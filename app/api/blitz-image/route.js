import { NextResponse } from 'next/server';

const ORIGIN = 'https://blitzcovers.com';
const META_ORIGIN = 'https://api.microlink.io';

const ALLOWED_IMAGE_HOSTS = new Set([
  'cdn.shopify.com',
  'blitzcovers.com',
  'www.blitzcovers.com',
  'cdn.shopifycdn.net'
]);

function validHandle(value = '') {
  return /^[a-z0-9][a-z0-9-]{0,120}$/i.test(value);
}

function allowedImageUrl(raw) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ALLOWED_IMAGE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store'
    });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveImage(productUrl) {
  const evaluate = `
    (() => {
      const bad = /(logo|favicon|icon|payment|badge|shopify|klarna|afterpay|sezzle|paypal|visa|mastercard|amex)/i;
      const images = Array.from(document.images || []);
      const scored = images
        .map((img) => {
          const src = img.currentSrc || img.src || '';
          const alt = img.alt || '';
          if (!src || bad.test(src + ' ' + alt)) return null;
          if (!/\\/cdn\\/shop\\/(files|products)\\//i.test(src) && !/cdn\\.shopify\\.com\\/s\\/files\\//i.test(src)) {
            return null;
          }

          const width = Number(img.naturalWidth || img.width || 0);
          const height = Number(img.naturalHeight || img.height || 0);
          const ratio = width && height ? width / height : 0;
          let score = 0;

          if (/product|card|skin|cover/i.test((img.className || '') + ' ' + alt)) score += 16;
          if (width >= 1000) score += 12;
          else if (width >= 700) score += 8;
          else if (width >= 400) score += 3;
          if (ratio >= 1.2 && ratio <= 2.2) score += 14;
          else if (ratio >= 0.8 && ratio <= 2.5) score += 5;
          if (/\\.(png|webp)(\\?|$)/i.test(src)) score += 3;

          return { src, score, width, height };
        })
        .filter(Boolean)
        .sort((a, b) => b.score - a.score);

      return scored[0]?.src || '';
    })()
  `;

  const endpoint =
    META_ORIGIN +
    '/?url=' +
    encodeURIComponent(productUrl) +
    '&meta=false&prerender=true&waitForSelector=img' +
    '&data.productImage.evaluate=' +
    encodeURIComponent(evaluate) +
    '&data.productImage.type=image';

  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AirCard-Card-Studio/4.4'
      },
      next: { revalidate: 2592000 }
    },
    20000
  );

  if (!response.ok) return '';

  const json = await response.json().catch(() => null);
  if (!json || json.status !== 'success') return '';

  const image = json?.data?.productImage || null;
  const imageUrl = image?.url || '';

  if (!imageUrl || !allowedImageUrl(imageUrl)) return '';

  const lowerUrl = imageUrl.toLowerCase();
  if (/(logo|favicon|icon|payment|badge|shopify|brandmark)/i.test(lowerUrl)) {
    return '';
  }

  const width = Number(image?.width || 0);
  const height = Number(image?.height || 0);
  if (width && height && width <= 320 && height <= 320) {
    return '';
  }

  return imageUrl;
}

export async function GET(request) {
  const handle = String(request.nextUrl.searchParams.get('handle') || '').trim().toLowerCase();

  if (!validHandle(handle)) {
    return new NextResponse('Invalid handle', { status: 400 });
  }

  const productCandidates = [
    ORIGIN + '/products/' + handle,
    ORIGIN + '/products/' + handle + '-1'
  ];

  let imageUrl = '';

  for (const productUrl of productCandidates) {
    try {
      imageUrl = await resolveImage(productUrl);
      if (imageUrl) break;
    } catch {}
  }

  if (!imageUrl) {
    return new NextResponse('Blitz artwork unavailable', {
      status: 404,
      headers: {
        'Cache-Control': 'public, max-age=300, s-maxage=900'
      }
    });
  }

  try {
    const upstream = await fetchWithTimeout(
      imageUrl,
      {
        redirect: 'follow',
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/jpeg,image/png,*/*',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1'
        },
        next: { revalidate: 2592000 }
      },
      15000
    );

    if (!upstream.ok) {
      return new NextResponse('Blitz image unavailable', { status: 502 });
    }

    const finalUrl = upstream.url || imageUrl;
    if (!allowedImageUrl(finalUrl)) {
      return new NextResponse('Unexpected Blitz image host', { status: 403 });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return new NextResponse('Blitz asset is not an image', { status: 415 });
    }

    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > 15 * 1024 * 1024) {
      return new NextResponse('Blitz image too large', { status: 413 });
    }

    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > 15 * 1024 * 1024) {
      return new NextResponse('Blitz image too large', { status: 413 });
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=604800',
        'CDN-Cache-Control': 'public, max-age=2592000, stale-while-revalidate=31536000',
        'Vercel-CDN-Cache-Control': 'public, max-age=2592000, stale-while-revalidate=31536000',
        'X-Blitz-Asset': 'product-image',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch {
    return new NextResponse('Blitz image resolver failed', { status: 502 });
  }
}

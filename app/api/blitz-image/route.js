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
  const endpoint =
    META_ORIGIN +
    '/?url=' +
    encodeURIComponent(productUrl) +
    '&meta=true';

  const response = await fetchWithTimeout(
    endpoint,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AirCard-Card-Studio/4.3'
      },
      next: { revalidate: 2592000 }
    },
    15000
  );

  if (!response.ok) return '';

  const json = await response.json().catch(() => null);
  if (!json || json.status !== 'success') return '';

  const image = json?.data?.image || null;
  const imageUrl = image?.url || '';

  // Never fall back to Microlink's logo field. That field is the storefront
  // branding, not product artwork, and was the cause of every Blitz card
  // showing the same Shopify/store logo.
  if (!imageUrl || !allowedImageUrl(imageUrl)) return '';

  const lowerUrl = imageUrl.toLowerCase();
  if (/(logo|favicon|shopify|brandmark|apple-touch-icon)/i.test(lowerUrl)) {
    return '';
  }

  const width = Number(image?.width || 0);
  const height = Number(image?.height || 0);

  // Reject tiny metadata images that are almost certainly branding/icons.
  if (width && height && width <= 512 && height <= 512) {
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

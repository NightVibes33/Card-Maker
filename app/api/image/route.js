import { NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set([
  'cdn.shopify.com',
  'www.animetowncreations.com',
  'animetowncreations.com',
  'stickyinkdesigns.com',
  'www.stickyinkdesigns.com',
  'cucucovers.com',
  'www.cucucovers.com',
  'styledcards.com',
  'www.styledcards.com'
]);

function isAllowed(url) {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 4;

async function fetchAllowedImage(startUrl, options) {
  let current = new URL(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isAllowed(current)) {
      throw new Error('Redirect host not allowed');
    }

    const response = await fetch(current, {
      ...options,
      redirect: 'manual'
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return { response, finalUrl: current };
    }

    if (hop === MAX_REDIRECTS) {
      throw new Error('Too many image redirects');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('Image redirect missing location');
    }

    const next = new URL(location, current);
    if (!isAllowed(next)) {
      throw new Error('Redirect host not allowed');
    }
    current = next;
  }

  throw new Error('Too many image redirects');
}

export async function GET(request) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw || raw.length > 2200) {
    return new NextResponse('Invalid url', { status: 400 });
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  if (!isAllowed(url)) {
    return new NextResponse('Host not allowed', { status: 403 });
  }

  const requestedWidth = Number(request.nextUrl.searchParams.get('w') || 0);
  const width = Number.isFinite(requestedWidth)
    ? Math.max(0, Math.min(1600, Math.floor(requestedWidth)))
    : 0;

  // Shopify's CDN can resize source artwork before it reaches our function.
  // Browse thumbnails use this; Studio/export continue to request the original.
  if (width >= 160 && (/^cdn\.shopify\.com$/i.test(url.hostname) || /(^|\.)cucucovers\.com$/i.test(url.hostname))) {
    url.searchParams.set('width', String(width));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const { response: upstream } = await fetchAllowedImage(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AirCard-Card-Studio/3.0 (+https://github.com/NightVibes33/Card-Maker)',
        Accept: 'image/avif,image/webp,image/apng,image/jpeg,image/png,*/*'
      },
      cache: 'force-cache',
      next: { revalidate: 31536000 }
    });

    if (!upstream.ok) {
      return new NextResponse('Image unavailable', { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (!contentType.startsWith('image/')) {
      return new NextResponse('Not an image', { status: 415 });
    }

    const declaredLength = Number(upstream.headers.get('content-length') || 0);
    if (declaredLength > 15 * 1024 * 1024) {
      return new NextResponse('Image too large', { status: 413 });
    }

    const buffer = await upstream.arrayBuffer();
    if (buffer.byteLength > 15 * 1024 * 1024) {
      return new NextResponse('Image too large', { status: 413 });
    }

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'CDN-Cache-Control': 'public, max-age=31536000, stale-while-revalidate=31536000',
        'Vercel-CDN-Cache-Control': 'public, max-age=31536000, stale-while-revalidate=31536000',
        'X-Content-Type-Options': 'nosniff'
      }
    });
  } catch (error) {
    console.error('image proxy failed', error);
    return new NextResponse('Image proxy failed', { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

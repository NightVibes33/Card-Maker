import { NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set([
  'cdn.shopify.com',
  'www.animetowncreations.com',
  'animetowncreations.com',
  'stickyinkdesigns.com',
  'www.stickyinkdesigns.com',
  'cucucovers.com',
  'www.cucucovers.com',
  'blitzcovers.com',
  'www.blitzcovers.com',
  'styledcards.com',
  'www.styledcards.com'
]);

function isAllowed(url) {
  return url.protocol === 'https:' && ALLOWED_HOSTS.has(url.hostname.toLowerCase());
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'AirCard-Card-Studio/3.0 (+https://github.com/NightVibes33/Card-Maker)',
        Accept: 'image/avif,image/webp,image/apng,image/jpeg,image/png,*/*'
      },
      cache: 'force-cache'
    });

    if (!upstream.ok) {
      return new NextResponse('Image unavailable', { status: 502 });
    }

    const finalUrl = new URL(upstream.url);
    if (!isAllowed(finalUrl)) {
      return new NextResponse('Redirect host not allowed', { status: 403 });
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
        'Cache-Control': 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000',
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

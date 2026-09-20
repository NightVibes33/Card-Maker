import { NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set([
  'cdn.myanimelist.net',
  'api-cdn.myanimelist.net',
  's4.anilist.co',
  'static.tvmaze.com'
]);

export async function GET(request) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw || raw.length > 1800) return new NextResponse('Invalid url', { status: 400 });

  let url;
  try {
    url = new URL(raw);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return new NextResponse('Host not allowed', { status: 403 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AirCard-Sticker-Studio/2.0',
        'Accept': 'image/avif,image/webp,image/apng,image/jpeg,image/png,*/*'
      },
      cache: 'force-cache'
    });

    if (!upstream.ok) return new NextResponse('Image unavailable', { status: 502 });

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
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

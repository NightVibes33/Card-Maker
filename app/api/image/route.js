import { NextResponse } from 'next/server';

const ALLOWED_HOSTS = new Set([
  'cdn.myanimelist.net',
  'api-cdn.myanimelist.net',
  'static.tvmaze.com'
]);

export async function GET(request) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw) return new NextResponse('Missing url', { status: 400 });

  let url;
  try {
    url = new URL(raw);
  } catch {
    return new NextResponse('Invalid url', { status: 400 });
  }

  if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname)) {
    return new NextResponse('Host not allowed', { status: 403 });
  }

  const upstream = await fetch(url, {
    headers: { 'User-Agent': 'AirCard-Studio/1.0' },
    next: { revalidate: 86400 }
  });
  if (!upstream.ok) return new NextResponse('Image unavailable', { status: 502 });

  const contentType = upstream.headers.get('content-type') || 'image/jpeg';
  if (!contentType.startsWith('image/')) return new NextResponse('Not an image', { status: 415 });

  const buffer = await upstream.arrayBuffer();
  if (buffer.byteLength > 12 * 1024 * 1024) return new NextResponse('Image too large', { status: 413 });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400, s-maxage=604800, immutable',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

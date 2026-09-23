import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { parseAllowedRemoteImageUrl } from '../../lib/imagePolicy';

export const runtime = 'nodejs';

const SAFE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/webp',
  'image/apng',
  'image/jpeg',
  'image/png',
  'image/gif'
]);
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_PROXY_OUTPUT_BYTES = 15 * 1024 * 1024;
const MAX_DECODED_IMAGE_PIXELS = 80_000_000;

function isAllowed(url) {
  return Boolean(parseAllowedRemoteImageUrl(url));
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 4;

async function readLimitedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) {
    throw new Error('Image too large');
  }

  if (!response.body) {
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('Image too large');
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel('Image too large').catch(() => {});
        throw new Error('Image too large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function fetchAllowedImage(startUrl, options) {
  let current = parseAllowedRemoteImageUrl(startUrl);
  if (!current) throw new Error('Redirect host not allowed');

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {

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

    const next = parseAllowedRemoteImageUrl(new URL(location, current));
    if (!next) {
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

  const url = parseAllowedRemoteImageUrl(raw);
  if (!url) {
    return new NextResponse('Host not allowed', { status: 403 });
  }

  const requestedWidth = Number(request.nextUrl.searchParams.get('w') || 0);
  const width = Number.isFinite(requestedWidth)
    ? Math.max(0, Math.min(3072, Math.floor(requestedWidth)))
    : 0;
  const requestedCrop = String(request.nextUrl.searchParams.get('crop') || '');
  const crop = requestedCrop.match(/^(\d+),(\d+),(\d+),(\d+)$/);
  const cropRect = crop
    ? { left: Number(crop[1]), top: Number(crop[2]), width: Number(crop[3]), height: Number(crop[4]) }
    : null;

  // Prefer origin/CDN resizing when it is known to be supported. Other
  // allowlisted hosts are normalized server-side below so a thumbnail request
  // can never silently return a multi-megapixel original to iPhone Safari.
  const upstreamResizeRequested =
    width >= 160 &&
    (/^cdn\.shopify\.com$/i.test(url.hostname) || /(^|\.)cucucovers\.com$/i.test(url.hostname));
  if (upstreamResizeRequested) {
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

    const contentType = (upstream.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!SAFE_IMAGE_TYPES.has(contentType)) {
      return new NextResponse('Unsupported image type', { status: 415 });
    }

    let buffer;
    try {
      buffer = await readLimitedBody(upstream, MAX_IMAGE_BYTES);
    } catch (error) {
      if (error?.message === 'Image too large') {
        return new NextResponse('Image too large', { status: 413 });
      }
      throw error;
    }

    let responseBody = buffer;
    let responseType = contentType;

    // Always enforce requested dimensions ourselves. Known CDNs still receive
    // the width hint above to reduce transfer size, but the proxy never trusts
    // an upstream to have actually honored it before the image reaches iOS.
    const shouldNormalize = width >= 160 || Boolean(cropRect);

    if (shouldNormalize) {
      try {
        let pipeline = sharp(Buffer.from(buffer), {
          animated: false,
          limitInputPixels: MAX_DECODED_IMAGE_PIXELS
        }).rotate();

        if (cropRect) {
          const meta = await pipeline.metadata();
          if (
            cropRect.left < 0 || cropRect.top < 0 ||
            cropRect.width < 1 || cropRect.height < 1 ||
            cropRect.left + cropRect.width > Number(meta.width || 0) ||
            cropRect.top + cropRect.height > Number(meta.height || 0)
          ) {
            return new NextResponse('Invalid crop', { status: 400 });
          }
          pipeline = pipeline.extract(cropRect);
        }

        if (width >= 160) {
          pipeline = pipeline.resize({
            width,
            withoutEnlargement: true,
            fit: 'inside'
          });
        }

        responseBody = await pipeline
          .webp({
            quality: width <= 800 ? 84 : 92,
            effort: 4
          })
          .toBuffer();
        responseType = 'image/webp';
      } catch (error) {
        console.error('image proxy resize failed', error);
        return new NextResponse('Image resize failed', { status: 422 });
      }
    }

    if (Number(responseBody?.byteLength || 0) > MAX_PROXY_OUTPUT_BYTES) {
      return new NextResponse('Processed image too large', { status: 413 });
    }

    return new NextResponse(responseBody, {
      headers: {
        'Content-Type': responseType,
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

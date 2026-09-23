import { NextResponse } from 'next/server';
import sharp from 'sharp';
import { IMAGE_PROXY_VERSION } from '../../../lib/imagePolicy';

export const runtime = 'nodejs';

const ALLOWED_HOSTS = new Set([
  'cdn.shopify.com',
  'cucucovers.com',
  'www.cucucovers.com',
  'animedeskmat.com',
  'www.animedeskmat.com'
]);

const SAFE_IMAGE_TYPES = new Set([
  'image/avif',
  'image/webp',
  'image/apng',
  'image/jpeg',
  'image/png',
  'image/gif'
]);
const MAX_ANALYSIS_BYTES = 8 * 1024 * 1024;
const MAX_ANALYSIS_PIXELS = 40_000_000;

function allowed(url) {
  return (
    url.protocol === 'https:' &&
    (!url.port || url.port === '443') &&
    !url.username &&
    !url.password &&
    ALLOWED_HOSTS.has(url.hostname.toLowerCase())
  );
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 4;

async function readLimitedBody(response, maxBytes) {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('CUCU artwork too large');

  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > maxBytes) throw new Error('CUCU artwork too large');
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
        await reader.cancel('CUCU artwork too large').catch(() => {});
        throw new Error('CUCU artwork too large');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks, total);
}

async function fetchAllowedArtwork(startUrl, options) {
  let current = new URL(startUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!allowed(current)) {
      throw new Error('CUCU artwork redirect host not allowed');
    }

    const response = await fetch(current, {
      ...options,
      redirect: 'manual'
    });

    if (!REDIRECT_STATUSES.has(response.status)) {
      return response;
    }

    if (hop === MAX_REDIRECTS) {
      throw new Error('Too many CUCU artwork redirects');
    }

    const location = response.headers.get('location');
    if (!location) {
      throw new Error('CUCU artwork redirect missing location');
    }

    const next = new URL(location, current);
    if (!allowed(next)) {
      throw new Error('CUCU artwork redirect host not allowed');
    }
    current = next;
  }

  throw new Error('Too many CUCU artwork redirects');
}

function proxy(url, width = 0) {
  return '/api/image?url=' + encodeURIComponent(url.toString()) +
    (width ? '&w=' + width : '') +
    '&v=' + encodeURIComponent(IMAGE_PROXY_VERSION);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export async function GET(request) {
  const raw = request.nextUrl.searchParams.get('url');
  if (!raw || raw.length > 2200) {
    return NextResponse.json({ error: 'Invalid image url' }, { status: 400 });
  }

  let source;
  try {
    source = new URL(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid image url' }, { status: 400 });
  }

  if (!allowed(source)) {
    return NextResponse.json({ error: 'Image host not allowed' }, { status: 403 });
  }

  const analysisUrl = new URL(source);
  analysisUrl.searchParams.set('width', '560');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);

  try {
    const response = await fetchAllowedArtwork(analysisUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'image/avif,image/webp,image/jpeg,image/png,*/*',
        'User-Agent': 'AirCard-Card-Studio/5.0'
      },
      next: { revalidate: 2592000 }
    });

    if (!response.ok) {
      throw new Error('CUCU artwork returned ' + response.status);
    }

    const type = (response.headers.get('content-type') || '')
      .split(';', 1)[0]
      .trim()
      .toLowerCase();
    if (!SAFE_IMAGE_TYPES.has(type)) {
      throw new Error('CUCU artwork format is not supported');
    }

    const buffer = await readLimitedBody(response, MAX_ANALYSIS_BYTES);
    const metadata = await sharp(buffer, {
      animated: false,
      limitInputPixels: MAX_ANALYSIS_PIXELS
    }).metadata();
    const rawWidth = Number(metadata.width || 0);
    const rawHeight = Number(metadata.height || 0);
    const orientation = Number(metadata.orientation || 1);
    const swapsAxes = orientation >= 5 && orientation <= 8;
    const naturalWidth = swapsAxes ? rawHeight : rawWidth;
    const naturalHeight = swapsAxes ? rawWidth : rawHeight;
    if (!naturalWidth || !naturalHeight) throw new Error('CUCU artwork dimensions unavailable');

    const naturalRatio = naturalWidth / naturalHeight;
    const prepared = await sharp(buffer, {
      animated: false,
      limitInputPixels: MAX_ANALYSIS_PIXELS
    })
      .rotate()
      .resize({ width: 128, height: 128, fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const data = prepared.data;
    const width = prepared.info.width;
    const height = prepared.info.height;
    const total = width * height;
    let opaque = 0;
    let nearWhite = 0;
    let colorful = 0;
    let luminanceSum = 0;
    let luminanceSqSum = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];

        if (a < 20) continue;
        opaque += 1;

        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const spread = max - min;
        const lum = (r + g + b) / 3;
        const white = r > 242 && g > 242 && b > 242;

        if (white) nearWhite += 1;
        if (spread > 48 && lum > 35 && lum < 235) colorful += 1;
        luminanceSum += lum;
        luminanceSqSum += lum * lum;

        if (!white || spread > 18 || lum < 235) {
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }

    const safeOpaque = Math.max(1, opaque);
    const whiteRatio = nearWhite / safeOpaque;
    const colorfulRatio = colorful / safeOpaque;
    const mean = luminanceSum / safeOpaque;
    const variance = Math.max(0, luminanceSqSum / safeOpaque - mean * mean);

    let crop = null;
    let effectiveRatio = naturalRatio;

    if (maxX >= minX && maxY >= minY) {
      const pad = 1;
      const left = Math.max(0, minX - pad);
      const top = Math.max(0, minY - pad);
      const right = Math.min(width - 1, maxX + pad);
      const bottom = Math.min(height - 1, maxY + pad);
      const cropW = right - left + 1;
      const cropH = bottom - top + 1;
      const cropCoverage = (cropW * cropH) / Math.max(1, total);
      const cropRatio = cropW / Math.max(1, cropH);

      if (
        (whiteRatio > 0.12 || opaque / Math.max(1, total) < 0.92) &&
        cropCoverage > 0.14 &&
        cropCoverage < 0.94 &&
        cropRatio >= 1.25 &&
        cropRatio <= 2.08
      ) {
        crop = {
          x: clamp(left / width, 0, 1),
          y: clamp(top / height, 0, 1),
          w: clamp(cropW / width, 0.01, 1),
          h: clamp(cropH / height, 0.01, 1)
        };
        effectiveRatio = cropRatio;
      }
    }

    const nearlyBlank = variance < 120 && colorfulRatio < 0.012;
    const cardLike = effectiveRatio >= 1.25 && effectiveRatio <= 2.08;
    const usable = !nearlyBlank && cardLike;

    return NextResponse.json(
      {
        usable,
        crop,
        ratio: effectiveRatio,
        naturalWidth,
        naturalHeight,
        // The shared inspector is the canonical media source for every
        // catalog provider. Keep the proxy URLs identical across CUCU and
        // AnimeDeskMat; crop metadata above is applied by the same renderer.
        thumbnail: proxy(source, 560),
        full: proxy(source),
        quality: {
          whiteRatio: Math.round(whiteRatio * 1000) / 1000,
          colorfulRatio: Math.round(colorfulRatio * 1000) / 1000,
          variance: Math.round(variance)
        }
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=86400, s-maxage=2592000, stale-while-revalidate=31536000',
          'CDN-Cache-Control': 'public, max-age=2592000, stale-while-revalidate=31536000',
          'Vercel-CDN-Cache-Control': 'public, max-age=2592000, stale-while-revalidate=31536000'
        }
      }
    );
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || 'Artwork inspection failed', usable: false },
      {
        status: 502,
        headers: { 'Cache-Control': 'public, max-age=60, s-maxage=300' }
      }
    );
  } finally {
    clearTimeout(timer);
  }
}

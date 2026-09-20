import { NextResponse } from 'next/server';

const ORIGIN = 'https://cucucovers.com';
const COLLECTION = 'all-card-covers';
const SHOPIFY_PAGE_SIZE = 250;
const FALLBACK_TOTAL = 2199;

const pageCache = new Map();
let countCache = null;

function cleanText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeImageUrl(raw) {
  if (!raw) return '';
  try {
    if (raw.startsWith('//')) return 'https:' + raw;
    return new URL(raw, ORIGIN).toString();
  } catch {
    return '';
  }
}

function imageProxy(url) {
  return '/api/image?url=' + encodeURIComponent(url);
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': 'AirCard-Card-Studio/4.0 (+https://github.com/NightVibes33/Card-Maker)',
        Accept: options.headers?.Accept || '*/*',
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getCollectionTotal() {
  const now = Date.now();
  if (countCache && countCache.expires > now) return countCache.value;

  let total = FALLBACK_TOTAL;
  try {
    const response = await fetchWithTimeout(
      ORIGIN + '/collections/' + COLLECTION,
      { headers: { Accept: 'text/html,application/xhtml+xml' } },
      9000
    );

    if (response.ok) {
      const html = await response.text();
      const patterns = [
        /Show\s+([\d,]+)\s+results/i,
        /([\d,]+)\s+items/i,
        /([\d,]+)\s+designs/i
      ];

      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (!match) continue;
        const parsed = Number(match[1].replace(/,/g, ''));
        if (Number.isFinite(parsed) && parsed > 0) {
          total = parsed;
          break;
        }
      }
    }
  } catch {}

  countCache = { value: total, expires: now + 30 * 60 * 1000 };
  return total;
}

async function getShopifyPage(page) {
  const key = String(page);
  const now = Date.now();
  const cached = pageCache.get(key);
  if (cached && cached.expires > now) return cached.promise;

  const promise = (async () => {
    const url =
      ORIGIN +
      '/collections/' +
      COLLECTION +
      '/products.json?limit=' +
      SHOPIFY_PAGE_SIZE +
      '&page=' +
      page;

    const response = await fetchWithTimeout(url, {
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error('CUCU collection page ' + page + ' returned ' + response.status);
    }

    const json = await response.json();
    return Array.isArray(json?.products) ? json.products : [];
  })();

  pageCache.set(key, { promise, expires: now + 30 * 60 * 1000 });

  try {
    return await promise;
  } catch (error) {
    pageCache.delete(key);
    throw error;
  }
}

function flattenProduct(product) {
  const handle = String(product?.handle || '').trim();
  if (!handle) return null;

  const images = Array.isArray(product?.images) ? product.images : [];
  const candidates = [];

  for (const image of images) {
    const src = normalizeImageUrl(
      typeof image === 'string' ? image : image?.src || image?.url || ''
    );
    if (src && !candidates.includes(src)) candidates.push(src);
    if (candidates.length >= 8) break;
  }

  const featured = normalizeImageUrl(product?.image?.src || product?.image || '');
  if (featured && !candidates.includes(featured)) candidates.unshift(featured);

  if (!candidates.length) return null;

  const title = cleanText(product?.title || handle.replace(/[-_]+/g, ' '));
  const tags = Array.isArray(product?.tags) ? product.tags : [];

  return {
    id: 'cucu-' + handle,
    title,
    subtitle: 'CUCU Covers',
    image: imageProxy(candidates[0]),
    candidateImages: candidates.slice(0, 8).map(imageProxy),
    source: 'CUCU Covers',
    sourceUrl: ORIGIN + '/products/' + handle,
    mediaType: 'premade-card-skin',
    cleanFilter: 'collection-source-media',
    mediaAlt: cleanText(images[0]?.alt || title),
    collection: COLLECTION,
    tags
  };
}

export async function GET(request) {
  const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1);
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 36);

  const page = Math.max(1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1));
  const limit = Math.max(12, Math.min(48, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 36)));

  try {
    const total = await getCollectionTotal();
    const startIndex = (page - 1) * limit;
    const endIndexExclusive = Math.min(startIndex + limit, total);

    if (startIndex >= total) {
      return NextResponse.json({
        results: [],
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: false,
        source: 'CUCU Covers · All Card Covers',
        collectionUrl: ORIGIN + '/collections/' + COLLECTION
      });
    }

    const firstSourcePage = Math.floor(startIndex / SHOPIFY_PAGE_SIZE) + 1;
    const lastSourcePage = Math.floor((Math.max(startIndex, endIndexExclusive - 1)) / SHOPIFY_PAGE_SIZE) + 1;

    const sourcePages = await Promise.all(
      Array.from(
        { length: lastSourcePage - firstSourcePage + 1 },
        (_, index) => getShopifyPage(firstSourcePage + index)
      )
    );

    const combined = sourcePages.flat();
    const localStart = startIndex - (firstSourcePage - 1) * SHOPIFY_PAGE_SIZE;
    const wanted = combined.slice(localStart, localStart + limit);
    const results = wanted.map(flattenProduct).filter(Boolean);

    return NextResponse.json(
      {
        results,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: endIndexExclusive < total,
        source: 'CUCU Covers · All Card Covers',
        collectionUrl: ORIGIN + '/collections/' + COLLECTION,
        upstream: {
          collection: COLLECTION,
          shopifyPageSize: SHOPIFY_PAGE_SIZE
        }
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=3600'
        }
      }
    );
  } catch (error) {
    console.error('CUCU catalog failed', error);
    return NextResponse.json(
      {
        error: error?.message || 'CUCU catalog failed',
        results: [],
        page,
        limit: requestedLimit,
        total: FALLBACK_TOTAL,
        source: 'CUCU Covers · All Card Covers'
      },
      { status: 502 }
    );
  }
}

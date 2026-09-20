import { NextResponse } from 'next/server';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = 'credit-card-cover';
const SHOPIFY_PAGE_SIZE = 250;
const MAX_SOURCE_PAGES = 6;

let catalogCache = null;

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

function assetScore(raw, image = {}) {
  const url = String(raw || '').toLowerCase();
  const alt = cleanText(image?.alt || '').toLowerCase();
  const filename = url.split('/').pop()?.split('?')[0] || '';
  let score = 0;

  if (/\.png$/i.test(filename)) score += 9;
  else if (/\.(webp|jpe?g)$/i.test(filename)) score += 3;

  if (/\/cdn\/shop\/(files|products)\//i.test(url)) score += 6;

  if (/(mockup|lifestyle|customer|review|package|packaging|install|instruction|size[-_ ]?guide|material|how[-_ ]?to)/i.test(filename + ' ' + alt)) {
    score -= 40;
  }

  const width = Number(image?.width || 0);
  const height = Number(image?.height || 0);
  const ratio = width && height ? width / height : 0;

  if (width >= 1000) score += 4;
  else if (width >= 700) score += 2;

  if (ratio >= 1.35 && ratio <= 1.9) score += 12;
  else if (ratio >= 1.1 && ratio <= 2.1) score += 4;

  return score;
}

async function fetchWithTimeout(url, options = {}, timeout = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': 'AirCard-Card-Studio/4.1 (+https://github.com/NightVibes33/Card-Maker)',
        Accept: options.headers?.Accept || '*/*',
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSourcePage(page) {
  const url =
    ORIGIN +
    '/collections/' +
    COLLECTION +
    '/products.json?limit=' +
    SHOPIFY_PAGE_SIZE +
    '&page=' +
    page;

  let lastStatus = 0;

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        headers: { Accept: 'application/json' }
      });
      lastStatus = response.status;

      if (response.ok) {
        const json = await response.json();
        return Array.isArray(json?.products) ? json.products : [];
      }

      if (response.status < 500 && response.status !== 429) {
        throw new Error('Blitz collection page ' + page + ' returned ' + response.status);
      }
    } catch (error) {
      if (attempt >= 4) throw error;
    }

    if (attempt < 4) {
      await new Promise((resolve) => setTimeout(resolve, 450 * attempt));
    }
  }

  throw new Error('Blitz collection page ' + page + ' returned ' + lastStatus);
}

function isRealCardCover(product) {
  const title = cleanText(product?.title || '');
  const evidence = [
    title,
    product?.handle || '',
    product?.product_type || '',
    cleanText(product?.body_html || ''),
    Array.isArray(product?.tags) ? product.tags.join(' ') : product?.tags || ''
  ].join(' ');

  if (/(customization|custom card|full card customization|half card customization|priority|packaging|voucher|gift card|insurance)/i.test(title)) {
    return false;
  }

  return /(credit card skin|credit card cover|card skin|card cover|debit card cover|debit card skin)/i.test(evidence);
}

function flattenProduct(product) {
  if (!isRealCardCover(product)) return null;

  const handle = String(product?.handle || '').trim();
  if (!handle) return null;

  const images = Array.isArray(product?.images) ? product.images : [];
  const ranked = [];

  for (const image of images) {
    const src = normalizeImageUrl(
      typeof image === 'string' ? image : image?.src || image?.url || ''
    );
    if (!src) continue;
    ranked.push({
      src,
      score: assetScore(src, typeof image === 'string' ? {} : image),
      alt: cleanText(typeof image === 'string' ? '' : image?.alt || '')
    });
  }

  const featuredRaw = product?.image?.src || product?.image || '';
  const featured = normalizeImageUrl(featuredRaw);
  if (featured) {
    ranked.push({
      src: featured,
      score: assetScore(featured, typeof product?.image === 'object' ? product.image : {}),
      alt: cleanText(product?.image?.alt || '')
    });
  }

  const seen = new Set();
  const candidates = ranked
    .sort((a, b) => b.score - a.score)
    .filter((asset) => {
      if (!asset.src || seen.has(asset.src)) return false;
      seen.add(asset.src);
      return true;
    })
    .slice(0, 8);

  if (!candidates.length) return null;

  const title = cleanText(product?.title || handle.replace(/[-_]+/g, ' '));

  return {
    id: 'blitz-' + handle,
    title,
    subtitle: 'Blitz Covers',
    image: imageProxy(candidates[0].src),
    candidateImages: candidates.map((asset) => imageProxy(asset.src)),
    directAssetUrls: candidates.map((asset) => asset.src),
    source: 'Blitz Covers',
    sourceUrl: ORIGIN + '/products/' + handle,
    mediaType: 'premade-card-skin',
    cleanFilter: 'direct-shopify-card-art',
    assetMode: 'direct-card-art',
    mediaAlt: candidates[0].alt || title,
    collection: COLLECTION
  };
}

async function getCatalog() {
  const now = Date.now();
  if (catalogCache && catalogCache.expires > now) return catalogCache.promise;

  const promise = (async () => {
    const all = [];

    for (let page = 1; page <= MAX_SOURCE_PAGES; page += 1) {
      const batch = await fetchSourcePage(page);
      all.push(...batch);
      if (batch.length < SHOPIFY_PAGE_SIZE) break;
    }

    const seen = new Set();
    return all
      .map(flattenProduct)
      .filter(Boolean)
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      });
  })();

  catalogCache = {
    promise,
    expires: now + 30 * 60 * 1000
  };

  try {
    return await promise;
  } catch (error) {
    catalogCache = null;
    throw error;
  }
}

export async function GET(request) {
  const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1);
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 24);

  const page = Math.max(1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1));
  const limit = Math.max(12, Math.min(48, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 24)));

  try {
    const catalog = await getCatalog();
    const total = catalog.length;
    const start = (page - 1) * limit;
    const results = catalog.slice(start, start + limit);

    return NextResponse.json(
      {
        results,
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: start + results.length < total,
        source: 'Blitz Covers · Full Card Covers',
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
    console.error('Blitz catalog failed', error);
    return NextResponse.json(
      {
        error: error?.message || 'Blitz catalog failed',
        results: [],
        page,
        limit,
        total: 0,
        source: 'Blitz Covers · Full Card Covers'
      },
      { status: 502 }
    );
  }
}

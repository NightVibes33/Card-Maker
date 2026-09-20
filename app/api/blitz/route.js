import { NextResponse } from 'next/server';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = 'credit-card-cover';
const SHOPIFY_PAGE_SIZE = 250;
const MAX_SOURCE_PAGES = 6;
const MAX_READER_PAGES = 12;
const READER_ORIGIN = 'https://r.jina.ai/http://blitzcovers.com';

let catalogCache = null;
const productCache = new Map();

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
    const cleaned = String(raw).replace(/&amp;/g, '&').replace(/[),.;]+$/g, '');
    if (cleaned.startsWith('//')) return 'https:' + cleaned;
    return new URL(cleaned, ORIGIN).toString();
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

  if (/\/cdn\/shop\/(files|products)\//i.test(url) || /cdn\.shopify\.com\/s\/files/i.test(url)) score += 8;

  if (/(mockup|lifestyle|customer|review|package|packaging|install|instruction|size[-_ ]?guide|material|how[-_ ]?to|logo)/i.test(filename + ' ' + alt)) {
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
        'User-Agent': options.headers?.['User-Agent'] ||
          'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept: options.headers?.Accept || 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function isExcluded(title = '', handle = '') {
  return /(customization|custom card|full card customization|half card customization|priority|packaging|voucher|gift card|insurance)/i.test(
    title + ' ' + handle
  );
}

function isRealCardCover(product) {
  const title = cleanText(product?.title || '');
  const handle = String(product?.handle || '');
  const evidence = [
    title,
    handle,
    product?.product_type || '',
    cleanText(product?.body_html || ''),
    Array.isArray(product?.tags) ? product.tags.join(' ') : product?.tags || ''
  ].join(' ');

  if (isExcluded(title, handle)) return false;

  return /(credit card skin|credit card cover|card skin|card cover|debit card cover|debit card skin)/i.test(evidence);
}

function buildItem({ handle, title, assets }) {
  if (!handle || isExcluded(title, handle)) return null;

  const seen = new Set();
  const ranked = (assets || [])
    .map((asset) => {
      const src = normalizeImageUrl(typeof asset === 'string' ? asset : asset?.src || asset?.url || '');
      return src
        ? {
            src,
            score: assetScore(src, typeof asset === 'string' ? {} : asset),
            alt: cleanText(typeof asset === 'string' ? '' : asset?.alt || '')
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .filter((asset) => {
      if (seen.has(asset.src)) return false;
      seen.add(asset.src);
      return true;
    })
    .slice(0, 8);

  if (!ranked.length) return null;

  const cleanTitle = cleanText(title || handle.replace(/[-_]+/g, ' '));

  return {
    id: 'blitz-' + handle,
    title: cleanTitle,
    subtitle: 'Blitz Covers',
    image: imageProxy(ranked[0].src),
    candidateImages: ranked.map((asset) => imageProxy(asset.src)),
    directAssetUrls: ranked.map((asset) => asset.src),
    source: 'Blitz Covers',
    sourceUrl: ORIGIN + '/products/' + handle,
    mediaType: 'premade-card-skin',
    cleanFilter: 'direct-shopify-card-art',
    assetMode: 'direct-card-art',
    mediaAlt: ranked[0].alt || cleanTitle,
    collection: COLLECTION
  };
}

async function fetchShopifyPage(page) {
  const url =
    ORIGIN +
    '/collections/' +
    COLLECTION +
    '/products.json?limit=' +
    SHOPIFY_PAGE_SIZE +
    '&page=' +
    page;

  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: 'application/json',
      Referer: ORIGIN + '/collections/' + COLLECTION
    }
  });

  if (!response.ok) {
    const error = new Error('Blitz collection page ' + page + ' returned ' + response.status);
    error.status = response.status;
    throw error;
  }

  const json = await response.json();
  return Array.isArray(json?.products) ? json.products : [];
}

async function getDirectShopifyCatalog() {
  const all = [];

  for (let page = 1; page <= MAX_SOURCE_PAGES; page += 1) {
    const batch = await fetchShopifyPage(page);
    all.push(...batch);
    if (batch.length < SHOPIFY_PAGE_SIZE) break;
  }

  const seen = new Set();
  return all
    .filter(isRealCardCover)
    .map((product) =>
      buildItem({
        handle: product.handle,
        title: product.title,
        assets: [
          ...(Array.isArray(product.images) ? product.images : []),
          product.image
        ]
      })
    )
    .filter(Boolean)
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
}

function readerUrl(path) {
  return READER_ORIGIN + path;
}

async function fetchReader(path, timeout = 18000) {
  const response = await fetchWithTimeout(
    readerUrl(path),
    {
      headers: {
        'User-Agent': 'AirCard-Card-Studio/4.2',
        Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.5'
      }
    },
    timeout
  );

  if (!response.ok) {
    throw new Error('Blitz reader returned ' + response.status + ' for ' + path);
  }

  return response.text();
}

function parseReaderCollection(markdown) {
  const products = [];
  const seen = new Set();

  const markdownLink =
    /\[([^\]]{1,160})\]\(https?:\/\/(?:www\.)?blitzcovers\.com\/products\/([a-z0-9][a-z0-9-]*)(?:[^)]*)\)/gi;
  let match;

  while ((match = markdownLink.exec(markdown))) {
    const title = cleanText(match[1]);
    const handle = match[2];
    if (!handle || seen.has(handle) || isExcluded(title, handle)) continue;
    seen.add(handle);
    products.push({ handle, title });
  }

  if (!products.length) {
    const plain = /https?:\/\/(?:www\.)?blitzcovers\.com\/products\/([a-z0-9][a-z0-9-]*)/gi;
    while ((match = plain.exec(markdown))) {
      const handle = match[1];
      if (!handle || seen.has(handle) || isExcluded('', handle)) continue;
      seen.add(handle);
      products.push({ handle, title: handle.replace(/[-_]+/g, ' ') });
    }
  }

  return products;
}

function parseReaderAssets(markdown) {
  const matches = String(markdown).match(
    /https?:\/\/(?:www\.)?blitzcovers\.com\/cdn\/shop\/(?:files|products)\/[^\s)"'<>]+|https?:\/\/cdn\.shopify\.com\/s\/files\/[^\s)"'<>]+/gi
  ) || [];

  const seen = new Set();
  return matches
    .map(normalizeImageUrl)
    .filter((url) => {
      if (!url || seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}

async function hydrateReaderProduct(product) {
  const now = Date.now();
  const cached = productCache.get(product.handle);
  if (cached && cached.expires > now) return cached.promise;

  const promise = (async () => {
    const markdown = await fetchReader('/products/' + product.handle);
    const assets = parseReaderAssets(markdown);
    return buildItem({
      handle: product.handle,
      title: product.title,
      assets
    });
  })();

  productCache.set(product.handle, {
    promise,
    expires: now + 6 * 60 * 60 * 1000
  });

  try {
    return await promise;
  } catch (error) {
    productCache.delete(product.handle);
    return null;
  }
}

async function getReaderIndex() {
  const all = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_READER_PAGES; page += 1) {
    const suffix =
      '/collections/' +
      COLLECTION +
      (page > 1 ? '?page=' + page : '');

    const markdown = await fetchReader(suffix);
    const found = parseReaderCollection(markdown);
    let added = 0;

    for (const product of found) {
      if (seen.has(product.handle)) continue;
      seen.add(product.handle);
      all.push(product);
      added += 1;
    }

    if (!found.length || (page > 1 && added === 0)) break;
    if (/Page\s+\d+\s+of\s+\d+/i.test(markdown)) {
      const pageMatch = markdown.match(/Page\s+(\d+)\s+of\s+(\d+)/i);
      if (pageMatch && Number(pageMatch[1]) >= Number(pageMatch[2])) break;
    }
  }

  return all;
}

async function getCatalog() {
  const now = Date.now();
  if (catalogCache && catalogCache.expires > now) return catalogCache.promise;

  const promise = (async () => {
    try {
      const direct = await getDirectShopifyCatalog();
      if (direct.length >= 100) {
        return { mode: 'shopify-json', items: direct };
      }
    } catch (error) {
      console.warn('Blitz direct Shopify blocked; using reader fallback:', error?.message || error);
    }

    const index = await getReaderIndex();
    if (!index.length) {
      throw new Error('Blitz reader returned no product index');
    }

    return { mode: 'reader', index };
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

    let total;
    let results;
    let mode = catalog.mode;

    if (catalog.mode === 'shopify-json') {
      total = catalog.items.length;
      const start = (page - 1) * limit;
      results = catalog.items.slice(start, start + limit);
    } else {
      total = catalog.index.length;
      const start = (page - 1) * limit;
      const pageIndex = catalog.index.slice(start, start + limit);
      results = (await Promise.all(pageIndex.map(hydrateReaderProduct))).filter(Boolean);
    }

    const totalPages = Math.max(1, Math.ceil(total / limit));

    return NextResponse.json(
      {
        results,
        page,
        limit,
        total,
        totalPages,
        hasMore: page < totalPages,
        source: 'Blitz Covers · Full Card Covers',
        collectionUrl: ORIGIN + '/collections/' + COLLECTION,
        upstream: {
          collection: COLLECTION,
          mode,
          directShopifyBlocked: mode === 'reader'
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

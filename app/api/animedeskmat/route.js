import { NextResponse } from 'next/server';
import { IMAGE_PROXY_VERSION } from '../../lib/imagePolicy';

const ORIGIN = 'https://www.animedeskmat.com';
const COLLECTION = 'anime-credit-card-skins';
const SHOPIFY_PAGE_SIZE = 100;
// Verified catalog size for the dedicated anime credit-card-skins collection.
// Keep this explicit so the shared Discover UI can report the combined Anime total
// without crawling the entire Shopify collection on every request.
const KNOWN_COLLECTION_TOTAL = 907;

const pageCache = new Map();
const productCache = new Map();
const searchCache = new Map();

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
    if (String(raw).startsWith('//')) return 'https:' + raw;
    return new URL(String(raw), ORIGIN).toString();
  } catch {
    return '';
  }
}

function imageProxy(url, width = 0) {
  return '/api/image?url=' + encodeURIComponent(url) +
    (width ? '&w=' + width : '') +
    '&v=' + encodeURIComponent(IMAGE_PROXY_VERSION);
}

function plainFullCoverAsset(raw) {
  const src = normalizeImageUrl(raw);
  if (!src) return '';

  let filename = '';
  try {
    filename = decodeURIComponent(new URL(src).pathname.split('/').pop() || '').toLowerCase();
  } catch {
    return '';
  }

  if (/with[-_](?:chip|window)|half[-_]cover|4[-_]sets?/.test(filename)) return '';
  if (!/full-cover(?:_[a-z0-9-]+)?\.(?:png|webp|jpe?g)$/.test(filename)) return '';
  return src;
}

function originalFullCoverAsset(src) {
  try {
    const url = new URL(src);
    // Shopify theme URLs often insert a size suffix before the extension.
    // The inspector verifies the unsuffixed asset before the sized fallback.
    const originalPath = url.pathname.replace(/_\d+x\d*(?:@\d+x)?(?=\.(?:png|webp|jpe?g)$)/i, '');
    if (originalPath === url.pathname) return '';
    url.pathname = originalPath;
    return plainFullCoverAsset(url.toString());
  } catch {
    return '';
  }
}

async function fetchWithTimeout(url, options = {}, timeout = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      next: options.next || { revalidate: 21600 },
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
        Accept: options.headers?.Accept || 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: ORIGIN + '/collections/' + COLLECTION,
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function getCollectionPage(page) {
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

    let lastStatus = 0;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      let retryDelay = 800 * attempt;

      try {
        const response = await fetchWithTimeout(url);
        lastStatus = response.status;

        if (response.ok) {
          const json = await response.json();
          return Array.isArray(json?.products) ? json.products : [];
        }

        if (response.status === 429) {
          const retryAfter = Number(response.headers.get('retry-after') || 0);
          retryDelay = retryAfter > 0
            ? Math.min(10000, Math.max(2000, retryAfter * 1000))
            : 2200 * attempt;
        } else if (response.status >= 500) {
          retryDelay = 1000 * attempt;
        } else {
          throw new Error('AnimeDeskMat collection page ' + page + ' returned ' + response.status);
        }
      } catch (error) {
        if (attempt >= 5) throw error;
      }

      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    throw new Error('AnimeDeskMat collection page ' + page + ' returned ' + lastStatus);
  })();

  pageCache.set(key, { promise, expires: now + 6 * 60 * 60 * 1000 });

  try {
    return await promise;
  } catch (error) {
    pageCache.delete(key);
    throw error;
  }
}

async function getProduct(handle) {
  const key = String(handle || '').trim();
  if (!key) return null;

  const now = Date.now();
  const cached = productCache.get(key);
  if (cached && cached.expires > now) return cached.promise;

  const promise = (async () => {
    const response = await fetchWithTimeout(
      ORIGIN + '/products/' + encodeURIComponent(key) + '.js',
      {},
      12000
    );
    if (!response.ok) {
      throw new Error('AnimeDeskMat product returned ' + response.status);
    }
    const json = await response.json();
    return json?.product || json || null;
  })();

  productCache.set(key, { promise, expires: now + 6 * 60 * 60 * 1000 });

  try {
    return await promise;
  } catch (error) {
    productCache.delete(key);
    throw error;
  }
}

async function searchProducts(query) {
  const normalized = cleanText(query).toLowerCase();
  if (!normalized) return [];

  const now = Date.now();
  const cached = searchCache.get(normalized);
  if (cached && cached.expires > now) return cached.promise;

  const promise = (async () => {
    const searchQuery = normalized + ' credit card skins';
    const url =
      ORIGIN +
      '/search/suggest.json?q=' +
      encodeURIComponent(searchQuery) +
      '&resources[type]=product&resources[limit]=10';

    const response = await fetchWithTimeout(url, {}, 12000);
    if (!response.ok) {
      throw new Error('AnimeDeskMat search returned ' + response.status);
    }

    const json = await response.json();
    const suggestions = Array.isArray(json?.resources?.results?.products)
      ? json.resources.results.products
      : [];

    const handles = [];
    const seen = new Set();

    for (const product of suggestions) {
      const title = cleanText(product?.title || '');
      const handle = String(product?.handle || '').trim();
      if (
        !handle ||
        seen.has(handle) ||
        !/credit card skins?/i.test(title)
      ) continue;
      seen.add(handle);
      handles.push(handle);
    }

    const products = await Promise.all(
      handles.map((handle) => getProduct(handle).catch(() => null))
    );
    return products.filter(Boolean);
  })();

  searchCache.set(normalized, { promise, expires: now + 60 * 60 * 1000 });

  try {
    return await promise;
  } catch (error) {
    searchCache.delete(normalized);
    throw error;
  }
}

function flattenProduct(product) {
  const handle = String(product?.handle || '').trim();
  if (!handle) return null;

  const rawImages = Array.isArray(product?.images) ? product.images : [];
  const candidates = [];
  const seen = new Set();

  for (const image of rawImages) {
    const raw = typeof image === 'string'
      ? image
      : image?.src || image?.url || '';
    const src = plainFullCoverAsset(raw);
    if (!src) continue;
    for (const candidate of [originalFullCoverAsset(src), src]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      candidates.push({
        src: candidate,
        alt: cleanText(typeof image === 'string' ? '' : image?.alt || ''),
        pixels: Number(image?.width || 0) * Number(image?.height || 0)
      });
    }
  }

  const featuredRaw =
    typeof product?.featured_image === 'string'
      ? product.featured_image
      : product?.featured_image?.src || product?.featured_image?.url || '';
  const featured = plainFullCoverAsset(featuredRaw);
  if (featured) {
    for (const candidate of [originalFullCoverAsset(featured), featured]) {
      if (!candidate || seen.has(candidate)) continue;
      seen.add(candidate);
      candidates.push({ src: candidate, alt: '', pixels: Number(product?.featured_image?.width || 0) * Number(product?.featured_image?.height || 0) });
    }
  }

  if (!candidates.length) return null;

  // Feed AnimeDeskMat through the exact CUCU candidate/inspector contract.
  // Do not inject provider-specific crop geometry here; the shared inspector is
  // the single authority for both providers.
  candidates.sort((a, b) => b.pixels - a.pixels);
  const asset = candidates[0];
  const title = cleanText(product?.title || handle.replace(/[-_]+/g, ' '));
  const tags = Array.isArray(product?.tags) ? product.tags : [];

  return {
    id: 'animedeskmat-' + handle,
    title,
    subtitle: 'AnimeDeskMat',
    image: imageProxy(asset.src),
    thumbnail: imageProxy(asset.src, 560),
    inspectUrls: candidates.slice(0, 3).map((candidate) => '/api/cucu/inspect?url=' + encodeURIComponent(candidate.src)),
    candidateImages: candidates.map((candidate) => imageProxy(candidate.src)),
    directAssetUrls: candidates.map((candidate) => candidate.src),
    source: 'AnimeDeskMat',
    sourceUrl: ORIGIN + '/products/' + handle,
    mediaType: 'premade-card-skin',
    cleanFilter: 'strict-full-cover-no-chip',
    assetMode: 'direct-card-art',
    mediaAlt: asset.alt || title,
    collection: COLLECTION,
    tags
  };
}

export async function GET(request) {
  const query = cleanText(request.nextUrl.searchParams.get('q') || '');
  const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1);
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 36);

  const page = Math.max(1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1));
  const limit = Math.max(8, Math.min(48, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 36)));

  try {
    const startIndex = (page - 1) * limit;
    let results = [];
    let total = query ? null : KNOWN_COLLECTION_TOTAL;
    let hasMore = false;
    let mode = 'shopify-collection';

    if (query) {
      const matches = (await searchProducts(query))
        .map(flattenProduct)
        .filter(Boolean);

      total = matches.length;
      results = matches.slice(startIndex, startIndex + limit);
      hasMore = startIndex + limit < total;
      mode = 'predictive-search';
    } else {
      const firstSourcePage = Math.floor(startIndex / SHOPIFY_PAGE_SIZE) + 1;
      const localStart = startIndex - (firstSourcePage - 1) * SHOPIFY_PAGE_SIZE;
      const firstBatch = await getCollectionPage(firstSourcePage);

      const needsNextBatch =
        localStart + limit + 1 > firstBatch.length &&
        firstBatch.length === SHOPIFY_PAGE_SIZE;
      const secondBatch = needsNextBatch
        ? await getCollectionPage(firstSourcePage + 1)
        : [];

      const combined = [...firstBatch, ...secondBatch];
      results = combined
        .slice(localStart, localStart + limit)
        .map(flattenProduct)
        .filter(Boolean);

      const hasBufferedNext = combined.length > localStart + limit;
      const sourceCouldContinue =
        firstBatch.length === SHOPIFY_PAGE_SIZE &&
        (hasBufferedNext || secondBatch.length === SHOPIFY_PAGE_SIZE);
      hasMore = startIndex + limit < KNOWN_COLLECTION_TOTAL && (hasBufferedNext || sourceCouldContinue);
    }

    return NextResponse.json(
      {
        results,
        page,
        limit,
        total,
        totalPages: total ? Math.max(1, Math.ceil(total / limit)) : null,
        hasMore,
        source: 'AnimeDeskMat · Anime',
        category: 'anime',
        categoryLabel: query ? 'Search Results' : 'Anime',
        collectionHandle: COLLECTION,
        query,
        upstream: {
          collection: COLLECTION,
          shopifyPageSize: SHOPIFY_PAGE_SIZE,
          mode,
          assetPolicy: 'plain-full-cover-only',
          knownCollectionTotal: KNOWN_COLLECTION_TOTAL
        }
      },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=21600, stale-while-revalidate=604800',
          'CDN-Cache-Control': 'public, max-age=21600, stale-while-revalidate=604800',
          'Vercel-CDN-Cache-Control': 'public, max-age=21600, stale-while-revalidate=604800'
        }
      }
    );
  } catch (error) {
    console.error('AnimeDeskMat catalog failed', error);
    return NextResponse.json(
      {
        error: error?.message || 'AnimeDeskMat catalog failed',
        results: [],
        page,
        limit,
        total: null,
        source: 'AnimeDeskMat · Anime',
        category: 'anime',
        categoryLabel: query ? 'Search Results' : 'Anime',
        collectionHandle: COLLECTION,
        query
      },
      {
        status: 502,
        headers: {
          'Cache-Control': 'public, max-age=30, s-maxage=120, stale-while-revalidate=600'
        }
      }
    );
  }
}

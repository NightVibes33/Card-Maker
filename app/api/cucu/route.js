import { NextResponse } from 'next/server';

const ORIGIN = 'https://cucucovers.com';
const DEFAULT_COLLECTION = 'all-card-covers';
const SHOPIFY_PAGE_SIZE = 100;

const COLLECTIONS = {
  all: { label: 'All Card Skins', handle: 'all-card-covers', total: 2225 },
  best: { label: 'Best Sellers', handle: 'best-sellers' },
  new: { label: 'New Arrivals', handle: 'latest-1' },
  anime: { label: 'Anime', handle: 'anime' },
  cars: { label: 'Cars', handle: 'cars' },
  sports: { label: 'Sports', handle: 'nba-card-skins' },
  artistic: { label: 'Artistic', handle: 'artistic' },
  cute: { label: 'Cute & Kawaii', handle: 'cute' },
  pets: { label: 'Pets', handle: 'pets' },
  classic: { label: 'Classic Art', handle: 'classic-art' },
  funny: { label: 'Funny', handle: 'funny' },
  memes: { label: 'Memes', handle: 'memes' },
  retro: { label: 'Retro & Nostalgic', handle: 'retro' },
  animals: { label: 'Animals', handle: 'animals' },
  crypto: { label: 'Crypto', handle: 'crypto-currency' }
};

const CATEGORY_TERMS = {
  best: ['best seller', 'best sellers', 'trending'],
  new: ['new', 'latest'],
  anime: ['anime'],
  cars: ['cars', 'jdm', 'racing', 'motorsports'],
  sports: ['sports', 'basketball', 'football', 'baseball', 'soccer', 'hockey', 'nba', 'ufc', 'mma'],
  artistic: ['artistic', 'art', 'abstract', 'paintings'],
  cute: ['cute', 'kawaii'],
  pets: ['pets', 'pet'],
  classic: ['classic art', 'paintings', 'van gogh', 'monet', 'klimt', 'vermeer', 'renoir'],
  funny: ['funny', 'funnyy'],
  memes: ['meme', 'memes', 'brainrot'],
  retro: ['retro', 'nostalgic', 'nostalgia'],
  animals: ['animals', 'animal'],
  crypto: ['crypto', 'bitcoin', 'ethereum', 'dogecoin']
};

const pageCache = new Map();
const fallbackCache = new Map();

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

function imageProxy(url, width = 0) {
  return '/api/image?url=' + encodeURIComponent(url) + (width ? '&w=' + width : '');
}

function assetScore(raw, image = {}) {
  const url = String(raw || '').toLowerCase();
  const alt = cleanText(image?.alt || '').toLowerCase();
  const filename = url.split('/').pop()?.split('?')[0] || '';
  let score = 0;

  if (/\.png$/i.test(filename)) score += 8;
  else if (/\.(webp|jpe?g)$/i.test(filename)) score += 3;

  if (/\/cdn\/shop\/(files|products)\//i.test(url)) score += 5;

  // CUCU's flat card artwork commonly uses SKU-style filenames such as
  // 002536a-4.png / 000230c-1.png. Prefer those over lifestyle/mockup media.
  if (/^\d{5,}[a-z]?[-_]\d+\.(png|webp|jpe?g)$/i.test(filename)) score += 30;
  if (/^\d{5,}[a-z]?\.(png|webp|jpe?g)$/i.test(filename)) score += 22;

  if (/(mockup|lifestyle|customer|review|package|packaging|install|instruction|size[-_ ]?guide|material)/i.test(filename + ' ' + alt)) {
    score -= 40;
  }

  const width = Number(image?.width || 0);
  if (width >= 1000) score += 4;
  else if (width >= 700) score += 2;

  return score;
}

async function fetchWithTimeout(url, options = {}, timeout = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      next: options.next || { revalidate: 21600 },
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

async function getCollectionTotal(collection) {
  return collection.total || null;
}

async function getShopifyPage(collectionHandle, page) {
  const key = collectionHandle + ':' + String(page);
  const now = Date.now();
  const cached = pageCache.get(key);
  if (cached && cached.expires > now) return cached.promise;

  const promise = (async () => {
    const url =
      ORIGIN +
      '/collections/' +
      collectionHandle +
      '/products.json?limit=' +
      SHOPIFY_PAGE_SIZE +
      '&page=' +
      page;

    let lastStatus = 0;

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      let retryDelay = 800 * attempt;

      try {
        const response = await fetchWithTimeout(
          url,
          {
            headers: {
              Accept: 'application/json',
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 Version/18.6 Mobile/15E148 Safari/604.1',
              'Accept-Language': 'en-US,en;q=0.9',
              Referer: ORIGIN + '/collections/' + collectionHandle
            }
          },
          15000
        );
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
          throw new Error('CUCU collection page ' + page + ' returned ' + response.status);
        }
      } catch (error) {
        if (attempt >= 5) throw error;
      }

      if (attempt < 5) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay));
      }
    }

    throw new Error('CUCU collection page ' + page + ' returned ' + lastStatus);
  })();

  pageCache.set(key, { promise, expires: now + 6 * 60 * 60 * 1000 });

  try {
    return await promise;
  } catch (error) {
    pageCache.delete(key);
    throw error;
  }
}

function categoryEvidence(product) {
  return [
    cleanText(product?.title || ''),
    String(product?.handle || ''),
    cleanText(product?.product_type || ''),
    cleanText(product?.body_html || ''),
    Array.isArray(product?.tags) ? product.tags.join(' ') : product?.tags || ''
  ].join(' ').toLowerCase();
}

function matchesCategory(product, categoryKey) {
  const terms = CATEGORY_TERMS[categoryKey] || [];
  if (!terms.length) return true;
  const evidence = categoryEvidence(product);
  return terms.some((term) => evidence.includes(term));
}

async function getFallbackCatalog(categoryKey) {
  const now = Date.now();
  const cached = fallbackCache.get(categoryKey);
  if (cached && cached.expires > now) return cached.promise;

  const promise = (async () => {
    const batches = [];
    const concurrency = 3;
    let done = false;

    for (let startPage = 1; startPage <= 30 && !done; startPage += concurrency) {
      const pages = Array.from(
        { length: Math.min(concurrency, 31 - startPage) },
        (_, index) => startPage + index
      );
      const pageResults = await Promise.all(
        pages.map((sourcePage) => getShopifyPage(DEFAULT_COLLECTION, sourcePage))
      );

      for (const batch of pageResults) {
        batches.push(...batch);
        if (batch.length < SHOPIFY_PAGE_SIZE) {
          done = true;
          break;
        }
      }
    }

    const seen = new Set();
    return batches.filter((product) => {
      const handle = String(product?.handle || '');
      if (!handle || seen.has(handle) || !matchesCategory(product, categoryKey)) return false;
      seen.add(handle);
      return true;
    });
  })();

  fallbackCache.set(categoryKey, {
    promise,
    expires: now + 6 * 60 * 60 * 1000
  });

  try {
    return await promise;
  } catch (error) {
    fallbackCache.delete(categoryKey);
    throw error;
  }
}

function flattenProduct(product) {
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

  const seenAssets = new Set();
  const candidates = ranked
    .sort((a, b) => b.score - a.score)
    .filter((asset) => {
      if (!asset.src || seenAssets.has(asset.src)) return false;
      seenAssets.add(asset.src);
      return true;
    })
    .slice(0, 8);

  if (!candidates.length) return null;

  const title = cleanText(product?.title || handle.replace(/[-_]+/g, ' '));
  const tags = Array.isArray(product?.tags) ? product.tags : [];

  return {
    id: 'cucu-' + handle,
    title,
    subtitle: 'CUCU Covers',
    image: imageProxy(candidates[0].src),
    thumbnail: imageProxy(candidates[0].src, 560),
    inspectUrls: candidates.slice(0, 3).map((asset) => '/api/cucu/inspect?url=' + encodeURIComponent(asset.src)),
    candidateImages: candidates.map((asset) => imageProxy(asset.src)),
    directAssetUrls: candidates.map((asset) => asset.src),
    source: 'CUCU Covers',
    sourceUrl: ORIGIN + '/products/' + handle,
    mediaType: 'premade-card-skin',
    cleanFilter: 'direct-shopify-card-art',
    assetMode: 'direct-card-art',
    mediaAlt: candidates[0].alt || title,
    collection: product.__collection || DEFAULT_COLLECTION,
    tags
  };
}

export async function GET(request) {
  const categoryKey = String(request.nextUrl.searchParams.get('category') || 'all').toLowerCase();
  const collection = COLLECTIONS[categoryKey] || COLLECTIONS.all;
  const query = cleanText(request.nextUrl.searchParams.get('q') || '').toLowerCase();
  const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1);
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 36);

  const page = Math.max(1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1));
  const limit = Math.max(12, Math.min(48, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 36)));

  try {
    const knownTotal = await getCollectionTotal(collection);
    const startIndex = (page - 1) * limit;
    const firstSourcePage = Math.floor(startIndex / SHOPIFY_PAGE_SIZE) + 1;
    const localStart = startIndex - (firstSourcePage - 1) * SHOPIFY_PAGE_SIZE;

    let results = [];
    let total = knownTotal || null;
    let totalPages = total ? Math.max(1, Math.ceil(total / limit)) : null;
    let inferredHasMore = false;
    let mode = 'shopify-collection';

    if (query) {
      const tokens = query.split(/\s+/).filter((token) => token.length > 1);
      const catalog = await getFallbackCatalog('all');
      const matches = catalog.filter((product) => {
        const evidence = categoryEvidence(product);
        return tokens.every((token) => evidence.includes(token));
      });

      total = matches.length;
      totalPages = Math.max(1, Math.ceil(total / limit));
      inferredHasMore = startIndex + limit < total;
      mode = 'catalog-search';
      results = matches
        .slice(startIndex, startIndex + limit)
        .map((product) => flattenProduct({ ...product, __collection: DEFAULT_COLLECTION }))
        .filter(Boolean);
    } else try {
      const firstBatch = await getShopifyPage(collection.handle, firstSourcePage);
      if (!firstBatch.length && categoryKey !== 'all') {
        throw new Error('empty category collection');
      }

      const needsNextBatch =
        localStart + limit + 1 > firstBatch.length &&
        firstBatch.length === SHOPIFY_PAGE_SIZE;
      const secondBatch = needsNextBatch
        ? await getShopifyPage(collection.handle, firstSourcePage + 1)
        : [];

      const combined = [...firstBatch, ...secondBatch].map((product) => ({
        ...product,
        __collection: collection.handle
      }));

      const wanted = combined.slice(localStart, localStart + limit);
      results = wanted.map(flattenProduct).filter(Boolean);

      const hasBufferedNext = combined.length > localStart + limit;
      const sourceCouldContinue =
        firstBatch.length === SHOPIFY_PAGE_SIZE &&
        (hasBufferedNext || secondBatch.length === SHOPIFY_PAGE_SIZE);

      inferredHasMore = knownTotal
        ? startIndex + limit < knownTotal
        : hasBufferedNext || sourceCouldContinue;
    } catch (collectionError) {
      if (categoryKey === 'all') throw collectionError;

      const fallback = await getFallbackCatalog(categoryKey);
      total = fallback.length;
      totalPages = Math.max(1, Math.ceil(total / limit));
      inferredHasMore = startIndex + limit < total;
      mode = 'product-tag-fallback';

      results = fallback
        .slice(startIndex, startIndex + limit)
        .map((product) =>
          flattenProduct({
            ...product,
            __collection: collection.handle
          })
        )
        .filter(Boolean);
    }

    return NextResponse.json(
      {
        results,
        page,
        limit,
        total,
        totalPages,
        hasMore: inferredHasMore,
        source: 'CUCU Covers · ' + collection.label,
        category: categoryKey,
        categoryLabel: query ? 'Search' : collection.label,
        collectionHandle: collection.handle,
        query,
        categories: Object.entries(COLLECTIONS).map(([key, value]) => ({
          key,
          label: value.label,
          handle: value.handle
        })),
        upstream: {
          collection: collection.handle,
          shopifyPageSize: SHOPIFY_PAGE_SIZE,
          mode
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
    console.error('CUCU catalog failed', error);
    return NextResponse.json(
      {
        error: error?.message || 'CUCU catalog failed',
        results: [],
        page,
        limit,
        total: collection.total || null,
        source: 'CUCU Covers · ' + collection.label,
        category: categoryKey,
        categoryLabel: collection.label,
        collectionHandle: collection.handle
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

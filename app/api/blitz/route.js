import { NextResponse } from 'next/server';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = 'all';
const SHOPIFY_PAGE_SIZE = 250;
const MAX_SOURCE_PAGES = 6;
const MAX_HTML_PAGES = 20;

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

function decodeXml(value = '') {
  return cleanText(
    String(value)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'")
  );
}

function absoluteBlitzUrl(raw = '') {
  try {
    return new URL(decodeXml(raw), ORIGIN).toString();
  } catch {
    return '';
  }
}

function parseProductSitemap(xml) {
  const items = [];
  const urlBlocks = String(xml).match(/<url>[\s\S]*?<\/url>/gi) || [];

  for (const block of urlBlocks) {
    const loc = decodeXml(block.match(/<loc>([\s\S]*?)<\/loc>/i)?.[1] || '');
    const handle = loc.match(/\/products\/([a-z0-9][a-z0-9-]*)/i)?.[1] || '';
    if (!handle) continue;

    const title = decodeXml(
      block.match(/<image:title>([\s\S]*?)<\/image:title>/i)?.[1] ||
      block.match(/<image:caption>([\s\S]*?)<\/image:caption>/i)?.[1] ||
      handle.replace(/[-_]+/g, ' ')
    );

    if (isExcluded(title, handle)) continue;

    const assets = [];
    const imageMatches = block.matchAll(/<image:loc>([\s\S]*?)<\/image:loc>/gi);
    for (const match of imageMatches) {
      const src = normalizeImageUrl(decodeXml(match[1]));
      if (src && !assets.includes(src)) assets.push(src);
    }

    if (!assets.length) continue;
    const item = buildItem({ handle, title, assets });
    if (item) items.push(item);
  }

  return items;
}

async function getSitemapCatalog() {
  const rootResponse = await fetchWithTimeout(
    ORIGIN + '/sitemap.xml',
    { headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5' } },
    15000
  );

  if (!rootResponse.ok) {
    throw new Error('Blitz sitemap index returned ' + rootResponse.status);
  }

  const rootXml = await rootResponse.text();
  const sitemapUrls = [...rootXml.matchAll(/<loc>([\s\S]*?)<\/loc>/gi)]
    .map((match) => absoluteBlitzUrl(match[1]))
    .filter((url) => /sitemap_products/i.test(url));

  if (!sitemapUrls.length) {
    throw new Error('Blitz sitemap index exposed no product sitemap');
  }

  const all = [];
  for (const url of sitemapUrls) {
    const response = await fetchWithTimeout(
      url,
      { headers: { Accept: 'application/xml,text/xml;q=0.9,*/*;q=0.5' } },
      18000
    );
    if (!response.ok) {
      throw new Error('Blitz product sitemap returned ' + response.status);
    }
    all.push(...parseProductSitemap(await response.text()));
  }

  const seen = new Set();
  return all.filter((item) => {
    if (!item?.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function parseHtmlCatalogPage(html) {
  const byHandle = new Map();
  const source = String(html)
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&');

  const productMatches = [...source.matchAll(/(?:href|url)=["']?(?:https?:\/\/(?:www\.)?blitzcovers\.com)?\/products\/([a-z0-9][a-z0-9-]*)/gi)];

  for (const match of productMatches) {
    const handle = match[1];
    if (!handle || isExcluded('', handle)) continue;

    const start = Math.max(0, match.index - 2200);
    const end = Math.min(source.length, match.index + 4200);
    const block = source.slice(start, end);

    const title =
      cleanText(block.match(/(?:title|alt)=["']([^"']{2,180})["']/i)?.[1] || '') ||
      handle.replace(/[-_]+/g, ' ');

    if (isExcluded(title, handle)) continue;

    const assets = [];
    const urls = block.match(
      /https?:\/\/(?:www\.)?blitzcovers\.com\/cdn\/shop\/(?:files|products)\/[^\s"'<>]+|https?:\/\/cdn\.shopify\.com\/s\/files\/[^\s"'<>]+|\/cdn\/shop\/(?:files|products)\/[^\s"'<>]+/gi
    ) || [];

    for (const raw of urls) {
      const src = normalizeImageUrl(raw);
      if (src && !assets.includes(src)) assets.push(src);
    }

    if (!assets.length) continue;

    const existing = byHandle.get(handle);
    if (existing) {
      existing.assets = [...new Set([...existing.assets, ...assets])].slice(0, 8);
    } else {
      byHandle.set(handle, { handle, title, assets: assets.slice(0, 8) });
    }
  }

  return [...byHandle.values()].map(buildItem).filter(Boolean);
}

async function getHtmlCatalog() {
  const all = [];
  const seen = new Set();

  for (let page = 1; page <= MAX_HTML_PAGES; page += 1) {
    const url = ORIGIN + '/collections/' + COLLECTION + (page > 1 ? '?page=' + page : '');
    const response = await fetchWithTimeout(
      url,
      { headers: { Accept: 'text/html,application/xhtml+xml' } },
      15000
    );

    if (!response.ok) {
      throw new Error('Blitz HTML collection page ' + page + ' returned ' + response.status);
    }

    const html = await response.text();
    const found = parseHtmlCatalogPage(html);
    let added = 0;

    for (const item of found) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      all.push(item);
      added += 1;
    }

    if (page > 1 && added === 0) break;
    if (!/page=\d+/i.test(html) && page > 1) break;
  }

  return all;
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
      console.warn('Blitz Shopify JSON blocked:', error?.message || error);
    }

    try {
      const sitemap = await getSitemapCatalog();
      if (sitemap.length >= 100) {
        return { mode: 'shopify-sitemap', items: sitemap };
      }
    } catch (error) {
      console.warn('Blitz sitemap fallback failed:', error?.message || error);
    }

    const html = await getHtmlCatalog();
    if (!html.length) {
      throw new Error('Blitz public collection exposed no usable card products');
    }

    return { mode: 'collection-html', items: html };
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

    const mode = catalog.mode;
    const total = catalog.items.length;
    const start = (page - 1) * limit;
    const results = catalog.items.slice(start, start + limit);
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
          directShopifyBlocked: mode !== 'shopify-json'
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

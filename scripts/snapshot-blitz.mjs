import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = '/collections/credit-card-cover';
const PAGE_COUNT = 8;

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeProductUrl(raw) {
  try {
    const url = new URL(raw, ORIGIN);
    if (url.hostname !== 'blitzcovers.com' && url.hostname !== 'www.blitzcovers.com') return null;
    const match = url.pathname.match(/\/products\/([a-z0-9][a-z0-9-]*)/i);
    if (!match) return null;
    return {
      handle: match[1].toLowerCase(),
      url: ORIGIN + '/products/' + match[1].toLowerCase()
    };
  } catch {
    return null;
  }
}

function pickLargestFromSrcset(srcset = '') {
  const parts = String(srcset)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const pieces = part.split(/\s+/);
      const url = pieces[0] || '';
      const descriptor = pieces[1] || '';
      const width = descriptor.endsWith('w') ? Number(descriptor.slice(0, -1)) || 0 : 0;
      return { url, width };
    })
    .filter((item) => item.url);

  parts.sort((a, b) => b.width - a.width);
  return parts[0]?.url || '';
}

function normalizeShopifyImage(raw) {
  if (!raw) return '';
  let url;

  try {
    const cleaned = String(raw)
      .replace(/^['"]|['"]$/g, '')
      .replace(/&amp;/g, '&')
      .trim();

    url = new URL(cleaned.startsWith('//') ? 'https:' + cleaned : cleaned, ORIGIN);
  } catch {
    return '';
  }

  const host = url.hostname.toLowerCase();
  const allowed =
    host === 'blitzcovers.com' ||
    host === 'www.blitzcovers.com' ||
    host === 'cdn.shopify.com';

  if (!allowed) return '';

  // Prefer the large raw Shopify rendition. Legacy themes commonly encode
  // dimensions in the filename; modern themes use a width query parameter.
  url.pathname = url.pathname
    .replace(/_(pico|icon|thumb|small|compact|medium|large|grande|master)(\.[a-z0-9]+)$/i, '_1500x$2')
    .replace(/_\d+x\d*(\.[a-z0-9]+)$/i, '_1500x$1')
    .replace(/_\d+x(\.[a-z0-9]+)$/i, '_1500x$1');

  if (url.searchParams.has('width')) url.searchParams.set('width', '1500');

  return url.toString();
}

function excluded(title, handle) {
  return /(customization|custom card|create your own|3-pack mystery|4-pack card covers|priority|packaging|voucher|gift card|insurance)/i.test(
    title + ' ' + handle
  );
}

function extractProducts(anchors, pageNumber) {
  const byHandle = new Map();

  for (const outerHtml of anchors || []) {
    const $ = cheerio.load(String(outerHtml || ''));
    const anchor = $('a').first();
    if (!anchor.length) continue;

    const href = anchor.attr('href') || '';
    const product = normalizeProductUrl(href);
    if (!product) continue;

    const img = anchor.find('img').first();
    if (!img.length) continue;

    const srcset =
      img.attr('data-srcset') ||
      img.attr('srcset') ||
      '';

    const rawImage =
      pickLargestFromSrcset(srcset) ||
      img.attr('data-master') ||
      img.attr('data-src') ||
      img.attr('src') ||
      '';

    const image = normalizeShopifyImage(rawImage);
    if (!image) continue;

    let title = cleanText(
      img.attr('alt') ||
      anchor.attr('aria-label') ||
      anchor.text()
    );

    if (!title) {
      title = product.handle
        .split('-')
        .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
        .join(' ');
    }

    if (excluded(title, product.handle)) continue;

    const existing = byHandle.get(product.handle);
    const candidate = {
      id: 'blitz-' + product.handle,
      handle: product.handle,
      title,
      source: 'Blitz Covers',
      sourceUrl: product.url,
      image,
      candidateImages: [image],
      directAssetUrls: [image],
      mediaType: 'premade-card-skin',
      cleanFilter: 'snapshot-direct-shopify-card-art',
      assetMode: 'direct-card-art',
      mediaAlt: title,
      collection: 'credit-card-cover',
      sourcePage: pageNumber
    };

    if (!existing || /1500x/i.test(candidate.image)) {
      byHandle.set(product.handle, candidate);
    }
  }

  return [...byHandle.values()];
}

const all = new Map();

async function fetchMicrolinkProductAnchors(target) {
  const api = new URL('https://api.microlink.io');
  api.searchParams.set('url', target);
  api.searchParams.set('meta', 'false');
  api.searchParams.set('data.products.selectorAll', 'a[href*="/products/"]');
  api.searchParams.set('data.products.attr', 'outerHTML');
  api.searchParams.set('data.products.type', 'string');

  const response = await fetch(api, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'AirCard-Blitz-Snapshot/1.1'
    }
  });

  const json = await response.json().catch(() => ({}));
  const raw = json?.data?.products;
  const anchors =
    Array.isArray(raw) ? raw :
    Array.isArray(raw?.value) ? raw.value :
    Array.isArray(raw?.data) ? raw.data :
    Array.isArray(raw?.items) ? raw.items :
    [];

  if (!response.ok || json.status !== 'success' || !anchors.length) {
    console.log(
      'Microlink products shape:',
      JSON.stringify(raw)?.slice(0, 1200) || String(raw)
    );
    throw new Error(
      'Microlink failed for ' + target + ': ' +
      (json?.message || json?.status || response.status)
    );
  }

  return anchors;
}

for (let page = 1; page <= PAGE_COUNT; page += 1) {
  const target = ORIGIN + COLLECTION + (page > 1 ? '?page=' + page : '');
  const anchors = await fetchMicrolinkProductAnchors(target);

  console.log('PAGE', page, 'anchors =>', anchors.length);
  const products = extractProducts(anchors, page);
  console.log('PAGE', page, '=>', products.length, 'products');

  for (const item of products) {
    if (!all.has(item.handle)) all.set(item.handle, item);
  }
}

const products = [...all.values()];

if (products.length < 120) {
  throw new Error('Blitz snapshot unexpectedly small: ' + products.length);
}

const output = {
  generatedAt: new Date().toISOString(),
  source: ORIGIN + COLLECTION,
  sourcePages: PAGE_COUNT,
  count: products.length,
  products
};

await fs.mkdir(path.join(process.cwd(), 'data'), { recursive: true });
await fs.writeFile(
  path.join(process.cwd(), 'data', 'blitz-catalog.json'),
  JSON.stringify(output, null, 2) + '\n'
);

console.log('SNAPSHOT COMPLETE =>', products.length, 'unique Blitz full-card products');

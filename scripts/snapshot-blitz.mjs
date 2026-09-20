import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = '/collections/credit-card-cover';
const PAGE_COUNT = 1;
const PROXY = 'https://api.allorigins.win/raw?url=';

function cleanText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeProductUrl(raw) {
  try {
    const url = new URL(raw, ORIGIN);
    const match = url.pathname.match(/\/products\/([a-z0-9][a-z0-9-]*)/i);
    if (!match) return null;
    const handle = match[1].toLowerCase();
    return { handle, url: ORIGIN + '/products/' + handle };
  } catch {
    return null;
  }
}

function pickLargestFromSrcset(srcset = '') {
  const options = String(srcset)
    .split(',')
    .map((part) => {
      const [url, descriptor = ''] = part.trim().split(/\s+/);
      const width = descriptor.endsWith('w') ? Number(descriptor.slice(0, -1)) || 0 : 0;
      return { url, width };
    })
    .filter((item) => item.url)
    .sort((a, b) => b.width - a.width);
  return options[0]?.url || '';
}

function normalizeShopifyImage(raw) {
  if (!raw) return '';
  let url;
  try {
    const cleaned = String(raw).replace(/&amp;/g, '&').trim();
    url = new URL(cleaned.startsWith('//') ? 'https:' + cleaned : cleaned, ORIGIN);
  } catch {
    return '';
  }

  const host = url.hostname.toLowerCase();
  if (!['blitzcovers.com', 'www.blitzcovers.com', 'cdn.shopify.com'].includes(host)) return '';

  if (!/\/cdn\/shop\/(files|products)\//i.test(url.pathname) && host !== 'cdn.shopify.com') return '';

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

function extractProducts(html, pageNumber) {
  const $ = cheerio.load(html);
  const byHandle = new Map();

  $('a[href*="/products/"]').each((_, el) => {
    const anchor = $(el);
    const product = normalizeProductUrl(anchor.attr('href') || '');
    if (!product || byHandle.has(product.handle)) return;

    const img = anchor.find('img').first();
    if (!img.length) return;

    const image = normalizeShopifyImage(
      pickLargestFromSrcset(img.attr('data-srcset') || img.attr('srcset') || '') ||
      img.attr('data-master') ||
      img.attr('data-src') ||
      img.attr('src') ||
      ''
    );
    if (!image) return;

    const title = cleanText(
      img.attr('alt') ||
      anchor.attr('aria-label') ||
      anchor.text() ||
      product.handle.replace(/-/g, ' ')
    );
    if (excluded(title, product.handle)) return;

    byHandle.set(product.handle, {
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
    });
  });

  return [...byHandle.values()];
}

const all = new Map();

for (let page = 1; page <= PAGE_COUNT; page += 1) {
  const target = ORIGIN + COLLECTION + (page > 1 ? '?page=' + page : '');
  const proxyUrl = PROXY + encodeURIComponent(target);

  const response = await fetch(proxyUrl, {
    headers: { Accept: 'text/html,*/*;q=0.8' },
    signal: AbortSignal.timeout(30000)
  });

  const html = await response.text();
  console.log('PAGE', page, 'proxy status', response.status, 'bytes', html.length);

  if (!response.ok) throw new Error('AllOrigins returned ' + response.status);
  const products = extractProducts(html, page);
  console.log('PAGE', page, '=>', products.length, 'products');

  for (const item of products) all.set(item.handle, item);
}

const products = [...all.values()];
if (products.length < 10) {
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

console.log('SNAPSHOT COMPLETE =>', products.length, 'unique Blitz products');

import fs from 'node:fs/promises';
import path from 'node:path';
import createClient from 'microlink.io';
import * as cheerio from 'cheerio';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = '/collections/credit-card-cover';
const PAGE_COUNT = 8;

const microlink = createClient();

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

function extractProducts(html, pageNumber) {
  const $ = cheerio.load(html);
  const byHandle = new Map();

  $('a[href*="/products/"]').each((_, anchor) => {
    const href = $(anchor).attr('href') || '';
    const product = normalizeProductUrl(href);
    if (!product) return;

    const img = $(anchor).find('img').first();
    if (!img.length) return;

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
    if (!image) return;

    let title = cleanText(
      img.attr('alt') ||
      $(anchor).attr('aria-label') ||
      $(anchor).text()
    );

    if (!title) {
      const escapedHref = href.replace(/"/g, '\\"');
      title = cleanText($('a[href="' + escapedHref + '"]').not(anchor).first().text());
    }

    if (!title) {
      title = product.handle
        .split('-')
        .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
        .join(' ');
    }

    if (excluded(title, product.handle)) return;

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

    // Prefer a larger-looking URL when the same product is repeated by the theme.
    if (!existing || /1500x/i.test(candidate.image)) {
      byHandle.set(product.handle, candidate);
    }
  });

  return [...byHandle.values()];
}

const all = new Map();

for (let page = 1; page <= PAGE_COUNT; page += 1) {
  const target = ORIGIN + COLLECTION + (page > 1 ? '?page=' + page : '');
  const html = await microlink.html(target, {
    prerender: true,
    waitUntil: 'networkidle0'
  });

  const products = extractProducts(html, page);
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

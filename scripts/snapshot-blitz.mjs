import fs from 'node:fs/promises';
import path from 'node:path';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = '/collections/credit-card-cover';
const PAGE_COUNT = 8;
const READER = 'https://r.jina.ai/http://blitzcovers.com';

function cleanText(value = '') {
  return String(value)
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[*_#>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeProductUrl(raw) {
  try {
    const url = new URL(raw, ORIGIN);
    const match = url.pathname.match(/\/products\/([a-z0-9][a-z0-9-]*)/i);
    if (!match) return null;
    const handle = match[1].toLowerCase();
    return {
      handle,
      url: ORIGIN + '/products/' + handle
    };
  } catch {
    return null;
  }
}

function normalizeShopifyImage(raw) {
  if (!raw) return '';
  let url;

  try {
    const cleaned = String(raw)
      .replace(/&amp;/g, '&')
      .replace(/[),.;]+$/g, '')
      .trim();

    url = new URL(cleaned.startsWith('//') ? 'https:' + cleaned : cleaned, ORIGIN);
  } catch {
    return '';
  }

  const host = url.hostname.toLowerCase();
  if (
    host !== 'blitzcovers.com' &&
    host !== 'www.blitzcovers.com' &&
    host !== 'cdn.shopify.com'
  ) {
    return '';
  }

  if (!/\/cdn\/shop\/(files|products)\//i.test(url.pathname) && !/cdn\.shopify\.com/i.test(host)) {
    return '';
  }

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

async function fetchReader(page) {
  const suffix = COLLECTION + (page > 1 ? '?page=' + page : '');
  const target = READER + suffix;
  let lastError = null;

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(target, {
        headers: {
          Accept: 'text/plain,text/markdown;q=0.9,*/*;q=0.5',
          'User-Agent': 'AirCard-Blitz-Snapshot/2.0'
        },
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        const text = await response.text();
        if (text.length > 1000) return text;
        lastError = new Error('reader returned short body: ' + text.length);
      } else {
        lastError = new Error('reader returned ' + response.status);
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < 6) {
      await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
    }
  }

  throw lastError || new Error('reader failed');
}

function extractPage(markdown, pageNumber) {
  const productLinkRe = /\[([^\]]{1,180})\]\((https?:\/\/(?:www\.)?blitzcovers\.com\/(?:collections\/credit-card-cover\/)?products\/[a-z0-9][a-z0-9-]*(?:[^)]*)?)\)/gi;
  const imageRe = /!\[([^\]]*)\]\((https?:\/\/(?:www\.)?blitzcovers\.com\/cdn\/shop\/(?:files|products)\/[^)\s]+|https?:\/\/cdn\.shopify\.com\/s\/files\/[^)\s]+)\)/gi;

  const images = [];
  let match;

  while ((match = imageRe.exec(markdown))) {
    const image = normalizeShopifyImage(match[2]);
    if (!image) continue;
    images.push({
      index: match.index,
      alt: cleanText(match[1]),
      image
    });
  }

  const out = [];
  const seen = new Set();

  while ((match = productLinkRe.exec(markdown))) {
    const title = cleanText(match[1]);
    const product = normalizeProductUrl(match[2]);
    if (!product || seen.has(product.handle) || excluded(title, product.handle)) continue;

    const start = Math.max(0, match.index - 2200);
    const end = Math.min(markdown.length, match.index + 1200);

    const nearby = images
      .filter((image) => image.index >= start && image.index <= end)
      .sort((a, b) => {
        const ad = Math.abs(a.index - match.index);
        const bd = Math.abs(b.index - match.index);
        return ad - bd;
      });

    if (!nearby.length) continue;

    const preferred =
      nearby.find((item) => {
        const alt = item.alt.toLowerCase();
        const words = title.toLowerCase().split(/\s+/).filter((word) => word.length >= 4);
        return words.some((word) => alt.includes(word));
      }) ||
      nearby[0];

    seen.add(product.handle);

    out.push({
      id: 'blitz-' + product.handle,
      handle: product.handle,
      title: title || product.handle.replace(/-/g, ' '),
      source: 'Blitz Covers',
      sourceUrl: product.url,
      image: preferred.image,
      candidateImages: [...new Set(nearby.slice(0, 4).map((item) => item.image))],
      directAssetUrls: [...new Set(nearby.slice(0, 4).map((item) => item.image))],
      mediaType: 'premade-card-skin',
      cleanFilter: 'snapshot-direct-shopify-card-art',
      assetMode: 'direct-card-art',
      mediaAlt: preferred.alt || title,
      collection: 'credit-card-cover',
      sourcePage: pageNumber
    });
  }

  return out;
}

const all = new Map();

for (let page = 1; page <= PAGE_COUNT; page += 1) {
  const markdown = await fetchReader(page);
  const products = extractPage(markdown, page);

  console.log(
    'PAGE',
    page,
    'markdown',
    markdown.length,
    'chars =>',
    products.length,
    'products'
  );

  if (page === 1 && products.length === 0) {
    console.log('PAGE 1 DEBUG:', markdown.slice(0, 7000));
  }

  for (const item of products) {
    if (!all.has(item.handle)) all.set(item.handle, item);
  }
}

const products = [...all.values()];

if (products.length < 100) {
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

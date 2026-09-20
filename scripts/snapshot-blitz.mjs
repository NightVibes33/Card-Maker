import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

// One-shot browser snapshot: keep network scraping out of production.
const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = '/collections/credit-card-cover';
const PAGE_COUNT = 1;

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

function normalizeShopifyImage(raw) {
  if (!raw) return '';
  let url;
  try {
    url = new URL(String(raw).replace(/&amp;/g, '&').trim(), ORIGIN);
  } catch {
    return '';
  }

  const host = url.hostname.toLowerCase();
  if (!['blitzcovers.com', 'www.blitzcovers.com', 'cdn.shopify.com'].includes(host)) return '';

  if (!/\/cdn\/shop\/(files|products)\//i.test(url.pathname) && host !== 'cdn.shopify.com') {
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

const executableCandidates = [
  process.env.CHROME_PATH,
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser'
].filter(Boolean);

let executablePath = null;
for (const candidate of executableCandidates) {
  try {
    await fs.access(candidate);
    executablePath = candidate;
    break;
  } catch {}
}

if (!executablePath) {
  throw new Error('No system Chrome/Chromium found on runner');
}

console.log('Using browser:', executablePath);

const browser = await chromium.launch({
  headless: true,
  executablePath,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
});

const context = await browser.newContext({
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  viewport: { width: 430, height: 932 },
  locale: 'en-US'
});

const all = new Map();

try {
  const page = await context.newPage();

  for (let pageNumber = 1; pageNumber <= PAGE_COUNT; pageNumber += 1) {
    const target = ORIGIN + COLLECTION + (pageNumber > 1 ? '?page=' + pageNumber : '');

    let response = null;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        response = await page.goto(target, {
          waitUntil: 'domcontentloaded',
          timeout: 15000
        });
        await page.waitForTimeout(2500);

        const productCount = await page.locator('a[href*="/products/"]').count();
        console.log(
          'PAGE',
          pageNumber,
          'attempt',
          attempt,
          'status',
          response?.status(),
          'anchors',
          productCount,
          'title',
          await page.title()
        );

        if (productCount >= 10) break;
      } catch (error) {
        console.log('PAGE', pageNumber, 'attempt', attempt, 'navigation error', error.message);
      }

      if (attempt < 2) await page.waitForTimeout(1000 * attempt);
    }

    const raw = await page.locator('a[href*="/products/"]').evaluateAll((anchors) => {
      return anchors.map((anchor) => {
        const img = anchor.querySelector('img');
        if (!img) return null;

        return {
          href: anchor.href || anchor.getAttribute('href') || '',
          title:
            img.getAttribute('alt') ||
            anchor.getAttribute('aria-label') ||
            anchor.textContent ||
            '',
          image:
            img.currentSrc ||
            img.getAttribute('data-master') ||
            img.getAttribute('data-src') ||
            img.getAttribute('src') ||
            '',
          srcset:
            img.getAttribute('data-srcset') ||
            img.getAttribute('srcset') ||
            ''
        };
      }).filter(Boolean);
    });

    const pageSeen = new Set();
    let added = 0;

    for (const candidate of raw) {
      const product = normalizeProductUrl(candidate.href);
      if (!product || pageSeen.has(product.handle)) continue;

      const title = cleanText(candidate.title) || product.handle.replace(/-/g, ' ');
      if (excluded(title, product.handle)) continue;

      let image = normalizeShopifyImage(candidate.image);

      if (!image && candidate.srcset) {
        const options = String(candidate.srcset)
          .split(',')
          .map((part) => part.trim().split(/\s+/)[0])
          .filter(Boolean)
          .reverse();

        for (const option of options) {
          image = normalizeShopifyImage(option);
          if (image) break;
        }
      }

      if (!image) continue;

      pageSeen.add(product.handle);
      added += 1;

      if (!all.has(product.handle)) {
        all.set(product.handle, {
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
      }
    }

    console.log('PAGE', pageNumber, '=>', added, 'unique product cards extracted');
  }
} finally {
  await browser.close();
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

console.log('SNAPSHOT COMPLETE =>', products.length, 'unique Blitz full-card products');

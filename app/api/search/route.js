import { NextResponse } from 'next/server';

const STORES = [
  {
    name: 'CUCU Covers',
    origin: 'https://cucucovers.com',
    priority: 5
  },
  {
    name: 'Anime Town Creations',
    origin: 'https://www.animetowncreations.com',
    priority: 4
  },
  {
    name: 'Stickyink Designs',
    origin: 'https://stickyinkdesigns.com',
    priority: 3
  },
  {
    name: 'Styled Cards',
    origin: 'https://styledcards.com',
    priority: 2
  }
];

const QUERY_ALIASES = new Map([
  ['spongebob', ['Bikini Bottom', 'Patrick', 'Krusty Krab']],
  ['spongebob squarepants', ['Bikini Bottom', 'Patrick', 'Krusty Krab']],
  ['breaking bad', ['Walter White', 'Heisenberg']],
  ['hunter x hunter', ['HxH', 'Hunter Hunter']],
  ['dragon ball z', ['Goku', 'Vegeta', 'Dragon Ball']],
  ['dragon ball', ['Goku', 'Vegeta']],
  ['pokemon', ['Pikachu', 'Charizard']],
  ['one piece', ['Luffy', 'Zoro']],
  ['jujutsu kaisen', ['Gojo', 'Sukuna']],
  ['demon slayer', ['Tanjiro', 'Nezuko']],
  ['naruto', ['Konohagakure', 'Akatsuki']],
  ['tokyo ghoul', ['Kaneki']],
  ['attack on titan', ['Scouts', 'Levi']],
  ['adventure time', ['Finn Jake', 'Finn']],
  ['regular show', ['Mordecai Rigby', 'Mordecai']],
  ['rick and morty', ['Rick & Morty', 'Portal', 'Mr Meeseeks']],
  ['stranger things', ['Hawkins', 'Hellfire Club']],
  ['the boys', ['Homelander']],
  ['fallout', ['Vault Boy']],
  ['wednesday', ['Wednesday Dance', 'Wednesday and Enid']]
]);

const REJECT_MEDIA = [
  'size guide',
  'chip guide',
  'chip size',
  'materials',
  'material showcase',
  'showcase of materials',
  'application',
  'how to apply',
  'instructions',
  'customer photo',
  'customer image',
  'packaging',
  'package',
  'back skin',
  'back side',
  'half skin',
  'half cover',
  'window skin',
  'window cover',
  'video',
  'logo',
  'watermark'
];

const GOOD_MEDIA = [
  'full skins',
  'full skin',
  'full cover',
  'credit card skin',
  'debit card skin',
  'card skin',
  'card cover'
];

function cleanText(value = '') {
  return String(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCardSkinProduct(evidence = '', title = '') {
  const titleText = title.toLowerCase();
  const text = cleanText(evidence).toLowerCase();

  if (/(poster|mouse ?pad|phone case|shirt|hoodie|metal print|sticker sheet|design your own|custom card skin|custom credit card)/i.test(titleText)) {
    return false;
  }

  if (/(poster|mouse ?pad|phone case|shirt|hoodie|metal print)/i.test(text) && !/(credit card skin|debit card skin|card skin|card cover)/i.test(text)) {
    return false;
  }

  return (
    /(credit|debit|bank).{0,30}(skin|cover|sticker)/i.test(text) ||
    /(skin|cover|sticker).{0,30}(credit|debit|bank)/i.test(text) ||
    /card skin/i.test(text) ||
    /skin sticker.{0,30}card/i.test(text)
  );
}

function normalizeImageUrl(raw, origin) {
  if (!raw) return '';
  try {
    if (raw.startsWith('//')) return 'https:' + raw;
    return new URL(raw, origin).toString();
  } catch {
    return '';
  }
}

function imageProxy(url) {
  return '/api/image?url=' + encodeURIComponent(url);
}

async function fetchWithTimeout(url, options = {}, timeout = 7000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'User-Agent': 'AirCard-Card-Studio/3.0 (+https://github.com/NightVibes33/Card-Maker)',
        Accept: options.headers?.Accept || '*/*',
        ...options.headers
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

function extractHandle(url = '') {
  const match = String(url).match(/\/products\/([^/?#]+)/i);
  return match?.[1] || '';
}

async function predictiveSearch(store, term) {
  const endpoint =
    store.origin +
    '/search/suggest.json?q=' +
    encodeURIComponent(term) +
    '&resources[type]=product&resources[limit]=10';

  const response = await fetchWithTimeout(endpoint, {
    headers: { Accept: 'application/json' }
  });

  if (!response.ok) throw new Error('predictive ' + response.status);
  const json = await response.json();

  return (json?.resources?.results?.products || [])
    .map((product) => ({
      title: cleanText(product.title),
      url: new URL(product.url || '', store.origin).toString(),
      image: normalizeImageUrl(product.image || product.featured_image || '', store.origin)
    }))
    .filter((product) => product.url.includes('/products/'));
}

async function htmlSearch(store, term) {
  const endpoint = store.origin + '/search?q=' + encodeURIComponent(term) + '&type=product';
  const response = await fetchWithTimeout(endpoint, {
    headers: { Accept: 'text/html,application/xhtml+xml' }
  });
  if (!response.ok) throw new Error('html search ' + response.status);

  const html = await response.text();
  const handles = [];
  const seen = new Set();
  const re = /href=["'](?:https?:\/\/[^"']+)?\/products\/([^"'?#/]+)[^"']*["']/gi;
  let match;
  while ((match = re.exec(html)) && handles.length < 40) {
    const handle = match[1];
    if (seen.has(handle)) continue;
    seen.add(handle);
    handles.push(handle);
  }

  return handles.map((handle) => ({
    title: handle.replace(/[-_]+/g, ' '),
    url: store.origin + '/products/' + handle,
    image: ''
  }));
}

function slugify(value = '') {
  return normalizeComparable(value).replace(/\s+/g, '-');
}

const COLLECTION_HINTS = new Map([
  ['naruto', ['naruto-skins']],
  ['one piece', ['one-piece']],
  ['demon slayer', ['demon-slayer-skins']],
  ['dragon ball', ['dragon-ball-z']],
  ['dragon ball z', ['dragon-ball-z']]
]);

async function collectionSearch(store, term) {
  if (store.name !== 'Anime Town Creations') return [];

  const key = normalizeComparable(term);
  const generic = slugify(term);
  const slugs = [
    ...(COLLECTION_HINTS.get(key) || []),
    generic,
    generic + '-skins'
  ].filter(Boolean);

  const seenSlug = new Set();
  const results = [];

  for (const slug of slugs) {
    if (seenSlug.has(slug)) continue;
    seenSlug.add(slug);

    try {
      const endpoint = store.origin + '/collections/' + slug + '/products.json?limit=250';
      const response = await fetchWithTimeout(endpoint, {
        headers: { Accept: 'application/json' }
      });

      if (!response.ok) continue;
      const json = await response.json();

      for (const product of json?.products || []) {
        const title = cleanText(product.title || '');
        const searchable = [
          title,
          product.handle || '',
          product.product_type || '',
          cleanText(product.body_html || ''),
          Array.isArray(product.tags) ? product.tags.join(' ') : product.tags || ''
        ].join(' ');

        if (!isCardSkinProduct(searchable, title)) continue;
        if (!isRelevantToTerm(searchable, term)) continue;

        results.push({
          title,
          url: store.origin + '/products/' + product.handle,
          image: normalizeImageUrl(product.image?.src || product.images?.[0]?.src || '', store.origin)
        });
      }

      if (results.length) break;
    } catch {}
  }

  return results.slice(0, 24);
}

async function catalogSearch(store, term) {
  try {
    const endpoint = store.origin + '/products.json?limit=250';
    const response = await fetch(endpoint, {
      headers: {
        'User-Agent': 'AirCard-Card-Studio/3.0 (+https://github.com/NightVibes33/Card-Maker)',
        Accept: 'application/json'
      },
      next: { revalidate: 3600 }
    });

    if (!response.ok) return [];
    const json = await response.json();

    return (json?.products || [])
      .filter((product) => {
        const title = cleanText(product.title || '');
        const searchable = [
          title,
          product.handle || '',
          product.product_type || '',
          cleanText(product.body_html || ''),
          Array.isArray(product.tags) ? product.tags.join(' ') : product.tags || ''
        ].join(' ');
        if (!isCardSkinProduct(searchable, title)) return false;
        return isRelevantToTerm(searchable, term);
      })
      .slice(0, 24)
      .map((product) => ({
        title: cleanText(product.title),
        url: store.origin + '/products/' + product.handle,
        image: normalizeImageUrl(product.image?.src || product.images?.[0]?.src || '', store.origin)
      }));
  } catch {
    return [];
  }
}

async function searchStore(store, term) {
  const [predictive, html, collection, catalog] = await Promise.all([
    predictiveSearch(store, term).catch(() => []),
    htmlSearch(store, term).catch(() => []),
    collectionSearch(store, term),
    catalogSearch(store, term)
  ]);

  const merged = [];
  const seen = new Set();

  for (const hit of [...collection, ...predictive, ...html, ...catalog]) {
    const handle = extractHandle(hit.url);
    if (!handle || seen.has(handle)) continue;
    seen.add(handle);
    merged.push(hit);
  }

  return merged;
}

function mediaScore(media, fallbackUrl = '') {
  const alt = cleanText(media?.alt || media?.preview_image?.alt || '');
  const src = normalizeImageUrl(
    media?.src ||
      media?.preview_image?.src ||
      media?.preview_image?.url ||
      fallbackUrl,
    'https://cdn.shopify.com'
  );

  if (!src) return { score: -999, src: '', alt };

  const descriptor = (alt + ' ' + src).toLowerCase();
  if (REJECT_MEDIA.some((term) => descriptor.includes(term))) {
    return { score: -999, src, alt };
  }

  let score = 0;
  for (const term of GOOD_MEDIA) {
    if (descriptor.includes(term)) score += 7;
  }

  const ratio =
    Number(media?.aspect_ratio) ||
    (Number(media?.width) && Number(media?.height) ? Number(media.width) / Number(media.height) : 0);

  if (ratio >= 1.35 && ratio <= 1.9) score += 8;
  else if (ratio >= 1.15 && ratio <= 2.1) score += 3;
  else if (ratio > 0 && ratio < 0.9) score -= 6;

  const width = Number(media?.width || media?.preview_image?.width || 0);
  if (width >= 1200) score += 4;
  else if (width >= 800) score += 2;

  if (/\bfull\b/i.test(alt)) score += 5;
  if (/mockup/i.test(descriptor)) score -= 8;

  return { score, src, alt, ratio, width };
}

function normalizeComparable(value = '') {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRelevantToTerm(text, term) {
  const haystack = normalizeComparable(text);
  const needle = normalizeComparable(term);
  if (!haystack || !needle) return false;
  if (haystack.includes(needle)) return true;

  const ignored = new Set(['credit', 'debit', 'card', 'skin', 'cover', 'sticker', 'anime', 'cartoon', 'tv', 'show']);
  const tokens = needle.split(' ').filter((token) => token.length > 2 && !ignored.has(token));
  if (!tokens.length) return false;

  // Require every meaningful token for multi-word franchises so "Dragon Ball"
  // does not degrade into an unrelated result containing only "Dragon".
  return tokens.every((token) => haystack.includes(token));
}

async function fetchProduct(store, hit, matchedTerm, originalQuery) {
  const handle = extractHandle(hit.url);
  if (!handle) return null;

  const productUrl = store.origin + '/products/' + handle;
  let details = null;

  try {
    const response = await fetchWithTimeout(productUrl + '.js', {
      headers: { Accept: 'application/json' }
    });
    if (response.ok) details = await response.json();
  } catch {}

  const title = cleanText(details?.title || hit.title || handle.replace(/[-_]+/g, ' '));

  const descriptiveText = [
    title,
    details?.type || '',
    details?.product_type || '',
    details?.description || '',
    Array.isArray(details?.tags) ? details.tags.join(' ') : details?.tags || '',
    details?.vendor || '',
    ...(details?.media || []).map((media) => media?.alt || media?.preview_image?.alt || '')
  ].join(' ');

  if (!isCardSkinProduct(descriptiveText, title)) return null;
  if (!isRelevantToTerm(descriptiveText, matchedTerm)) return null;

  const queryRelevant = isRelevantToTerm(descriptiveText, originalQuery);
  const candidates = [];

  for (const media of details?.media || []) {
    if (media?.media_type && media.media_type !== 'image') continue;
    candidates.push(mediaScore(media));
  }

  const detailImages = details?.images || [];
  for (const image of detailImages) {
    if (typeof image === 'string') {
      candidates.push(mediaScore({ src: image }));
    } else {
      candidates.push(mediaScore(image));
    }
  }

  if (details?.featured_image) {
    const featured =
      typeof details.featured_image === 'string'
        ? { src: details.featured_image }
        : details.featured_image;
    candidates.push(mediaScore(featured));
  }

  if (hit.image) candidates.push(mediaScore({ src: hit.image }));

  const usable = candidates
    .filter((candidate) => candidate.src && candidate.score > -100)
    .sort((a, b) => b.score - a.score);

  const best = usable[0];
  if (!best) return null;

  // Require positive evidence that this is useful card-skin media.
  // Unknown gallery/media entries are intentionally dropped rather than
  // silently substituted with a poster or unrelated product photo.
  if (best.score < 3) return null;

  const candidateImages = [...new Set(
    usable
      .slice(0, 6)
      .map((candidate) => candidate.src)
      .filter(Boolean)
  )].map(imageProxy);

  return {
    id: store.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + handle,
    title,
    subtitle: store.name,
    image: imageProxy(best.src),
    candidateImages,
    source: store.name,
    sourceUrl: productUrl,
    mediaType: 'premade-card-skin',
    cleanFilter: 'source-and-media-filtered',
    originalImage: best.src,
    mediaAlt: best.alt || '',
    mediaAspectRatio: best.ratio || null,
    priority: store.priority,
    qualityScore: best.score,
    matchedTerm,
    queryRelevant
  };
}

function searchTerms(q) {
  const key = q.toLowerCase().trim();
  const aliases = QUERY_ALIASES.get(key) || [];
  return [...new Set([q, ...aliases])].slice(0, 3);
}

export async function GET(request) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 100);
  if (q.length < 2) {
    return NextResponse.json({ results: [], source: 'Premade card-skin stores' });
  }

  try {
    const terms = searchTerms(q);
    const discoveryJobs = [];

    for (const store of STORES) {
      for (const term of terms) {
        discoveryJobs.push(
          searchStore(store, term).then((hits) => ({ store, term, hits }))
        );
      }
    }

    const discovered = await Promise.all(discoveryJobs);
    const productJobs = [];
    const seenProduct = new Set();

    // Validate a fair slice from every store/search-term group. The previous
    // global cap could be exhausted by the first store, causing valid CUCU
    // and other results to be skipped entirely.
    for (const group of discovered) {
      for (const hit of group.hits.slice(0, 4)) {
        const handle = extractHandle(hit.url);
        const key = group.store.origin + '|' + handle + '|' + group.term.toLowerCase();
        if (!handle || seenProduct.has(key)) continue;
        seenProduct.add(key);
        productJobs.push(fetchProduct(group.store, hit, group.term, q));
      }
    }

    const products = (await Promise.all(productJobs)).filter(Boolean);

    const queryTokens = q.toLowerCase().split(/\s+/).filter(Boolean);
    products.sort((a, b) => {
      const aText = a.title.toLowerCase();
      const bText = b.title.toLowerCase();
      const aMatch = queryTokens.reduce((score, token) => score + (aText.includes(token) ? 1 : 0), 0);
      const bMatch = queryTokens.reduce((score, token) => score + (bText.includes(token) ? 1 : 0), 0);
      return (
        Number(b.queryRelevant) - Number(a.queryRelevant) ||
        bMatch - aMatch ||
        b.priority - a.priority ||
        b.qualityScore - a.qualityScore
      );
    });

    const deduped = [];
    const seen = new Set();

    for (const item of products) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const { priority, qualityScore, originalImage, queryRelevant, ...publicItem } = item;
      deduped.push(publicItem);
      if (deduped.length >= 20) break;
    }

    return NextResponse.json(
      {
        results: deduped,
        source: 'Premade card-skin stores',
        policy: {
          postersAllowed: false,
          genericEntertainmentArtworkAllowed: false,
          obviousWatermarkLogoMediaAllowed: false,
          uncertainMedia: 'excluded'
        }
      },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600'
        }
      }
    );
  } catch (error) {
    console.error('card skin search failed', error);
    return NextResponse.json(
      {
        error: error?.message || 'Card-skin search failed',
        results: [],
        source: 'Premade card-skin stores'
      },
      { status: 502 }
    );
  }
}

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';

async function fetchJsonRetry(url, label, attempts = 4) {
  let lastResponse = null;
  let lastJson = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const response = await fetch(url);
    const json = await response.json().catch(() => ({}));
    lastResponse = response;
    lastJson = json;

    if (response.ok) return { response, json };

    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt >= attempts) break;
    await new Promise((resolve) => setTimeout(resolve, 900 * attempt));
  }

  throw new Error(
    label + ' returned ' +
    (lastResponse?.status || 'unknown status') +
    (lastJson?.error ? ': ' + lastJson.error : '')
  );
}

async function fetchSearch(query) {
  let last = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(base + '/api/search?q=' + encodeURIComponent(query) + '&kind=anime');
    const json = await response.json().catch(() => ({}));
    last = { response, json };

    if (response.ok && Array.isArray(json.results) && json.results.length > 0) {
      return json;
    }

    if (attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 700 * attempt));
    }
  }

  if (!last?.response?.ok) {
    throw new Error(query + ' search returned ' + (last?.response?.status || 'unknown status'));
  }

  console.warn('WARN', query, 'returned no results after 3 attempts; upstream storefront search was empty');
  return null;
}

async function check(query, titlePattern) {
  const json = await fetchSearch(query);
  if (!json) return;

  if (json.policy?.postersAllowed !== false) {
    throw new Error(query + ' did not enforce poster rejection');
  }

  const invalid = json.results.find((item) =>
    item.mediaType !== 'premade-card-skin' ||
    /Jikan|AniList|TVmaze/i.test(item.source || '') ||
    !/\/products\//i.test(item.sourceUrl || '') ||
    !Array.isArray(item.candidateImages) ||
    item.candidateImages.length < 1 ||
    !item.candidateImages.every((src) => src.startsWith('/api/image?')) ||
    /design your own|custom card skin|custom credit card/i.test(item.title || '')
  );
  if (invalid) {
    throw new Error(query + ' returned a non-premade or invalid result: ' + JSON.stringify(invalid));
  }

  const relevant = json.results.find((item) => titlePattern.test(item.title || '') || titlePattern.test(item.mediaAlt || ''));
  if (!relevant) {
    throw new Error(query + ' returned card skins, but none matched the requested franchise: ' + json.results.map((x) => x.title).join(' | '));
  }

  if (!relevant.image?.startsWith('/api/image?')) {
    throw new Error(query + ' result bypassed image proxy');
  }

  const imageResponse = await fetch(base + relevant.image);
  if (!imageResponse.ok) {
    throw new Error(query + ' image proxy returned ' + imageResponse.status);
  }

  const type = imageResponse.headers.get('content-type') || '';
  if (!type.startsWith('image/')) {
    throw new Error(query + ' image proxy returned ' + type);
  }

  console.log(
    'PASS',
    query,
    '=>',
    relevant.title,
    '|',
    relevant.source,
    '|',
    relevant.mediaType,
    '|',
    type
  );
}

async function checkCucuCatalog() {
  const firstResult = await fetchJsonRetry(base + '/api/cucu?page=1&limit=24', 'CUCU catalog page 1');
  const first = firstResult.json;
  if (!Array.isArray(first.results) || first.results.length < 1) {
    throw new Error('CUCU catalog page 1 returned no products');
  }
  if ((Number(first.total) || 0) < 2000) {
    throw new Error('CUCU catalog total unexpectedly small: ' + first.total);
  }
  if (first.source !== 'CUCU Covers · All Card Skins') {
    throw new Error('CUCU catalog source mismatch: ' + first.source);
  }

  const expectedCategories = [
    'All Card Skins',
    'Best Sellers',
    'New Arrivals',
    'Anime',
    'Cars',
    'Sports',
    'Artistic',
    'Cute & Kawaii',
    'Pets',
    'Classic Art',
    'Funny',
    'Memes',
    'Retro & Nostalgic',
    'Animals',
    'Crypto'
  ];

  const categoryLabels = Array.isArray(first.categories)
    ? first.categories.map((entry) => entry.label)
    : [];

  for (const label of expectedCategories) {
    if (!categoryLabels.includes(label)) {
      throw new Error('CUCU category missing from API: ' + label);
    }
  }

  const catalogCache = firstResult.response.headers.get('cache-control') || '';
  if (!/s-maxage=21600/.test(catalogCache)) {
    throw new Error('CUCU catalog is not edge cached for 6h: ' + catalogCache);
  }

  const invalidFirst = first.results.find((item) =>
    item.source !== 'CUCU Covers' ||
    item.mediaType !== 'premade-card-skin' ||
    item.collection !== 'all-card-covers' ||
    item.assetMode !== 'direct-card-art' ||
    !Array.isArray(item.directAssetUrls) ||
    item.directAssetUrls.length < 1 ||
    !/cucucovers\.com\/products\//i.test(item.sourceUrl || '') ||
    !item.image?.startsWith('/api/image?') ||
    !Array.isArray(item.candidateImages) ||
    item.candidateImages.length < 1
  );
  if (invalidFirst) {
    throw new Error('CUCU catalog returned invalid item: ' + JSON.stringify(invalidFirst));
  }

  const totalPages = Number(first.totalPages) || Math.ceil(first.total / 24);
  const lastResult = await fetchJsonRetry(
    base + '/api/cucu?page=' + totalPages + '&limit=24',
    'CUCU final page'
  );
  const last = lastResult.json;
  if (!Array.isArray(last.results) || last.results.length < 1) {
    throw new Error('CUCU final catalog page returned no products');
  }
  if (last.hasMore !== false) {
    throw new Error('CUCU final catalog page incorrectly reports hasMore');
  }

  console.log(
    'PASS CUCU catalog =>',
    first.total,
    'products across',
    totalPages,
    'app pages | final page',
    last.results.length,
    'products'
  );
}

async function checkBrowseTaxonomy() {
  const response = await fetch(base + '/');
  if (!response.ok) throw new Error('Home page returned ' + response.status);
  const html = (await response.text()).replace(/&amp;/g, '&');

  for (const label of ['CUCU Covers', 'All Card Skins', 'Best Sellers', 'New Arrivals', 'Cute & Kawaii']) {
    if (!html.includes(label)) throw new Error('Browse UI missing real source/category label: ' + label);
  }

  if (/Original ↗|Open the original|>Cartoon<|>TV</i.test(html)) {
    throw new Error('Browse UI still contains removed sources, fake taxonomy, or outbound storefront controls');
  }

  console.log('PASS Browse taxonomy => CUCU-only real collections, no Blitz, no storefront redirects');
}

await check('Naruto', /naruto|konohagakure|akatsuki/i);
await check('SpongeBob', /spongebob|bikini bottom|krusty/i);
await check('Rick and Morty', /rick|morty|portal|meeseeks/i);
await check('Wednesday', /wednesday/i);
await checkBrowseTaxonomy();
await checkCucuCatalog();
console.log('CUCU catalog smoke tests passed.');

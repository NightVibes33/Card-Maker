const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';

async function check(query, titlePattern) {
  const response = await fetch(base + '/api/search?q=' + encodeURIComponent(query) + '&kind=anime');
  if (!response.ok) throw new Error(query + ' search returned ' + response.status);

  const json = await response.json();
  if (!Array.isArray(json.results) || json.results.length < 1) {
    throw new Error(query + ' returned no premade card skins');
  }

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
  const firstResponse = await fetch(base + '/api/cucu?page=1&limit=24');
  if (!firstResponse.ok) throw new Error('CUCU catalog page 1 returned ' + firstResponse.status);

  const first = await firstResponse.json();
  if (!Array.isArray(first.results) || first.results.length < 1) {
    throw new Error('CUCU catalog page 1 returned no products');
  }
  if ((Number(first.total) || 0) < 2000) {
    throw new Error('CUCU catalog total unexpectedly small: ' + first.total);
  }
  if (first.source !== 'CUCU Covers · All Card Covers') {
    throw new Error('CUCU catalog source mismatch: ' + first.source);
  }

  const invalidFirst = first.results.find((item) =>
    item.source !== 'CUCU Covers' ||
    item.mediaType !== 'premade-card-skin' ||
    item.collection !== 'all-card-covers' ||
    !/cucucovers\.com\/products\//i.test(item.sourceUrl || '') ||
    !item.image?.startsWith('/api/image?') ||
    !Array.isArray(item.candidateImages) ||
    item.candidateImages.length < 1
  );
  if (invalidFirst) {
    throw new Error('CUCU catalog returned invalid item: ' + JSON.stringify(invalidFirst));
  }

  const totalPages = Number(first.totalPages) || Math.ceil(first.total / 24);
  const lastResponse = await fetch(base + '/api/cucu?page=' + totalPages + '&limit=24');
  if (!lastResponse.ok) throw new Error('CUCU final page returned ' + lastResponse.status);

  const last = await lastResponse.json();
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

await check('Naruto', /naruto|konohagakure|akatsuki/i);
await check('SpongeBob', /spongebob|bikini bottom|krusty/i);
await check('Rick and Morty', /rick|morty|portal|meeseeks/i);
await check('Wednesday', /wednesday/i);
await checkCucuCatalog();
console.log('Premade search + full CUCU catalog pagination smoke test passed.');

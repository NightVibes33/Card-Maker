const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';

async function check(query, expectedHint) {
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
    !/\/products\//i.test(item.sourceUrl || '')
  );
  if (invalid) {
    throw new Error(query + ' returned a non-card-skin result: ' + JSON.stringify(invalid));
  }

  const first = json.results[0];
  if (!first.image?.startsWith('/api/image?')) {
    throw new Error(query + ' result bypassed image proxy');
  }

  const imageResponse = await fetch(base + first.image);
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
    first.title,
    '|',
    first.source,
    '|',
    first.mediaType,
    '|',
    type,
    expectedHint || ''
  );
}

await check('Naruto', 'premade skin');
await check('SpongeBob', 'premade skin');
console.log('Premade card-skin search smoke test passed.');

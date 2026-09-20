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

await check('Naruto', /naruto/i);
await check('SpongeBob', /spongebob|bikini bottom/i);
console.log('Premade card-skin relevance + image smoke test passed.');

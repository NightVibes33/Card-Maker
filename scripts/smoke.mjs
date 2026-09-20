const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';

async function check(kind, query) {
  const url = base + '/api/search?q=' + encodeURIComponent(query) + '&kind=' + encodeURIComponent(kind);
  const response = await fetch(url);
  if (!response.ok) throw new Error(kind + ' search returned ' + response.status);
  const json = await response.json();
  if (!Array.isArray(json.results) || json.results.length < 1) {
    throw new Error(kind + ' search returned no artwork');
  }

  const first = json.results[0];
  if (!first.image || !first.image.startsWith('/api/image?')) {
    throw new Error(kind + ' result did not use the image proxy');
  }

  const imageResponse = await fetch(base + first.image);
  if (!imageResponse.ok) {
    throw new Error(kind + ' image proxy returned ' + imageResponse.status);
  }
  const type = imageResponse.headers.get('content-type') || '';
  if (!type.startsWith('image/')) {
    throw new Error(kind + ' image proxy returned ' + type);
  }

  console.log('PASS', kind, first.title, json.source, type);
}

await check('anime', 'Naruto');
await check('tv', 'Breaking Bad');
await check('cartoon', 'SpongeBob SquarePants');
console.log('Search + image proxy smoke test passed.');

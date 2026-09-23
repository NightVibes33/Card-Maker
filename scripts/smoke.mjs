import sharp from 'sharp';

const base = process.env.SMOKE_BASE || 'http://127.0.0.1:3000';

async function fetchJsonRetry(url, label, attempts = 5) {
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

async function checkHome() {
  const response = await fetch(base + '/');
  if (!response.ok) throw new Error('Home page returned ' + response.status);
  const html = (await response.text()).replace(/&amp;/g, '&');

  for (const text of ['Card Studio', 'Discover a card skin', 'Search 2,225+ card skins', 'Surprise Me']) {
    if (!html.includes(text)) throw new Error('Home page missing V2 UI text: ' + text);
  }

  if (/Blitz|Load More|Original ↗|Open the original|Design Studio/i.test(html)) {
    throw new Error('Home page contains removed or legacy catalog UI');
  }

  console.log('PASS V2 shell');
}

async function checkInstallIcons() {
  for (const [path, width, height] of [
    ['/icon', 512, 512],
    ['/apple-icon', 180, 180]
  ]) {
    const response = await fetch(base + path);
    if (!response.ok || !(response.headers.get('content-type') || '').startsWith('image/png')) {
      throw new Error(path + ' did not return a PNG install icon');
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    const image = sharp(bytes, { animated: false }).ensureAlpha();
    const metadata = await image.metadata();
    if (metadata.width !== width || metadata.height !== height) {
      throw new Error(
        path + ' has wrong dimensions: ' +
        String(metadata.width || '?') + 'x' + String(metadata.height || '?')
      );
    }

    const raw = await image.raw().toBuffer();
    if (raw.length < 4 || raw[3] !== 255) {
      throw new Error(path + ' has a transparent top-left corner instead of full-bleed artwork');
    }
  }

  console.log('PASS install icons => 512px maskable + 180px Apple full-bleed PNGs');
}

async function checkCatalog() {
  const { response, json } = await fetchJsonRetry(
    base + '/api/cucu?category=all&page=1&limit=24',
    'CUCU catalog'
  );

  if (!Array.isArray(json.results) || json.results.length < 1) {
    throw new Error('CUCU catalog returned no products');
  }

  if ((Number(json.total) || 0) < 2000) {
    throw new Error('CUCU catalog total unexpectedly small: ' + json.total);
  }

  const cache = response.headers.get('cache-control') || '';
  if (!/s-maxage=21600/.test(cache)) {
    throw new Error('CUCU catalog missing 6h edge cache: ' + cache);
  }

  const expectedCategories = [
    'All Card Skins','Best Sellers','New Arrivals','Anime','Cars','Sports',
    'Artistic','Cute & Kawaii','Pets','Classic Art','Funny','Memes',
    'Retro & Nostalgic','Animals','Crypto'
  ];
  const labels = (json.categories || []).map((entry) => entry.label);
  for (const label of expectedCategories) {
    if (!labels.includes(label)) throw new Error('Missing CUCU category: ' + label);
  }

  const invalid = json.results.find((item) =>
    item.source !== 'CUCU Covers' ||
    !/card covers?/i.test(String(item.upstreamProductType || '')) ||
    item.mediaType !== 'premade-card-skin' ||
    item.assetMode !== 'direct-card-art' ||
    !item.image?.startsWith('/api/image?') ||
    !item.thumbnail?.startsWith('/api/image?') ||
    !item.image.includes('v=2') ||
    !item.thumbnail.includes('w=560') ||
    !item.thumbnail.includes('v=2') ||
    !Array.isArray(item.inspectUrls) ||
    item.inspectUrls.length < 1 ||
    !item.inspectUrls.every((url) => url.startsWith('/api/cucu/inspect?'))
  );

  if (invalid) throw new Error('Invalid CUCU V2 item: ' + JSON.stringify(invalid));

  const thumb = await fetch(base + json.results[0].thumbnail);
  if (!thumb.ok || !(thumb.headers.get('content-type') || '').startsWith('image/')) {
    throw new Error('CUCU thumbnail pipeline failed');
  }

  const thumbBytes = Buffer.from(await thumb.arrayBuffer());
  const thumbMeta = await sharp(thumbBytes, { animated: false }).metadata();
  if (
    !Number(thumbMeta.width) ||
    !Number(thumbMeta.height) ||
    Number(thumbMeta.width) > 560 ||
    Number(thumbMeta.height) > 560
  ) {
    throw new Error(
      'CUCU thumbnail was not physically downsampled: ' +
      String(thumbMeta.width || '?') + 'x' + String(thumbMeta.height || '?')
    );
  }

  console.log(
    'PASS CUCU catalog + thumbnail pipeline =>',
    json.total,
    'products ·',
    thumbMeta.width + 'x' + thumbMeta.height
  );
  return json.results;
}

async function checkAnimeDeskMat() {
  const { response, json } = await fetchJsonRetry(
    base + '/api/animedeskmat?page=1&limit=12',
    'AnimeDeskMat catalog'
  );

  if (!Array.isArray(json.results) || json.results.length < 1) {
    throw new Error('AnimeDeskMat catalog returned no products');
  }

  const invalid = json.results.find((item) => {
    const assets = Array.isArray(item.directAssetUrls) ? item.directAssetUrls : [];
    if (
      item.source !== 'AnimeDeskMat' ||
      item.mediaType !== 'premade-card-skin' ||
      item.assetMode !== 'direct-card-art' ||
      assets.length < 1 ||
      !item.image?.startsWith('/api/image?') ||
      !item.thumbnail?.includes('w=560') ||
      !Array.isArray(item.inspectUrls) ||
      item.inspectUrls.length !== Math.min(3, assets.length) ||
      !item.inspectUrls.every((url) => url.startsWith('/api/cucu/inspect?')) ||
      Object.prototype.hasOwnProperty.call(item, 'sourceCrop') ||
      Object.prototype.hasOwnProperty.call(item, 'mediaAspectRatio')
    ) return true;

    return assets.some((assetUrl) => {
      let filename = '';
      try {
        filename = decodeURIComponent(new URL(assetUrl).pathname.split('/').pop() || '').toLowerCase();
      } catch {
        return true;
      }
      return (
        !/full-cover(?:_[a-z0-9-]+)?\.(?:png|webp|jpe?g)$/.test(filename) ||
        /with[-_](?:chip|window)|half[-_]cover|4[-_]sets?/.test(filename)
      );
    });
  });

  if (invalid) {
    throw new Error('AnimeDeskMat returned a non-plain full-cover asset: ' + JSON.stringify(invalid));
  }

  const cache = response.headers.get('cache-control') || '';
  if (!/s-maxage=21600/.test(cache)) {
    throw new Error('AnimeDeskMat catalog missing 6h edge cache: ' + cache);
  }

  const inspected = await fetchJsonRetry(
    base + json.results[0].inspectUrls[0],
    'AnimeDeskMat artwork preprocessing',
    3
  );
  if (
    !inspected.json?.usable ||
    !inspected.json?.full ||
    !inspected.json?.thumbnail ||
    !inspected.json?.crop ||
    !(Number(inspected.json?.ratio) > 1.25 && Number(inspected.json?.ratio) <= 2.08)
  ) {
    throw new Error(
      'AnimeDeskMat did not receive the same usable crop/full/thumbnail metadata as CUCU'
    );
  }

  console.log(
    'PASS AnimeDeskMat => no-chip source selection, then exact CUCU preprocessing path'
  );
}

async function checkPreprocessing(results) {
  let usable = null;

  for (const item of results.slice(0, 6)) {
    for (const inspectUrl of item.inspectUrls.slice(0, 3)) {
      try {
        const result = await fetchJsonRetry(base + inspectUrl, 'CUCU artwork preprocessing', 3);
        if (result.json?.usable && result.json?.full && result.json?.thumbnail) {
          usable = result;
          break;
        }
      } catch {}
    }
    if (usable) break;
  }

  if (!usable) throw new Error('No usable server-preprocessed CUCU image found in sample');

  const cache =
    usable.response.headers.get('cdn-cache-control') ||
    usable.response.headers.get('cache-control') ||
    '';
  if (!/2592000/.test(cache)) {
    throw new Error('CUCU preprocessing metadata is not cached for 30d: ' + cache);
  }

  if (!usable.json.thumbnail.includes('w=560')) {
    throw new Error('Preprocessed thumbnail is not downsampled: ' + usable.json.thumbnail);
  }

  console.log('PASS CUCU server preprocessing => usable crop/full/thumbnail metadata');
}

async function checkSearch(catalogResults) {
  const firstTitle = String(catalogResults[0]?.title || '');
  const token = firstTitle
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length >= 4 && !['card','credit','debit','skin','skins','cover','covers'].includes(word))
    .sort((a, b) => b.length - a.length)[0];

  if (!token) throw new Error('Could not derive a real CUCU search token from: ' + firstTitle);

  const result = await fetchJsonRetry(
    base + '/api/cucu?category=all&q=' + encodeURIComponent(token) + '&page=1&limit=12',
    'CUCU search'
  );

  if (result.json.upstream?.mode !== 'catalog-search') {
    throw new Error('CUCU search did not use cached catalog-search mode');
  }

  if (!Array.isArray(result.json.results) || result.json.results.length < 1) {
    throw new Error('CUCU search returned no matches for known catalog token: ' + token);
  }

  const matched = result.json.results.some((item) =>
    String(item.title || '').toLowerCase().includes(token) ||
    String(item.mediaAlt || '').toLowerCase().includes(token)
  );
  if (!matched) {
    throw new Error('CUCU search returned results but not the known token: ' + token);
  }

  console.log('PASS CUCU cached search =>', token, result.json.results.length, 'results');
}


async function checkAnimeDeskMatCatalog() {
  const { response, json } = await fetchJsonRetry(
    base + '/api/animedeskmat?category=anime&page=1&limit=24',
    'AnimeDeskMat catalog'
  );

  if (!Array.isArray(json.results) || json.results.length < 1) {
    throw new Error('AnimeDeskMat catalog returned no products');
  }
  if (Number(json.total) !== 907) {
    throw new Error('AnimeDeskMat catalog total changed unexpectedly: ' + json.total);
  }

  const invalid = json.results.find((item) => {
    const direct = String(item.directAssetUrls?.[0] || '').toLowerCase();
    return (
      item.source !== 'AnimeDeskMat' ||
      item.mediaType !== 'premade-card-skin' ||
      item.assetMode !== 'direct-card-art' ||
      item.cleanFilter !== 'strict-full-cover-no-chip' ||
      !direct ||
      !/full-cover(?:_[a-z0-9-]+)?\.(?:png|webp|jpe?g)(?:\?|$)/i.test(direct) ||
      /with[-_](?:chip|window)|half[-_]cover|4[-_]sets?/i.test(direct) ||
      !item.image?.startsWith('/api/image?') ||
      !item.thumbnail?.includes('w=560') ||
      !Array.isArray(item.inspectUrls) ||
      !item.inspectUrls.every((url) => url.startsWith('/api/cucu/inspect?'))
    );
  });
  if (invalid) throw new Error('Invalid AnimeDeskMat no-chip item: ' + JSON.stringify(invalid));

  const thumb = await fetch(base + json.results[0].thumbnail);
  if (!thumb.ok || !(thumb.headers.get('content-type') || '').startsWith('image/')) {
    throw new Error('AnimeDeskMat thumbnail pipeline failed');
  }

  const cache = response.headers.get('cache-control') || '';
  if (!/s-maxage=21600/.test(cache)) {
    throw new Error('AnimeDeskMat catalog missing 6h edge cache: ' + cache);
  }

  console.log('PASS AnimeDeskMat => 907 anime skins · strict no-chip full-cover assets');
}

async function checkNoConsoleProducts() {
  for (const query of ['ps5', 'playstation 5', 'nintendo switch', 'steam deck', 'controller']) {
    const result = await fetchJsonRetry(
      base + '/api/cucu?category=all&q=' + encodeURIComponent(query) + '&page=1&limit=24',
      'CUCU console exclusion'
    );
    const bad = (result.json.results || []).find((item) =>
      /playstation|ps5|nintendo switch|steam deck|controller/i.test(
        [item.title, item.upstreamProductType, ...(item.tags || [])].join(' ')
      )
    );
    if (bad) throw new Error('Console hardware leaked into card catalog: ' + JSON.stringify(bad));
  }
  console.log('PASS CUCU console exclusion => PS5 / Switch / Steam Deck / controllers blocked');
}

await checkHome();
await checkInstallIcons();
const results = await checkCatalog();
await checkAnimeDeskMat();
await checkPreprocessing(results);
await checkSearch(results);
await checkAnimeDeskMatCatalog();
await checkNoConsoleProducts();
console.log('Card Studio V2 CUCU smoke tests passed.');

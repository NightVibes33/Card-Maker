import { NextResponse } from 'next/server';

const proxy = (url) => '/api/image?url=' + encodeURIComponent(url);

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeJikan(item) {
  const remote =
    item.images?.webp?.large_image_url ||
    item.images?.jpg?.large_image_url ||
    item.images?.webp?.image_url ||
    item.images?.jpg?.image_url ||
    '';

  if (!remote) return null;
  return {
    id: 'jikan-' + item.mal_id,
    title: item.title_english || item.title || 'Untitled',
    subtitle: [item.year, item.type, ...(item.genres || []).slice(0, 2).map((g) => g.name)].filter(Boolean).join(' · '),
    image: proxy(remote),
    source: 'Jikan',
    sourceUrl: item.url || 'https://myanimelist.net/'
  };
}

async function searchJikan(q) {
  const url = 'https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(q) + '&limit=18&sfw=true&order_by=popularity';
  let response = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'AirCard-Sticker-Studio/2.0' }
  });

  if (response.status === 429) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    response = await fetchWithTimeout(url, {
      headers: { 'User-Agent': 'AirCard-Sticker-Studio/2.0' }
    });
  }

  if (!response.ok) throw new Error('Jikan ' + response.status);
  const json = await response.json();
  return (json.data || []).map(normalizeJikan).filter(Boolean);
}

async function searchAniList(q) {
  const query = [
    'query ($search: String) {',
    '  Page(page: 1, perPage: 18) {',
    '    media(search: $search, type: ANIME, isAdult: false, sort: SEARCH_MATCH) {',
    '      id',
    '      title { romaji english }',
    '      coverImage { extraLarge large }',
    '      seasonYear',
    '      format',
    '      genres',
    '      siteUrl',
    '    }',
    '  }',
    '}'
  ].join('\n');

  const response = await fetchWithTimeout('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'User-Agent': 'AirCard-Sticker-Studio/2.0'
    },
    body: JSON.stringify({ query, variables: { search: q } })
  });

  if (!response.ok) throw new Error('AniList ' + response.status);
  const json = await response.json();
  const rows = json?.data?.Page?.media || [];

  return rows.map((item) => {
    const remote = item.coverImage?.extraLarge || item.coverImage?.large || '';
    if (!remote) return null;
    return {
      id: 'anilist-' + item.id,
      title: item.title?.english || item.title?.romaji || 'Untitled',
      subtitle: [item.seasonYear, item.format, ...(item.genres || []).slice(0, 2)].filter(Boolean).join(' · '),
      image: proxy(remote),
      source: 'AniList',
      sourceUrl: item.siteUrl || 'https://anilist.co/'
    };
  }).filter(Boolean);
}

function mergeAnime(groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const item of group) {
      const key = item.title.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
      if (out.length >= 24) return out;
    }
  }
  return out;
}

async function searchAnime(q) {
  const settled = await Promise.allSettled([searchJikan(q), searchAniList(q)]);
  const successful = settled.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!successful.length) {
    const reasons = settled.map((r) => r.status === 'rejected' ? r.reason?.message : '').filter(Boolean).join(', ');
    throw new Error(reasons || 'Anime providers unavailable');
  }
  return {
    results: mergeAnime(successful),
    source: successful.length > 1 ? 'Jikan + AniList' : (settled[0].status === 'fulfilled' ? 'Jikan' : 'AniList')
  };
}

async function searchTV(q, cartoonOnly) {
  const response = await fetchWithTimeout(
    'https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q),
    { headers: { 'User-Agent': 'AirCard-Sticker-Studio/2.0' } }
  );

  if (!response.ok) throw new Error('TVmaze ' + response.status);
  let rows = (await response.json()).map((row) => row.show).filter(Boolean);

  if (cartoonOnly) {
    const animation = rows.filter((show) =>
      (show.genres || []).some((genre) => /animation|children|family/i.test(genre))
    );
    if (animation.length) rows = animation;
  }

  const results = rows.slice(0, 24).map((show) => {
    const remote = show.image?.original || show.image?.medium || '';
    if (!remote) return null;
    return {
      id: 'tvmaze-' + show.id,
      title: show.name || 'Untitled',
      subtitle: [show.premiered?.slice(0, 4), ...(show.genres || []).slice(0, 3)].filter(Boolean).join(' · '),
      image: proxy(remote),
      source: 'TVmaze',
      sourceUrl: show.url || 'https://www.tvmaze.com/'
    };
  }).filter(Boolean);

  return { results, source: 'TVmaze' };
}

export async function GET(request) {
  const q = (request.nextUrl.searchParams.get('q') || '').trim().slice(0, 100);
  const kind = request.nextUrl.searchParams.get('kind') || 'anime';

  if (q.length < 2) {
    return NextResponse.json({ results: [], source: '' });
  }

  try {
    const payload = kind === 'anime'
      ? await searchAnime(q)
      : await searchTV(q, kind === 'cartoon');

    return NextResponse.json(payload, {
      headers: {
        'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=86400'
      }
    });
  } catch (error) {
    console.error('search failed', error);
    return NextResponse.json({
      error: error?.message || 'Artwork search failed',
      results: [],
      source: ''
    }, { status: 502 });
  }
}

import { NextResponse } from 'next/server';

const imageProxy = (url) => '/api/image?url=' + encodeURIComponent(url);

export async function GET(request) {
  const params = request.nextUrl.searchParams;
  const q = (params.get('q') || '').trim().slice(0, 80);
  const kind = params.get('kind') || 'anime';
  if (q.length < 2) return NextResponse.json({ results: [] });

  try {
    if (kind === 'anime') {
      const response = await fetch(
        'https://api.jikan.moe/v4/anime?q=' + encodeURIComponent(q) + '&limit=20&sfw=true',
        { headers: { 'User-Agent': 'AirCard-Studio/1.0' }, next: { revalidate: 3600 } }
      );
      if (!response.ok) throw new Error('Jikan ' + response.status);
      const json = await response.json();
      const results = (json.data || []).map((item) => {
        const remote = item.images?.webp?.large_image_url || item.images?.jpg?.large_image_url || item.images?.jpg?.image_url || '';
        return {
          id: 'anime-' + item.mal_id,
          title: item.title_english || item.title || 'Untitled',
          subtitle: [item.year, item.type, ...(item.genres || []).slice(0, 2).map((g) => g.name)].filter(Boolean).join(' · '),
          image: remote ? imageProxy(remote) : '',
          source: 'Jikan / MyAnimeList',
          sourceUrl: item.url || 'https://myanimelist.net/'
        };
      }).filter((item) => item.image);
      return NextResponse.json({ results }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
    }

    const response = await fetch(
      'https://api.tvmaze.com/search/shows?q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': 'AirCard-Studio/1.0 (card skin editor)' }, next: { revalidate: 3600 } }
    );
    if (!response.ok) throw new Error('TVmaze ' + response.status);
    let rows = (await response.json()).map((row) => row.show).filter(Boolean);

    if (kind === 'cartoon') {
      const animated = rows.filter((show) => (show.genres || []).some((genre) => /animation|children/i.test(genre)));
      if (animated.length) rows = animated;
    }

    const results = rows.slice(0, 20).map((show) => {
      const remote = show.image?.original || show.image?.medium || '';
      return {
        id: 'tv-' + show.id,
        title: show.name || 'Untitled',
        subtitle: [show.premiered?.slice(0, 4), ...(show.genres || []).slice(0, 3)].filter(Boolean).join(' · '),
        image: remote ? imageProxy(remote) : '',
        source: 'TVmaze',
        sourceUrl: show.url || 'https://www.tvmaze.com/'
      };
    }).filter((item) => item.image);

    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: 'Artwork search is temporarily unavailable.', results: [] }, { status: 502 });
  }
}

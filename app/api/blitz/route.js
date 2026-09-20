import { NextResponse } from 'next/server';
import { BLITZ_INDEX } from './catalog';

const ORIGIN = 'https://blitzcovers.com';
const COLLECTION = 'credit-card-cover';

const BLITZ_IMAGE_REV = '3';

function imageUrl(handle) {
  return '/api/blitz-image?handle=' + encodeURIComponent(handle) + '&v=' + BLITZ_IMAGE_REV;
}

function toPublicItem(entry) {
  const productUrl = ORIGIN + '/products/' + entry.handle;
  const image = imageUrl(entry.handle);

  return {
    id: entry.id,
    title: entry.title,
    subtitle: 'Blitz Covers',
    image,
    candidateImages: [image],
    source: 'Blitz Covers',
    sourceUrl: productUrl,
    mediaType: 'premade-card-skin',
    cleanFilter: 'indexed-product-art',
    assetMode: 'resolved-product-art',
    mediaAlt: entry.title,
    collection: COLLECTION
  };
}

export async function GET(request) {
  const requestedPage = Number(request.nextUrl.searchParams.get('page') || 1);
  const requestedLimit = Number(request.nextUrl.searchParams.get('limit') || 24);

  const page = Math.max(1, Math.floor(Number.isFinite(requestedPage) ? requestedPage : 1));
  const limit = Math.max(
    12,
    Math.min(48, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 24))
  );

  const total = BLITZ_INDEX.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const start = (page - 1) * limit;
  const results = BLITZ_INDEX.slice(start, start + limit).map(toPublicItem);

  return NextResponse.json(
    {
      results,
      page,
      limit,
      total,
      totalPages,
      hasMore: page < totalPages,
      source: 'Blitz Covers · Full Card Covers',
      collectionUrl: ORIGIN + '/collections/' + COLLECTION,
      upstream: {
        collection: COLLECTION,
        mode: 'indexed-snapshot',
        note: 'Blitz blocks server-side collection requests; product artwork resolves per item.'
      }
    },
    {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400'
      }
    }
  );
}

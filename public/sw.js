const SHELL_CACHE = 'card-studio-shell-v3';
const ART_CACHE = 'card-studio-art-v4';
const THUMB_CACHE = 'card-studio-thumb-v1';
const CATALOG_CACHE = 'card-studio-catalog-v3';
const STATIC_CACHE = 'card-studio-static-v3';
const OWNED_CACHE_PREFIX = 'card-studio-';

const SHELL = ['/', '/manifest.webmanifest'];
const CACHE_LIMITS = {
  [SHELL_CACHE]: 16,
  [ART_CACHE]: 40,
  [THUMB_CACHE]: 160,
  [CATALOG_CACHE]: 80,
  [STATIC_CACHE]: 120
};

async function trimCache(cacheName) {
  const limit = CACHE_LIMITS[cacheName];
  if (!limit) return;

  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  const overflow = keys.length - limit;
  if (overflow <= 0) return;

  await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
}

async function cacheResponse(cacheName, request, response) {
  if (!response?.ok) return;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  await trimCache(cacheName);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter(
            (key) =>
              key.startsWith(OWNED_CACHE_PREFIX) &&
              ![SHELL_CACHE, ART_CACHE, THUMB_CACHE, CATALOG_CACHE, STATIC_CACHE].includes(key)
          )
          .map((key) => caches.delete(key))
      ))
      .then(() => Promise.all([
        trimCache(SHELL_CACHE),
        trimCache(ART_CACHE),
        trimCache(THUMB_CACHE),
        trimCache(CATALOG_CACHE),
        trimCache(STATIC_CACHE)
      ]))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cacheResponse(cacheName, request, response).catch(() => {});
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cacheResponse(cacheName, request, response).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (hit) {
    network.catch(() => {});
    return hit;
  }

  return (await network) || new Response('Offline', { status: 503 });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);

  try {
    const response = await fetch(request, { cache: 'no-store' });
    if (response.ok) {
      cacheResponse(cacheName, request, response).catch(() => {});
      return response;
    }

    if (response.status >= 500) {
      const hit = await cache.match(request);
      if (hit) return hit;
    }

    return response;
  } catch {
    const hit = await cache.match(request);
    return hit || new Response('Offline', { status: 503 });
  }
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(cacheFirst(event.request, SHELL_CACHE));
    return;
  }

  if (url.pathname === '/api/image') {
    const requestedWidth = Number(url.searchParams.get('w') || 0);
    const cacheName = requestedWidth > 0 && requestedWidth <= 800
      ? THUMB_CACHE
      : ART_CACHE;
    event.respondWith(cacheFirst(event.request, cacheName));
    return;
  }

  if (url.pathname.startsWith('/api/cucu')) {
    event.respondWith(staleWhileRevalidate(event.request, CATALOG_CACHE));
    return;
  }

  if (url.pathname.startsWith('/_next/static/') || /\.(?:js|css|woff2?|png|jpg|jpeg|webp|svg|ico)$/i.test(url.pathname)) {
    event.respondWith(cacheFirst(event.request, STATIC_CACHE));
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirst(event.request, SHELL_CACHE));
  }
});

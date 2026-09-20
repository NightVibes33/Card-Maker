const SHELL_CACHE = 'aircard-shell-v2';
const ART_CACHE = 'aircard-art-v2';
const CATALOG_CACHE = 'aircard-catalog-v2';
const STATIC_CACHE = 'aircard-static-v2';

const SHELL = ['/', '/manifest.webmanifest'];

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
          .filter((key) => ![SHELL_CACHE, ART_CACHE, CATALOG_CACHE, STATIC_CACHE].includes(key))
          .map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone()).catch(() => {});
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone()).catch(() => {});
      return response;
    })
    .catch(() => null);

  if (hit) {
    network.catch(() => {});
    return hit;
  }

  return (await network) || new Response('Offline', { status: 503 });
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname === '/api/image') {
    event.respondWith(cacheFirst(event.request, ART_CACHE));
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
    event.respondWith(staleWhileRevalidate(event.request, SHELL_CACHE));
  }
});

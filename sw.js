// Zuma Sales Dashboard — Service Worker
// Caching strategy:
//   - HTML                       → stale-while-revalidate (instant + always pull
//                                  latest in BG → fresh code visible on next visit)
//   - Static assets (JS/CSS/etc) → cache-first (versioned via CDN URL anyway)
//   - API (/api/*)               → stale-while-revalidate (instant + auto-update)
//
// IMPORTANT: bump VERSION every release so old caches (especially HTML) get nuked
// via the activate handler. Match APP_VERSION di index.html biar gampang trace.
const VERSION = 'v2.51';
const STATIC_CACHE = `zuma-static-${VERSION}`;
const API_CACHE    = `zuma-api-${VERSION}`;

// Install: skip waiting so a fresh SW takes control immediately on next reload.
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: nuke any cache that doesn't match the current VERSION + claim clients.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.endsWith(VERSION))
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Only intercept GET; POST/etc. should go straight to network.
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Only handle our own origin + the API proxy on Vercel.
  const isSelf = url.origin === self.location.origin;
  const isApiProxy = url.hostname === 'zuma-api-proxy.vercel.app';
  if (!isSelf && !isApiProxy) return;

  // Skip auth-bearing or cache-control bypass requests.
  if (request.headers.get('Cache-Control') === 'no-cache') return;

  const isApi = url.pathname.startsWith('/api/');
  // Treat HTML doc requests as SWR juga supaya code update (APP_VERSION bump)
  // landing di user tanpa harus hard-refresh. JS/CSS lain tetap cache-first
  // karena versioned via CDN URL.
  const isHtml = request.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html');
  if (isApi) {
    event.respondWith(staleWhileRevalidate(request, API_CACHE));
  } else if (isHtml) {
    event.respondWith(staleWhileRevalidate(request, STATIC_CACHE));
  } else {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
  }
});

// Cache-first: serve from cache if available, else fetch and cache.
// Used for static assets (HTML, JS, CSS) — they only change on VERSION bump.
async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (e) {
    // Offline + uncached — let the browser show its native error.
    throw e;
  }
}

// Stale-while-revalidate: return cache immediately (if any), refresh in background.
// Used for API responses — instant render with stale data, fresh data lands silently.
// On fresh response, post a message to all clients so the dashboard can re-fetch
// from its in-memory cache and re-render with up-to-date data.
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request).then((response) => {
    if (response.ok) {
      cache.put(request, response.clone());
      // Notify dashboard that fresher data is now in the cache.
      // Dashboard listens via navigator.serviceWorker.addEventListener('message').
      notifyClients({ type: 'api-updated', url: request.url });
    }
    return response;
  }).catch(() => cached);

  // Return cache immediately if present; otherwise wait for the network.
  return cached || fetchPromise;
}

async function notifyClients(payload) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage(payload);
  }
}

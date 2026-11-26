const CACHE_NAME = 'softspot-shell-v2.3.1';
const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css?v=2.3.1',
  './apis.js?v=2.3.1',
  './app.js?v=2.3.1'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL_ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('softspot-shell-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isShellRequest(request, url) {
  if (request.mode === 'navigate') return true;
  const p = url.pathname || '';
  return p.endsWith('/') ||
    p.endsWith('/index.html') ||
    p.endsWith('/style.css') ||
    p.endsWith('/apis.js') ||
    p.endsWith('/app.js');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }

  // Strictly ignore third-party API origins (Gemini, Discogs, Spotify, Google, iTunes, Deezer)
  if (url.origin !== self.location.origin) return;
  if (!isShellRequest(req, url)) return;

  // Network-first with automatic cache refresh when online and instant cache fallback when offline
  event.respondWith(
    fetch(req)
      .then((networkRes) => {
        if (networkRes && networkRes.ok && (networkRes.type === 'basic' || networkRes.type === 'default')) {
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
        }
        return networkRes;
      })
      .catch(async () => {
        const exact = await caches.match(req);
        if (exact) return exact;
        if (req.mode === 'navigate') {
          const fallbackHtml = await caches.match('./index.html') || await caches.match('./');
          if (fallbackHtml) return fallbackHtml;
        }
        const noQuery = await caches.match(req, { ignoreSearch: true });
        if (noQuery) return noQuery;
        return new Response('Offline — Soft Spot app shell not cached yet.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      })
  );
});

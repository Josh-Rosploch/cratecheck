const SCOPE_PATH = new URL(self.registration.scope).pathname;
const SCOPE_ID = SCOPE_PATH.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '') || 'root';
const CACHE_PREFIX = 'softspot-shell-' + SCOPE_ID + '-';
const CACHE_NAME = CACHE_PREFIX + 'v2.3.2';

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css?v=2.3.2',
  './apis.js?v=2.3.2',
  './app.js?v=2.3.2'
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
          .filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isShellRequest(request, url) {
  if (!url.pathname.startsWith(SCOPE_PATH)) return false;
  if (request.mode === 'navigate') return true;
  const p = url.pathname || '';
  return p === SCOPE_PATH ||
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

  // Network-first with explicit scope-isolated cache reads/writes, 5xx outage fallback,
  // and strict version-locked asset matching (never mix newer HTML with older JS/CSS!)
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const serveFallback = async () => {
      if (req.mode === 'navigate') {
        const cachedIndex = await cache.match('./index.html') || await cache.match('./') || await cache.match(req);
        if (cachedIndex) return cachedIndex;
      } else {
        const exact = await cache.match(req);
        if (exact) return exact;
      }
      return new Response('Offline — Soft Spot app shell not cached yet.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    };

    try {
      const networkRes = await fetch(req);
      if (!networkRes || networkRes.status >= 500) {
        return await serveFallback();
      }
      if (networkRes.ok && (networkRes.type === 'basic' || networkRes.type === 'default')) {
        const copy = networkRes.clone();
        if (req.mode === 'navigate') {
          cache.put('./index.html', copy).catch(() => {});
        } else {
          cache.put(req, copy).catch(() => {});
        }
      }
      return networkRes;
    } catch (_) {
      return await serveFallback();
    }
  })());
});

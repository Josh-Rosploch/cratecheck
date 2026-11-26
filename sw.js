const SHELL_VERSION = '2.3.3';
const SCOPE_PATH = new URL(self.registration.scope).pathname;

function hashScopePath(str) {
  const s = String(str || '/');
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= (c + i);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

const SCOPE_ID = 's_' + hashScopePath(SCOPE_PATH);
const CACHE_PREFIX = 'softspot-shell-' + SCOPE_ID + '-';
const CACHE_NAME = CACHE_PREFIX + 'v' + SHELL_VERSION;

const SHELL_ASSETS = [
  './',
  './index.html',
  './style.css?v=' + SHELL_VERSION,
  './apis.js?v=' + SHELL_VERSION,
  './app.js?v=' + SHELL_VERSION
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

function isMatchingVersionedAsset(url) {
  const p = url.pathname || '';
  if (p.endsWith('/style.css') || p.endsWith('/apis.js') || p.endsWith('/app.js')) {
    return url.searchParams.get('v') === SHELL_VERSION;
  }
  return false;
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

  // Network-first with collision-free scope-isolated cache, 5xx outage fallback,
  // and atomic version-locked caching (never overwrite cached HTML with a newer version's HTML
  // or cache mismatched .js/.css assets before the new Service Worker installs!).
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
        if (req.mode === 'navigate') {
          const textCopy = networkRes.clone();
          const cacheCopy = networkRes.clone();
          textCopy.text().then((htmlText) => {
            if (
              htmlText.includes('app.js?v=' + SHELL_VERSION) &&
              htmlText.includes('apis.js?v=' + SHELL_VERSION) &&
              htmlText.includes('style.css?v=' + SHELL_VERSION)
            ) {
              cache.put('./index.html', cacheCopy).catch(() => {});
            }
          }).catch(() => {});
        } else if (isMatchingVersionedAsset(url)) {
          cache.put(req, networkRes.clone()).catch(() => {});
        }
      }
      return networkRes;
    } catch (_) {
      return await serveFallback();
    }
  })());
});

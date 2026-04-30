/**
 * Lingua Service Worker
 *
 * Strategy:
 * - Network-First for navigations so deployed builds do not strand users on
 *   stale cached HTML that points at deleted hashed assets.
 * - Cache-First for same-origin static assets (CSS, JS chunks, WASM).
 * - Network-First for CDN resources (Pyodide) to pick up updates.
 *
 * The cache version is embedded at build time via Vite's import.meta.env,
 * but since this file is plain JS served from /public, we use a manual
 * version constant. Bump CACHE_VERSION when you deploy a new build to
 * force clients to refresh stale caches.
 */

// Bumped to `v3` for RL-061 Slice 5 — the web build moved from
// GitHub Pages (`<user>.github.io/lingua/`) to Cloudflare Pages
// (`app.linguacode.dev/`). The previous `v2` cache was scoped under
// `/lingua/`, so any user who reached the legacy GH Pages URL before
// the migration has cached entries whose paths no longer match the
// new asset hashes served at the subdomain root. Bumping the
// version forces those clients to drop the stale caches on next
// load. (For the v1→v2 history, see RL-061 Slice 2.5.)
const CACHE_VERSION = 'v3';
const CACHE_NAME = `lingua-${CACHE_VERSION}`;
const BASE_PATH = new URL(self.registration.scope).pathname;

// Resources to pre-cache on install (app shell)
const APP_SHELL = [BASE_PATH, `${BASE_PATH}index.html`];

// CDN origins that should use Network-First (always try network, fall back to cache)
const NETWORK_FIRST_ORIGINS = ['https://cdn.jsdelivr.net'];

// Cross-origin API origins are always passthrough — never cached. The
// SW Cache API does not enforce HTTP cache headers by itself, so the
// cache-first strategy would otherwise keep safety-critical API data
// indefinitely:
// - A stale `/licenses/status` could keep a refunded or revoked
//   license alive in the renderer until the SW unregisters.
// - A stale `/web/version` could hide a newly deployed web build from
//   the update banner after the first poll.
const PASSTHROUGH_ORIGINS = [
  'https://licenses.linguacode.dev',
  'https://updates.linguacode.dev',
  // Allow preview deployments and local dev to also bypass without
  // needing per-build SW edits. Keep this list synchronised with
  // CORS_ALLOWED_ORIGINS in `license-server/wrangler.toml`.
  'http://localhost:8787',
];

// ------------------------------------------------------------------ Install

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ------------------------------------------------------------------ Activate

self.addEventListener('activate', event => {
  event.waitUntil(
    caches
      .keys()
      .then(keys =>
        Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))
      )
  );
  // Take control of all open clients immediately
  self.clients.claim();
});

// ------------------------------------------------------------------ Fetch

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // RL-061 — API requests bypass the cache entirely. Returning early
  // without `respondWith` lets the browser run its default fetch path,
  // so the response never enters our cache regardless of the strategy
  // that would otherwise apply.
  if (PASSTHROUGH_ORIGINS.includes(url.origin)) {
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }

  // Network-First for CDN resources
  const isNetworkFirst = NETWORK_FIRST_ORIGINS.some(origin => url.origin === origin);

  if (isNetworkFirst) {
    event.respondWith(networkFirst(request));
  } else {
    event.respondWith(cacheFirst(request));
  }
});

// ------------------------------------------------------------------ Strategies

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Offline and not cached — return a simple offline page for navigation
    if (request.mode === 'navigate') {
      const shell = await caches.match(BASE_PATH);
      if (shell) return shell;
      const rootCached = await caches.match('/');
      if (rootCached) return rootCached;
    }
    return new Response('Offline — Lingua could not load this resource.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response('Offline — Lingua could not load this resource.', {
      status: 503,
      statusText: 'Service Unavailable',
    });
  }
}

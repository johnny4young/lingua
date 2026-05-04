/**
 * Lingua Service Worker
 *
 * Strategy:
 * - Network-First for navigations so deployed builds do not strand users on
 *   stale cached HTML that points at deleted hashed assets.
 * - Cache-First for same-origin static assets (CSS, JS chunks, WASM).
 * - Cache-First for the version-pinned Pyodide CDN prefix so Python
 *   works offline after first load.
 * - Network-First for any other CDN resources to pick up updates.
 *
 * The cache version is embedded at build time via Vite's import.meta.env,
 * but since this file is plain JS served from /public, we use a manual
 * version constant. Bump CACHE_VERSION when you deploy a new build to
 * force clients to refresh stale caches.
 */

// Bumped to `v4` for RL-083 Slice 2 — the Pyodide jsdelivr URL moved
// from network-first to cache-first so the web build is offline-tolerant
// after the first Python load. Old `v3` clients hold network-first
// responses for `cdn.jsdelivr.net` that would otherwise shadow the new
// strategy until the next deploy; bumping the version forces eviction
// on the next page load.
//
// History:
// - v3 (RL-061 Slice 5): web moved from GitHub Pages (`/lingua/`) to
//   Cloudflare Pages (`app.linguacode.dev/`). Prior `v2` had paths
//   under `/lingua/` that no longer match the subdomain-rooted hashes.
// - v2 (RL-061 Slice 2.5): cache scope changed.
const CACHE_VERSION = 'v4';
const CACHE_NAME = `lingua-${CACHE_VERSION}`;
const BASE_PATH = new URL(self.registration.scope).pathname;

// Resources to pre-cache on install (app shell)
const APP_SHELL = [BASE_PATH, `${BASE_PATH}index.html`];

// RL-083 Slice 2 — the version-pinned Pyodide CDN prefix uses
// cache-first so the second visit (and every subsequent visit) does
// not need network connectivity to run Python. Must stay in sync with
// `RUNTIME_ASSETS.pyodide.sourceUrl` in `src/shared/runtimeAssets.ts`;
// a vitest mirror in `tests/shared/runtimeAssets.test.ts` fails red on
// drift. Other `cdn.jsdelivr.net` URLs (none today; defensive) keep
// network-first so an unrelated CDN load picks up upstream changes.
const PYODIDE_CACHE_PREFIX = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';

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

  // RL-083 Slice 2 — version-pinned Pyodide URLs are cache-first so
  // the renderer can boot Python offline after the first load. Match
  // by full prefix, not by origin alone, so an unrelated jsdelivr URL
  // (none today) stays on network-first below.
  if (request.url.startsWith(PYODIDE_CACHE_PREFIX)) {
    event.respondWith(cacheFirst(request));
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

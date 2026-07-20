/**
 * Lingua Service Worker
 *
 * Strategy:
 * - Network-First for navigations so deployed builds do not strand users on
 *   stale cached HTML that points at deleted hashed assets.
 * - Cache-First for same-origin static assets (CSS, JS chunks, WASM).
 * - API origins bypass the SW cache entirely.
 *
 * The cache version is embedded at build time via Vite's import.meta.env,
 * but since this file is plain JS served from /public, we use a manual
 * version constant. Bump CACHE_VERSION when you deploy a new build to
 * force clients to refresh stale caches.
 */

// Bumped to `v5` for the Pyodide self-hosting hardening: older `v4`
// clients could hold jsDelivr Pyodide responses that are no longer
// part of the runtime trust boundary.
//
// History:
// - v4 : web Pyodide CDN moved to cache-first.
// - v3 : web moved from GitHub Pages (`/lingua/`) to
//   Cloudflare Pages (`app.linguacode.dev/`). Prior `v2` had paths
//   under `/lingua/` that no longer match the subdomain-rooted hashes.
// - v2 : cache scope changed.
const CACHE_VERSION = 'v5';
const CACHE_NAME = `lingua-${CACHE_VERSION}`;
const BASE_PATH = new URL(self.registration.scope).pathname;

// Resources to pre-cache on install (app shell)
const APP_SHELL = [BASE_PATH, `${BASE_PATH}index.html`];

// Vite dev servers (`dev:web` + `dev:web:pro`, both on :5174; :5173 is
// the legacy default) serve UNHASHED module URLs whose transformed
// contents change every session. The cache-first strategy below would
// pin the first session's modules — including the inlined
// `import.meta.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` and the
// `@vite/client` HMR token — and shadow every later session. That
// strands `dev:web:pro` on a stale license public key (a freshly minted
// dev token then fails `invalid-signature` even after a reload) and
// breaks HMR after a server restart. So on those exact dev origins this
// SW stays inert and self-destructs (see the activate handler); browsers
// always revalidate the SW script on navigation, so this reaches an
// already-registered install without any manual cache clear.
//
// Scoped to localhost:5173/5174 ONLY — production and local
// `preview:web` (port 4173, hashed build assets where cache-first is
// correct) keep the full offline strategy untouched.
const IS_DEV_SERVER =
  ['localhost', '127.0.0.1', '[::1]'].includes(self.location.hostname) &&
  ['5173', '5174'].includes(self.location.port);

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
  // Dev servers never pre-cache — the activate handler tears this SW down
  // instead of seeding a cache that would shadow fresh dev modules.
  if (!IS_DEV_SERVER) {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  }
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ------------------------------------------------------------------ Activate

self.addEventListener('activate', event => {
  if (IS_DEV_SERVER) {
    // Self-destruct: drop every cache, unregister, and reload open dev
    // tabs so the dev server's fresh modules (rotated license key, HMR
    // token) win immediately instead of waiting for the developer to
    // manually clear the SW. Reaches already-affected installs because
    // the browser revalidates this script on each navigation.
    event.waitUntil(
      (async () => {
        const keys = await caches.keys();
        await Promise.all(keys.map(key => caches.delete(key)));
        await self.registration.unregister();
        const clients = await self.clients.matchAll({ type: 'window' });
        await Promise.all(clients.map(client => client.navigate(client.url).catch(() => {})));
      })()
    );
    return;
  }

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

  // Dev servers: never serve from cache. Belt-and-suspenders with the
  // activate self-destruct so no dev request is shadowed by a stale
  // cache even in the brief window before this SW deregisters.
  if (IS_DEV_SERVER) return;

  // internal — API requests bypass the cache entirely. Returning early
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

  event.respondWith(cacheFirst(request));
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

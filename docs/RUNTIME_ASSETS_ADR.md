# Runtime Assets ADR

> Owning ticket: `RL-083` — Offline runtime assets + strict CSP.
> Status: Closed 2026-05-04. Slice 1 vendored Pyodide for desktop and
> tightened the desktop CSP. Slice 2 picked the web strategy: load
> from the upstream CDN with a cache-first service worker so the
> first Python load primes the cache and subsequent loads work
> offline. See "Web (Slice 2 — cache-backed offline)" below.

## Context

Lingua's renderer relies on a handful of "runtime assets" — files that
ship outside the JS / CSS bundle but are required for code execution.
The set today is small: Pyodide v0.26.4 (CPython compiled to WASM, plus
its standard library and lockfile) for the Python tab, and esbuild-wasm
for TypeScript transpilation.

Before this ADR, Pyodide loaded from `https://cdn.jsdelivr.net` at run
time. That had three launch-blocking consequences:

1. **Offline-first claim was false** for the desktop product. A user on
   a plane could not run Python.
2. **Security posture leaned on a third-party CDN** and required CSP
   allowances (`script-src https://cdn.jsdelivr.net`, same in
   `connect-src`) that an attacker can target for sub-resource
   substitution if jsdelivr were ever compromised.
3. **No release-time integrity check** — the version we shipped at
   build time was not the version a user might receive at boot, and we
   had no signed manifest to compare against.

esbuild-wasm was already vendored (it ships in `node_modules` and Vite
chunks the `.wasm` next to the JS), so this ADR concerns Pyodide
specifically. The same pattern applies if a future ticket adds another
runtime asset.

## Decision

### Desktop (this slice)

- Pin `pyodide@0.26.4` as a runtime npm dependency.
- A small Vite plugin (`build/copyRuntimeAssetsPlugin.mts`) copies the
  curated set of Pyodide files from `node_modules/pyodide/` into
  `<renderer-out-dir>/pyodide/` at build time. The same plugin's
  `configureServer` middleware serves the same files from the dev
  server so dev and packaged loads use identical URLs.
- `python-worker.ts` resolves the Pyodide entry via
  `new URL('../pyodide/', import.meta.url).href` and imports
  `${indexURL}pyodide.mjs` — this produces a `file://.../pyodide/`
  URL inside the packaged renderer and a
  `http://localhost:5173/src/renderer/pyodide/...` URL in dev. No
  desktop CDN fallback.
- The desktop renderer's CSP loses `https://cdn.jsdelivr.net` from
  `script-src` and `connect-src`. The new policy is enforced by the
  meta tag in `index.html`.
- `src/shared/runtimeAssets.ts` is the single source of truth: asset
  id, version, source URL (for documentation + diff tooling), the path
  inside `node_modules`, the served path under the renderer, and the
  list of critical files. `package.json` exposes
  `npm run build:runtime-assets` (write the lock) and
  `npm run check:runtime-assets` (assert match).
- `runtime-assets.lock.json` is checked into git and records sha256
  hashes for the critical files. CI fails if `node_modules/pyodide/`
  drifts from the lock without an intentional rebuild.
  `tests/shared/runtimeAssets.test.ts` is the Vitest mirror of the same
  check.
- `npm run smoke:desktop:offline` boots the existing desktop smoke
  harness with `LINGUA_DESKTOP_SMOKE_OFFLINE=1`. The main process
  installs a `session.defaultSession.webRequest.onBeforeRequest`
  handler that cancels every non-loopback HTTP/HTTPS request and
  records the URL. The renderer's smoke loop appends a synthetic
  `offline-no-cdn` case that fails if any URL was blocked.

### Web (Slice 2 — cache-backed offline)

The web build keeps loading Pyodide from `cdn.jsdelivr.net` (the
shared worker is built with `__LINGUA_PYODIDE_INDEX_URL__` set to the
upstream URL in `vite.web.config.mts`), but `public/sw.js` switches
the version-pinned prefix from network-first to **cache-first** so the
second visit and every subsequent visit do not need network
connectivity to run Python.

Concretely:

- The constant `PYODIDE_CACHE_PREFIX` in `public/sw.js` mirrors
  `RUNTIME_ASSETS.pyodide.sourceUrl`. A vitest gate in
  `tests/shared/runtimeAssets.test.ts` fails red if the two drift, so
  a Pyodide bump that touches the registry must also touch the SW.
- Other `cdn.jsdelivr.net` URLs (none today; defensive future-proof)
  stay on `network-first` so an unrelated CDN load picks up upstream
  changes.
- `CACHE_VERSION` was bumped to `v4` so existing clients drop the old
  network-first responses on next reload — without the bump, users
  running `v3` would keep the old strategy until cache eviction.

**Documented limitation.** The very first Python load on web still
needs connectivity. Subsequent loads (any time after the first
successful Pyodide boot) work offline. This is the explicit gap the
acceptance criteria allowed; we accept it as the chosen strategy.
The only alternative that would close it (an SW install-time
precache) would block the install on a ~13 MB download for users
who never run Python — a worse trade-off than the current
cache-on-first-use behavior.

**Why CDN over self-hosting.** jsdelivr serves immutable,
version-pinned URLs, so the substitution surface is constrained to
the upstream provider. The cache-first strategy gives the
offline-tolerance value without the bandwidth cost we would absorb by
serving ~13 MB of Pyodide assets from our own infrastructure. This is
the chosen strategy, not an interim step.

**Web CSP.** `src/web/index.html` keeps `https://cdn.jsdelivr.net` in
`script-src` and `connect-src` because that is where Pyodide loads
from. The CSP comment cites this ADR.

## Consequences

- The packaged macOS / Windows / Linux desktop apps gain ~13 MB of
  Pyodide assets inside the renderer chunk directory. The JS bundle is
  unchanged — `manualChunks` does not see these files.
- A Pyodide upgrade now requires three coordinated changes in the same
  PR: bump `pyodide` in `package.json`, run
  `npm run build:runtime-assets` to refresh the lock, and update the
  `version` field in `src/shared/runtimeAssets.ts`. The Vitest gate
  fails red if any of the three is missing.
- The desktop CSP is provably stricter than before. Any future regression
  that tries to fetch a remote script will be blocked at the renderer
  AND at the offline-smoke gate in CI.
- The web build's looser posture is documented as an explicit gap, not
  a hidden one. After the first Python load, users keep working
  offline. CDN compromise risk remains accepted for the web build and
  is bounded only by the version-pinned jsdelivr URL plus the explicit
  CSP allowlist; the local runtime-asset lock does not verify CDN
  responses.

## Alternatives considered

- **Custom protocol scheme (`lingua-asset://`)** — would let main
  serve Pyodide assets through `protocol.handle` with stricter
  same-origin guarantees than `file://`. Rejected for Slice 1 because
  the plain copy-into-renderer-output approach already works under
  Electron's existing `loadFile` flow and adds no new IPC surface.
  The custom-protocol option remains open for a later slice if we want
  per-asset SRI verification at request time.
- **`asarUnpack: '**/pyodide/**'`** — would store the files outside
  asar and load them from disk. Not needed today because Electron's
  asar layer transparently handles `fetch()` reads inside asar for
  the file types Pyodide loads (JS, JSON, WASM, ZIP). If a future
  Pyodide version exposes a streaming-read API that fights asar, this
  flag is the immediate fallback.
- **Inline-bundle Pyodide WASM into the JS** — rejected; the main JS
  payload would balloon by 10 MB and dev reloads would slow to a
  crawl. The directory copy keeps the dev cycle unchanged.

## Lock-file workflow

1. Bump `pyodide` in `package.json` and update the `version` field in
   `src/shared/runtimeAssets.ts`. Run `npm install`.
2. `npm run build:runtime-assets` to refresh `runtime-assets.lock.json`.
3. `npm run check:runtime-assets` should now pass.
4. `npm test -- tests/shared/runtimeAssets.test.ts` should also pass.
5. Stage `runtime-assets.lock.json` alongside the dependency bump.

If CI flags lock drift on a branch you did not intend to upgrade,
something in `node_modules/pyodide/` mutated between installs — usually
a postinstall script or a registry mirror returning a different
artifact. Treat as a security signal and investigate before forcing a
rebuild.

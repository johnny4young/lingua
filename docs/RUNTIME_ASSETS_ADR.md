# Runtime Assets ADR

> Owning ticket: `RL-083` — Offline runtime assets + strict CSP.
> Status: Slice 1 shipped 2026-05-04 (this ADR + the desktop vendor +
> manifest + offline smoke). Slice 2 (web first-party hosting +
> tighter web CSP) tracked under the same ticket.

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

### Web (deferred to Slice 2)

`src/web/index.html` and `public/sw.js` are intentionally untouched in
this slice. The shared worker is built with
`__LINGUA_PYODIDE_INDEX_URL__` set to the upstream
`cdn.jsdelivr.net` index URL in `vite.web.config.mts`, so the web build
still loads Pyodide through the same network-first cache rule that
already exists. Slice 2 will pick the web strategy explicitly —
first-party hosting on `app.linguacode.dev`, a SW prefetch +
install-time cache, or an explicit "web mode requires connectivity for
first Python boot" limitation. The choice depends on
`app.linguacode.dev` traffic projections and the cost / quota tradeoff
at the Cloudflare layer; it does not block the desktop launch.

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
  a hidden one.

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

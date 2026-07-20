# Runtime Assets ADR

> Scope: offline runtime assets and strict CSP.
> Status: Closed 2026-05-04; hardened 2026-05-08. implementation vendored
> Pyodide for desktop and tightened the desktop CSP. implementation originally
> used a cache-first CDN strategy for web; the hardening follow-up moved
> web onto the same copied, same-origin Pyodide asset tree. The 2026-06-01
> Cloudflare Pages hardening keeps Pyodide same-origin but serves oversized
> Ruby/DuckDB WASM from the public R2 runtime prefix because Pages rejects
> individual assets above 25 MiB.

## Context

Lingua's renderer relies on a handful of "runtime assets" — files that
ship outside the JS / CSS bundle but are required for code execution.
The set today includes Pyodide v0.29.4 (CPython compiled to WASM, plus
its standard library and lockfile) for Python, Ruby's `ruby+stdlib.wasm`
for the bundled Ruby worker, DuckDB's MVP WASM for the SQL workspace,
and esbuild-wasm for TypeScript transpilation.

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
chunks the `.wasm` next to the JS). This ADR started with Pyodide and now
also records the policy for larger WASM runtimes that cannot be deployed
directly through Cloudflare Pages.

## Decision

### Desktop (this change)

- Pin `pyodide@0.29.4` as a runtime npm dependency.
- A small Vite plugin (`build/copyRuntimeAssetsPlugin.mts`) copies the
  curated runtime files from `src/shared/runtimeAssets.ts` into the
  renderer output at build time. The same plugin's `configureServer`
  middleware serves those files from the dev server so dev and packaged
  loads use identical URLs. The plugin accepts an `exclude` list so the
  web production build can omit oversized files that are served from R2
  while desktop packages keep them bundled.
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
  `pnpm run build:runtime-assets` (write the lock) and
  `pnpm run check:runtime-assets` (assert match).
- `runtime-assets.lock.json` is checked into git and records sha256
  hashes for the critical files. CI fails if `node_modules/pyodide/`
  drifts from the lock without an intentional rebuild.
  `tests/shared/runtimeAssets.test.ts` is the Vitest mirror of the same
  check.
- `pnpm run smoke:desktop:offline` boots the existing desktop smoke
  harness with `LINGUA_DESKTOP_SMOKE_OFFLINE=1`. The main process
  installs a `session.defaultSession.webRequest.onBeforeRequest`
  handler that cancels every non-loopback HTTP/HTTPS request and
  records the URL. The renderer's smoke loop appends a synthetic
  `offline-no-cdn` case that fails if any URL was blocked.

### Web (same-origin Pyodide + R2-hosted oversized WASM)

The web build uses the same runtime-asset plugin for Pyodide, but not for
every large WASM runtime. `vite.web.config.mts` sets
`__LINGUA_PYODIDE_INDEX_URL__` to `null`, so `python-worker.ts` resolves
Pyodide through `new URL('../pyodide/', import.meta.url)` and Vite copies
the curated runtime files into `dist/web/pyodide/`.

Cloudflare Pages rejects individual assets above 25 MiB. Ruby's
`ruby+stdlib.wasm` and DuckDB's `duckdb-mvp.wasm` exceed that deployment
budget, so production web builds inject absolute URLs under
`VITE_LINGUA_WEB_RUNTIME_BASE` (default:
`https://downloads.linguacode.dev/web-runtime`). The `deploy-web.yml`
workflow uploads those versioned objects to Cloudflare R2 before deploying
the Pages bundle. Local web dev keeps the defines as `null`, so Vite still
serves local runtime assets from `node_modules`.

Concretely:

- `src/web/index.html` no longer allows `https://cdn.jsdelivr.net` in
  `script-src` or `connect-src`.
- `public/sw.js` no longer has a `PYODIDE_CACHE_PREFIX` or
  `NETWORK_FIRST_ORIGINS` branch. Pyodide is a same-origin static
  asset like other built chunks.
- `vite.web.config.mts` defines `__LINGUA_DUCKDB_MVP_WASM_URL__` and
  `__LINGUA_RUBY_WASM_URL__` to versioned R2 URLs only for production
  build commands. `vite.renderer.config.mts` keeps both `null` so packaged
  desktop builds stay fully bundled.
- `copyRuntimeAssetsPlugin({ exclude: ['ruby'] })` is used only on web
  production builds; the upload step copies the exact Ruby WASM from
  `node_modules/@ruby/3.4-wasm-wasi/dist/`. DuckDB's worker JS stays in the
  `duckdb-wasm` chunk while the MVP WASM URL is injected at runtime.
- `CACHE_VERSION` was bumped to `v5` so existing clients drop the old
  jsDelivr Pyodide cache entries on next activation.
- `tests/shared/runtimeAssets.test.ts` now pins both renderer and web
  configs to `JSON.stringify(null)` for `__LINGUA_PYODIDE_INDEX_URL__`, and
  pins the R2 URL defines for Ruby/DuckDB web runtime assets.

## Consequences

- The packaged macOS / Windows / Linux desktop apps gain Pyodide and Ruby
  runtime assets inside the renderer chunk directory. The JS bundle is
  unchanged — `manualChunks` does not see files copied by
  `copyRuntimeAssetsPlugin`.
- A Pyodide upgrade now requires three coordinated changes in the same
  PR: bump `pyodide` in `package.json`, run
  `pnpm run build:runtime-assets` to refresh the lock, and update the
  `version` field in `src/shared/runtimeAssets.ts`. The Vitest gate
  fails red if any of the three is missing.
- The desktop CSP is provably stricter than before. Any future regression
  that tries to fetch a remote script will be blocked at the renderer
  AND at the offline-smoke gate in CI.
- The web build no longer accepts CDN substitution risk for Pyodide. Ruby
  and DuckDB web runtime trust moves to the owned Cloudflare R2 public
  runtime prefix, whose object paths include the package version so deploys
  are immutable by convention.

## Alternatives considered

- **Custom protocol scheme (`lingua-asset://`)** — would let main
  serve Pyodide assets through `protocol.handle` with stricter
  same-origin guarantees than `file://`. Rejected for implementation because
  the plain copy-into-renderer-output approach already works under
  Electron's existing `loadFile` flow and adds no new IPC surface.
  The custom-protocol option remains open for a later work if we want
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
   `src/shared/runtimeAssets.ts`. Run `pnpm install`.
2. `pnpm run build:runtime-assets` to refresh `runtime-assets.lock.json`.
3. `pnpm run check:runtime-assets` should now pass.
4. `pnpm test -- tests/shared/runtimeAssets.test.ts` should also pass.
5. Stage `runtime-assets.lock.json` alongside the dependency bump.

If CI flags lock drift on a branch you did not intend to upgrade,
something in `node_modules/pyodide/` mutated between installs — usually
a postinstall script or a registry mirror returning a different
artifact. Treat as a security signal and investigate before forcing a
rebuild.

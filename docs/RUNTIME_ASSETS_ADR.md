# Runtime Assets ADR

> Scope: offline runtime assets and strict CSP.
> Status: Closed 2026-05-04; hardened 2026-05-08. The first change vendored
> Pyodide for desktop and tightened the desktop CSP. The web build originally
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
for the bundled Ruby worker, DuckDB's EH WASM for the SQL workspace,
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
  URL inside the packaged renderer (`app://lingua/pyodide/` since the
  renderer moved to the app scheme) and a
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
`ruby+stdlib.wasm` and DuckDB's `duckdb-eh.wasm` exceed that deployment
budget, so production web builds inject absolute URLs under
`VITE_LINGUA_WEB_RUNTIME_BASE` (default:
`https://downloads.linguacode.dev/web-runtime`). The `deploy-web.yml`
workflow uploads those versioned objects to Cloudflare R2 before deploying
the Pages bundle. Local web dev keeps the defines as `null`, so Vite still
serves local runtime assets from `node_modules`.

Production web HTML also preconnects to the origin of the configured runtime
base, with anonymous CORS (`crossorigin`) to match the WASM fetches. This is
only a connection hint, not a WASM preload: DuckDB and Ruby remain lazy, and
no download-time improvement is guaranteed if the connection expires before
activation. Dev and `LINGUA_WEB_RUNTIME_SAME_ORIGIN=1` builds omit the hint,
using the same gate as the external WASM URL defines. The transform keeps
this hint after the existing first-party preconnects; its tests cover both
the real HTML entry and the resolved Vite configuration.

Concretely:

- `src/web/index.html` no longer allows `https://cdn.jsdelivr.net` in
  `script-src` or `connect-src`.
- `public/sw.js` no longer has a `PYODIDE_CACHE_PREFIX` or
  `NETWORK_FIRST_ORIGINS` branch. Pyodide is a same-origin static
  asset like other built chunks.
- `vite.web.config.mts` defines `__LINGUA_DUCKDB_WASM_URL__` and
  `__LINGUA_RUBY_WASM_URL__` to versioned R2 URLs only for production
  build commands. `vite.renderer.config.mts` keeps both `null` so packaged
  desktop builds stay fully bundled.
- `copyRuntimeAssetsPlugin({ exclude: ['ruby'] })` is used only on web
  production builds; the upload step copies the exact Ruby WASM from
  `node_modules/@ruby/3.4-wasm-wasi/dist/`. DuckDB's worker JS stays in the
  `duckdb-wasm` chunk while the WASM URL is injected at runtime.
- `CACHE_VERSION` was bumped to `v5` so existing clients drop the old
  jsDelivr Pyodide cache entries on next activation.
- `tests/shared/runtimeAssets.test.ts` now pins both renderer and web
  configs to `JSON.stringify(null)` for `__LINGUA_PYODIDE_INDEX_URL__`, and
  pins the R2 URL defines for Ruby/DuckDB web runtime assets.

### DuckDB's extensions (vendored)

`@duckdb/duckdb-wasm` leaves its loadable extensions out of the package, and
DuckDB would fetch them from `extensions.duckdb.org` on first use, in a request
from its worker. Everyday SQL asks for them: `current_date` needs ICU, and
Instant SQL parses every statement with `json_serialize_sql`, so that fetch would
happen while the user types, and it would fail offline.

The engine sets `custom_extension_repository` to `data:` right after it opens the
database, so no extension comes from that host, and turns
`autoload_known_extensions` off. An autoload through that repository throws a
JavaScript error across the wasm frames and traps the EH build. With autoloading
off, DuckDB's catalog error names the extension, and `LOAD` and `ATTACH`, which
still reach the closed repository, fail with its file name. The app turns either
into a sentence naming the extension. `date_trunc(now())` still reaches for ICU
regardless, so it traps if ICU failed to load at start; the engine stays usable.
A user who types their own `SET custom_extension_repository` opts out of this, as
with any URL they type.

Lingua uses the EH build because the MVP worker in `@duckdb/duckdb-wasm` 1.32.0
calls `_setThrew` without defining it. There, any C++ exception that DuckDB catches
fails the statement with no reason, including exceptions that are not errors, such
as the one behind an untyped `CREATE MACRO` parameter. Browsers without
WebAssembly exceptions cannot start the engine.

`vendor/duckdb-extensions/<duckdb>/wasm_eh/` holds the signed upstream builds.
The registry copies them to the same path on web and desktop, and the lock
records their hashes.

| Extension | Size | Brotli | Loads |
| --- | --- | --- | --- |
| JSON | 801 KiB | 123 KiB | When the engine starts |
| ICU | 6.2 MiB | 1.3 MiB | When the engine starts, because `now() - INTERVAL 1 DAY` fails without it and never asks for it |
| Parquet | 2.9 MiB | 487 KiB | The first time SQL names `parquet` |

The main thread reads each file with a time limit and gives `LOAD` a blob URL,
because DuckDB's own request blocks its worker with none. DuckDB checks the
file's signature, so a changed file does not load. If a load fails the engine
still starts, and the next statement that needs the extension tries again. A
single statement that failed for an extension Lingua ships runs again once it has
loaded, which covers a failed load at start and SQL that needs Parquet without
naming it. A script does not run again, since an earlier statement may have
written.

Any other extension, such as INET, spatial, Excel or SQLite, is not shipped: the
query fails with a message naming it. On the web, a Parquet file that was never
used online is not in the service worker's cache, so it reports that its copy did
not load until the app is online.

To bump `@duckdb/duckdb-wasm`: read the DuckDB version it embeds, download the
`wasm_eh` extensions for that version into a new `vendor` folder, update the
`duckdbExtensions` entry and the folder in `duckdbClient.ts`, and run
`pnpm run build:runtime-assets`. `tests/shared/runtimeAssets.test.ts` fails until
the version, the path and the footers agree, and `tests/e2e/sqlExtensions.spec.ts`
fails if the engine rejects a file.

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
  same-origin guarantees than `file://`. Rejected for the initial change because
  the plain copy-into-renderer-output approach already works under
  Electron's existing `loadFile` flow and adds no new IPC surface.
  The custom-protocol option remains open for a later work if we want
  per-asset SRI verification at request time. The whole renderer later
  moved to `app://lingua`; see `ARCHITECTURE.md` § Desktop renderer origin.
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

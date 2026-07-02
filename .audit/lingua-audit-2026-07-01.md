# Lingua — Full-Spectrum Codebase Audit

- **Date:** 2026-07-01
- **Auditor:** automated single-session review (`/effort high`, sub-agents disabled)
- **Commit audited:** `14fff60` (`fix(desktop): grant file protocol privileges…`, tag baseline 0.9.0)
- **Branch:** `claude/lingua-full-spectrum-audit-hb7fah`
- **Scope:** Electron + Vite + React 19 + TypeScript desktop/web multi-language code runner (6 execution backends), plus `license-server/` and `update-server/` (flagged, not refactored).

## How to read this report

Every finding carries a severity tag (`[CRITICAL]` / `[HIGH]` / `[MEDIUM]` /
`[LOW]`), a file/line anchor, an impact statement, and a concrete recommended
fix. Findings are grouped by the audit scopes A–F. A UI screenshot of the web
build at boot is saved at
`./.audit/screenshots/web-app-boot-2026-07-01.png`.

**Headline:** Lingua is in strong shape. The Electron trust boundary, the
capability-based filesystem sandbox (RL-077), the native-runner env allowlist
(RL-079), the deny-by-default permission posture (RL-127), and the Ed25519
license verifier are all above the bar for a source-available commercial
product that executes arbitrary user code. No `[CRITICAL]` issues were found.
The most actionable items are supply-chain reproducibility, native-runner
resource ceilings, the web build's broad `connect-src`, and a defense-in-depth
gap in license `productId` binding.

## Baseline gate results

Reproduced locally (Node 22.22 in the audit sandbox; repo pins Node 24.x):

| Gate | Result | Notes |
| --- | --- | --- |
| `tsc --noEmit` | ✅ pass | clean |
| `eslint` | ✅ pass (0 errors) | 12 `react-hooks` warnings (set-state-in-effect / exhaustive-deps), all annotated |
| `pnpm test` | ⚠️ 2 failures / 6141 pass / 4 skip | both failures are **environmental**, see A-7 |
| `knip` (`check:deadcode`) | ✅ pass | files/dependencies/unlisted at zero; ~60 advisory unused *exports* (deliberately non-gating) |
| `check:i18n` / `check:i18n:copy` | ✅ pass | en + es parity holds |
| `pnpm audit --prod` | ✅ no known vulns | production graph clean |
| `pnpm audit` (full) | ⚠️ 18 advisories (10 high) | dev/build graph only — see D-1 |
| `build:web` | ✅ built in ~11s | 53 MiB `dist/web`; see C-1 |
| `performance:report` | ✅ budget pass | web initial 1.56 MiB gzip |

> **Install note (environment, not a repo defect):** `pnpm install` in the
> audit sandbox failed until worked around, because the lockfile pins
> `@electron/node-gyp` as a **GitHub tarball URL** and the egress policy
> returns 403 for `codeload.github.com`. This is the same class flagged in
> D-2. All gates above were run after a local-only workaround that was
> reverted before any commit.

---

## Scope A — Architecture & Code Quality

### A-1 `[LOW]` IPC bridge is clean and minimal, but the surface is large and undocumented as a whole
- **Files:** `src/preload/index.ts:1-522`, `src/main/index.ts:58-75`
- **Impact:** The preload exposes ~13 namespaces (`fs`, `go`, `rust`, `ruby`,
  `node`, `lsp`, `git`, `license`, `updates`, `dependencies`, `deepLinks`,
  `plugins`, `desktopSmoke`) over `contextBridge`. Each is a narrow typed
  pass-through — no `ipcRenderer` handle is leaked to the renderer, and no
  channel returns a raw Node object — which is correct. The risk is not any
  single channel but the absence of a single canonical inventory of the whole
  channel list with its validation status, which makes drift auditing manual.
- **Fix:** Add a generated channel-inventory table (channel name → validating
  handler → input-shape guard) to `docs/ARCHITECTURE.md`, and a test that
  fails if a new `ipcMain.handle` appears without a matching row. Layering
  itself needs no change.

### A-2 `[LOW]` Renderer never reaches outside its sandbox contract — verified
- **Files:** `src/renderer/**` (searched), `src/renderer/runtime/executeTabManually.ts:221`
- **Impact:** No renderer file imports `ipcRenderer` or calls Node `require()`
  at runtime — the only `require(` hits are template string literals in
  `data/projectTemplates/*` (user-facing sample code) and a doc comment. The
  82 renderer consumers all go through `window.lingua.*`. This is the intended
  contract and it holds.
- **Fix:** None required. Keep the ESLint guard that would catch a future
  `ipcRenderer` import in renderer code (add one if absent).

### A-3 `[LOW]` Execution-backend isolation matches `CAPABILITY_MATRIX.md` — no drift found
- **Files:** `src/main/go-compiler.ts`, `src/main/rust-compiler.ts`,
  `src/main/ruby-runner.ts`, `src/main/node-runner.ts`,
  `docs/CAPABILITY_MATRIX.md:107-138`
- **Impact:** The documented classes (Go hybrid compile-native/run-WASM, Rust
  desktop-native, Ruby hybrid WASM/subprocess, Python Pyodide WASM, JS/TS
  worker) all match the shipping code. Go still injects `GOOS=js GOARCH=wasm`
  as runner-owned overrides (`go-compiler.ts:149-157`); Rust still runs the
  compiled binary through `spawn` with process-tree kill
  (`rust-compiler.ts:199-209`). The matrix is not stale.
- **Fix:** None. The `capabilityMatrixDrift.test.ts` guard already protects the
  auto-derived language table; keep it.

### A-4 `[LOW]` TypeScript rigor is high; `any` density is negligible
- **Files:** repo-wide `src/**`
- **Impact:** Only 7 `: any` / `as any` occurrences across all of `src` (each
  in an isolated helper), zero `@ts-ignore` / `@ts-expect-error` in `src`, and
  branded IDs (`RootId`/`RelativePath`/`WatchId`, `src/shared/fs/brandedIds.ts`)
  keep the highest-blast-radius seam (filesystem capabilities) type-safe. The
  IPC and execution boundaries validate `unknown` inputs explicitly
  (`normalizeStringMap`, `resolveCapabilityPath`, `typeof source !== 'string'`
  guards). This is better than typical for a project this size.
- **Fix:** None material. Optionally fold the two per-file `normalizeStringMap`
  copies (`node-runner.ts:443`, `ruby-runner.ts:213`) into one shared helper to
  prevent divergence.

### A-5 `[LOW]` `eslint-disable` density is low and each is justified
- **Files:** 20 disable comments across `src` (measured)
- **Impact:** The disables are narrow (`no-control-regex` for byte-level
  parsers, `react-hooks/*` for intentional external-signal effects, `no-console`
  in user-facing project templates, `no-var` in a `.d.ts`). None broadly
  suppress a rule file-wide or repo-wide. The 12 remaining lint *warnings*
  (set-state-in-effect) are all annotated with rationale.
- **Fix:** None required. Consider converting the annotated
  `set-state-in-effect` warnings to scoped `eslint-disable-next-line` with the
  same rationale so the warning count is zero and a genuinely new violation
  stands out.

### A-6 `[LOW]` ADRs are current — one is correctly marked superseded
- **Files:** `docs/*ADR*.md`
- **Impact:** All eight ADRs carry a Status line. `BUILD_SYSTEM_ADR.md` is
  correctly `Superseded (2026-06-28)` reflecting the electron-builder migration
  that shipped in `package.json` (`electron-builder`, `electron-updater`, no
  Forge makers). The runtime-modes, capability, env-vars, language-pack, Tauri,
  Vim, and debugger ADRs match current `src/` structure. No stale ADR found.
- **Fix:** None.

### A-7 `[LOW]` Two unit tests are non-portable (root/permission dependent)
- **File:** `tests/main/license.test.ts:389-391`
- **Impact:** `runtime.clear()` and a sibling `applyToken` case assert that a
  write fails after `chmod(tempDir, 0o500)`. Running as **root** (CI containers,
  this audit sandbox) bypasses POSIX permission bits, so the write succeeds and
  the "rejects" expectation fails. This is a test-portability defect, not a code
  defect — the license runtime logic under test is correct.
- **Fix:** Guard these two cases with `it.skipIf(process.getuid?.() === 0)` (or
  an equivalent capability probe) so they skip under root instead of failing,
  keeping the suite green across CI runner configurations.

### A-8 `[LOW]` Renderer state ownership is well-partitioned
- **Files:** `src/renderer/stores/*` (per `src/renderer/README.md:90-128`)
- **Impact:** State is owned by focused Zustand stores with a documented
  ownership table; the RL-128/RL-129/RL-130 splits (editor/settings/license)
  keep each assembly point thin. No evidence of cross-cutting state parked in
  `App.tsx`. Persisted stores are schema-versioned through one central
  migration registry with a drift-guard test (`ARCHITECTURE.md:60-130`). The
  29 utility panels share `utilityHistoryStore`/`utilityOutputStore`/
  `utilityPipelineStore` rather than duplicating state.
- **Fix:** None material.

---

## Scope B — Security & Vulnerabilities (highest priority)

### B-1 `[LOW]` Electron hardening is complete and defensively pinned
- **File:** `src/main/index.ts:153-201`, `src/main/permissionHandlers.ts`,
  `src/main/security.ts`
- **Impact (positive):** `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`, and `webSecurity: true` are all set and the last is pinned
  with a comment explaining why. `setWindowOpenHandler` denies all popups,
  `will-attach-webview` is prevented, and both `will-navigate` **and**
  `will-redirect` are gated through one `isAllowedNavigationTarget` allowlist
  (`security.ts:36-63`) that rejects credentials-in-URL and non-loopback
  origins. Permissions are deny-by-default with a two-entry clipboard allowlist
  and subframe denial (RL-127). `shell.openExternal` input is normalized to
  http/https only (`shared/appInfo.ts:42-61`). This is a model Electron
  posture.
- **Fix:** None. Maintain the `permissionHandlers.test.ts` allowlist assertion.

### B-2 `[MEDIUM]` Web build CSP `connect-src` allows any HTTPS/WSS origin
- **File:** `src/web/index.html:37`
- **Impact:** The web CSP ends with `connect-src 'self'
  https://licenses.linguacode.dev https://updates.linguacode.dev https: wss:`.
  The trailing `https:` / `wss:` wildcards mean that renderer-context code (and
  any compromised or malicious transitive dependency running in the main
  document, not the sandboxed preview iframe) can exfiltrate to **any** origin.
  This is partly by design — the HTTP Workspace panel lets users fire arbitrary
  requests — but those requests should originate from an isolated surface, not
  loosen the whole document's policy.
- **Fix:** Scope the wildcard to the feature that needs it. Route
  user-initiated HTTP Workspace calls through a dedicated worker/iframe with its
  own relaxed CSP (mirroring how `browser-preview` is isolated in
  `RUNTIME_MODES_ADR.md`), and reduce the top-level document `connect-src` to
  the first-party hosts plus the R2 runtime base only. If a near-term scope-down
  is infeasible, document the decision in an ADR so it is a reviewed tradeoff
  rather than an implicit one. (Desktop CSP in `index.html:25` is already tight —
  no wildcard `connect-src`.)

### B-3 `[MEDIUM]` License payload `productId` is shape-validated but never bound to Lingua
- **Files:** `src/shared/license.ts:136-152`, `src/main/license.ts:206-221`
- **Impact:** `isValidPayload` requires `productId` to be a non-empty string
  but never checks its value. Any token signed by the issuer's Ed25519 private
  key — including a token minted for a *different* product that shares the same
  signing key — passes `verifyLicenseToken` and activates paid entitlements.
  Because the private key is issuer-controlled this is defense-in-depth rather
  than an open bypass, but a single key reused across products (or a future
  product line) would create a real cross-product entitlement leak.
- **Fix:** Add an expected-product check in the verifier (e.g. accept a
  `expectedProductIds: readonly string[]` option and reject a mismatch with a
  new `unexpected-product` reason). Wire the desktop/web callers to the known
  Lingua product IDs (`lingua_monthly` / `lingua_lifetime` / `lingua_team`,
  already used in `license-server/src/handlers/webhooks.ts:412-413`). Gate
  behind a test so legacy tokens without the field can be handled deliberately
  (grandfather or reject) rather than by accident.

### B-4 `[MEDIUM]` Native runners enforce time limits but no memory/CPU ceiling
- **Files:** `src/main/rust-compiler.ts:48-56,199-209`,
  `src/main/go-compiler.ts:191-204`, `src/main/node-runner.ts`,
  `src/main/ruby-runner.ts:73-76`
- **Impact:** Each backend has a wall-clock timeout (Rust run 30s / compile 60s,
  Go compile 30s, Ruby/Node 30s) with SIGTERM→SIGKILL escalation and 1 MiB
  output caps — good. But there is no memory cap or CPU-share limit on the
  spawned toolchain or compiled user binary. Within the timeout window, a
  `fn main(){ let mut v=vec![]; loop{ v.push([0u8;1<<20]); } }` (Rust) or an
  equivalent Go/Node program can drive host RAM to OOM before the 30s kill
  fires, degrading or crashing the user's machine. The docs reference RL-078
  timeouts but no resource ceiling.
- **Fix:** Add per-process resource limits where the platform allows: on Linux,
  wrap spawns with `ulimit`/`prlimit` (address-space + CPU) or a cgroup; on
  macOS use `setrlimit` via a small launcher; for Node pass
  `--max-old-space-size` in the argv the runner already controls
  (`node-runner.ts:654`). At minimum, document the absence as a known limit in
  `SECURITY.md`'s High-Risk Areas so it is an accepted, disclosed tradeoff.

### B-5 `[LOW]` Filesystem IPC sandbox is robust (capability + realpath + denylist)
- **Files:** `src/main/ipc/projectCapabilities.ts`, `src/main/ipc/fileSystem.ts`,
  `src/main/ipc/git.ts`
- **Impact (positive):** Every FS op routes through `resolveCapabilityPath`,
  which rejects absolute inputs, `..` traversal, Windows device prefixes, and
  unsafe basenames *before* resolving, then re-verifies containment against the
  `realpath` of both candidate and root (defeating symlink-out), then re-applies
  the denylist. The git read-only layer — the one surface that legitimately
  takes raw absolute paths — is gated on `pathIntersectsApprovedScope` +
  `isPathBlocked` (`ipc/git.ts:51-54`). Capabilities are process-lifetime and
  never persisted. This closes the traversal class thoroughly.
- **Fix:** None. Keep the branded-ID compile guard
  (`tests/main/projectCapabilitiesBrand.test.ts`).

### B-6 `[LOW]` License verification: signature-before-clock ordering is correct
- **File:** `src/shared/license.ts:256-331`
- **Impact (positive):** Signature is verified before any expiry/grace decision,
  so a tampered-but-expired token reports `invalid-signature` rather than a
  misleading `expired`. Clock-skew tolerance (24h) rejects future-issued
  tokens. The JWK is normalized to RFC 8037 fields before `importKey`
  (`license.ts:247-249`) to avoid the Node/Cloudflare `alg` divergence. The
  desktop runtime re-fetches devices from the server on boot rather than
  trusting a cached bucket (`main/license.ts:56-59`), limiting stale-state
  replay. Offline grace (14d) is inherent to the offline-first model and is
  documented.
- **Fix:** None. (The residual offline-bypass — a user blocking network to lean
  on local verify within the grace window — is an accepted property of an
  offline-first product; server revalidation on reconnect is the mitigation.)

### B-7 `[LOW]` Auto-updater relies on electron-updater's built-in integrity checks
- **File:** `src/main/updater.ts`
- **Impact:** Updates read the `app-update.yml` feed baked in by
  electron-builder from the GitHub Releases `publish` provider; there is no
  hand-rolled unauthenticated update path. Signature/checksum verification is
  delegated to electron-updater (code signing on mac/win, blockmap integrity),
  which is the standard posture. The state machine correctly preserves a staged
  download across a later "no update" response (`updater.ts:117-134`).
- **Fix:** None in code. For release hardening, ensure macOS notarization and
  Windows Authenticode signing are enforced in the release workflow (tracked in
  `docs/MACOS_SIGNING.md` / `docs/WINDOWS_SIGNING.md`) so the updater's
  signature check has a trust anchor on every platform; Linux AppImage has no
  OS signature layer, so the feed's HTTPS + GitHub provenance is the only
  guarantee there — document that gap.

### B-8 `[LOW]` Telemetry/crash redaction genuinely excludes code and paths
- **Files:** `src/shared/redaction.ts:30-91`, `src/main/crashReporter.ts:120-136`
- **Impact (positive):** The redaction deny-list drops any key containing
  `content`/`code`/`source`/`snippet`/`file`/`path`/`token`/`secret`/`email`/
  `name`/`project` (case-insensitive) and drops all non-primitive values, before
  anything leaves the app. The crash reporter attaches only `appVersion` as
  `extra`, is opt-in (unified telemetry consent), and has an env kill switch
  and a no-endpoint default-off. The README's "never user code or file paths"
  claim is backed by testable code, not just prose.
- **Fix:** None. The claim holds.

### B-9 `[MEDIUM]` `.env.production` is committed to git (currently only public/empty material)
- **Files:** `.env.production` (tracked), `.gitignore:48-50`
- **Impact:** `.gitignore` ignores `.env`, `.env.local`, `.env.*.local` but
  **not** `.env.production`, which is tracked. Today it holds only empty values
  and public-key placeholders (`LINGUA_LICENSE_PUBLIC_KEY_JWK=`,
  `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK=`, `VITE_LINGUA_LICENSE_SERVER_URL=`), so
  no secret is exposed. The risk is procedural: the file's name invites a future
  contributor to paste a real production value into a tracked file, and the
  public-key JWK is the one build-time value the app *does* embed, so it will
  eventually be populated. Per the audit rules this is reported, not silently
  "cleaned up."
- **Fix:** Decide the intent explicitly. If `.env.production` must hold only
  public build-time material (public JWK, public URLs), add a header banner
  saying exactly that and keep it tracked. If it may ever hold anything private,
  untrack it (`git rm --cached .env.production`), add it to `.gitignore`, and
  ship a `.env.production.example` template instead. Do not rely on
  `.gitleaks.toml` to catch it — that file must not be modified to suppress
  findings.

### B-10 `[LOW]` Browser-preview iframe isolation is correct
- **File:** `docs/RUNTIME_MODES_ADR.md:290-347`, `src/renderer/runners/browserPreview.ts`
- **Impact (positive):** User DOM code runs in an iframe `sandbox="allow-scripts"`
  (no `allow-same-origin`, so opaque origin `null`), with srcdoc CSP
  `default-src 'none'` (no `connect-src` → fetch/XHR/WebSocket blocked), and a
  runId-anchored postMessage bridge that rejects spoofed/stale messages. The
  "Open in window" path uses a `data:` URL (opaque origin) rather than a Blob
  URL (which would inherit app origin). Worker-mode JS/TS has no DOM and no Node
  built-ins. Pyodide runs in its own worker.
- **Fix:** None.

---

## Scope C — Performance & Optimization

### C-1 `[MEDIUM]` Web bundle ships duplicate/oversized TypeScript + Monaco payloads
- **Evidence:** `dist/web` = 53 MiB. Largest chunks: `esbuild.wasm` 14 MiB,
  `pyodide.asm.wasm` 8.3 MiB, `ts.worker` 6.6 MiB, `monaco` 3.7 MiB, and **two**
  `typescript-*.js` chunks (3.4 MiB + 868 KiB) plus a 1.8 MiB `index` chunk.
  `performance:report`: web `initial` 1.56 MiB gzip, `runtime` 8.88 MiB gzip,
  `worker` 2.24 MiB gzip.
- **Impact:** Two independent TypeScript compiler copies (the Monaco
  `ts.worker` and the `typescript` package pulled for notebook transpile via
  `notebookSession.ts:54`) plus `esbuild-wasm` mean the app carries three
  overlapping transpiler/analysis payloads. Runtime assets (Pyodide, DuckDB,
  Ruby WASM) dominate but are lazy; the `initial` budget is healthy. The
  duplicate TS is the clearest dead-weight.
- **Fix:** Confirm the `typescript` import in `notebookSession.ts` can be lazy
  and shared with Monaco's TS worker instead of bundling a second copy; if it is
  only used for type-info in notebooks, gate it behind a dynamic `import()` so
  it never lands in `initial`/`utility`. Verify `vega-embed` (819 KiB) is only
  loaded by the rich-output surface that needs it. Add a per-chunk regression
  line to the committed performance baseline so a future duplicate is caught.

### C-2 `[LOW]` Cold-start contributors are known and lazily loaded, but unbenchmarked end-to-end
- **Files:** `docs/PERFORMANCE.md`, `src/renderer/monaco.ts` (lazy per-language
  registration, RL-124)
- **Impact:** Monaco registers each non-JS/TS language lazily on first
  activation, and Pyodide/Go-WASM/Ruby-WASM instantiate on demand — the right
  structure. But there is no committed benchmark for the three heaviest
  cold-starts the prompt calls out (Electron main boot, Pyodide init, Go→WASM
  compile+instantiate), so regressions are invisible until a user notices.
- **Fix:** Extend `performance:report` (or the desktop smoke) to record
  timestamps for main-process `ready`, first Pyodide `runPython`, and a
  reference Go compile+instantiate, and add them to
  `docs/performance/baseline.json` with a tolerance so `check:performance`
  guards them.

### C-3 `[LOW]` No leak evidence found across run/stop cycles, but no automated soak test
- **Files:** `src/main/ipc/git.ts:70-125` (per-sender watcher registry with
  `destroyed` cleanup), runner `killProcessTree` paths
- **Impact:** The watcher and process registries are disposed on sender
  `destroyed` and on Stop/timeout, and a reviewer pass already fixed a
  `destroyed`-listener accumulation bug (`ipc/git.ts:73-80`). Long-running WASM
  session memory (Go/Ruby-WASM) across repeated run/stop is the untested axis.
- **Fix:** Add a repeated-run soak assertion to `smoke:desktop` that records
  `getMemorySnapshot()` (already exposed at `preload/index.ts:406`) before and
  after N run/stop cycles per backend and fails on unbounded growth.

### C-4 `[LOW]` Vitest suite is slow (~284s) relative to coverage
- **Evidence:** `Duration 283.65s` for 6147 tests; `environment 417.48s`
  (jsdom setup dominates, parallelized).
- **Impact:** jsdom environment construction is the single largest cost. This is
  acceptable for CI but slows local iteration.
- **Fix:** Consider `environmentMatchGlobs` so only component/DOM tests pay for
  jsdom and pure `shared/` logic tests run in the faster `node` environment;
  and enable Vitest's isolate-off pool for the pure-logic projects. Measure
  before/after with `--reporter=verbose`.

---

## Scope D — Dependency & Library Updates

### D-1 `[LOW]` 18 audit advisories, all confined to the dev/build graph
- **Evidence:** `pnpm audit` → 10 high / 4 moderate / 4 low; `pnpm audit --prod`
  → **clean**. High-severity packages: `tar` (via `@electron/rebuild`/node-gyp
  build tooling), `undici` (via `electron`'s `@electron/get`, `jsdom`,
  `vitest`), `ws` (dev). Moderate/low: `dompurify` (already force-overridden up
  to a patched range in `pnpm-workspace.yaml:48`), `esbuild` (Windows dev-server
  file read).
- **Impact:** None reach the shipped production graph — the release-blocking
  `check:prod-audit` gate is green. These are build/test-time only.
- **Fix:** Keep `check:prod-audit` as the release gate. Opportunistically bump
  `undici`/`tar`/`ws` transitive ranges via `pnpm-workspace.yaml` `overrides`
  when the parent toolchain (`@electron/rebuild`, `electron`) publishes
  compatible versions; do not force-override across a major boundary blindly.

### D-2 `[MEDIUM]` `@electron/node-gyp` is pinned as a GitHub tarball URL — a reproducibility and supply-chain footgun
- **Files:** `pnpm-lock.yaml:476-477`, `pnpm-workspace.yaml:30-36`
  (`blockExoticSubdeps: false`)
- **Impact:** `@electron/rebuild` pulls `@electron/node-gyp` as
  `https://codeload.github.com/electron/node-gyp/tar.gz/<sha>`. To allow it, the
  repo sets `blockExoticSubdeps: false`, which **disables pnpm's supply-chain
  hardening for all git/tarball subdependencies**, not just this one. Any
  environment whose egress policy blocks `codeload.github.com` (this audit
  sandbox returns 403) cannot `pnpm install` at all — a CI/reproducibility
  hazard. The existing `TODO` in `pnpm-workspace.yaml` acknowledges this.
- **Fix:** Follow the repo's own TODO: bump `@electron-forge/*` /
  `@electron/rebuild` to a version whose graph no longer git-pins node-gyp, then
  re-enable `blockExoticSubdeps` (delete the `false` override) so exotic
  subdeps are blocked by default again. Until then, add a `packageExtensions`
  or a scoped `overrides` entry that repoints only that one dep to the npm
  registry release, rather than disabling the global guard.

### D-3 `[LOW]` Electron is one major behind; most other deps are patch-current
- **Evidence:** `electron 42.3.3` (latest 43.0.0), `react 19.2.7`,
  `vite 8.0.16` (latest 8.1.2), `typescript 6.0.3`, `monaco-editor 0.55.1`.
  `pnpm outdated` shows mostly patch/minor gaps (eslint, prettier, vitest,
  wrangler, knip, lucide-react, playwright).
- **Impact:** Electron 42.x still receives security patches, so this is not
  urgent, but staying one major behind lengthens the eventual jump and delays
  Chromium security fixes. React 19 ecosystem shows no React-18 shims. Node
  24.x pin (`.nvmrc`) is a reasonable current LTS-adjacent choice.
- **Fix (prioritized update list):**
  1. **Security-adjacent / currency:** plan the `electron 42 → 43` bump
     (Chromium security cadence) and re-verify the desktop smoke matrix.
  2. **Toolchain reproducibility:** resolve D-2 (node-gyp git pin) in the same
     dependency lane.
  3. **Routine patch/minor:** `vite`, `vitest`, `eslint`, `typescript-eslint`,
     `prettier`, `knip`, `playwright`, `wrangler`, `lucide-react`,
     `react-resizable-panels`, `i18next`, `tailwindcss`/`@tailwindcss/postcss` —
     low risk, batch them.
  4. **Hold / review:** `js-yaml 4→5`, `@types/node 25→26`, `undici-types 7→8`,
     `pyodide 0.29→3xx` (the `314.0.2` "latest" is a mistagged/incompatible
     line — do **not** bump), `@duckdb/duckdb-wasm` dev tag. Treat these as
     breaking-change-risk majors and vet individually.

### D-4 `[LOW]` Unpinned Rust `stable` channel is a reproducibility risk (documented, accepted)
- **Files:** `README.md:64`, `docs/CAPABILITY_MATRIX.md` (Rust section)
- **Impact:** Rust execution uses whatever `rustc stable` the user has; edition
  is pinned to 2021 (`rust-compiler.ts:46`) but the compiler version is not.
  For a code runner this is acceptable (it mirrors the user's local toolchain
  by design), but it means Lingua cannot reproduce a specific compiler's
  diagnostics. Fengari (Lua) is pinned-and-unmaintained, explicitly accepted in
  the matrix under the RL-144 trust model.
- **Fix:** None required — keep the current documented posture. If reproducible
  Rust diagnostics ever matter, surface the detected `rustc --version` in the
  status notice (already parsed) so users can self-diagnose version drift.

---

## Scope E — DX / UX / Product Quality

### E-1 `[LOW]` i18n is genuinely externalized (en + es at parity)
- **Files:** `src/renderer/i18n/locales/{en,es}/common.json` (3422 lines each),
  `check:i18n` + `check:i18n:copy` gates
- **Impact:** Both locales are key-for-key equal and the copy-lint gate blocks
  hardcoded English in touched renderer files. Spanish uses the mandated neutral
  Latin American tuteo register (per `AGENTS.md`). This is real i18n, not a
  scaffold.
- **Fix:** None. When adding the roadmap LATAM push (F-5), the plumbing is ready.

### E-2 `[LOW]` Accessibility foundation is present; coverage is partial
- **Files:** `src/renderer/components/a11y/LiveAnnouncer.tsx`,
  `src/renderer/README.md:218` (mandatory `.focus-ring` on bespoke controls),
  `docs/A11Y.md`, the 0.9.0 "Accessibility overhaul" changelog (visible in the
  boot screenshot)
- **Impact:** There is a single polite `aria-live` announcer, a documented
  focus-ring requirement, and roving-arrow/ARIA work landed in 0.9.0. But only
  23 files reference `focus-ring`, versus 29 utility panels plus the shell — so
  a subset of bespoke controls may still lack a visible focus indicator or full
  keyboard nav. No automated axe gate is wired into the default test run
  (`@axe-core/playwright` is a dep but not in the standard gates).
- **Fix:** Add an `@axe-core/playwright` smoke over the web preview (the shell,
  Command Palette, one utility panel, Settings) to the CI gate set, and audit
  the remaining utility panels for the `.focus-ring` requirement. Target zero
  serious/critical axe violations as the gate.

### E-3 `[LOW]` Error-handling UX across backends is consistent and honest
- **Files:** runner result shapes (`RubyRunResult`, node/rust/go results),
  `components/NativeExecutionWarning/`, typed watcher diagnostics
  (`shared/fs/watcherDiagnostic.ts`)
- **Impact:** Every native backend returns a closed-enum `kind`
  (`success|error|timeout|stopped|missing-binary`) with truncation-aware
  stderr, and the web build degrades honestly (Go/Rust stubs, desktop-only Node
  error). Missing-toolchain messages include install URLs. Watcher failures
  surface typed notices rather than silent breakage. This is a strong, uniform
  error contract.
- **Fix:** None material.

### E-4 `[LOW]` Docs-vs-code coherence is high
- **Files:** `docs/ARCHITECTURE.md`, `docs/CAPABILITY_MATRIX.md`, `README.md`
- **Impact:** Spot-checks (IPC channel table, capability classes, runtime
  model, permission posture) all match the code. The capability matrix's
  language table is auto-derived and drift-guarded. The one superseded ADR is
  clearly marked. No material doc/code contradiction found.
- **Fix:** Land A-1's generated IPC channel inventory to keep the one manually
  maintained surface (the channel list) from drifting.

---

## Scope F — Roadmap: Becoming a World-Class Product

These are product recommendations, ranked roughly by impact-to-effort. They are
proposals, not applied changes.

### F-1 Competitive positioning
Lingua's defensible niche is **multi-language, offline-first, desktop-native**
— the axis where RunJS (JS-only), CodeSandbox/StackBlitz (web, Node-centric,
online), and Replit (cloud, collaborative) are all weaker. The highest-value
gaps to close relative to those competitors, in Lingua's own lane:
- **Package management breadth** (Go modules, Rust crates, Ruby gems via
  bundler) — currently JS/npm desktop + Python micropip web only. This is the
  single biggest "it doesn't run my real snippet" gap.
- **Rich output for Go/Rust** (currently `unsupported` in the matrix) — parity
  with the Python/JS rich-output surface.

### F-2 Feature proposals (effort × impact)
| Proposal | Effort | Impact | Notes |
| --- | --- | --- | --- |
| Go modules / Rust crates / Ruby gems install | High | High | Extends the RL-025 dependency lane; closes F-1's top gap |
| Real-time collaboration | High | Medium | Off-niche (Lingua is offline-first); consider only for the team tier |
| Plugin ecosystem beyond the built-in allowlist | High | Medium | Needs the sandbox story the capability matrix flags as a prerequisite |
| Optional cloud sync (snippets/settings) | Medium | High | Natural paid upsell; keep code local, sync only user artifacts through the redaction layer |
| Additional runtimes (Zig, Deno, Bun, SQL engines) | Medium | Medium | Reuses the language-pack contract |
| Local AI inference (RL-031) | Medium | Medium | Decision still deferred in the matrix; a small transformers.js "explain this error" is a cheap first win |

### F-3 Server scaling
`license-server` and `update-server` are Cloudflare Workers (KV rate-limit
buckets, D1 for devices). This scales horizontally by default. Before growth:
add read-replica awareness to the device-status path (the desktop runtime
already defends against stale replicas via `issuedAt` comparison), and put an
SLO dashboard on the `SERVER_OBSERVABILITY.md` worker log envelope.

### F-4 Observability maturity
Telemetry is opt-in-only by design (correct for the privacy posture). To mature
without weakening that: invest in **crash-report triage** (the pipeline exists,
minidumps only) and **structured worker logs** for the servers, rather than
broadening client telemetry. Add the cold-start benchmarks from C-2 as an
internal (not user) observability surface.

### F-5 LATAM / Spanish-market expansion
The es locale is already at full parity and the register is standardized. This
is a low-cost differentiated growth channel: most competitors ship English-only.
Concrete next steps: localize the marketing SEO landing pages (scaffolds exist
per README), and prioritize es in the onboarding tour and error copy — the
runtime is already fully translatable.

---

## Summary of findings by severity

| Severity | Count | IDs |
| --- | --- | --- |
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 5 | B-2, B-3, B-4, B-9, C-1, D-2 (6 incl. D-2) |
| LOW | ~20 | A-1…A-8, B-1/5/6/7/8/10, C-2/3/4, D-1/3/4, E-1…E-4 |

(Positive findings — B-1, B-5, B-6, B-8, B-10, A-3, E-3 — are recorded as
`[LOW]`/no-action because verifying a control held is part of the audit
record.)

## Applied changes in this audit

None to product code. This audit is report-only by design: the MEDIUM items
touch the licensing security path (B-3), revenue-adjacent supply-chain config
(D-2), a feature-coupled CSP (B-2), and a committed-file policy decision (B-9) —
each needs a product/owner decision rather than a silent low-risk fix, per the
audit's hard rules (do not weaken entitlement gating, do not refactor
revenue-critical infra, do not modify `.gitleaks.toml`, report secrets rather
than clean them up). The one clearly-safe code fix (A-7, skip root-dependent
tests) and the dependency bumps (D-3) are left as recommended follow-ups so
they land as reviewed, testable commits rather than being bundled into an audit
PR.

---

## Resumen ejecutivo (español latinoamericano neutro — registro usted)

**Total de hallazgos por severidad:** 0 críticos, 0 altos, 6 medios y
aproximadamente 20 bajos (varios de los cuales documentan controles que se
verificó que funcionan correctamente).

**Los cinco puntos que conviene atender primero:**

1. **B-4 — Límites de recursos en los runners nativos (medio).** Los backends
   de Go, Rust, Ruby y Node aplican tiempo límite y tope de salida, pero no
   imponen un techo de memoria ni de CPU. Dentro de la ventana de 30 segundos,
   el código del usuario puede agotar la memoria del equipo. Se recomienda
   agregar `prlimit`/`ulimit` o `--max-old-space-size`, o al menos declararlo en
   `SECURITY.md`.
2. **D-2 — `@electron/node-gyp` fijado como tarball de GitHub (medio).** Obliga
   a desactivar globalmente la protección de cadena de suministro de pnpm
   (`blockExoticSubdeps: false`) e impide `pnpm install` en entornos cuya
   política de red bloquea `codeload.github.com`. Conviene seguir el TODO ya
   escrito: actualizar `@electron/rebuild` y reactivar la protección.
3. **B-2 — CSP del build web demasiado amplia (medio).** El `connect-src`
   termina en `https: wss:`, lo que permite exfiltración a cualquier origen
   desde el documento principal. Se recomienda aislar el HTTP Workspace en su
   propia superficie y acotar la política del documento a los hosts propios.
4. **B-3 — El `productId` de la licencia no se valida contra Lingua (medio).**
   Un token firmado con la misma clave para otro producto verificaría y
   activaría el tier de pago. Se recomienda agregar una verificación de producto
   esperado en el verificador Ed25519.
5. **B-9 — `.env.production` versionado en git (medio).** Hoy solo contiene
   valores vacíos y material público, así que no hay filtración, pero el patrón
   invita a subir un secreto por accidente. Conviene definir explícitamente su
   intención (solo material público con un encabezado, o dejar de versionarlo).

**Veredicto sobre preparación para producción:** Lingua se encuentra en muy
buen estado para un producto comercial de código disponible que ejecuta código
arbitrario. El límite de confianza de Electron, el sandbox de sistema de
archivos basado en capacidades, la lista blanca de variables de entorno de los
runners, la postura de permisos por denegación predeterminada y el verificador
de licencias Ed25519 están por encima del estándar habitual, y las suites de
calidad (tipos, lint, pruebas, i18n, auditoría de producción) pasan. No se
encontraron problemas críticos ni altos; los seis hallazgos medios son mejoras
de defensa en profundidad y de reproducibilidad de la cadena de suministro, no
fallas explotables abiertas. Con la atención de esos seis puntos, el producto
está listo para producción.

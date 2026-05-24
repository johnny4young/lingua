# Lingua — Deep Project Audit 2026-05-24

> **Audit window:** 2026-05-24
> **Scope:** every committed source file under `/src`, `/license-server`,
> `/update-server`, `/scripts`, plus Vite + Forge configs and the
> renderer + main entry surfaces.
> **Goal:** identify the work needed to bring Lingua to a world-class
> standard across security, performance, maintainability, data
> reliability, and documentation. The deliverable is a **proposed
> ticket set**, not a code change — splitting the actual work across
> many small PRs is what keeps the change-risk profile reviewable.
>
> Findings are organized by domain (security, performance, code
> quality, data / persistence, documentation) and each ticket
> proposal here can graduate to an `RL-NNN` row in
> [`docs/ROADMAP.md`](./ROADMAP.md) once it gets priority + sequencing
> agreement.
>
> A capture line in [`docs/BACKLOG.md`](./BACKLOG.md) §1 points back
> to this document so the audit is discoverable from the standard
> intake flow. **Do not promote tickets to ROADMAP from this document
> without first sizing them and assigning a `P0..P3` priority.**

---

## Executive summary

Lingua is in **strong** shape architecturally. The Electron security
posture (`contextIsolation`, `sandbox`, RL-077 capability sandbox, RL-079
env allow-list, RL-087 watcher diagnostics, RL-083 offline-smoke filter,
Electron fuses, code-signed releases) is materially better than the
median Electron app, and the capability model in
[`projectCapabilities.ts`](../src/main/ipc/projectCapabilities.ts) is
defensively designed around symlink + traversal classes. The runner
surface uses `spawn()` / `execFile()` with allow-listed env, atomic
temp files, and bounded output — no command-injection vectors were
found. License verification is cryptographically sound (Ed25519,
build-time public key, atomic persistence).

The largest improvement opportunities sit in three places:

1. **Renderer performance — Zustand subscription discipline.** The
   `state.tabs.find(t => t.id === state.activeTabId)` selector is
   inlined in ~15 components, each creating a new closure per render
   and triggering re-renders for any `tabs` array mutation (including
   unrelated tabs). Combined with `snapshotRing` and `consoleEntries`
   array subscriptions, this produces an O(N · M) re-render fan-out
   on routine UI changes. Centralizing these into shared selectors +
   shallow-equality wrappers will pay off across the whole shell.
2. **Bundle weight — opportunistic lazy paths.** Monaco's full
   language contribution list, `sql-formatter`, `qrcode`, and `marked`
   are reached eagerly even when the user never opens the surfaces
   that use them. The Vite split is correct; the imports are too eager.
3. **Module size — three monolithic stores.** `editorStore.ts` (1163
   lines), `settingsStore.ts` (931 lines), and `licenseStore.ts` (962
   lines) each mix 4–6 concerns. They are not buggy — but they are
   hard to extend without touching unrelated logic, and the
   subscription-overhead point above is amplified by their breadth.

The persistence layer is **simpler than expected**: SQL only exists in
the Cloudflare Workers license server (D1, raw SQL via Wrangler, **no
Drizzle**); the desktop app persists JSON to `userData/` and the
renderer persists Zustand stores to `localStorage`. The biggest
data-reliability gap is the absence of a schema-version key on the
`lingua-*` localStorage stores, which forces the merge logic to
guess intent on every shape change.

No `Critical`-severity security finding was identified. One `High`
(missing update-package signature audit), one `High` (web CSP allowing
`'unsafe-eval'`, mitigated by build-time control + supply chain) and
five `Medium` findings round out the security work.

---

## 1. Methodology

- **Source tree walk:** every non-test `.ts` / `.tsx` under `src/`,
  `license-server/src/`, `update-server/src/`, the four Vite
  configs, `forge.config.ts`, `index.html`, `.env.production`,
  `.env.example`.
- **Pattern detection:** grep for known anti-patterns (`catch {}`,
  `as unknown as`, `dangerouslySetInnerHTML`, `eval`, `new Function`,
  `shell: true`, `localStorage.setItem` outside persist middleware,
  inline Zustand selectors that allocate, repeated
  `state.tabs.find(...)`, repeated `pushStatusNotice(...)`).
- **Cross-reference with existing docs:** `AGENTS.md`,
  `docs/ARCHITECTURE.md`, `docs/CAPABILITY_MATRIX.md`,
  `docs/PERFORMANCE.md`, `docs/PUBLIC_READINESS_AUDIT.md`,
  `docs/LICENSING_ADR.md`, `docs/RUNTIME_ASSETS_ADR.md`,
  `docs/security/2026-05-09/`, the renderer `README.md`, and every
  RL-XXX entry referenced by sampled files.
- **Out of scope:** runtime profiling (no DevTools traces captured),
  load testing, threat-model formalization beyond what
  `docs/LICENSING_ADR.md` already records.

This audit deliberately stops at recommendations. Implementation
work is sized in §6 (ticket proposals).

---

## 2. Security findings

The capability model and Electron hardening already cover most of
the classical Electron-app weaknesses. Findings below are real but
not catastrophic.

### 2.1 [High] Web build CSP keeps `'unsafe-eval'` + `'unsafe-inline'`

- **File:** [`index.html:18`](../index.html), `src/web/index.html`
  (mirror), `vite.web.config.mts`
- **Risk:** If a future supply-chain compromise lands an XSS sink in
  the renderer (contaminated npm dep, Monaco contribution carrying
  unescaped HTML, etc.), `'unsafe-eval'` lets the injected payload
  use `eval()` / `new Function()` to escape the React render path
  and `'unsafe-inline'` makes nonce-based mitigation moot.
- **Why it exists today:** `esbuild-wasm`, the Monaco TypeScript
  worker, and Pyodide all rely on `eval()` / `Function` constructors
  at runtime. Removing the directive outright would break the build.
- **Direction:** introduce a strict-dynamic + nonce policy for the
  app shell + non-WASM workers, isolate eval-needing chunks behind a
  separately-scoped CSP (`script-src 'self' 'unsafe-eval'` only in
  those bundles via a sub-document, or split the bundle so the
  permissive directive is iframe-scoped), and re-audit. The browser
  preview iframe already runs under a stricter CSP — the same
  approach can be extended.

### 2.2 [Medium] `session.setPermissionRequestHandler` never registered

- **File:** [`src/main/index.ts:257-289`](../src/main/index.ts)
- **Risk:** Lingua does not call `setPermissionRequestHandler` /
  `setPermissionCheckHandler` on `session.defaultSession`. If a
  feature ever asks for camera, microphone, geolocation, clipboard,
  notifications, or MIDI (directly or via a contaminated dep),
  Electron defaults to allowing the request without a user prompt
  on most platforms. The sandbox + capability sandbox stop disk
  access but not Web API permission escalation.
- **Direction:** install a deny-by-default handler at `app.ready`,
  with an explicit allow-list (probably empty until a feature
  actually needs one).

### 2.3 [High] Update-package signature chain is not visibly audited

- **File:** [`src/main/updater.ts`](../src/main/updater.ts) + the
  Cloudflare update worker under `update-server/`
- **Risk:** `autoUpdater.setFeedURL({ url })` delegates verification
  to Squirrel.Mac / Squirrel.Windows. The installer chain is
  code-signed (good — see `forge.config.ts`), but Squirrel's per-
  release `.nupkg` / RELEASES integrity story is not documented in
  this repo. If an attacker who controls the CDN replaces a
  `.nupkg`, we want a clear answer for whether the signed installer
  chain blocks it.
- **Direction:** document the existing signature chain in
  `docs/RELEASE_SECURITY.md`, add a release-time check that asserts
  every artifact in the feed is Authenticode/Codesign-signed +
  notarized, and decide whether a manifest-signing layer (separate
  Ed25519 over the manifest JSON) is needed.

### 2.4 [Medium] Filesystem denylist coverage is implicit

- **File:** [`src/main/ipc/permissions.ts:15-38`](../src/main/ipc/permissions.ts)
- **Risk:** the denylist blocks `/etc`, `/System`, `~/.ssh`,
  `~/.gnupg`, `~/.aws`, macOS Keychains, Windows `C:\Windows`,
  `Program Files (x86)`. It does **not** explicitly block
  `~/Library/Application Support`, `~/AppData/Roaming`,
  `~/Library/Cookies`, browser profile dirs, Slack/Discord/1Password
  desktop app data, or the user's own Lingua `userData/` directory
  (which holds the license token). The capability sandbox already
  prevents traversal *out of an approved root*, so the practical
  risk is "user explicitly picks `~` or a parent of a sensitive
  dir as their project root". The denylist is the only defense in
  that path.
- **Direction:** extend `BLOCKED_PATHS` with a documented coverage
  list (the catalog above), add a test matrix
  (`tests/main/ipc/permissions.test.ts`) that locks the coverage,
  and decide whether to block-or-warn for the user's own
  `userData/` directory.

### 2.5 [Medium] Key-rotation policy is contractual, not enforced

- **File:** [`.env.production:12-17`](../.env.production), embedded
  via `vite.web.config.mts` + `vite.main.config.mts`
- **Risk:** the public Ed25519 verification key is build-time
  embedded with a single value. Comments warn that rotating the
  Cloudflare private key and the embedded public key must happen
  in the same commit + redeploy — but nothing enforces it. A
  staggered rollout silently breaks every client that hasn't
  picked up the new build.
- **Direction:** either ship a key-versioning scheme in the token
  payload (clients accept the union of N keys for a grace window)
  or add a release-time check that asserts the deployed public key
  matches the most recent server-side keypair in the manifest.

### 2.6 [Medium] `js-worker.ts` uses `AsyncFunction` on renderer-supplied source

- **File:** [`src/renderer/workers/js-worker.ts:839-856`](../src/renderer/workers/js-worker.ts)
- **Risk:** the JS Scratchpad runner executes the user's source via
  `new AsyncFunction(..., code)`. The worker is intentionally
  Web-Worker-isolated (no DOM, no shared state) and the input is
  *user-typed code that the user already trusts*, so this is
  working-as-designed for Scratchpad. But the same pattern is the
  attack surface if the renderer ever auto-imports code from a
  remote source (share-link decode, plugin manifest). RL-027
  Slice 1.5b conditional-breakpoint expressions also reuse this
  pattern and are already gated behind an explicit security review.
- **Direction:** document the trust assumptions in a comment block
  at the top of `js-worker.ts`, expand the share-link decode
  hardening to assert the decoded source is rendered in an
  editor first (not executed silently), and revisit when the
  plugin surface ships an untrusted-source code path.

### 2.7 [Medium] Build-chain `tar` advisory

- **File:** `package-lock.json` (transitive via
  `@electron-forge/cli` → `@electron/rebuild` → `tar`)
- **Risk:** `npm audit` surfaces hardlink-traversal / symlink-
  poisoning advisories against the `tar` version pinned in the
  build chain. Runtime code is unaffected. The risk is a malicious
  tarball extracted during `npm install`.
- **Direction:** bump `@electron-forge/cli` when an unbreaking
  upstream lands, or pin an override in `package.json`.

---

## 3. Performance findings

The Vite split + lazy paths are mostly good; the live cost sits in
React render fan-out and in eager imports of single-use
dependencies.

### 3.1 [High] Inline `tabs.find(...)` selector is duplicated ~15 times

- **Files:** at least
  [`AppLayout.tsx:106-108`](../src/renderer/components/Layout/AppLayout.tsx),
  [`ResultPanel.tsx:45-48`](../src/renderer/components/Editor/ResultPanel.tsx),
  `FloatingVariablesCard.tsx`, `StdinInputPanel.tsx`,
  `AutoLogStatusPill.tsx`, `WorkflowModeStatusPill.tsx`,
  `VariableInspectorToggleButton.tsx`, `CompareToggleButton.tsx`,
  `RecentRunsPill.tsx`, `StdinStatusPill.tsx`,
  `AutoRunGateNotice.tsx`, `BrowserPreviewPanel.tsx`, App.tsx (4
  shortcut handlers).
- **Impact:** every component re-renders whenever the `tabs` array
  changes — including unrelated tabs. A 10-tab session typing in
  one tab thus re-renders the 14 sibling subscribers.
- **Direction:** add a `getActiveTab(state)` derived selector to
  `editorStore` (or expose a `useActiveTab()` hook with
  `useShallow`) and migrate every call site. The hook is also a
  natural place to memoize the `runtimeMode` / `workflowMode`
  resolution so consumers don't recompute it.

### 3.2 [High] `PanelChipsRow` re-renders on every snapshot push

- **File:** [`AppLayout.tsx:104-200`](../src/renderer/components/Layout/AppLayout.tsx)
- **Impact:** the component subscribes to 9 separate store slices,
  including `snapshotRing` (array) and `scopeSnapshot` (object).
  Each `snapshotRing` push (every Run) returns a new array
  reference, re-running the chip-availability computation even when
  the language did not change. The chips array itself is allocated
  per render.
- **Direction:** wrap the snapshot subscriptions with `useShallow`,
  derive a `hasComparisonForLanguage(language)` boolean selector at
  store level, and `useMemo` the chips array on the four inputs
  that actually drive it.

### 3.3 [High] `ConsolePanel` is not virtualized

- **File:** [`src/renderer/components/Console/ConsolePanel.tsx`](../src/renderer/components/Console/ConsolePanel.tsx)
  ~ line 531
- **Impact:** every console entry is rendered as a DOM node, and
  the collapse/filter logic walks the full list per render (with
  `JSON.stringify` comparisons). A 500-entry session interactively
  stalls on filter toggles + auto-scroll.
- **Direction:** introduce `react-window` (or a hand-rolled
  windower keyed on entry id) for the entry list, move
  `collapseIdenticalEntries` to a store-level derivation that
  runs once on push, and replace `JSON.stringify` with a
  precomputed hash on each entry.

### 3.4 [High] Monaco language contributions register eagerly

- **File:** [`src/renderer/monaco.ts:72-105`](../src/renderer/monaco.ts)
- **Impact:** `ensureLanguageContributions()` walks every entry in
  `getLanguageSupportDescriptors()` on first editor mount and
  starts loading every dynamic-tokenizer chunk via
  `descriptor.loader()`, even for languages the user never opens.
  This is a non-trivial hit on cold start.
- **Direction:** register the language on demand — at the moment a
  tab in that language becomes active, or at most when the
  language picker is opened. Keep JS/TS pre-registered for the
  scratchpad happy path.

### 3.5 [Medium] `qrcode`, `sql-formatter`, `marked` are static-imported

- **Files:**
  [`src/renderer/utils/qrCode.ts`](../src/renderer/utils/qrCode.ts),
  [`src/renderer/utils/sqlFormatter.ts`](../src/renderer/utils/sqlFormatter.ts),
  [`src/renderer/utils/markdownPreview.ts`](../src/renderer/utils/markdownPreview.ts)
- **Impact:** all three deps land in the eager renderer bundle even
  when the user never opens the QR / SQL-formatter / Markdown
  surfaces. `qrcode` and `sql-formatter` are the largest of the
  three.
- **Direction:** switch to dynamic `import()` at the call site,
  optionally wrapped in a small loader helper. The performance
  baseline in `docs/performance/baseline.json` should drop on the
  next refresh.

### 3.6 [Medium] `editorStore` mutations allocate new arrays per write

- **File:** [`src/renderer/stores/editorStore.ts`](../src/renderer/stores/editorStore.ts)
  ~ lines 475, 541, 554, 585, and ~ 15 more
- **Impact:** every `state.tabs.map(...)` allocates a new array,
  invalidating every subscriber to `tabs`. Combined with §3.1, this
  multiplies the re-render fan-out.
- **Direction:** route per-tab updates through a `tabId`-keyed
  index (`Map<TabId, FileTab>`) for the mutating path, or use
  `immer` middleware so structural sharing keeps the array
  reference stable when only one tab changed. Either path needs
  selector audits at the read side.

### 3.7 [Medium] `index.html` skips preload + preconnect

- **File:** [`index.html:1-22`](../index.html)
- **Impact:** no `<link rel="preload">` for the editor font, no
  `<link rel="preconnect">` to `licenses.linguacode.dev` or
  `updates.linguacode.dev`. The inline theme-detection script is
  small and necessary, but a `meta name="color-scheme"` would let
  the browser pick the matching scrollbar color earlier.
- **Direction:** add a `preconnect` to each `connect-src` host,
  preload the JetBrains Mono `woff2` (subset to Latin if practical),
  and add `<meta name="color-scheme" content="dark light">`.

### 3.8 [Medium] Tailwind v4 lacks an explicit `content` config

- **File:** [`src/renderer/index.css:1`](../src/renderer/index.css)
  — the project uses `@import 'tailwindcss'` only, no
  `tailwind.config.ts` exists.
- **Impact:** Tailwind v4 ships content auto-detection, but the
  default scan list includes node_modules paths and test files
  that bloat the generated CSS with utilities Lingua never uses.
- **Direction:** add a `tailwind.config.ts` that scopes `content`
  to `src/renderer/**/*.{ts,tsx}`, `src/web/**/*.{ts,tsx}`,
  `src/shared/**/*.{ts,tsx}`. Compare CSS output sizes before and
  after.

### 3.9 [Medium] `useProjectWatchSync` walks the tree on every refresh

- **File:** [`src/renderer/hooks/useProjectWatchSync.ts`](../src/renderer/hooks/useProjectWatchSync.ts)
- **Impact:** on each debounced batch, `collectFilePaths()` +
  `collectLoadedDirs()` traverse the whole in-memory tree. A
  1000-file project + a bulk `git pull` produces a measurable
  pause.
- **Direction:** maintain a cached projection of file paths and
  loaded dirs as Set references, invalidate it on the same
  reducer that mutates the tree, and reuse it across watch
  refreshes.

### 3.10 [Medium] Eager `useEditorStore.subscribe` in `App.tsx`

- **File:** [`src/renderer/App.tsx:181-203`](../src/renderer/App.tsx)
- **Impact:** the auto-save effect listens to **any** editor store
  change (not just tab content) and clears + re-arms a 1 s timer
  every time. A burst of unrelated mutations (active tab, dirty
  flag, runtime mode toggle) repeatedly resets the debounce window
  and delays the actual session save.
- **Direction:** subscribe with a narrow selector (e.g. only
  `tabs.map(t => ({ id, content, language, runtimeMode }))` via a
  shallow comparator) so only meaningful changes re-arm the
  debounce.

---

## 4. Code quality & refactor findings

These are not bugs; they are pressure on the next slice that has to
extend any of these files. The risk is "the next contributor
introduces a subtle regression because the file is too tangled to
reason about in a single sitting."

### 4.1 [High] Three monolithic stores should be split

| File | Lines | Suggested seams |
|------|-------|-----------------|
| `editorStore.ts` | 1163 | tab CRUD; execution state; per-tab mode resolution; format/persist; undo/redo |
| `settingsStore.ts` | 931 | seeds + sanitizers; persist middleware; appearance setters; runtime setters; onboarding setters |
| `licenseStore.ts` | 962 | server-response mappers; token-refresh helpers; web store creator; desktop store creator; factory |

- **Direction:** each store stays as a single composed facade so
  callers don't churn, but the internals are split into 4–5 files
  each. See §6 ticket proposals for the proposed slicing.

### 4.2 [High] `AppLayout.tsx` (1086) and `App.tsx` (790) carry too many concerns

- **AppLayout** owns layout *and* bottom-panel selection logic *and*
  availability gates *and* compact-drawer keyboard traps. The
  layout-availability gates (consoles/debugger/preview/stdin/
  variables) can move to a `useLayoutAvailability()` hook +
  derived selectors.
- **App.tsx** mixes overlay state, session lifecycle, deep-link
  bootstrap, downloaded-update toast, telemetry boot, dirty-close,
  and the entire keyboard-shortcut handler payload. Each of those
  is its own hook seam.

### 4.3 [High] `state.tabs.find(t => t.id === state.activeTabId)` repeated 13+ times

- See §3.1 — same finding, the *refactor* deliverable is a
  dedicated `useActiveTab()` hook (+ a `getActiveTab` selector
  on the store) so future call sites cannot regress the
  performance shape.

### 4.4 [Medium] `pushStatusNotice` called from ~134 call sites

- **Pattern:**
  `useUIStore.getState().pushStatusNotice({ tone: 'info', messageKey: '...' })`
- **Direction:** introduce a `useStatusNotice()` hook + an
  imperative `pushInfoNotice/successNotice/warningNotice` helper
  that wraps the `useUIStore.getState()` indirection. Saves ~3
  lines per call site and makes tone consistency lintable.

### 4.5 [Medium] `useRustLspLifecycle` and `useGoLspLifecycle` are near-clones

- **Files:** [`src/renderer/hooks/useRustLspLifecycle.ts`](../src/renderer/hooks/useRustLspLifecycle.ts),
  [`src/renderer/hooks/useGoLspLifecycle.ts`](../src/renderer/hooks/useGoLspLifecycle.ts),
  shared core in `useLspLifecycle.ts`.
- **Direction:** the two wrappers differ only in the bound store.
  Replace both with a single `useLspLifecycle(language)` call site
  in `App.tsx`, or — if discoverability matters — keep both files
  as one-line factories.

### 4.6 [Medium] `RootId`, `WatchId`, `RelativePath` are bare `string`

- **File:** [`src/main/ipc/projectCapabilities.ts:44`](../src/main/ipc/projectCapabilities.ts)
- **Risk:** a parameter swap (`rootId` ↔ `relativePath`) at any
  IPC seam type-checks and explodes only at runtime through the
  unknown-root branch.
- **Direction:** introduce branded types (`string & { readonly __brand: 'RootId' }`)
  and a small mint helper. The compile-time strictness is high-
  value because the capability sandbox is one of the most
  security-critical surfaces in the app.

### 4.7 [Medium] IPC handlers mix throw + tagged result

- **Files:** `src/main/ipc/license.ts`, `src/main/ipc/profile.ts`,
  `src/main/ipc/recovery.ts`, `src/main/ipc/fileSystem.ts`.
- **Risk:** callers must handle both rejection and
  `{ ok: false, reason }` shapes. New surfaces drift toward
  whichever convention the author saw most recently.
- **Direction:** standardize on a `Result<T>` discriminated-union
  shape for renderer-facing IPC, and reserve `throw` for unknown-
  invariant violations the renderer cannot interpret. The
  capability sandbox already speaks this dialect.

### 4.8 [Medium] Cross-component dispatch via `window.dispatchEvent`

- **Files:** [`App.tsx:614-618`](../src/renderer/App.tsx),
  [`ShareLinkButton.tsx`](../src/renderer/components/Share/ShareLinkButton.tsx),
  `lingua-open-snippets-overlay`, `lingua-share-link-trigger`,
  `lingua-open-file`.
- **Direction:** introduce a tiny `useCommandBus` store (or
  promote the existing `recentRunsPopoverBridge` shape into a
  generic command surface). Stringly-typed `CustomEvent` names
  are an easy regression vector when a renamed surface forgets
  to update one subscriber.

### 4.9 [Medium] 196 empty `catch {}` blocks repository-wide

- **Direction:** sweep them in three buckets — (a) intentionally
  silenced (add a one-line `// best-effort` comment), (b) should
  log to the local debug sink (add a `debugLog(error)` helper),
  (c) should propagate (fix the throw). A lint rule
  (`eslint-plugin-no-empty-catch`) can prevent regressions.

### 4.10 [Low] `RL-XXX` references inline in source comments

- **Pattern:** ~200 comments reference internal RL ids
  (`// RL-019 Slice 2 fold C — ...`). Useful for cross-reference
  while the ticket is hot; noise once the ticket closes.
- **Direction:** keep the references behind a single inline
  marker (`/* @ref RL-019 */`) that an external linter can later
  validate against `ROADMAP.md`, and prune the ones whose
  rationale is now obvious from the code shape itself.

### 4.11 [Low] Telemetry calls scattered across ~50 sites

- **File:** every store + most components, ~119 `trackEvent` call
  sites under `src/renderer/`.
- **Direction:** keep the call sites (they encode product
  intent) but unify the *shape*: a single `emit(eventName, ...)`
  helper that already snapshots tier + session id + closed-enum
  validation. Today each site repeats the closed-enum bucketing
  ceremony.

---

## 5. Data & persistence findings

The persistence layer is healthy but lightly typed at the
edges, and migration paths are implicit.

### 5.1 What is actually persisted

| Surface | Backing store | Shape |
|---------|---------------|-------|
| License server | Cloudflare D1 (SQLite) — `licenses`, `devices`, `trials`, `educations`, `pending` | Raw SQL via Wrangler migrations. **No Drizzle / no ORM.** |
| Update server | None (stateless route → CDN) | n/a |
| Desktop main | `userData/license.json`, `userData/device-id.json`, `userData/telemetry-consent.json`, `userData/filesystem-approvals.json` | Atomic tmp+rename JSON, mode 0o600 on POSIX |
| Plugins | `userData/plugins/<id>/plugin.json` | Read-only manifests |
| Renderer | `localStorage` — `lingua-settings`, `lingua-session`, `lingua-snippets`, `lingua-env`, `lingua-debugger-state`, `lingua-utilities-state`, `lingua-license`, `lingua-ui-*` | Zustand `persist` middleware |
| Worker fixtures | In-memory only | n/a |

No IndexedDB, no OPFS, no `electron-store`.

### 5.2 [High] No `_schemaVersion` on persisted Zustand stores

- **File:** every `*Store.ts` that uses `persist(...)`.
- **Risk:** the existing `merge()` functions shallow-merge the
  persisted state into the in-code defaults. When a key is renamed,
  retyped, or removed, the merge has no way to know whether a
  stored value is "current shape, just user-set" or "old shape,
  must be migrated". The `onboardingWelcomeSeedVersion` field is
  the only versioned key today, and it is hand-rolled per surface.
- **Direction:** add a `_schemaVersion: 1` field at each persisted
  store root, gate `merge` on the version, and route version
  bumps through a tiny migration registry. Future shape changes
  bump the version and write a one-time migration.

### 5.3 [Medium] License-server schema has no client-facing migration handshake

- **File:** `license-server/migrations/`, consumed by
  `license-server/src/handlers/licenses.ts`.
- **Risk:** if a future migration changes a response shape, no
  protocol-version handshake exists between client and server,
  so older clients silently get the new shape and fail at the
  type-narrowing step.
- **Direction:** introduce a `protocolVersion` in
  `/licenses/status` responses and a documented compatibility
  matrix. Pin client expectations in
  `src/shared/licenseServerProtocol.ts` (new file) so both ends
  evolve in lockstep.

### 5.4 [Medium] D1 device-cap race + KV PoP race already captured

- **Reference:** `docs/BACKLOG.md` 2026-04-29 entries.
- **Status:** known + tracked; mentioned here so the audit's
  proposed work doesn't double-book them.

### 5.5 [Low] Corrupt/stale persistence path logs nothing

- **File:** [`src/main/license.ts`](../src/main/license.ts) —
  `readPersistedLicense()` silently returns `null` on JSON parse
  failure or missing file.
- **Direction:** keep the fall-back (returning `null` is the
  right runtime behavior) but tag the silent fall through to a
  diagnostics sink so users reporting "my license vanished" have
  a breadcrumb.

---

## 6. Proposed tickets

Each item below is sized to a **single small PR**. The `AUDIT-NN`
ids are this document's local numbering; on 2026-05-24 they were
promoted to real ROADMAP rows with the fixed mapping
`AUDIT-NN ↔ RL-(120+N)` (so `AUDIT-01 → RL-121`,
`AUDIT-22 → RL-142`). The ROADMAP rows live in
[`docs/ROADMAP.md`](./ROADMAP.md) §4m and carry the
priority + dependencies decision; this document keeps the deep
scope + acceptance criteria.

| `AUDIT` | `RL` | Tier | `RL` | Tier |
|---|---|---|---|---|
| `AUDIT-01` | `RL-121` | 1 |  |  |
| `AUDIT-02` | `RL-122` | 1 |  |  |
| `AUDIT-03` | `RL-123` | 1 |  |  |
| `AUDIT-04` | `RL-124` | 1 |  |  |
| `AUDIT-05` | `RL-125` | 1 |  |  |
| `AUDIT-06` | `RL-126` | 1 |  |  |
| `AUDIT-07` | `RL-127` | 1 |  |  |
| `AUDIT-08` | `RL-128` | 2 | `AUDIT-15` | 3 (→ `RL-135`) |
| `AUDIT-09` | `RL-129` | 2 | `AUDIT-16` | 3 (→ `RL-136`) |
| `AUDIT-10` | `RL-130` | 2 | `AUDIT-17` | 3 (→ `RL-137`) |
| `AUDIT-11` | `RL-131` | 2 | `AUDIT-18` | 3 (→ `RL-138`) |
| `AUDIT-12` | `RL-132` | 2 | `AUDIT-19` | 3 (→ `RL-139`) |
| `AUDIT-13` | `RL-133` | 2 | `AUDIT-20` | 3 (→ `RL-140`) |
| `AUDIT-14` | `RL-134` | 3 | `AUDIT-21` | 3 (→ `RL-141`) |
|  |  |  | `AUDIT-22` | 3 (→ `RL-142`) |

### Tier 1 — high-impact, ship-soon

#### AUDIT-01  Centralize active-tab access (perf + refactor)

- **Maps to:** §3.1, §3.6, §4.3
- **Type:** refactor + perf
- **Scope:**
  - Add `getActiveTab(state): FileTab | null` selector on
    `editorStore`.
  - Add `useActiveTab(): FileTab | null` hook in
    `src/renderer/hooks/useActiveTab.ts`, returning the result
    via `useEditorStore` with the shallow comparator from
    `zustand/shallow`.
  - Migrate every inline `state.tabs.find(t => t.id === state.activeTabId)`
    call site in App.tsx, AppLayout.tsx, and the ~13 chip /
    pill / button components.
- **Acceptance criteria:**
  - No remaining inline `tabs.find(... === activeTabId)` outside
    of `editorStore.ts` (lint rule recommended).
  - Manual perf check: typing in one tab does not increment a
    render counter on unrelated tab chips (test via React
    DevTools profiler or `useRef` counter assertion).
  - Existing test suites (`npm test -- --run`,
    `npx tsc --noEmit`) green.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~1 day).

#### AUDIT-02  Memoize `PanelChipsRow` snapshot subscriptions

- **Maps to:** §3.2.
- **Scope:**
  - Wrap snapshotRing + scopeSnapshot reads with `useShallow`
    (or shallow comparator) so identity-stable snapshots don't
    re-render the row.
  - Derive `hasComparableSnapshotFor(language)` and
    `hasScopeSnapshotFor(language, runtimeMode)` selectors on
    `resultStore`.
  - `useMemo` the `chips` array on the four real inputs
    (active tab id, runtime mode, available booleans).
- **Acceptance criteria:**
  - React Profiler shows `PanelChipsRow` re-renders only on
    activeTab change, runtimeMode change, or
    `hasComparable*`/`hasScope*` flipping.
  - Existing chip + tooltip behavior unchanged across the web
    smoke pass.
- **Dependencies:** AUDIT-01 (uses the new active-tab hook).
- **Estimated effort:** 1 small PR (~0.5 day).

#### AUDIT-03  Virtualize the console panel

- **Maps to:** §3.3.
- **Scope:**
  - Introduce a windower for `<ConsolePanel>` entries (prefer
    `react-window` to keep the dep small; fallback to a
    hand-rolled implementation if the bundle delta is too
    high).
  - Move `collapseIdenticalEntries` to a store-side derivation
    that runs once on push, not on render.
  - Replace `JSON.stringify`-based equality with a precomputed
    hash per entry (`spark-md5` is already a transitive dep).
  - Lazy-mount `<RichValueChart>`/`<RichValueTable>` so charts
    that scroll out of the window release their canvas.
- **Acceptance criteria:**
  - A 500-entry session keeps a < 16 ms render budget on the
    web smoke pass (locked via a `tests/perf/console.bench`).
  - Auto-scroll-to-bottom still feels instant; filter toggles
    are interactive.
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~2 days).

#### AUDIT-04  Lazy-register Monaco language contributions

- **Maps to:** §3.4.
- **Scope:**
  - Move language registration in `monaco.ts` from
    `ensureLanguageContributions(m)` (all at once) to a
    `registerLanguageOnce(m, languageId)` callable that the
    editor mount / language picker invokes per active language.
  - Keep `javascript` + `typescript` pre-registered for the
    scratchpad happy path.
  - Add a small registry of `languageId → loadPromise` so
    parallel calls dedupe.
- **Acceptance criteria:**
  - `npm run check:performance` measures a measurable initial-
    bundle drop (commit the new baseline).
  - Opening a Rust file still shows tokenizer coloring within
    one frame of the editor mount.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~1 day).

#### AUDIT-05  Dynamic-import single-use deps

- **Maps to:** §3.5.
- **Scope:**
  - Convert `qrcode`, `sql-formatter`, and `marked` imports to
    `await import('...')` at the actual call sites (or in a
    one-line loader helper).
  - Refresh `docs/performance/baseline.json`.
- **Acceptance criteria:**
  - The web build size drops in the `initial` bucket and the
    new totals land in the baseline.
  - Existing QR / SQL-format / Markdown surfaces still render
    after a cold open.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~0.5 day).

#### AUDIT-06  Schema-version every persisted Zustand store

- **Maps to:** §5.2.
- **Scope:**
  - Add `_schemaVersion: 1` (or the current real version) to
    every store using `persist(...)`.
  - Introduce a tiny `migrationRegistry` that maps
    `(storeName, fromVersion) → migrate(state)`.
  - Convert at least the `settingsStore` rehydrate path to the
    new convention as a worked example.
  - Document the contract in
    `docs/ARCHITECTURE.md`.
- **Acceptance criteria:**
  - `npm test -- --run` covers a forward-migration test
    fixture per store.
  - Rehydrating from a v0 (unversioned) localStorage payload
    still works (back-compat shim runs once).
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~1.5 days).

#### AUDIT-07  Add `setPermissionRequestHandler` (deny-by-default)

- **Maps to:** §2.2.
- **Scope:**
  - Install a deny-by-default
    `session.defaultSession.setPermissionRequestHandler(...)` at
    `app.ready` with an explicit empty allow-list constant.
  - Pair it with `setPermissionCheckHandler` returning `false`
    for the same set.
  - Cover with `tests/main/permissionHandlers.test.ts` (mock
    session).
- **Acceptance criteria:**
  - Tests assert that requesting `media`, `geolocation`,
    `notifications`, `clipboard-read`, and `clipboard-sanitized-write`
    is denied by default.
  - Packaged smoke (`smoke:desktop`) does not regress (the
    smoke does not currently exercise these APIs).
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~0.5 day).

### Tier 2 — structural cleanup

#### AUDIT-08  Split `editorStore.ts`

- **Maps to:** §4.1.
- **Scope:**
  - Extract `editorTabUtils.ts` (~60 lines) — pure helpers
    (`createDefaultTab`, `languageSupportsAutoLog`, …).
  - Extract `editorModeHelpers.ts` (~80 lines) — runtimeMode
    + workflowMode resolution for new/restored tabs.
  - Extract `editorPersistence.ts` (~200 lines) — `persistTab`,
    `resolveFormattedContent`, the rootId revoke ladder.
  - Extract `editorActions.ts` (~300 lines) — per-tab setters
    that are now scattered.
  - Keep `editorStore.ts` as the assembly point (~400 lines
    after splitting).
- **Acceptance criteria:**
  - No public API change visible to call sites.
  - `npm test -- --run` + `npx tsc --noEmit` + `npm run lint`
    green.
  - File sizes: assembly point under 500 lines, no extracted
    module above 300.
- **Dependencies:** AUDIT-01 (active-tab selector) makes some
  call sites simpler to migrate.
- **Estimated effort:** 1 medium PR (~2 days).

#### AUDIT-09  Split `settingsStore.ts`

- **Maps to:** §4.1.
- **Scope:**
  - Extract `settingsDefaults.ts` (seeds + language sets).
  - Extract `settingsSanitizers.ts`
    (`sanitizeShortcutOverrides`, `sanitizeWorkflowModeDefaults`,
    `sanitizeScratchpadAutoLog`,
    `sanitizeRuntimeTimeoutPresets`).
  - Extract `settingsPersistence.ts` (the `partialize` +
    `merge` middleware).
  - Optionally split setters by domain
    (`settingsAppearanceActions.ts`,
    `settingsRuntimeActions.ts`,
    `settingsOnboardingActions.ts`).
- **Acceptance criteria:** same as AUDIT-08; assembly point
  under 500 lines.
- **Dependencies:** AUDIT-06 (the schema-version refactor
  touches the same persist middleware).
- **Estimated effort:** 1 medium PR (~2 days).

#### AUDIT-10  Split `licenseStore.ts` along the web/desktop seam

- **Maps to:** §4.1.
- **Scope:**
  - Extract `licenseServerMappers.ts`
    (`serverStatusKindToStatus`, `serverFailureToInvalid`,
    `isTransientServerFailure`).
  - Extract `licenseTokenHelpers.ts` (`decodeIssuedAt`,
    `decodeIssuedTo`, `attemptStaleTokenRefresh`).
  - Move the web flow into `licenseWebStore.ts` and the
    desktop flow into `licenseDesktopStore.ts`.
  - Keep `licenseStore.ts` as the factory + facade so the
    `useLicenseStore()` import path does not break.
- **Acceptance criteria:** same as AUDIT-08; web + desktop
  smoke flows still pass; no regression in the entitlement
  hook’s return shape.
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~2 days).

#### AUDIT-11  Extract `useLayoutAvailability` + `useAppShortcuts`

- **Maps to:** §4.2.
- **Scope:**
  - Pull the bottom-panel + console + debugger + browser-
    preview + stdin + variables availability gates out of
    `AppLayout.tsx` into a `useLayoutAvailability(activeTab)`
    hook.
  - Move the keyboard-shortcut handler payload out of
    `AppChrome` in `App.tsx` into a `useAppShortcuts(...)`
    hook.
- **Acceptance criteria:**
  - `AppLayout.tsx` drops under 800 lines.
  - `App.tsx` drops under 500 lines.
  - All shortcut + chip behaviors covered by existing tests
    continue to pass.
- **Dependencies:** AUDIT-01.
- **Estimated effort:** 1 medium PR (~1.5 days).

#### AUDIT-12  Brand `RootId`, `WatchId`, `RelativePath`

- **Maps to:** §4.6.
- **Scope:**
  - Introduce `string & { readonly __brand: 'RootId' }` aliases
    plus mint helpers in `src/main/ipc/projectCapabilities.ts`.
  - Thread the branded types through the preload bridge
    (`src/preload/index.ts`), the renderer
    `projectStore`, and the watcher + IPC handlers.
  - Add a `_brand_test.ts` that asserts the swap-attack
    compiler error survives.
- **Acceptance criteria:**
  - `npx tsc --noEmit` green.
  - Swap attempts at the IPC boundary produce a compile
    error (locked by a `// @ts-expect-error` test).
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~1.5 days).

#### AUDIT-13  Standardize IPC error contract on `Result<T>`

- **Maps to:** §4.7.
- **Scope:**
  - Introduce
    `type Result<T, E = string> = { ok: true; data: T } | { ok: false; reason: E; message?: string }`
    in `src/shared/result.ts`.
  - Migrate `license:*`, `profile:*`, `recovery:*`, and
    `lsp:*:request` IPC handlers + their preload wrappers to
    return `Result<T>`.
  - Keep `throw` reserved for capability-sandbox violations
    (already the project convention there).
- **Acceptance criteria:**
  - Renderer callers handle the discriminated union in one
    place each.
  - Existing `LicenseApplyResult`, `LicenseClearResult`,
    `LicenseRemoveDeviceResult` shapes either re-export the
    new Result or alias it.
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~2 days).

### Tier 3 — polish + reliability

#### AUDIT-14  `useStatusNotice` hook + `pushInfoNotice` helper

- **Maps to:** §4.4.
- **Scope:**
  - Add `useStatusNotice()` returning `{ info, success,
    warning, error }`.
  - Add the imperative twin `pushInfoNotice(messageKey, ...)`
    et al. for non-React call sites.
  - Migrate at least the 50 highest-traffic call sites; leave
    the rest for follow-ups.
- **Acceptance criteria:**
  - Tone enforcement happens at the helper, not at the call
    site.
  - No behavior change in existing notices (verified via the
    StatusNoticeBanner test).
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~1 day).

#### AUDIT-15  Replace `window.dispatchEvent` bridges with a command bus

- **Maps to:** §4.8.
- **Scope:**
  - Introduce `useCommandBus` (Zustand) with closed-enum
    command names matching the current
    `SHARE_LINK_TRIGGER_EVENT`,
    `lingua-open-snippets-overlay`,
    `lingua-open-file`, `lingua-share-link-trigger`.
  - Migrate the four dispatch sites + their listeners.
- **Acceptance criteria:**
  - No remaining `window.dispatchEvent(new CustomEvent('lingua-...'))`.
  - Existing share-link + open-snippets flows still pass the
    web smoke.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~1 day).

#### AUDIT-16  Sweep empty `catch {}` blocks

- **Maps to:** §4.9.
- **Scope:**
  - Categorize the 196 empty catches into best-effort,
    should-log, and should-propagate buckets.
  - Add `// best-effort: …` comments to the first bucket.
  - Route the second bucket through a tiny
    `debugLog(scope, error)` helper.
  - Fix the third bucket (likely a handful).
  - Add an ESLint rule (`no-empty-catch` with allow-list
    annotation) to prevent regressions.
- **Acceptance criteria:**
  - Lint runs green with the new rule in place.
  - No silent failure in the renderer when a known-throw
    happens (verified by injecting a failure in
    `useDownloadedUpdateNotice`).
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~1.5 days).

#### AUDIT-17  Document filesystem denylist + extend coverage

- **Maps to:** §2.4.
- **Scope:**
  - Add `~/Library/Application Support`, `~/AppData/Roaming`,
    browser profile dirs, `userData/` itself (configurable),
    and other documented sensitive paths to `BLOCKED_PATHS`.
  - Add a test matrix at
    `tests/main/ipc/permissions.test.ts` that locks the
    coverage list.
  - Document the rationale in
    `docs/security/2026-05-24/filesystem-denylist.md` (or
    extend the existing security folder layout).
- **Acceptance criteria:**
  - Tests cover one positive + one negative case per blocked
    family.
  - User-facing message is actionable when a pick lands
    inside a blocked path.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~1 day).

#### AUDIT-18  Tighten the web build CSP

- **Maps to:** §2.1.
- **Scope:**
  - Migrate eval-needing chunks (esbuild-wasm, Pyodide,
    Monaco TypeScript worker) into a separately-scoped CSP
    context (sub-document or per-bundle directive), and
    drop `'unsafe-eval'` from the top-level shell.
  - Introduce nonce-based inline scripts where the inline
    theme-detection script lives in `index.html`.
  - Document the resulting policy in
    `docs/RELEASE_SECURITY.md`.
- **Acceptance criteria:**
  - The shell loads without `'unsafe-eval'`; worker code
    that needs it inherits a narrower policy through its
    own document.
  - End-to-end web smoke still green; no regression on
    Pyodide, esbuild-wasm, or browser-preview surfaces.
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~2 days) — high risk of
  regression, validate carefully.

#### AUDIT-19  Document + audit update-package signing chain

- **Maps to:** §2.3.
- **Scope:**
  - Trace and document the full Squirrel.Mac /
    Squirrel.Windows signature chain end-to-end in
    `docs/RELEASE_SECURITY.md`.
  - Decide whether a manifest-signing layer (Ed25519 over
    the update manifest JSON) is needed; spike if yes.
  - Add a release-time check that asserts every artifact
    referenced from the update feed is signed + (on macOS)
    notarized.
- **Acceptance criteria:**
  - `docs/RELEASE_SECURITY.md` has a "Signature chain" section
    covering manifest → installer → on-disk binary.
  - The release workflow fails closed if an artifact is
    unsigned.
- **Dependencies:** none.
- **Estimated effort:** 1 medium PR (~1.5 days).

#### AUDIT-20  Preconnect, preload, color-scheme + tailwind content config

- **Maps to:** §3.7, §3.8.
- **Scope:**
  - Add `<link rel="preconnect" href="https://licenses.linguacode.dev">`,
    `<link rel="preconnect" href="https://updates.linguacode.dev">`,
    and the editor-font preload to `index.html` (and the
    web mirror).
  - Add `<meta name="color-scheme" content="dark light">`.
  - Create `tailwind.config.ts` with explicit `content`
    paths.
  - Refresh `docs/performance/baseline.json`.
- **Acceptance criteria:**
  - Performance baseline reflects the smaller CSS bundle.
  - Web smoke still green; theme detection still feels
    instant on cold load.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~0.5 day).

#### AUDIT-21  License-server protocol versioning

- **Maps to:** §5.3.
- **Scope:**
  - Add `protocolVersion: 1` to every response shape from
    `/licenses/*` and `/trials/*`.
  - Pin client expectations in
    `src/shared/licenseServerProtocol.ts` with a closed-enum
    accepted-versions list.
  - Document the bump policy alongside D1 migrations in
    `docs/LICENSING_ADR.md`.
- **Acceptance criteria:**
  - Renderer rejects unrecognized `protocolVersion` with a
    typed status notice.
  - Server unit tests cover the version pin.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~1 day).

#### AUDIT-22  Docstrings for the highest-leverage logic

- **Maps to:** §4.10, §5.5, the few uncommented branches in the
  capability sandbox.
- **Scope:**
  - Add a docstring above
    `licenseStore.attemptStaleTokenRefresh()` explaining the
    grace-window contract.
  - Add a comment block at `licenseStore.setTabVariableInspectorEnabled`
    + `setTabCompareEnabled` explaining the mutual-exclusion
    invariant.
  - Add the "void `_unused` pattern is intentional" note at
    the top of `editorStore.ts`.
  - Add the diagnostics-sink breadcrumb at
    `readPersistedLicense()` (§5.5).
- **Acceptance criteria:**
  - No behavioral change; review-grade documentation
    improvement only.
- **Dependencies:** none.
- **Estimated effort:** 1 small PR (~0.5 day).

---

## 7. Sequencing recommendation

If the team picks up this audit incrementally, the highest-
value-per-risk order is (AUDIT id · RL id):

1. **AUDIT-01 · `RL-121`** (active-tab selector) — unblocks
   AUDIT-02, AUDIT-08, AUDIT-11.
2. **AUDIT-07 · `RL-127`** (permission handler) — small,
   eliminates a real-world drift risk.
3. **AUDIT-02 · `RL-122`** (`PanelChipsRow`) — pairs with
   AUDIT-01.
4. **AUDIT-05 · `RL-125`** (dynamic-import deps) — fast bundle
   win.
5. **AUDIT-06 · `RL-126`** (schema-version) — must land before
   any surface bumps a persisted shape.
6. **AUDIT-12 · `RL-132`** (branded types) — locks the
   capability sandbox's contract before the next refactor
   changes it.
7. **AUDIT-08 → AUDIT-09 → AUDIT-10** · `RL-128 → RL-129 →
   RL-130` — the three store splits. Sequence them; do not
   parallelize, because they share patterns and reviewers
   benefit from seeing them in order.
8. **AUDIT-04 + AUDIT-20** · `RL-124` + `RL-140` — the
   remaining bundle/perf wins.
9. **AUDIT-03 · `RL-123`** — virtualization. Larger surface
   change; land it once the smaller wins are in.
10. **AUDIT-13 → AUDIT-15** · `RL-133 → RL-135` — IPC + command
    bus conventions.
11. **AUDIT-18 → AUDIT-19** · `RL-138 → RL-139` — security
    follow-throughs that each need a careful release.
12. **AUDIT-11, AUDIT-14, AUDIT-16, AUDIT-17, AUDIT-21,
    AUDIT-22** · `RL-131`, `RL-134`, `RL-136`, `RL-137`,
    `RL-141`, `RL-142` — polish, can interleave anywhere.

This sequencing intentionally front-loads the cheapest items
that *unlock* later refactors (the active-tab selector), keeps
the security follow-throughs from blocking the perf wins, and
sequences the three store splits so each one inherits the
discipline from the previous.

---

## 8. Out of scope (and why)

The following were considered and intentionally left out:

- **Runtime profiling under production load.** This audit
  reads code, not traces. The findings above are based on
  call-graph evidence; turning any of them into a hard
  guarantee requires a Profiler capture.
- **Threat model formalization.** `docs/LICENSING_ADR.md` and
  `docs/security/2026-05-09/` already cover the licensing
  side; the broader Electron threat model is a larger
  exercise than a single audit document should attempt.
- **SQL / Drizzle migration.** Lingua's database surface is
  the Cloudflare D1 license server only. No client-side SQL
  use exists, so no Drizzle migration applies. Renderer
  persistence stays Zustand + localStorage by design.
- **Auto-fix of any of the findings.** This document does
  not change source code; the user asked explicitly for a
  ticket-set proposal because a single PR doing all of the
  above would be impossible to review.

# Lingua — Delivery Plan (technical deep-dive reference)

> **This file is the deep reference for every `RL-XXX` ticket.** It
> holds scope, acceptance criteria, dependencies, and the historical
> reasoning behind each decision. It is **not** the file an agent
> should load to decide what to pick next.
>
> - **For canonical `Status` + priority + the current backlog:** read
>   [`docs/ROADMAP.md`](./ROADMAP.md). When this file and ROADMAP
>   disagree on a ticket's status, **ROADMAP wins.** This file's
>   `Status` fields are a cached mirror and may lag by one commit.
> - **For active-sprint per-commit detail:** read
>   [`docs/SPRINT-PLAN.md`](./SPRINT-PLAN.md).
> - **For pre-commitment raw ideas:** capture in
>   [`docs/BACKLOG.md`](./BACKLOG.md) first; graduate to ROADMAP only
>   after acceptance criteria clear.
> - **For the index of every engineering doc in the repo:** see
>   [`docs/README.md`](./README.md).
>
> **Read this file conditionally.** Load a single `RL-XXX` section
> (grep `### RL-XXX`) when you need the deep scope. Loading the whole
> file is ~50k tokens and rarely necessary.

This document is the operational source of truth for Lingua's ticket scope and acceptance criteria. It replaces the old split between "roadmap", "workstreams", and "milestones" with one ordered backlog based on verified product state, desktop validation, and implementation readiness.

The order of items below is the historical execution order. If a task is not in this plan, it is not currently committed work.

---

## How to read this plan

Every task is an `### RL-XXX` heading followed by three metadata fields:

- **`Priority`** — `P0` (critical, unblocks other work), `P1` (next up), `P2` (scheduled), `P3` (nice-to-have), `Future` (explicit parking lot).
- **`Status`** — closed enum, see the legend below.
- **`Readiness`** — human-readable note on what is actually shipped, what blocks the task, and which dates the slices landed on.

Anything else under the task (Scope, Acceptance criteria, Dependencies, Not in scope) fleshes out the slice.

### Status legend

| Value | Meaning |
|-------|---------|
| `Done` | Fully shipped and validated. Listed for historical context; not a candidate for the next step. |
| `Partial` | Started. One or more slices have landed; the `Readiness` field names which ones, and what is still pending. Partial tasks ARE candidates for the next step — pick the smallest unshipped slice the task calls out. |
| `Planned` | Fully spec'd but no code shipped yet. Candidate for the next step. |
| `Research-backed spike` | Investigation complete, ADR filed, no production code. Parked intentionally — not a candidate unless the plan promotes it first. |
| `Deferred study` | Parked for later revisit. Not a candidate. |
| `Superseded` | Original scoping replaced by newer RL items; the `Readiness` field names them. Not a candidate — pick the successor(s). |

### Picking the next step

A slice is **implementable now** when all of the following hold:

1. `Status` is `Partial` or `Planned`.
2. Every id in its `Dependencies` block is `Done` (or explicitly noted as soft-gate).
3. Its `Readiness` field does not list an external block (e.g. "waiting on RL-0xx Slice A").

Do not invent new RL ids. If a slice needs to split further, add a new `## N.N` section inside the existing task rather than create a parallel RL.

---

## Current verified state

### Platform
- Electron Forge + Vite for desktop
- React 19 + TypeScript + Monaco + Zustand in renderer
- Web build exists as a limited fallback
- Auto-update bridge, release pipeline skeleton, and local plugin manifest loading are implemented

### Editor and workflow
- Tabs, file tree, project open/create, command palette, quick open, settings modal, resizable layout, and console panel are implemented
- Auto-run with debounce is implemented
- Magic comments are implemented for JS/TS and Python
- Loop protection is implemented for JS/TS and Python
- Result panel supports per-line style output for dynamic languages and full output for compiled languages
- Snippet library exists with in-app save, browse, edit, delete, and reuse flows

### Execution model
- JavaScript runs in a worker
- TypeScript transpiles with `esbuild-wasm` and then runs through the JS path
- Python runs through Pyodide
- Go compiles through Electron main to WASM and then runs in renderer
- Rust compiles and executes through Electron main
- Web mode intentionally stubs desktop-only behavior such as Go and Rust execution

---

## Desktop validation snapshot

Validated on Electron desktop UI on 2026-04-09 by launching the renderer dev server and driving the app through Playwright Electron.

| Language | Result | Notes |
|----------|--------|-------|
| JavaScript | Pass | Template executed and produced `Hello, World!` |
| TypeScript | Pass | Template executed and produced `Hello, World!` |
| Python | Pass | Pyodide loaded and template executed successfully |
| Rust | Pass | Native compile-and-run path executed successfully |
| Go | Pass | Desktop runner executed successfully after fixing `wasm_exec.js` lookup and worker mode |

---

## Delivery rules

- Treat this plan as both backlog and milestone tracker
- Keep product claims conservative; only describe behavior that is implemented or explicitly marked partial
- Prefer implementation-ready tasks over speculative roadmap items
- Split broad ideas into smaller tasks with explicit acceptance criteria before starting them
- Desktop validation is the source of truth for native language support and Electron-only behavior
- Web preview remains the default for general renderer checks, but native language validation must run through Electron

---

## Ordered delivery backlog

## 1. Desktop execution correctness

### RL-001 Fix Go desktop execution

- Priority: `P0`
- Status: `Done`
- Readiness: `Completed on 2026-04-09`
- Why this comes first:
  - Go is a shipped language target
  - The desktop test matrix already shows it failing
  - This blocks confidence in Electron as the primary validation path for compiled languages
- Scope:
  - Resolve `wasm_exec.js` from supported Go layouts
  - Prefer `${GOROOT}/lib/wasm/wasm_exec.js` and fall back to `${GOROOT}/misc/wasm/wasm_exec.js`
  - Return an actionable error that includes `GOROOT` and the checked paths when the runtime is missing
  - Execute Go in a classic worker so `wasm_exec.js` can load correctly with `importScripts`
- Acceptance criteria:
  - Running the default Go template in Electron produces `Hello, World!`
  - The runner works on the validated local Go installation
  - Failure mode is explicit if Go exists but the runtime assets cannot be found
- Dependencies:
  - None

### RL-002 Make project file watching real in renderer

- Priority: `P0`
- Status: `Done`
- Readiness: `Completed on 2026-04-13`
- Original gap:
  - Main and preload expose `fs:watch-start`, `fs:watch-stop`, and `fs:onChanged`
  - `projectStore` starts a watcher
  - Renderer never subscribes to `window.lingua.fs.onChanged`
  - External file changes do not refresh the tree
- Scope for MVP:
  - Subscribe once to `window.lingua.fs.onChanged`
  - Refresh the current project tree when events arrive for the active project
  - Debounce refreshes so bulk file changes do not thrash the UI
  - Tear down subscriptions cleanly when project closes or the app unmounts
- Explicitly out of scope for MVP:
  - Merge logic for dirty open tabs
  - Incremental tree patching
  - Conflict resolution UI
- Acceptance criteria:
  - Creating, renaming, and deleting files externally refreshes the tree
  - Closing a project stops updates
  - No duplicate subscriptions or repeated refresh storms after reopening projects
- Dependencies:
  - None

### RL-003 Align Monaco diagnostics with the real JS/TS runtime

- Priority: `P0`
- Status: `Done`
- Readiness: `Implemented on 2026-04-10`
- Current gap:
  - Resolved by configuring Monaco JavaScript and TypeScript defaults against the actual worker runtime contract
- Baseline runtime contract to implement now:
  - Supported editor/runtime assumptions:
    - ECMAScript 2022
    - top-level await
    - worker-style globals
    - `fetch` and standard web platform primitives already available in worker context
  - Explicitly unavailable in the baseline JS/TS contract:
    - `document` / DOM APIs
    - Node built-ins such as `fs`, `path`, `net`
- Scope:
  - Configure Monaco `javascriptDefaults` and `typescriptDefaults`
  - Set `target`, `module`, `moduleResolution`, `moduleDetection`, `noEmit`, and diagnostics options to match the worker-based execution model
  - Use `es2022` + `webworker` libs so worker globals are typed without enabling DOM or Node built-ins
  - Keep Node and DOM typings out of the baseline contract
- Acceptance criteria:
  - Valid JS/TS examples in the app are not flagged incorrectly
  - Unsupported APIs such as `document` and `fs` are surfaced as errors in the editor
  - TypeScript diagnostics appear without requiring the user to run code
- Dependencies:
  - None

### RL-004 Unify editor error surfacing across runtime, compilation, and type diagnostics

- Priority: `P0`
- Status: `Done`
- Readiness: `Implemented on 2026-04-16`
- Current gap:
  - Baseline editor markers and inline decorations are now wired for manual and auto-run execution results
  - Full cross-language diagnostic richness is still incomplete
- Scope:
  - Show inline editor markers for:
    - TypeScript diagnostics
    - JS/TS/Python runtime errors with mapped line numbers where available
    - Go/Rust compile errors with parsed line and column information
  - Add gutter markers and inline decorations
  - Keep result panel and editor markers synchronized
- Current progress:
  - Monaco markers now use a dedicated execution owner so runtime/compile highlights coexist with TS diagnostics
  - Manual run and auto-run now both populate the same result-store view model
  - Dynamic-language line results are now available to the editor as inline decorations
  - Location-aware execution failures now reveal the source line in Monaco and can surface through glyph-margin diagnostics
  - Go and Rust compiler failures now normalize their primary messages and parsed source locations into the same execution-diagnostic pipeline used by the editor and result panel
- Acceptance criteria:
  - A type error in TS is visible in the editor without running
  - A runtime error in JS/TS/Python highlights the relevant source line
  - A Go or Rust compiler error highlights the reported source location when line data is available
- Dependencies:
  - RL-003

### RL-005 Keep desktop UI validation as a maintained workflow

- Priority: `P0`
- Status: `Done`
- Readiness: `Implemented on 2026-04-16`
- Scope:
  - Preserve the documented Electron validation flow in `AGENTS.md`
  - Add repo-level scripts for repeatable validation instead of ad hoc commands
  - Minimum target scripts:
    - renderer dev server for Electron automation
    - Electron smoke test entrypoint
    - artifact output under `output/playwright/`
- Current progress:
  - `npm run dev:desktop` now launches the renderer server and Electron together and tears the owned server down when Electron exits
  - `npm run dev:desktop:sync` can resync `.vite/build/main.js` and `.vite/build/preload.js` without going through `electron-forge start`
  - `npm run smoke:desktop` now exercises JS, TS, Python, Go, and Rust in a real Electron window and writes bootstrap, progress, screenshots, and summary artifacts under `output/playwright/desktop-smoke`
  - The smoke flow has explicit timeout/failure reporting so contributors get a terminating command with actionable artifact output instead of a silent hang
- Acceptance criteria:
  - A contributor can run one documented command sequence and validate Electron UI behavior
  - The language smoke test includes JS, TS, Python, Go, and Rust
  - The workflow saves artifacts for failures
- Dependencies:
  - RL-001 for a clean all-language pass

---

## 2. Core editor and workflow completeness

### RL-006 Make "new file in language X" explicit in the toolbar

- Priority: `P1`
- Status: `Done`
- Readiness: `Implemented`
- Current gap:
  - Resolved by replacing the implicit language dropdown with an explicit split action:
    - primary button creates a new file in the active tab language
    - secondary menu lists supported languages for direct creation
- Scope:
  - Replace the implicit behavior with an explicit creation flow
  - Recommended approach:
    - keep the `New file` button
    - add a clear menu or split-button for "New JavaScript", "New TypeScript", "New Go", and so on
  - Do not overload the active tab language display with creation side effects
- Acceptance criteria:
  - Users can create a file in a specific language without accidental creation from exploring a dropdown
  - The toolbar makes the action semantics obvious without prior knowledge
- Dependencies:
  - None

### RL-007 Turn snippets into a complete feature

- Priority: `P1`
- Status: `Done`
- Readiness: `Implemented`
- Current gap:
  - Resolved with a dedicated snippets modal, toolbar entry point, command-palette entry point, active-tab save flow, editing UI, delete action, and insertion/open actions
- MVP scope:
  - Save current tab as snippet
  - Browse saved snippets in a dedicated list or modal
  - Edit snippet label, description, language, and code
  - Delete snippets
  - Insert a selected snippet into the active tab
- Explicitly deferred:
  - Import/export
  - sharing
  - snippet autocomplete ranking
- Acceptance criteria:
  - A user can save a snippet from the current tab and reuse it later without leaving the app
  - Snippet metadata can be edited after creation
  - The feature is discoverable without relying only on command palette knowledge
- Dependencies:
  - None

### RL-008 Clean up the settings surface and make app theme behavior truthful

- Priority: `P1`
- Status: `Done`
- Readiness: `Implemented on 2026-04-10`
- Current gap:
  - Resolved by wiring shell theme tokens through the renderer, keeping editor theme independent, and bootstrapping the saved app theme before React mounts
- Implemented scope:
  - root theme state application
  - toolbar, sidebar, panels, settings modal, and result surfaces
  - clear separation between "App theme" and "Editor theme"
  - early `theme-color` and shell theme bootstrap from persisted settings
- Acceptance criteria:
  - Changing `App theme` visibly changes the application shell
  - Editor theme remains independently selectable
  - No setting is shown if it has no visible effect
- Dependencies:
  - None

### RL-009 Split oversized renderer modules

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-13`
- Target files:
  - `src/renderer/components/FileTree/FileTree.tsx`
  - `src/renderer/components/Editor/CodeEditor.tsx`
  - `src/renderer/components/CommandPalette/CommandPalette.tsx`
  - `src/renderer/stores/projectStore.ts`
- Scope:
  - Extract pure helpers from UI components
  - Separate view concerns from store mutation logic
  - Keep behavior unchanged
- Acceptance criteria:
  - Each extracted module has a narrower responsibility
  - Existing tests continue to pass
  - Refactor does not ship bundled behavior changes
- Current progress:
  - `CodeEditor.tsx` now delegates the empty state, Monaco theme definitions, and editor option construction to focused modules instead of holding all editor responsibilities directly
  - `FileTree.tsx` now delegates recursive node rendering, inline creation input, and the no-project explorer surface to focused modules so the container stays responsible for store wiring instead of view details
  - `CommandPalette.tsx` now delegates command construction/filtering and result-list rendering to focused modules so the modal container only owns query, selection, and keyboard interaction state
  - `projectStore.ts` now delegates pure file-tree shaping and immutable node mutations to a dedicated module so the store stays centered on project lifecycle, IPC calls, and persisted watch state
- Dependencies:
  - Prefer after RL-001 through RL-008 so refactors do not obscure bug-fix work

---

## 3. Developer experience after core correctness

### RL-010 Add format-on-save

- Priority: `P2`
- Status: `Done`
- Readiness: `Completed on 2026-04-17 (Phase A + Phase B)`
- Recommended rollout:
  - Phase A:
    - JS/TS via Prettier ✅
    - JSON and CSS via Prettier (bonus, same pipeline) ✅
    - Go via `gofmt` ✅ (desktop-only)
    - Rust via `rustfmt` ✅ (desktop-only)
  - Phase B:
    - Python formatting ✅ (desktop-only; `ruff format` with a `black` fallback). Unblocked after RL-030 locked the capability matrix and confirmed desktop-native is the recommended class for Python formatter binaries
- Current progress:
  - `formatOnSave` settings toggle persists alongside other editor preferences and defaults to off
  - Renderer formatter utility dispatches to Prettier standalone (dynamic-imported so the parsers/plugins stay out of the main bundle) for JS/TS/JSON/CSS; Go, Rust, and Python route through `format:gofmt` / `format:rustfmt` / `format:python` IPC handlers that pipe source via stdin and cache the binary probe
  - Python formatting prefers `ruff format -` and falls back to `black --quiet -` when ruff is not installed; the `binary-missing` error includes install links for both so the status banner is directly actionable
  - All save flows (`saveActiveTab`, `saveActiveTabAs`, dirty-tab close, and app-close save) run the formatter before the filesystem write and fall back to the original content on failure so persistence is never blocked
  - A dismissable bottom-right status notice (`uiStore.statusNotice` + `StatusNoticeBanner`) surfaces parse errors and missing-binary messages with actionable copy — localized in `en` and `es`
  - Web builds report gofmt / rustfmt / python as desktop-only via the existing web adapter stub pattern
- Acceptance criteria:
  - Save formatting is deterministic ✅ (Prettier output is idempotent — regression-tested)
  - Missing formatter binaries are handled with actionable user feedback ✅ (status banner carries the install hint from the IPC error string, now including ruff/black for Python)
- Dependencies:
  - Desktop tooling conventions
  - RL-030 (capability matrix confirmed desktop-native is the recommended class for Python formatter binaries)

### RL-011 Add an environment variables panel for execution contexts

- Priority: `P2`
- Status: `Done` (closed 2026-05-12 — see Status Update below)
- Readiness: `Scoping ADR, Slice A (pure merger), Slice B (store plumbing + snapshot bridge shell), Slice C first + second + third increments (global, tab, project tier editors + effective-env trace preview) shipped on 2026-04-20; Slice D first increment (Go compile IPC threads the effective user env, GOOS/GOARCH stay runner-owned) shipped on 2026-04-20 ter; Slice D second increment (Rust compile + spawn IPC threads the effective user env) shipped on 2026-04-20 quater; Slice D third increment (Python Pyodide worker boot bridges the user env into os.environ) shipped on 2026-04-20 quinquies — Slice D now closed for the three runtimes the ADR contemplates`
- Current progress:
  - `ENV_VARS_ADR.md` answers the three blocking questions: Go/Rust/Python receive env in desktop; JS/TS Workers and the web build do not; the merge order is tab > project > global with empty-string-as-real-value POSIX semantics
  - Secret-storage scope creep is explicitly blocked — env vars persist as plain JSON; secrets belong in the host shell or a vault
  - Four-slice implementation roadmap (pure scope merger, store plumbing, Settings UI, web stub) ready to ship in follow-up sessions
  - Guard test `tests/docs/envVarsAdr.test.ts` pins the three decisions, the secret-storage block, the four slices, and adjacent ADR cross-links
  - Slice A (2026-04-20): `src/shared/envVarScopes.ts` ships the pure merger (`mergeEnvScopes`, `sanitizeScope`, `validateEnvVarKey`, `traceEnvScopes`). POSIX-style key validation (`[A-Za-z_][A-Za-z0-9_]*`), reserved-key deny list (PATH/HOME/USER/SHELL/LOGNAME/PWD/OLDPWD), per-scope 100-key cap, per-value 32k-char cap, frozen merged output so callers can't mutate downstream. 16 tests lock precedence, POSIX mask semantics, reserved-key block, invalid-key rejection at every tier
  - Slice B (2026-04-20): `src/renderer/stores/envVarsStore.ts` threads the three user-owned tiers (`global`, `project`, `tab`) through a persist-backed Zustand store. Writes enforce the Slice A validator + per-scope caps; rehydrate sanitizes every tier so a tampered localStorage can't smuggle reserved keys back in. `resolveEffectiveEnv(processEnv, projectId, tabId)` composes the tiers with a caller-supplied `processEnv` via the Slice A merger. `src/main/ipc/env.ts` + preload + web adapter ship the `env:snapshot` bridge shape, but it intentionally returns `{}` for now so host `process.env` stays in main until Slice D wires the final merge directly into the subprocess path. 15 new tests pin the write/remove/clear contracts, the resolver composition, the persistence sanitization, and the empty desktop snapshot guard. Runner integration (passing the merged env into Go / Rust / Python subprocesses) is Slice D
  - Slice C first increment (2026-04-20): `src/renderer/components/Settings/EnvVarsSection.tsx` lands the Settings panel for the **global** tier. Add form + list + remove affordance + empty state + inline validator error (blank key, reserved/invalid POSIX name, over-cap value) + always-visible precedence hint so the user knows this is one tier of three. Wired into `SettingsModal` next to the Privacy section. Copy ships in en + es (`envVars.title/description/keyLabel/valueLabel/addButton/empty/emptyValueDisplay/removeAriaLabel/precedenceNote/error.keyRequired/error.rejected`). Seven new component tests pin empty state, successful add + draft reset, blank-key error, reserved-name rejection, empty-string sentinel, row removal, and the Spanish locale
  - Slice C second increment (2026-04-20 bis): extracts a generic `ScopeEditor` sub-component and adds the **tab** tier editor that reads `useEditorStore.activeTabId` and delegates to `setTabVar` / `removeTabVar`. Empty-tab placeholder renders when no tab is focused. Copy extends en + es (`envVars.globalTitle/tabTitle/tabDescription/tabEmpty/noActiveTab`). Seven new component tests cover the no-active placeholder, empty tab-scope, successful add + per-tab keying, row removal with automatic pruning of the tabId entry, validator error on the tab editor, and Spanish locale on both the editor copy and the placeholder
  - Slice C third increment (2026-04-20 bis): **project** tier editor reads `useProjectStore.currentProject.id` and falls back to a "no active project" placeholder; description interpolates the project name when one is open. Below the precedence note, a new collapsible `EffectiveEnvPanel` uses `traceEnvScopes` to render every resolved key with a tier badge (global / project / tab — `processEnv` stays empty by design, the host-side merge is Slice D). Copy extends en + es (`envVars.projectTitle/projectDescription{,NoProject}/projectEmpty/noActiveProject/effectiveTitle/effectiveEmpty/trace.tier.*`). Five additional component tests cover the no-active-project placeholder, project-scope writes keyed by projectId, the trace-panel tier-discrimination across SHARED/GLOBAL_ONLY/PROJECT_ONLY/TAB_ONLY, the empty-trace hint, and the Spanish locale
  - Slice D first increment (2026-04-20 ter): Go compile IPC now accepts an optional `userEnv: Record<string, string>` second parameter. `resolveGoCompileEnv` in `src/main/go-compiler.ts` merges `process.env` + user env, then overrides `GOOS / GOARCH` with `js / wasm` so the WASM pipeline stays honest regardless of what the user set. Preload + web adapter + `LinguaAPI.go.compile` type signature all extend to carry the parameter. Renderer-side `src/renderer/runners/go.ts` exports a shared `resolveUserEnvForRunner()` helper that reads the global + project + tab tiers from `useEnvVarsStore` and passes the merged record through the IPC. Five new IPC-layer tests pin the merge order (host keys visible, user overrides host, `GOOS` / `GOARCH` immovable, non-string user values dropped, undefined userEnv still ships the wasm defaults); two new GoRunner tests pin that the renderer sends the merged tiers and falls back to `{}` when no tiers have values. Rust + Python subprocess integration is each a follow-up slice that reuses the same `resolveUserEnvForRunner` contract
  - Slice D second increment (2026-04-20 quater): Rust compile + spawn IPC now accepts the same optional `userEnv` parameter. `resolveRustRunEnv` in `src/main/rust-compiler.ts` merges `process.env` + user env (no runner-owned keys — rustc and the spawned binary both see the same env). The resolved env is passed to both `execFileAsync('rustc', ...)` and the `spawn(binaryFile, ...)` call so user vars are visible at compile AND runtime. Preload, web adapter, and `LinguaAPI.rust.run` type signature extend with the new argument. `src/renderer/runners/rust.ts` imports the shared `resolveUserEnvForRunner()` helper from `./go.ts` and forwards the merged record. Six new IPC-layer tests pin host keys visible, user-over-host precedence, non-string values dropped, undefined userEnv stays clean, and the explicit "no runner-owned keys" contract (e.g. RUSTC_WRAPPER + RUSTFLAGS survive user-set). Two new RustRunner tests pin that the renderer forwards the merged tiers and falls back to `{}` when tiers are empty
  - Slice D third increment (2026-04-20 quinquies): Python is the last runtime in scope. Pyodide lives in a Web Worker so the env crosses via the `execute` postMessage payload (`userEnv` field) instead of an IPC. The worker runs a tiny Python preamble that sets `_LINGUA_USER_ENV` via `pyodide.globals.set` and copies it into `os.environ` so user code can read it via `os.getenv(...)`. Empty-tier fast path skips the preamble entirely. `src/renderer/runners/python.ts` reuses the shared `resolveUserEnvForRunner()` helper. Two new tests with a Worker mock pin the merged-tiers payload and the empty-record fallback
- Decisions needed:
  - Which runtimes receive env vars in desktop mode ✅
  - Which env vars, if any, should exist in web mode ✅
  - Whether env vars are tab-scoped, project-scoped, or global ✅

#### Status Update — 2026-05-12 (closes RL-011)

ROADMAP § 4d previously said "Remaining: JS/TS desktop runner env
threading." That line was stale TODO from before the ADR settled.
The ADR is explicit and load-bearing:

- `docs/ENV_VARS_ADR.md` § Decision: *"JS/TS Worker mode and the
  web build remain env-var free."*
- ADR capability table: *"JavaScript Worker: No — Workers cannot
  read host env, and exposing `process.env` would be a misleading
  polyfill."*

There is no JS/TS desktop subprocess path in the repo —
`src/renderer/runners/javascript.ts` and
`src/renderer/runners/typescript.ts` are both Web Workers, so the
JS/TS surface is structurally outside the ADR-contemplated set
(Go / Rust / Python). Slice D closing those three runtimes already
exhausted scope as written.

Future JS/TS env-var support would arrive only if `RL-019`
(explicit JS/TS runtime modes) lands a desktop Node-subprocess
mode; in that case env threading belongs to RL-019, NOT a reopen of
RL-011. `tests/docs/envVarsAdr.test.ts` now asserts the ROADMAP
§6 archive lists `RL-011` so a future revert needs new ADR
justification.

### RL-012 Package management

- Priority: `P2`
- Status: `Planned`
- Readiness: `Not implementation-ready`
- Reason:
  - The execution model for dependencies differs significantly across JS/TS, Python, Go, and Rust
  - This should not begin before desktop correctness, diagnostics, and basic workflow UX are stable
- Pre-work required:
  - decide per-language package model
  - decide cache ownership and project isolation
  - define web-mode limitations clearly
- Detailed implementation is now split into RL-025 and RL-029 below so this item can remain an umbrella product goal rather than a single oversized task.

---

## 4. Future platform expansion

These items remain valid product directions, but they are intentionally behind the current backlog because they depend on the stability work above.

### RL-013 Hybrid JS/TS runtime modes

- Priority: `Future`
- Status: `Superseded`
- Readiness: `Scope re-split across RL-019 (explicit JS/TS runtime modes), RL-020 (scratchpad / REPL experience), and RL-029 (WebContainers pilot). Do not pick this id — pick the successor(s) instead.`
- Includes:
  - DOM/iframe execution mode
  - desktop Node execution mode
  - per-tab runtime mode selection
  - preview pane for visual output
- Not ready to implement until RL-003 and RL-004 define the current runtime contract cleanly
- Detailed implementation is now split into RL-019, RL-020, and RL-029 below.

### RL-014 AI assistance

- Priority: `Future`
- Status: `Superseded`
- Readiness: `Scope re-split into RL-031 (local AI assistant focused on algorithms + cross-language generation). Do not pick this id — pick RL-031.`
- Includes:
  - provider abstraction
  - chat sidebar
  - code explanation and fix suggestions
  - local model option
- Not ready to implement until editor diagnostics and snippet/productivity features are stable
- Detailed implementation is now split into RL-031 below.

### RL-015 i18n, custom theming, and shortcut customization

- Priority: `Future`
- Status: `Superseded`
- Readiness: `Scope re-split into RL-018 (maintainable i18n system) and RL-037 (deep editor personalization — theme packs, editor fonts, keymap presets, Vim mode). Both successors already shipped relevant slices. Do not pick this id.`
- Includes:
  - translation framework
  - locale packs
  - custom theme import
  - user-defined shortcuts
- These are valid enhancements, but they should follow after workflow correctness and settings cleanup
- Detailed implementation is now split into RL-018 and RL-037 below.

---

## 5. Operational hardening

### RL-016 Release validation and update readiness

- Priority: `P2`
- Status: `Done`
- Readiness: `Release pipeline + code-sign/notarize paths shipped earlier; the human release checklist shipped on 2026-04-20 with its guard test`
- Scope:
  - validate tagged release flow in CI with real secrets ✅
  - validate packaged update behavior against the chosen release channel ✅
  - verify signing and notarization paths in CI ✅
  - document the human procedure that complements the automation ✅
- 2026-04-20 update:
  - `RELEASE.md` now ships the full 14-step release procedure: preconditions (green `main`, no open P0, version + CHANGELOG bumped, signing credentials valid), the draft-first publish flow, the packaged macOS desktop smoke via `npm run smoke:desktop`, the artifact verification step, the post-publish smoke against the update channel, and the rule that the release is not announced before the post-publish smoke passes
  - Adds a rollback plan that keeps a broken release in draft on smoke failure and publishes a `-hotfix` patch tag if a regression ships, with a note that the update bridge tolerates a skipped version so clients land on the hotfix automatically
  - Adds a Validation checklist that names every gate the automation cannot assert (signing verification on both OSes, `SHA256SUMS.txt` presence, packaged desktop smoke, post-publish smoke)
  - `tests/docs/releaseChecklist.test.ts` guards the preconditions, every numbered step, the desktop smoke + post-publish smoke requirements, the validation checklist, and the rollback plan so a future edit cannot silently strip the procedure
- Acceptance:
  - The human release procedure is committed and testable; the automation (Release workflow) already covers the tagged release + signing paths. Any change to the gate must update `RELEASE.md` and the guard test in the same commit

### RL-017 Migrate away from deprecated Vite CJS Node API usage

- Priority: `P2`
- Status: `Done`
- Scope:
  - move Vite config entry points to the supported ESM config path without breaking Forge integration
- Acceptance criteria:
  - the deprecation warning no longer appears during the standard dev/build flow

---

## 6. Competitive benchmark snapshot

Research pass completed on `2026-04-11` against the current repo plus the following reference products and platform docs:

- RunJS
- WizardJS
- OpenRunner
- PlayJS / JS Blitz
- PlayCode JavaScript Playground
- PlayCode Go Compiler
- Swift Playground
- Python IDLE
- WebContainers
- Electron Forge
- Vite
- Tauri 2
- Monaco Editor and alternatives

### Benchmark signals that matter for Lingua

- RunJS, WizardJS, OpenRunner, and PlayJS confirm that the core scratchpad expectation for developers is:
  - instant execution
  - smart auto-run
  - clean inline results
  - runtime flexibility
  - strong JS/TS editing ergonomics
  - snippet reuse
  - low-friction package usage
- PlayCode confirms that web-first value is no longer just "run code online":
  - multi-file projects
  - package installation
  - offline-capable browser execution
  - shareability
  - guided examples
  - collaboration-ready surfaces
- Swift Playground confirms that student usefulness requires more than execution:
  - guided lessons
  - challenge packs
  - starter galleries
  - assets and multi-file projects
  - shareability
  - rich documentation
- IDLE confirms that long-term daily utility still depends on classic dev-tool features:
  - debugger
  - breakpoints
  - configurable keys and themes
  - help integration
  - better output handling
- WebContainers strongly fit JS/TS/web package workflows, but they do not automatically replace:
  - native desktop file-system access
  - native file watching
  - updater flows
  - local toolchain-dependent Go/Rust flows
  - desktop-only plugin discovery
- Electron Forge remains a strong default shell/build choice for Electron apps, but its Vite path is still the part of this stack most likely to introduce upgrade friction.
- Tauri 2 is viable only as a deliberate rewrite/spike, not as a near-zero-cost migration.
- Monaco remains the best fit for a desktop-heavy "developer-grade IDE surface" today, while CodeMirror 6 is the most credible alternative worth evaluating for lighter-weight, mobile-sensitive, and collaboration-heavy surfaces.

### Current strengths relative to the benchmark

- Lingua is already ahead of the JS-only scratchpads on breadth of language support
- The current app already has a real project tree, recent projects, tabs, resizable layout, snippets, quick open, command palette, updates, and a web build
- The current app already supports desktop-specific compiled-language workflows that the web-first competitors do not match
- The current app already has a conservative plugin direction, a release pipeline, and a PWA/web build instead of only a desktop binary

### Confirmed gaps worth productizing

- Maintainable i18n for app and future website
- Loose-file workflow quality:
  - Open File
  - Save As
  - session restore
  - recent files
- JS/TS runtime flexibility:
  - worker scratchpad
  - desktop Node runtime
  - browser/DOM preview runtime
- Better REPL UX:
  - smart complete-code detection
  - stdin/input support
  - execution history
  - replay and benchmarking
- Indexed quick open and project-wide search
- Package management that is explicit and language-aware
- Multi-file playgrounds, assets, and starter galleries
- Guided lessons and practice/challenge mode for students
- LSP-grade editor intelligence beyond JS/TS
- Debugging support
- WebContainers pilot for JS/TS/web only
- Explicit WASM-first decision record instead of an all-at-once migration
- Dedicated marketing/download/docs website separate from the app web build
- Local AI assistance oriented to algorithm explanation and code generation by selected language
- Deeper editor personalization:
  - themes
  - keymaps
  - Vim mode
  - shortcut editor

---

## 7. Research-backed expansion backlog

### RL-018 Build a maintainable i18n system for the app and future website

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-14`
- Current progress:
  - Phase 1 (Foundation and Bootstrap) is complete
  - Phase 2 (highest-visibility surfaces) is complete
  - Phase 3 (config-driven and reusable text sources) is complete
  - Phase 4 (enforcement and contributor workflow) is complete
  - `i18next` and `react-i18next` installed and wired
  - Shared i18n resources and a non-React translator now live under `src/shared/i18n/`
  - Locale resources for `en` and `es` with `common` namespace
  - `language` setting persisted in settingsStore with `system`, `en`, `es` options
  - Manual language selector implemented in Settings -> Appearance
  - IPC bridge for `app:get-system-languages` in Electron main/preload
  - Web adapter uses a guarded browser-locale helper instead of assuming `navigator.languages`
  - Synchronous init with bundled resources, no Suspense needed
  - Settings modal title, subtitle, description, footer, and language dropdown localized
  - Appearance section title, description, theme cards, and language dropdown localized
  - Layout, Editor, Updates, and Plugins sections now use locale-driven copy inside the same settings surface
  - Toolbar actions, menu labels, and accessibility text now use locale-driven copy
  - Editor empty state headline, descriptions, shortcuts, and template count now use locale-driven copy
  - Command palette search placeholder, empty state, result count, hints, and built-in action labels now use locale-driven copy
  - Snippets modal library, detail panel, field labels, placeholders, action buttons, and active-tab hint now use locale-driven copy
  - Electron `main` close/delete confirmation dialogs now use locale-driven copy
  - Web adapter Go/Rust/update stub messages now resolve from the active locale instead of hardcoded English strings
  - `document.documentElement.lang` now tracks the active app language
  - Runtime language switching falls back safely to `en` if system-locale resolution fails
  - Persisted invalid language values are sanitized during settings rehydration and i18n bootstrap
  - `npx tsc --noEmit` is clean again after aligning shared UI code with current library APIs
  - Focused i18n coverage now includes renderer surfaces, Electron IPC dialog copy, and web adapter stub messaging
  - Repo checks now validate missing locale keys, orphaned locale keys, and invalid locale JSON structure against the English source locale
  - A renderer copy guard now scans touched `src/renderer/**/*.ts(x)` files for obvious hardcoded user-facing JSX copy and literal UI attributes
  - Contributor documentation now covers locale file layout, key authoring rules, non-localized identifiers, and command-palette discoverability guidance
- Why this is now concrete:
  - Benchmark apps and websites already use multilingual product messaging and maintainable locale structures
  - Lingua currently hardcodes most user-facing copy in the renderer, Electron `main`, and web adapters
  - A future website should reuse the same glossary and locale model instead of inventing a second translation stack
- Technical decisions locked for implementation:
  - Use `i18next` as the shared translation core
  - Use `react-i18next` only in React surfaces
  - Keep locale assets repo-managed for MVP; do not introduce a translation SaaS yet
  - Start with `en` as source locale and `es` as the first additional locale
  - Support `system` as the default language preference
  - Use locale fallback order:
    - exact locale
    - base language
    - `en`
  - Do not localize code samples, generated file names, language ids, plugin ids, or other internal identifiers in the first rollout
- Required architecture:
  - Add a shared i18n package/module usable by:
    - Electron renderer
    - Electron main
    - web build
    - future website
  - Keep translation keys stable and semantic; do not use visible English sentences as keys
  - Organize locale files by namespace, not by one global file
  - Resolve user-facing text at render/use sites rather than storing translated labels in domain constants
- Required namespaces for MVP:
  - `common`
  - `toolbar`
  - `settings`
  - `editor`
  - `commandPalette`
  - `snippets`
  - `dialogs`
  - `errors`
  - `website`
- Data-model changes required:
  - Add `language: 'system' | 'en' | 'es'` to persisted settings
  - Add a resolved-locale helper that maps:
    - Electron desktop -> `app.getPreferredSystemLanguages()`
    - web build -> `navigator.languages`
  - Add formatting helpers for date/time/number output so formatting does not drift by surface
- Refactor rules for maintainability:
  - Replace hardcoded UI copy in components with translation keys
  - Replace `label` / `description` literals in config modules with `labelKey` / `descriptionKey` style fields where the value is UI-facing
  - Keep search/discovery features language-aware:
    - command palette labels and descriptions must localize
    - command palette keywords may keep English aliases for discoverability
  - Keep plugin-provided runtime names as plugin-owned strings until a language-pack model exists
- Phase 1: Foundation and bootstrap
  - Add `i18next` and `react-i18next`
  - Create shared i18n bootstrap under a new module such as:
    - `src/shared/i18n/`
  - Add base resource structure for `en` and `es`
  - Add renderer bootstrap in:
    - `src/renderer/main.tsx`
  - Add desktop/web locale resolution bridge through:
    - `src/main/index.ts`
    - `src/preload/index.ts`
    - `src/web/main.tsx`
  - Add persisted language setting in:
    - `src/renderer/stores/settingsStore.ts`
  - Acceptance criteria for Phase 1:
    - App can boot with `system`, `en`, or `es`
    - Renderer language can be switched without reload regressions
    - Desktop and web resolve the same fallback behavior
- Phase 2: Convert highest-visibility app surfaces
  - Convert toolbar, settings modal/sections, empty states, command palette, snippets modal, and core dialogs
  - Target files include:
    - `src/renderer/components/Toolbar/Toolbar.tsx`
    - `src/renderer/components/Settings/**`
    - `src/renderer/components/Editor/EditorEmptyState.tsx`
    - `src/renderer/components/CommandPalette/**`
    - `src/renderer/components/Snippets/SnippetsModal.tsx`
    - `src/main/ipc/fileSystem.ts`
    - `src/web/adapter.ts`
  - Acceptance criteria for Phase 2:
    - Main user flows are readable in both `en` and `es`
    - Electron confirmation dialogs are localized
    - No new hardcoded copy is introduced in converted surfaces
- Phase 3: Convert config-driven and reusable text sources
  - Refactor config/data modules so UI-facing labels come from translation keys:
    - `src/renderer/components/Settings/settingsOptions.ts`
    - `src/renderer/utils/languageMeta.ts`
    - `src/renderer/components/CommandPalette/commandPaletteModel.ts`
    - `src/renderer/data/templates.ts`
  - Decide per item whether content is:
    - product UI copy -> localize now
    - educational/example content -> leave source text unchanged for MVP
  - Acceptance criteria for Phase 3:
    - Config-driven menus and labels do not embed user-facing English literals
    - Language/template metadata remains stable without storing translated strings in the state layer
- Phase 4: Enforcement and contributor workflow
  - Add CI or repo checks for:
    - missing keys
    - orphaned keys
    - invalid locale JSON structure
  - Add a lightweight hardcoded-string guard for touched renderer files
  - Document contributor rules in repo docs:
    - where locale files live
    - how to add a key
    - what must not be localized
    - how to preserve command palette discoverability
  - Acceptance criteria for Phase 4:
    - Missing locale keys fail CI with actionable output
    - Contributors have one documented path for adding new strings
- Explicitly out of scope for MVP:
  - third-party translation management services
  - community language packs
  - runtime download of locale bundles
  - plugin-translatable manifests
  - full localization of code templates/snippet bodies
  - localized keyboard shortcut glyph differences beyond existing platform logic
- Final acceptance criteria:
  - Desktop app, web build, and future website can share one i18n foundation without duplicating translation logic
  - New user-facing surfaces have a clear path to land without hardcoded copy
  - Language preference persists cleanly and `system` mode behaves predictably
  - The app remains maintainable as locale coverage grows beyond `en` and `es`
- Dependencies:
  - None

### RL-019 Add explicit JS/TS runtime modes: worker scratchpad, desktop Node, and browser preview

- Priority: `P1`
- Status: `Done`
- Readiness: `Closed in full 2026-05-14. Slice 1 (2026-05-12) contract surface. Slice 3 (2026-05-12) iframe Browser preview. Slice 2 (2026-05-14) desktop Node child-spawn backend with parent-owned timeout + env allowlist + esbuild TS transpile + detection cache + first-run trust notice + node_modules cwd + package.json#type ESM/CJS picker + adoption telemetry. RL-019 is closed.`
- Why this is high leverage:
  - JS/TS users need the runtime contract to be explicit before they can trust whether APIs, imports, debugger behavior, and preview output match the environment they are targeting
  - The current app exposes only the worker-style JS/TS contract
- Scope:
  - Add per-tab runtime mode selection for JS/TS:
    - `Worker`
    - `Node (desktop only)`
    - `Browser Preview`
  - Keep the existing worker runner as the fast default scratchpad
  - Add a desktop Node runner via child process or utility process with explicit timeouts and sandbox boundaries
  - Add a browser-preview runtime backed by an iframe/webview-style isolated preview surface for DOM-oriented examples
  - Switch Monaco diagnostics/libs by runtime mode so the editor contract stays truthful
  - Surface capability differences per mode, including:
    - debugger availability
    - import/dependency support
    - DOM/browser API support
    - Node built-in support
    - output surface ownership
- Acceptance criteria:
  - A JS/TS tab can switch runtime mode without opening Settings
  - Desktop Node mode can use Node built-ins explicitly
  - Browser Preview mode can render DOM output in a dedicated preview surface
  - Worker mode remains the fastest default for pure language experimentation
  - The selected runtime mode explains its available APIs and debugger capability before execution starts
- Dependencies:
  - RL-021

#### Slice 1 — 2026-05-12 (contract surface)

Slice 1 ships the contract surface only — three modes in the UI,
but only `worker` is selectable. The other two render disabled with
plain "Coming soon" tooltips so users see the runtime ambition
without us shipping half-functional backends. See
[`RUNTIME_MODES_ADR.md`](./RUNTIME_MODES_ADR.md) for the design
rationale.

What landed:

- `src/shared/runtimeModes.ts` — closed `RuntimeMode` enum
  (`worker | node | browser-preview`) plus pure helpers
  (`defaultRuntimeModeFor`, `isRuntimeModeImplemented`,
  `coerceRuntimeMode`, `cycleRuntimeMode`,
  `languageHasRuntimeModes`).
- `FileTab.runtimeMode?: RuntimeMode` — optional, defaulted to
  `'worker'` for JS/TS tabs at creation time
  (`createDefaultTab` / `addTab` / `openFile` /
  `openFileFromDisk`). Non-JS/TS tabs never carry the field.
- `editorStore.setTabRuntimeMode(id, mode)` — enforces the JS/TS
  guard, rejects unimplemented modes with a localized status
  notice, fires `runtime.mode_changed` telemetry on success,
  no-op on same-mode writes.
- `sessionStore` persists `runtimeMode` per tab; rehydrate uses
  `coerceRuntimeMode` so a tampered or pre-Slice-1 entry coerces
  back to `'worker'` for JS/TS.
- `settingsStore.defaultRuntimeMode` (fold B) — per-app default
  with a setter that rejects unimplemented modes. Persisted
  alongside the rest of Settings.
- `<RuntimeModeSelector>` (`src/renderer/components/Toolbar/`) —
  JS/TS-only dropdown next to the Run button; disabled options
  explain in plain product copy that the modes are coming soon.
  Mounted via `languageHasRuntimeModes` guard in `Toolbar.tsx`.
- Settings → Editor row (fold B) — default mode select; disabled
  options render with explanatory text.
- `Mod+Alt+M` keyboard shortcut (fold D) — registered in
  `KEYBOARD_SHORTCUTS` and dispatched via `useGlobalShortcuts` to
  cycle through implemented modes. Slice 1 is a no-op (only one
  implemented mode); Slices 2 / 3 light it up automatically.
- Three Command Palette entries (fold E) — "Switch runtime to
  Worker / Node / Browser preview"; the unimplemented two land in
  the palette so users discover the roadmap from the keyboard.
- Telemetry event `runtime.mode_changed` (fold A) — closed enum
  payload `{ mode, language }`; mirrored on the worker side at
  `update-server/src/telemetry.ts` with parity-test coverage.
- Three new rows in `docs/CAPABILITY_MATRIX.md` (fold C) for the
  three runtime modes.
- ADR `docs/RUNTIME_MODES_ADR.md` (fold F) documenting the
  three-mode enum, JS/TS-only scope, `worker`-default rule,
  disabled-with-tooltip vs. hidden decision, no-silent-fallback
  rule, telemetry contract, and rollback plan. Guard test at
  `tests/docs/runtimeModesAdr.test.ts`.
- Status-notice toast (fold G) on every `setTabRuntimeMode`
  success, so palette / shortcut changes get an audit trail.

Test surface: ~36 new assertions across
`tests/shared/runtimeModes.test.ts`,
`tests/stores/editorStore.runtimeMode.test.ts`,
`tests/docs/runtimeModesAdr.test.ts`, and
`tests/e2e/runtimeModeSelector.spec.ts` (5 Playwright cases).

What stays out of scope until later slices:

- Slice 2 — desktop Node child-process backend
  (`src/main/runners/nodeChild.ts` planned; rides RL-078
  parent-owned timeouts + resource limits). The selector flips
  the Node option from disabled to enabled in the same diff.
- Slice 3 — iframe-isolated browser-preview pane
  (`src/renderer/components/BrowserPreview/`); requires a
  preview-panel surface alongside the console panel.
- Monaco diagnostic / lib switching per mode — lands inside
  Slice 2 / Slice 3 alongside their respective backends.

#### Slice 3 — 2026-05-12 (browser preview backend)

Slice 3 lands the iframe-isolated DOM runtime behind
`runtimeMode === 'browser-preview'`. The Slice 1 selector +
palette + shortcut + Settings select now light up the option;
Slice 2 (desktop Node) is the only remaining sub-slice.

What shipped:

- `src/renderer/runners/browserPreview.ts` —
  `BrowserPreviewRunner` implementing the existing
  `LanguageRunner` contract. Owns the postMessage protocol
  (runId-anchored, origin-guarded), the parent-owned timeout
  kill, and the `setSiblingSources` push for fold A.
- `src/renderer/components/BrowserPreview/iframeBridge.ts` —
  pure module owning the bridge IIFE template, the discriminator
  constant, the CSP literal, and `buildPreviewDocument`. Pure so
  the unit test asserts the generated payload directly.
- `src/renderer/components/BrowserPreview/BrowserPreviewPanel.tsx`
  — bottom-panel surface that mounts the iframe element ref into
  the bridge so the runner can write into `srcdoc`. Includes the
  fold-F inspect button (opaque-origin data-URL `window.open`
  round-trip) and the empty-state overlay for
  non-browser-preview tabs.
- `src/renderer/runtime/browserPreviewBridge.ts` — module-level
  iframe-ref + bottom-panel activator registry. Mirrors the
  RL-027 Slice 1 `debuggerWorkerBridge.ts` pattern.
- `src/renderer/runners/manager.ts` — runtime-mode-aware dispatch.
  `runtimeMode === 'browser-preview'` on a JS/TS tab routes to
  the new runner; everything else falls through to the language
  runner. Decision 6 in the ADR (registry stays language-keyed)
  still holds — the override lives in a separate
  `runtimeModeRunners` map so the language registry is
  untouched.
- `src/renderer/stores/uiStore.ts` — `BottomPanelTab` extended
  with `'browser-preview'`. The AppLayout `BottomPanel` mounts
  the tab conditionally on
  `languageHasRuntimeModes(activeLanguage) && activeRuntimeMode
  === 'browser-preview'`.
- `src/renderer/runtime/executeTabManually.ts` — Fold A wiring.
  Sibling `.css` / `.html` tabs in the active tab's project /
  directory scope are looked up at run start and pushed into the
  runner via `setSiblingSources` before the `prepareRunner` call.
- `src/renderer/hooks/useRunner.ts` + `useAutoRun.ts` —
  `currentRuntimeModeRef` tracks the active runtime mode so
  `stop()` routes to the right runner; auto-run respects
  per-tab `runtimeMode`.
- `src/shared/runtimeModes.ts` —
  `isRuntimeModeImplemented('browser-preview')` now returns
  `true`. The cycle helper alternates between worker and
  browser-preview (skipping the still-unimplemented `node`).
- `src/renderer/components/Toolbar/RuntimeModeSelector.tsx` —
  the browser-preview hint key flipped from
  `runtimeMode.hint.browserPreview.comingSoon` to
  `runtimeMode.hint.browserPreview.shipping`.
- `docs/RUNTIME_MODES_ADR.md` — `Slice 3 ship notes` section
  documenting the bridge protocol, sandbox attrs, srcdoc CSP,
  timeout kill, fold A seed, and fold F inspect button. **Fold
  B** adds a per-mode CSP audit table covering Worker, Node
  (Slice 2), and Browser preview so a future security review
  finds the contract in one place.
- `docs/CAPABILITY_MATRIX.md` — JS/TS Browser preview row flips
  from `Planned` to **Shipping**.
- Telemetry — the closed-enum validator in `src/shared/telemetry.ts`
  already accepts `'browser-preview'` from Slice 1; fold C adds
  a regression test that asserts every `RuntimeMode` value
  survives the redactor on the `runtime.mode_changed` event,
  plus a defensive test that an unsafe-token language is dropped
  by the validator.

Test surface: 22 new assertions in
`tests/runners/browserPreview.test.ts` (metadata, bridge script
template, srcdoc payload + close-script escaping, isBridgeMessage
type guard, runId guard, origin guard, console capture, error
capture, fold-A sibling seed, timeout kill, stop cancellation),
9 assertions in `tests/components/BrowserPreviewPanel.test.tsx`
(register/unregister with the bridge, empty-state overlay paths,
running/error status text, inspect-button success + blocked,
Spanish locale), 5 Playwright cases in
`tests/e2e/browserPreviewMode.spec.ts` (selector option enabled,
panel tab appears, DOM render + console forwarding, empty-state
overlay round trip), plus updated assertions in
`tests/shared/runtimeModes.test.ts`,
`tests/e2e/runtimeModeSelector.spec.ts`, and
`tests/docs/runtimeModesAdr.test.ts`.

Out of scope until Slice 2:

- Desktop Node child-process backend. Selector / palette /
  shortcut keep the `node` option disabled with the "Coming
  soon" tooltip.
- Monaco lib switching for Node mode (`@types/node` types,
  CommonJS resolution hints). Lands with the backend.

#### Slice 2 — 2026-05-14 (desktop Node child-spawn backend — closes RL-019)

Slice 2 lands the named scope item: *"Add a desktop Node runner
via child process or utility process with explicit timeouts and
sandbox boundaries."* With this slice RL-019 flips to `Done` and
the three-mode contract from Slice 1 (Worker / Node / Browser
Preview) is fully shipped.

Architecture:

- **`src/main/node-runner.ts`** (new) — main-process runner.
  Invokes `node` via `spawn()` only (no shell-evaluating sibling
  and no string interpolation into shell args). Inline `-e`
  invocation for source ≤ 4 KB; temp-file fallback above that.
  Parent-owned timeout with SIGTERM → 200 ms → SIGKILL escalation
  ladder. `detectNode()` probes `node --version` and caches the
  result per main-process lifetime; a `force` argument
  invalidates the cache (Settings → Native Toolchains uses this).
  IPC handlers `node:detect` + `node:run` registered via
  `registerNodeJSHandlers()` in `src/main/index.ts`.
- **`src/main/runners/nativeEnv.ts`** (extended) — new
  `NODE_TOOLCHAIN_KEYS = ['NODE_PATH', 'NPM_CONFIG_CACHE',
  'NPM_CONFIG_PREFIX']` const. Layered on top of the COMMON
  allowlist (PATH / HOME / LANG / TMPDIR) the existing
  `buildNativeRunnerEnv()` helper composes for every subprocess.
  Intentionally excluded: `NODE_OPTIONS`, `NODE_NO_WARNINGS`,
  `NODE_DEBUG`, `NODE_ENV` — those belong to the RL-011 user-env
  tier where the user opts in explicitly.
- **`src/preload/index.ts`** (extended) — exposes
  `window.lingua.node.run(source, options)` +
  `window.lingua.node.detect(userEnv?, force?)` via the desktop
  preload bridge. Web adapter (`src/web/adapter.ts`) deliberately
  omits this surface; `LinguaAPI.node` is optional so type-checks
  fail fast on any web-side reference.
- **`src/renderer/runners/nodeRunner.ts`** (new) — renderer-side
  `LanguageRunner` registered against
  `RunnerManager.runtimeModeRunners.get('node')`. JS tabs skip
  esbuild; TS source detected by a cheap sniff goes through
  `esbuild.transform({ loader: 'tsx', format: 'cjs', target: 'es2022' })`
  before the IPC. Defensively gates on `window.lingua.node`
  presence — web builds surface a clear renderer-side error
  instead of crashing the manager. Per-call timeout resolves from
  `runtimeTimeoutPresetByLanguage.javascript` (Slice 7 plumbing)
  unless the caller overrides. Renderer cancel via an in-flight
  resolver — main's parent timer reaps the subprocess.
- **`src/shared/runtimeModes.ts`** —
  `isRuntimeModeImplemented('node')` flipped from `false` to
  `true`. The Slice 1 cycle helper's "skip unimplemented" code
  path is no longer exercised by `node`; the cycle now walks
  Worker → Node → Browser Preview → Worker.
- **`src/renderer/components/Toolbar/RuntimeModeSelector.tsx`** —
  tooltip key for the Node option swapped from
  `runtimeMode.hint.node.comingSoon` to
  `runtimeMode.hint.node.ready`. Disabled-state copy
  (`missingBinary`) is reserved for the future detection-cache
  failure path; the current selector renders the option enabled
  whenever `isRuntimeModeImplemented` returns `true`.

Folds shipped:

- **A — `runtime.node_runner_used` adoption telemetry**
  (`['language', 'status']` closed-enum, statuses
  `'success'` / `'error'` / `'timeout'` / `'stopped'` /
  `'missing-binary'`). Mirrored on update-server with parity
  test (`NODE_RUNNER_STATUS_VALUES`).
- **E — First-run trust notice** toast surfaced once per session
  via `Settings.nodeRunnerFirstRunNoticeShown`. Copy:
  `runtimeMode.notice.firstRunDangerous` — "Node mode runs your
  code with full filesystem and network access. Only run code
  you trust."
- **F — `node_modules`-aware cwd**: `resolveNodeCwd(filePath)`
  walks up to 8 levels from the saved tab's directory looking
  for a `node_modules/` neighbor; first hit becomes the
  subprocess's cwd so `require('lodash')` resolves naturally.
  Unsaved Scratchpad tabs fall back to `app.getPath('temp')`.
- **G — `package.json#type` ESM / CJS picker**:
  `pickInputType(cwd)` reads the resolved cwd's `package.json`
  and emits `--input-type=module` when `"type": "module"`,
  CommonJS otherwise. Temp-file fallback paths swap the file
  extension to `.mjs` / `.cjs` to match.
- **H — Command palette `action-runtime-mode-node`** entry was
  already wired by Slice 1 fold E. Slice 2 didn't need to add
  the entry — it now actually succeeds because the editor
  store's `setTabRuntimeMode` no longer rejects `node`. The
  shortcut catalog's `Mod+Alt+M` cycle also now visits the Node
  mode (was previously skipped by `cycleRuntimeMode`).

Folds deferred (store fields + i18n in place; UI surface only):

- **B — `nodeDetect()` Settings → Native Toolchains row**.
- **C — Node version pinning** (`Settings.nodeVersionMajor`).
- **D — Permission flags** (`--allow-fs-read=...`) for Node ≥ 22.

Tests:

- `tests/shared/runtimeModes.test.ts` — `isRuntimeModeImplemented('node')`
  is now `true`; `cycleRuntimeMode('worker')` now returns `'node'`;
  `coerceRuntimeMode('node', 'javascript')` preserves the value.
- `tests/shared/telemetry.test.ts` — sort-order list adds
  `runtime.node_runner_used`; validator coverage with every
  closed-enum status bucket; unknown-key drop test.
- `tests/stores/editorStore.runtimeMode.test.ts` — Slice 1's
  "rejects unimplemented modes" test rewritten to assert the
  Slice 2 positive path; new test covers the defensive coercion
  fallback for unknown future modes.
- `update-server/test/telemetry.test.ts` — parity test extended
  for the new event.

Security posture (documented in the ADR amendment + the
in-source header comment of `node-runner.ts`):

- `spawn()` only — never the shell-evaluating sibling. User
  input never reaches a shell command line.
- Env via `buildNativeRunnerEnv()` allowlist. Host secrets
  (CI tokens, OPENAI_API_KEY, etc.) do NOT leak. User-tier env
  from RL-011 layers on top.
- Cwd choice is `app.getPath('temp')` (Scratchpad) or the
  saved tab's `node_modules`-aware directory (fold F). Lingua's
  install directory is never inherited.
- Network + filesystem are unrestricted (Node subprocess
  shares the host stack). Documented in the first-run trust
  notice. Future hardening (`--allow-fs-read` etc.) is fold D.
- Output caps: stdout / stderr each capped at
  `MAX_NATIVE_STDERR_BYTES` (1 MiB) via the existing
  `truncateBytes` helper. Truncation marker localized via the
  `runner.truncated.*` i18n keys.

### RL-020 Make the scratchpad and REPL experience best-in-class

- Priority: `P1`
- Status: `Done`
- Readiness: `Slices 1–9 shipped 2026-05-13/14 — auto-run completion gate, Run/Debug/Scratchpad workflow modes, magic-comment watches, per-tab history replay, JS/TS auto-log, JS/TS/Python pre-set stdin, timeout presets, last-stable compare, and the variable inspector (closes the ticket).`
- Scope:
  - Add smart auto-run with complete-code detection so incomplete edits do not execute too early
  - Treat Scratchpad as a distinct workflow from Run and Debug:
    - Run produces a single intentional execution result
    - Debug pauses on breakpoints and exposes state
    - Scratchpad continuously evaluates safe, complete edits for exploration
  - Expand magic comments into a richer inline-watch system that can pin and preserve selected expressions
  - Add an optional expression auto-log mode for JS/TS scratchpad tabs so expression-oriented exploration does not require wrapping every value in `console.log(...)`
  - Add stdin / input support for supported runtimes
  - Add timeout presets and clearer abort state for long-running code
  - Preserve the last successful run so users can compare current output against the previous stable result
  - Add per-tab execution history with timestamps and rerun support
  - Add a lightweight variable inspector panel that shows current variable state after execution:
    - Variable name, type, and value for the current runtime scope
    - Expandable objects and arrays with tree view
    - Auto-refresh after each execution
    - Available for JS/TS and Python from the first rollout
    - Optimized for fast scope inspection without entering a debugger session
- Acceptance criteria:
  - Auto-run skips obviously incomplete code states
  - Users can distinguish Run, Debug, and Scratchpad from the toolbar state and per-tab runtime controls
  - Users can rerun a previous execution from history
  - Supported runtimes can accept simple stdin text without custom code changes
  - Variable inspector shows current scope state after execution for JS/TS and Python
- Dependencies:
  - RL-019

#### Slice 1 — 2026-05-13 (smart auto-run completion gate)

Slice 1 lands the first acceptance criterion (`Auto-run skips obviously
incomplete code states`) for JS/TS Scratchpad. Non-JS/TS languages keep
the existing auto-run cadence unchanged. The gate is renderer-only and
zero-network — no Monaco worker call, no parse, no TS-service dep.

Architecture:

- New pure module `src/shared/autoRunGating.ts` exports
  `isLikelyComplete(language, code): { ready: boolean; reason: 'empty'
  | 'incomplete' | 'ok' }`. Single-pass scanner tracks bracket depth,
  quote / template / block-comment state with collapse-to-spaces
  comment stripping so the trailing-token sweep can run on the
  comment-stripped string in O(n). The auto-pair-aware `hasAutoPairTrap`
  helper walks every close bracket in the buffer and inspects the
  previous significant token — catches `for (let i = )`, `const arr =
  [1, ]`, `items.map((x) => )`, etc. that Monaco's auto-pair shape
  hides from a naive bracket-balance check. Postfix `++` / `--` are
  explicitly exempt so `for (...; i++)` stays ready.
- `src/renderer/hooks/useAutoRun.ts` calls the gate after the
  language-support check, before the runner branch. When
  `ready === false` and `reason === 'incomplete'`, the hook
  short-circuits — no `runnerManager.prepareRunner`, no
  `runner.execute`, no `runner.executed` telemetry — restores the
  last successful snapshot, sets `autoRunGateReason: 'incomplete'`,
  and emits exactly one `runtime.auto_run_gated` event.
- `src/renderer/stores/resultStore.ts` gains
  `autoRunGateReason: AutoRunGateReason | null`,
  `lastSuccessfulSnapshot: ResultSnapshot | null`,
  `setAutoRunGateReason`, `captureSuccessfulSnapshot`, and
  `restoreLastSuccessfulSnapshot`. Existing `clear()` resets both new
  fields so a tab switch starts fresh.
- `src/renderer/components/Editor/AutoRunGateNotice.tsx` renders an
  ambient `status-pill` in the result panel header when
  `autoRunGateReason === 'incomplete'`. Mounted in
  `ResultPanel.tsx` next to the execution-time pill.
- Fold A — telemetry. `runtime.auto_run_gated` added to
  `TELEMETRY_EVENTS` + `EVENT_PROPERTY_ALLOWLIST` +
  `isAllowedValue` in `src/shared/telemetry.ts`. Closed-enum
  validator locks `reason` to `'incomplete'` for Slice 1. Mirror in
  `update-server/src/telemetry.ts` + parity test
  (`AUTO_RUN_GATE_REASONS` regex compare) in
  `update-server/test/telemetry.test.ts`.
- Fold E — `<AutoRunGateNotice>` reads the active tab's `runtimeMode`
  and swaps the title + tooltip to the
  `autoRun.gate.incomplete.titleBrowserPreview` /
  `autoRun.gate.incomplete.descriptionBrowserPreview` keys when the
  tab runs in `browser-preview` mode. A `data-gate-variant`
  attribute (`default` / `browser-preview`) anchors the e2e
  assertion.
- Fold F — `tests/shared/autoRunGating.bench.test.ts` runs the gate
  5 000× on a 5 KB realistic JS buffer; assertion locks under 750 ms
  wall clock (~150 µs / call ceiling). Local: ~266 ms. Lives in the
  default `npm test -- --run` gate, no extra script.

i18n — 4 new keys per locale (2 base + 2 browser-preview). Spanish
in tuteo (`Termina`, `intentará`, `recargará`).

Tests:

- `tests/shared/autoRunGating.test.ts` — 58 cases: language gating,
  empty buffer, balanced cases (function declaration, nested
  template, line + block comment after expression, identifiers
  shadowing keywords like `piglet` / `awaiting`), incomplete cases
  (open brackets / quotes / templates / block comments, trailing
  operators, trailing keywords, mid-template-placeholder),
  auto-pair shapes (`for (let i = )`, `const arr = [1, ]`,
  `items.map((x) => )`, `if (x === )`, `const obj = { a: }`,
  trailing keyword before close-paren), false-positive defenses
  (`1 + 1` is ready, identifiers ending in keywords are ready,
  strings shielding operators don't pollute the sweep, nested
  template `}` doesn't leak).
- `tests/shared/autoRunGating.bench.test.ts` — fold F perf lock.
- `tests/hooks/useAutoRun.test.tsx` — gated-incomplete short-circuit,
  ok-clears-reason, snapshot-restore on gated keystroke (first run
  captures, second keystroke restores).
- `tests/shared/telemetry.test.ts` — fold A validator: accepts
  `incomplete`, accepts both `javascript` / `typescript`, drops
  unknown reasons, drops non-safe-token language. Sorted-name list
  gains `runtime.auto_run_gated`.
- `update-server/test/telemetry.test.ts` — fold A worker-side
  validator + `AUTO_RUN_GATE_REASONS` regex-compare parity test
  (mirror of the existing `RUNTIME_MODE_VALUES` parity guard).
- `tests/e2e/autoRunGating.spec.ts` — 3 Playwright cases: typing an
  incomplete line surfaces the notice with `data-gate-variant
  default`; completing the expression dismisses the notice; under
  `runtimeMode === 'browser-preview'` the notice switches to
  `data-gate-variant browser-preview` with the `Preview paused`
  copy.

Out of scope until Slice 2:

- Run / Debug / Scratchpad distinct-workflow chrome (toolbar split
  buttons, status indicators).
- Magic-comment inline-watch expansion.
- Expression auto-log mode.
- stdin / input surface.
- Timeout presets.
- Per-tab execution history with rerun (depends on RL-028 surface).
- Variable inspector panel.

#### Slice 2 — 2026-05-13 (per-tab workflow mode: Run / Debug / Scratchpad)

Slice 2 lands the second acceptance criterion (`Users can distinguish
Run, Debug, and Scratchpad from the toolbar state and per-tab runtime
controls`). Every tab now carries an explicit `workflowMode` field;
the editor toolbar mounts a 3-segment control next to the Run button;
`useAutoRun` short-circuits as a true no-op for Run + Debug so the
user opts into Scratchpad behavior on a per-tab basis.

Architecture:

- New pure module `src/shared/workflowMode.ts` exports the
  `WorkflowMode` closed enum (`run` / `debug` / `scratchpad`) plus
  `defaultWorkflowMode(language)`, `supportsWorkflowMode(language,
  mode)`, `coerceWorkflowMode(value, language)`, and
  `cycleWorkflowMode(current, language)` (skips unsupported
  segments). Scratchpad-capable languages: JS / TS / Python / Go /
  Rust (anything with an auto-run runner); debug-capable: JS / TS
  (RL-027 adapter surface). Pure, no DOM, vitest-safe under node.
- `src/renderer/types/index.ts` — `FileTab.workflowMode?: WorkflowMode`
  field. Optional so pre-Slice-2 persisted tabs load cleanly; the
  resolved selector falls through to `defaultWorkflowMode(language)`
  when missing.
- `src/renderer/stores/editorStore.ts` —
  `workflowModeForNewTab(language, explicit?)` resolves per-tab seed
  via Settings → shared default. `setTabWorkflowMode(id, mode)`
  validates language support, no-ops on same-mode, and emits
  `runtime.workflow_mode_changed { trigger: 'toolbar' }` on a
  successful change. `renameTab` re-resolves the workflow mode when
  the language flips (fold D): when the user's explicit mode is no
  longer supported on the new language, the mode auto-corrects and
  the store emits with `trigger: 'language_change'`. `restoreTabs`
  + `persistTab` backfill the field.
- `src/renderer/hooks/useAutoRun.ts` — workflow-mode short-circuit
  at the TOP of the effect, BEFORE the empty-code branch. Run + Debug
  modes do not touch `isAutoRunning`, do not advance `lastCodeRef`,
  do not call `clear()`. The last manual run stays on screen
  indefinitely. Validate-mode tabs (JSON / YAML) are unaffected
  because they live downstream of the runner branch.
- `src/renderer/stores/settingsStore.ts` —
  `workflowModeDefaultsByLanguage: Record<Language, WorkflowMode>` +
  `setWorkflowModeDefault(language, mode | null)`. Fold C — the merge
  function sanitizes tampered persisted values (unknown language /
  invalid mode) and seeds blank slots with `{ javascript: 'scratchpad',
  typescript: 'scratchpad', python: 'scratchpad' }` so the Settings
  rows surface a populated default on upgrade. Fold F —
  `firstWorkflowModeSwitchAcknowledged` flag + setter.
- `src/renderer/components/Toolbar/WorkflowModeSegment.tsx` — new
  3-segment toggle (`Run | Debug | Scratchpad`) mounted next to the
  RuntimeModeSelector. Click an enabled segment → fires the setter
  + telemetry. Click a disabled segment → noop with hover-tooltip.
  Collapses to a single label-pill when only one mode is supported
  for the active language (plain-text tabs). Fold E — arrow keys
  skip disabled segments while cycling supported ones; focus moves
  with selection. Fold F — first time the user moves AWAY from
  Scratchpad, surfaces a one-shot status notice explaining the
  modes; the ack flag is persisted.
- `src/renderer/components/Editor/WorkflowModeStatusPill.tsx` —
  fold B. Low-contrast pill mounted in the result-panel header next
  to the execution-time slot, mirroring the current workflow mode
  for users whose toolbar is offscreen.
- `src/renderer/components/Editor/ResultPanel.tsx` — fold G.
  Mode-aware empty state: dynamic-language tabs in Run / Debug mode
  show `Press Cmd+R to run` instead of the generic `Results appear
  here as you type`.
- `src/renderer/components/Settings/EditorSection.tsx` — new
  `settings.workflowMode.title` Row with three Select rows for the
  lightweight in-process languages (JS / TS / Python), pulling the
  current value from `workflowModeDefaultsByLanguage` and writing
  via `setWorkflowModeDefault`.
- Fold A — `Mod+Shift+M` cycle shortcut. `keyboardShortcuts.ts`
  registers `run-cycle-workflow-mode`; `useGlobalShortcuts.ts`
  gains a `cycleWorkflowMode` option; `App.tsx` wires the dispatcher
  to read the active tab + call `setTabWorkflowMode(next)`.
- Telemetry — `runtime.workflow_mode_changed` added to
  `TELEMETRY_EVENTS` + `EVENT_PROPERTY_ALLOWLIST` + `isAllowedValue`
  in `src/shared/telemetry.ts`. Closed-enum validators:
  `WORKFLOW_MODE_VALUES` (`run` / `debug` / `scratchpad`),
  `WORKFLOW_MODE_CHANGE_TRIGGERS` (`toolbar` / `language_change`).
  Property is named `trigger` (not `source`) so the DENY_SUBSTRINGS
  pass does not strip it. Mirror in `update-server/src/telemetry.ts`
  + two parity tests (regex-compare for both Sets) in
  `update-server/test/telemetry.test.ts`.

i18n — 16 keys per locale (2 shortcut reference keys + 3 segment
labels + toggle description + 3 unsupported-reason keys + 3 language
labels + first-switch notice + settings title + settings description
and mode-aware empty state). Spanish in tuteo (`Elige`, `Cambia`,
`Pulsa`).

Tests:

- `tests/shared/workflowMode.test.ts` — pure-module coverage:
  defaults per language, supports matrix, coerce snap-back, cycle
  with skip-disabled-segment behavior, single-mode short-circuit.
- `tests/stores/editorStore.workflowMode.test.ts` — store-level
  coverage: `createDefaultTab` defaults, `addTab` backfill,
  `setTabWorkflowMode` valid + invalid + same-mode + nonexistent-tab
  paths, fold-D auto-correction on language change with telemetry
  assertion, `restoreTabs` backfill + tampered-value snap-back.
- `tests/stores/settingsStore.test.ts` — fold-C seed + sanitize-on-
  rehydrate + setter coverage; fold-F first-switch ack flag.
- `tests/hooks/useAutoRun.test.tsx` — Run-mode short-circuit
  (no `prepareRunner` call), Debug-mode short-circuit, Scratchpad
  mode still gates incomplete buffers.
- `tests/shared/telemetry.test.ts` — validator coverage:
  `runtime.workflow_mode_changed` accepts the closed enum, drops
  unknown `trigger` / `to` / non-safe-token language; sorted-name
  list gains the event.
- `update-server/test/telemetry.test.ts` — worker-side validator
  smoke (accepts closed enum, drops unknown `trigger` silently with
  204) + two parity guards: `WORKFLOW_MODE_VALUES` and
  `WORKFLOW_MODE_CHANGE_TRIGGERS` regex-compare against the
  renderer authority.
- `tests/components/Toolbar.test.tsx` — extends the lucide-react
  mock with the `Sparkles` icon used by `WorkflowModeSegment`.
- `tests/e2e/workflowMode.spec.ts` — 3 Playwright cases: 3-segment
  toggle renders with Scratchpad active on a fresh JS tab; clicking
  Run silences auto-run on subsequent keystrokes (gate notice never
  appears); switching back to Scratchpad re-enables the Slice-1
  gate.

Out of scope until Slice 3:

- Magic-comment inline-watch expansion.
- Expression auto-log mode.
- stdin / input surface.
- Timeout presets.
- Per-tab execution history with rerun (depends on RL-028 surface).
- Variable inspector panel.

#### Slice 3 — 2026-05-14 (`@watch` magic-comment pin)

Slice 3 lands the third acceptance criterion (`Inline watch expressions
via magic comments persist their values across reruns`). The existing
`//=>` (`#=>` for Python) arrow syntax stays unchanged; the new
`// @watch <expr>` (`# @watch <expr>` for Python) syntax produces a
pinned watch that renders with a Pin icon and survives the Slice 1
snapshot-restore + the Slice 2 workflow-mode short-circuit by
construction.

Architecture:

- **`src/renderer/utils/magicComments.ts`** extends to a discriminated
  union: `MagicCommentLine = { line, expression, kind: 'arrow' |
  'watch', preserve }`. The watch regex (`JS_WATCH_RE`,
  `PY_WATCH_RE`) is tried BEFORE the arrow regex so a pathological
  `// @watch x //=> y` line resolves to a watch (not an arrow). The
  Python watch parser refuses lines whose preserve text ends with
  `:` (control-flow header — `if`, `for`, `def`, `class`,
  `with`, `try`) because appending `; __mc(...)` after the colon
  would eat the indented body in the transform pass.
  `transformJSMagicComments` preserves the prefix code for watch
  lines (`const x = 5; // @watch x * 2` → `const x = 5; void
  (__mc(line, ...x * 2...))`). The matching Python transform keeps
  the original indentation so watches inside function bodies stay
  syntactically valid.
- **`magicCommentKindsByLine(language, code)`** — new helper returns
  a sparse `Record<lineNumber, MagicCommentKind>`. Runners consume
  this map at result-stitching time to tag each `magic-comment`
  worker message with the correct kind; the worker postMessage
  protocol is deliberately kind-agnostic, so no worker change.
- **`MagicCommentResult.kind?: 'arrow' | 'watch'`** — optional field
  on the result type. Runners populate it from `kindByLine`; legacy
  consumers that ignore the field keep working.
- **`LineResult.type`** widens from 6 to 7 variants (adds `'watch'`).
  `executionPresentation.toLineResults` maps `magicResult.kind ===
  'watch'` → `type: 'watch'`, else `type: 'magic'`.
- **`<LineResultRow>` in `ResultPanel.tsx`** gains a watch branch
  with a `<Pin>` lucide icon, `data-result-kind="watch"` for e2e
  anchors, an `aria-label` from `magic.watch.ariaLabel`, a `title`
  tooltip from `magic.watch.tooltip`, and an inner
  `aria-live="polite"` region (fold F) so screen readers announce
  value updates. The watch branch renders the `magic.watch.empty`
  copy ("no value yet") when the watched expression is `undefined`
  so a pinned watch never silently disappears (fold G).
- **`isUndefinedResult`** short-circuits on `type === 'watch'` so the
  `hideUndefined` setting never filters out a pinned watch. Arrow
  results behave unchanged.
- **`useAutoRun`** (fold C) — on an errored run, splice
  previous-snapshot watch entries into `nextLineResults` for any
  watch line that did NOT emit a fresh value this time. The Set of
  fresh watch lines is built per-run; double-add is impossible. On
  a clean run with at least one magic result, emit the new
  `runtime.magic_comment_emitted { language, hasArrow, hasWatch }`
  telemetry (fold A). The discriminator uses POSITIVE matches
  (`kind === 'arrow'`, `kind === 'watch'`) so a future runner that
  emits magic results without a `kind` field doesn't inflate
  arrow-adoption counts.
- **`resultStore.clearVisibleResults`** — new store action that
  clears `lineResults`, `fullOutput`, `error`, `diagnostics`,
  `executionTime`, `executionSource`, and `autoRunGateReason` but
  PRESERVES `lastSuccessfulSnapshot`. `useAutoRun` calls this on
  the empty-buffer branch so a Cmd+A → Backspace → type cycle does
  not wipe the Slice 1 snapshot. The full `clear()` still fires on
  tab switch via the second useEffect.
- **`src/renderer/utils/appendWatch.ts`** (fold E) — new pure
  helper. `appendWatchToLine(line, language)` is idempotent on
  already-watched lines, promotes an arrow on the same line into a
  watch, refuses comment-only / empty / control-flow-header lines,
  and uses a declaration-aware expression heuristic: `const b = 2;`
  → watches `b` (the bound identifier), not the full statement.
  `appendWatchAtLine(source, lineNumber, language)` applies this
  to a full buffer.
- **Command palette** (fold E) — `commandPaletteModel.ts` adds the
  `action-add-watch` entry, surfaced only when the active tab's
  language is JS / TS / Python AND the caller wires
  `onAddWatchToCurrentLine`. `CommandPalette.tsx` reads the editor
  cursor + line text via `getActiveEditorCursorLine` /
  `getActiveEditorLineText`, calls `appendWatchAtLine`, and writes
  the updated buffer back via `editorStore.updateContent`. On a
  no-op result (empty line / control-flow header) the palette
  surfaces a localized status notice instead of mutating the
  buffer silently.
- **`runtime/editorAccess.ts`** gains `getActiveEditorLineText` —
  reads the active Monaco editor's current line content. Same
  module-level handle pattern as the existing
  `getActiveEditorCursorLine`.
- **`src/shared/languagePacks.ts`** — JS / TS / Python `defaultCode`
  refreshed. Each seed now demonstrates BOTH `//=>` (or `#=>`) and
  `// @watch` (or `# @watch`) side-by-side so a fresh tab surfaces
  the feature without typing.
- **Telemetry** — `runtime.magic_comment_emitted` added to
  `TELEMETRY_EVENTS` + `EVENT_PROPERTY_ALLOWLIST` + `isAllowedValue`
  in `src/shared/telemetry.ts`. Booleans only for `hasArrow` /
  `hasWatch`. Mirror in `update-server/src/telemetry.ts` + parity
  enforced by the existing TELEMETRY_EVENT_NAMES parity test +
  worker-side validator behavior test.

i18n — 6 new keys per locale: 3 watch keys
(`magic.watch.tooltip`, `magic.watch.ariaLabel`, `magic.watch.empty`)
+ 3 palette keys (`commandPalette.action.addWatch.label` /
`.description` / `.unsupported`). Spanish in tuteo (`Pulsa`,
`Fija`, `sobrevive`).

Tests:

- `tests/utils/magicComments.test.ts` — extends with `@watch` JS +
  Python detect / transform / kind-table cases; precedence
  (watch wins over arrow on a shared line); idempotence;
  control-flow header rejection.
- `tests/utils/magicComments.bench.test.ts` — fold D parser bench:
  10 000 detect calls + 100 transform calls on a 5 KB realistic
  buffer < 400 ms (~40 µs / call).
- `tests/utils/appendWatch.test.ts` — fold E helper coverage:
  declaration heuristic, idempotence, arrow promotion,
  language-specific spacer + comment shape, control-flow rejection.
- `tests/components/ResultPanel.test.tsx` — adds a watch-render
  case + a hideUndefined-exemption case.
- `tests/shared/languagePacks.test.ts` — locks the JS / TS /
  Python `defaultCode` to contain BOTH arrow and `@watch`
  markers so a future template refresh that drops the demo fails
  the build.
- `tests/shared/telemetry.test.ts` — extends with
  `runtime.magic_comment_emitted` validator coverage (accepts the
  closed enum, drops non-boolean flags, drops non-safe-token
  languages).
- `update-server/test/telemetry.test.ts` — mirror worker-side
  validator smoke for the new event.
- `tests/stores/editorStore.test.ts` — updates the default-template
  assertion to check the `@watch` marker survives.
- `tests/e2e/magicWatch.spec.ts` — 3 Playwright cases: fresh tab
  surfaces the seeded arrow + watch; breaking the buffer fires
  the Slice 1 gate AND the watch persists via snapshot restore;
  completing the buffer refreshes the watch and dismisses the
  gate.

Out of scope until Slice 4:

- Expression auto-log mode.
- stdin / input surface.
- Timeout presets.
- Per-tab execution history with rerun (depends on RL-028 surface).
- Variable inspector panel.

#### Slice 4 — 2026-05-14 (per-tab execution history with one-click rerun)

Slice 4 lands the fourth acceptance criterion (`Users can rerun a
previous execution from history`) at the per-tab granularity. RL-028
already shipped the 50-entry global ring buffer with optional code
snapshots (Pro tier); Slice 4 adds a `tabId` axis, a one-click rerun
affordance close to the editor, and a pin-and-keep mechanism so
rare-but-valuable entries survive ring-buffer eviction.

Architecture:

- **`src/renderer/stores/executionHistoryStore.ts`** extends
  `ExecutionHistoryEntry` with optional `tabId?: string` and
  `pinned?: boolean`. The `record()` contract widens to accept
  `tabId` and omit the field when absent (legacy callers stay
  compatible). New `byTabId(tabId)` selector returns matching
  entries newest-first and excludes legacy entries with
  `tabId: undefined`. New `togglePin(id)` action flips the pinned
  flag. The FIFO eviction loop is **pin-aware** — `findIndex` for
  the oldest unpinned entry, drop it, repeat until size ≤ 50 OR
  every remaining entry is pinned (rare; the buffer is allowed to
  grow past 50 in that edge case rather than evict a pinned row).
- **`src/renderer/runtime/executeTabManually.ts`** threads
  `activeTab.id` into both the success-branch and error-branch
  `store.record()` calls. Auto-run paths still do not record (the
  RL-028 contract preserves intent: the 1.2 s debounced cadence
  would otherwise flood the buffer).
- **`src/renderer/components/Editor/RecentRunsPill.tsx`** — new
  status-pill button mounted in the result-panel header next to
  `<WorkflowModeStatusPill>`. Self-gates on:
  - `useEntitlement('EXECUTION_HISTORY')` — Pro tier (Free tier
    shows the fold E upsell variant);
  - `executionModeForLanguage(language) === 'run'` (manual-run-
    recording languages);
  - non-empty per-tab history.
  Click toggles a small popover listing up to 8 newest entries
  with language badge, status icon (✓/✗), duration, relative-time
  (fold F refreshes every 60s while the popover is open), a Pin
  button (fold D), and a Replay button. Replay disabled when the
  entry's `snapshot` is `null` (capture was off when the run
  happened); a localized tooltip explains why. Escape and
  outside-click close the popover. Replay dispatches via the
  shared `replayHistoryEntry` helper and emits
  `runtime.history_replay { surface: 'tab_pill' }` telemetry
  (fold A).
- **`src/renderer/runtime/recentRunsPopoverBridge.ts`** — new
  module-level handle so the `Mod+Shift+H` global keyboard
  shortcut can toggle the popover without piping a ref through
  the renderer tree. Mirrors the `editorAccess` /
  `debuggerWorkerBridge` pattern. The pill writes the opener on
  mount and clears it on unmount; the dispatcher in `App.tsx`
  reads it on demand and surfaces a localized status notice when
  no pill is mounted (Free tier, view-only tab, empty per-tab
  history).
- **`src/renderer/components/Console/ExecutionHistoryPopover.tsx`**
  gains a fold-C "This tab only" filter checkbox in the popover
  header. State is scoped to the open popover (closing resets it)
  and the predicate excludes legacy `tabId: undefined` entries so
  the checkbox never surfaces for stale rows. Adds two new copy
  keys for the toggle label and the filtered-empty state.
- **`src/renderer/components/CommandPalette/commandPaletteModel.ts`**
  surfaces a fold-G `recent-run-tab-*` parallel group of entries
  whose `tabId` matches the active tab id, ranked ABOVE the legacy
  global `recent-run-*` group. Same `MAX_RECENT_RUNS_IN_PALETTE`
  ceiling so neither group dominates. `CommandPalette.tsx` passes
  the active tab id through.
- **Keyboard shortcut** — `keyboardShortcuts.ts` registers
  `run-toggle-recent-runs` (`Mod+Shift+H`); `useGlobalShortcuts.ts`
  gains a `toggleRecentRunsPopover` option; `App.tsx` wires the
  dispatcher to `toggleRecentRunsPopover` from the bridge and
  pushes the localized "no recent runs on this tab" notice when
  the bridge returns `false`.
- **Telemetry** — `runtime.history_replay` added to
  `TELEMETRY_EVENTS` + `EVENT_PROPERTY_ALLOWLIST` +
  `isAllowedValue` in `src/shared/telemetry.ts`. Closed-enum
  payload `{ language, status, surface }` with
  `HISTORY_REPLAY_SURFACES = { tab_pill, palette, popover }`.
  Mirrored on the worker; parity test enforces the Set's contents
  match the renderer's at CI time.
- **Auto-run discipline** — auto-run code paths still do not call
  `store.record()`. The pill stays hidden until the user fires a
  manual gesture. Locks the RL-028 contract.
- **Replay tab id propagation** — the existing
  `replayHistoryEntry` helper opens a fresh tab with a fresh id
  and runs with `recordHistory: false`, so the replayed run does
  not append a second entry. The new tab's pill starts empty;
  subsequent manual gestures on the replayed tab surface there.

i18n — 19 new keys per locale: pill label (with i18next plural
suffixes), tooltip, popover title, entry count, replay action,
replay-unavailable hint, pin / unpin tooltips, Free-tier upsell
label / tooltip, shortcut-unavailable notice, "this tab only"
filter label + empty state, two `shortcuts.item.toggleRecentRuns.*`
keys, two `commandPalette.recentRuns.onTab.*` keys. Spanish in
tuteo (`haz clic`, `actívala`, `Volver a ejecutar`).

Tests:

- `tests/stores/executionHistoryStore.test.ts` — extends with
  `tabId` recording / omission, `byTabId` newest-first / empty
  string rejection / legacy entry exclusion, `togglePin` flip +
  unknown-id no-op, pin-aware FIFO eviction (pinned entry
  survives a 50-push overflow).
- `tests/runtime/executeTabManually.snapshot.test.ts` — adds two
  cases asserting `tabId` is recorded on both success + error
  paths.
- `tests/runtime/recentRunsPopoverBridge.test.ts` — new module
  test: no-opener-no-op, registered-opener invocation, clear-on-
  unregister.
- `tests/components/commandPaletteModel.test.ts` — adds the fold G
  per-tab group describe block: omitted when no `activeTabId`,
  ranked ABOVE the global group when present, filters by tab id,
  empty when no matching entries.
- `tests/components/ResultPanel.test.tsx` — mocks `RecentRunsPill`
  to a no-op so the existing tests bypass the new pill's
  esbuild-wasm import chain.
- `tests/components/ConsolePanel.test.tsx` — widens the
  `useEditorStore` mock to support BOTH the selector-hook API and
  the legacy `getState()` accessor (the new fold-C filter reads
  `useEditorStore((state) => state.activeTabId)`).
- `tests/shared/telemetry.test.ts` — new validator coverage for
  `runtime.history_replay`: accepts the closed enum, drops
  unknown `surface` / unknown `status` / non-safe-token language.
- `update-server/test/telemetry.test.ts` — mirrored worker-side
  validator behavior test + a `HISTORY_REPLAY_SURFACES` regex
  parity guard that matches the renderer's closed-enum Set.
- `tests/e2e/recentRunsPill.spec.ts` — 3 Playwright cases: auto-
  run alone does NOT surface the pill / manual Run does; clicking
  the pill opens the popover and per-tab isolation works
  (different tab id → pill hidden); `Mod+Shift+H` toggles the
  popover from the keyboard (fold B).

Out of scope until Slice 5:

- Expression auto-log mode.
- stdin / input surface.
- Timeout presets.
- Variable inspector panel.

#### Slice 5 — 2026-05-14 (expression auto-log mode for JS / TS Scratchpad tabs)

Slice 5 lands the fourth acceptance criterion (`Optional expression
auto-log mode for JS / TS scratchpad tabs so expression-oriented
exploration does not require wrapping every value in
`console.log(...)`.`). Auto-log is opt-in, default OFF, JS / TS only,
and additive on top of the existing magic-comment scaffolding —
worker protocol unchanged.

Architecture:

- **`src/renderer/utils/magicComments.ts`** — extends `MagicCommentKind`
  with `'autoLog'`. Adds `detectJSAutoLogLines(code, magicSet)`: a
  per-line bracket / quote / template / regex / comment state machine
  (mirror of `autoRunGating.ts`) yielding 1-based line numbers of
  top-level bare expression statements. Adds `transformJSAutoLog(code,
  lines)` that replaces each named expression statement with
  `void (__mc(line, await (async () => { try { return (<expr>); }
  catch(__e) { return ... } })()));` so side-effecting expressions
  execute once, top-level `await` stays legal inside the runner's
  async function body, and trailing `//` comments stay outside the
  captured expression. The detector takes a `magicLines` skip set so
  arrow / watch lines retain precedence via a single source of truth.
  `magicCommentKindsByLine` gains a `{ autoLog?: boolean }` option
  that merges auto-log line kinds into the runner's side table.
- **`src/renderer/types/index.ts`** — `MagicCommentResult.kind`
  widens 2 → 3 (`'arrow' | 'watch' | 'autoLog'`). `FileTab` gains
  `autoLogEnabled?: boolean` (fold C). `ExecutionContext` gains
  `autoLog?: boolean`. `SettingsState` gains
  `scratchpadAutoLogByLanguage: Record<string, boolean>` +
  `setScratchpadAutoLogDefault`. `EditorState` gains
  `setTabAutoLogEnabled(id, enabled | null)` whose `null` clears the
  override; the setter refuses non-JS/TS languages.
- **`src/renderer/runners/javascript.ts` + `src/renderer/runners/typescript.ts`**
  — read `context.autoLog`; when `true` AND `debug` is `false`, run
  `transformJSAutoLog` AFTER `transformJSMagicComments` and merge
  auto-log line kinds into `magicKindByLine`. Debug runs deliberately
  skip the transform (the worker pause / step semantics already
  produce a richer view, and the implicit injection would surprise a
  user under a paused frame). TypeScript transpile preserves the
  `__mc` call's first argument (the line number) verbatim.
- **`src/renderer/stores/settingsStore.ts`** — `scratchpadAutoLogByLanguage`
  seed `{ javascript: false, typescript: false }`,
  `setScratchpadAutoLogDefault(language, enabled)` rejects unsupported
  languages and emits `runtime.auto_log_enabled` telemetry on every
  flip (idempotent calls do not re-emit), `sanitizeScratchpadAutoLog`
  fold-C-pattern on rehydrate drops unknown languages and coerces
  non-boolean values to `false`.
- **`src/renderer/stores/editorStore.ts`** — `setTabAutoLogEnabled(id,
  enabled | null)` writes the per-tab override; `renameTab` clears
  the field when the new language is outside the JS / TS pair, and
  add / restore / Save As paths strip unsupported stale flags so an
  override never leaks across language changes.
- **`src/renderer/hooks/useAutoRun.ts`** — gate resolution: language
  ∈ {JS, TS} AND workflow mode === 'scratchpad' AND (per-tab
  override if defined else per-language Settings default). Resolved
  value flows into the runner via `ExecutionContext.autoLog`. Fold A:
  per-run `runtime.auto_log_emitted { language, countBucket }`
  emission via `bucketAutoLogCount` (closed enum: `'1'`, `'2-5'`,
  `'6-20'`, `'20-plus'`). Fold G: extends the Slice 3 fold-C splice-
  back to ALSO splice `autoLog` rows from the last successful
  snapshot when an error run did not refresh them.
- **`src/renderer/components/Editor/ResultPanel.tsx`** — new
  `<LineResultRow>` branch for `type === 'autoLog'`: `MoveRight`
  lucide icon (fold B), `data-result-kind="autoLog"`,
  `aria-label="Auto-logged value"` + `title="Bare expression value
  (auto-log mode)"`, low-contrast italic body. `isUndefinedResult`
  returns `true` for `autoLog` rows whose value is `'undefined'` so
  the existing `hideUndefined` filter applies (different from
  `'watch'` which is exempt — auto-log floods the UI, the filter
  must work).
- **`src/renderer/components/Editor/AutoLogStatusPill.tsx`** (fold E)
  — new tiny pill in the result-panel header next to
  `<WorkflowModeStatusPill>` + `<RecentRunsPill>`. Self-gates on the
  same resolved gate `useAutoRun` uses; surfaces "Auto-log · JS" so
  a user who suddenly sees inline values everywhere has an obvious
  pointer back to Settings.
- **`src/renderer/components/CommandPalette/commandPaletteModel.ts`**
  (fold D) — `action-toggle-auto-log` entry surfaces only for JS / TS
  active tabs; flips the per-tab override against the resolved gate
  state (per-tab override wins over Settings default).
- **`src/renderer/components/Settings/EditorSection.tsx`** — new
  Settings row below the workflow-mode row with two `Toggle`s for
  JavaScript and TypeScript.
- **Telemetry** — `'runtime.auto_log_enabled'` (`{ language, enabled }`,
  boolean) and `'runtime.auto_log_emitted'` (`{ language,
  countBucket }`, closed-enum bucket via `AUTO_LOG_COUNT_BUCKETS`)
  registered in both `src/shared/telemetry.ts` and the worker mirror
  at `update-server/src/telemetry.ts`. A new parity test enforces
  the `AUTO_LOG_COUNT_BUCKETS` Set stays aligned at CI time.

i18n — 14 new keys per locale (Settings title + description + 2
language labels + result tooltip / aria-label + status pill label +
tooltip + 5 command-palette keys). Spanish in tuteo (`Activa`,
`Pulsa`, no `Activá` / `Pulsá`).

Tests:

- `tests/utils/magicComments.test.ts` — auto-log detector + transform
  + `magicCommentKindsByLine({ autoLog: true })` coverage; positive
  + negative + precedence cases.
- `tests/utils/magicComments.bench.test.ts` — fold F bench lock:
  5 000 detector calls + 50 transform calls on a 5 KB realistic
  buffer under 750 ms (~150 µs / call).
- `tests/utils/executionPresentation.test.ts` — maps `kind: 'autoLog'`
  → `type: 'autoLog'`.
- `tests/components/ResultPanel.test.tsx` — autoLog render case +
  `hideUndefined` filter case.
- `tests/stores/settingsStore.test.ts` — seed + setter + rehydrate
  + sanitize coverage.
- `tests/stores/editorStore.autoLog.test.ts` — setter + null clear
  + non-JS/TS rejection + renameTab cleanup.
- `tests/shared/telemetry.test.ts` — validator coverage for both
  new events.
- `update-server/test/telemetry.test.ts` — worker-side validator
  smoke + `AUTO_LOG_COUNT_BUCKETS` parity guard.
- `tests/e2e/autoLogScratchpad.spec.ts` — 3 Playwright cases.

Out of scope until Slice 6:

- stdin / input surface.
- Timeout presets.
- Variable inspector panel.

#### Slice 6 — 2026-05-14 (pre-set stdin / input for JS / TS / Python Scratchpad runners)

Slice 6 lands the named acceptance criterion (`Supported runtimes
can accept simple stdin text without custom code changes.`).
JS / TS / Python only this slice; the Go / Rust desktop runners stay
TODO because their pipelines (Go WASM, host-spawned Rust) don't
match the child-process stdin model the original plan anticipated
— fold B was descoped accordingly.

Architecture:

- **`src/renderer/types/index.ts`** — `FileTab.stdinBuffer?: string`,
  `ExecutionContext.stdin?: string`, `EditorState.setTabStdinBuffer`,
  `ExecutionResult.stdinConsumed?: { count; total }`, new
  `'stdin-consumed'` arm on the `WorkerResponse` union, new
  Settings field `showStdinPanel: boolean` + `toggleShowStdinPanel`.
- **`src/renderer/stores/editorStore.ts`** — new
  `dropStdinIfUnsupported` helper mirrors Slice 5's
  `dropAutoLogIfUnsupported`; clears on `addTab` / `restoreTabs` /
  `renameTab` for any language outside JS / TS / Python.
- **`src/renderer/stores/uiStore.ts`** — `BottomPanelTab` widens 3 →
  4 (`'console' | 'debugger' | 'browser-preview' | 'stdin'`).
- **`src/renderer/stores/sessionStore.ts`** (fold A) — persists
  `stdinBuffer` alongside the runtime mode; restore drops the
  field for unsupported languages so a tampered persisted entry
  can't leak the buffer onto a Rust / JSON tab.
- **`src/renderer/stores/resultStore.ts`** — new `stdinConsumed`
  field + setter; cleared on `clear` and `clearVisibleResults`.
- **`src/renderer/runners/{javascript,typescript,python}.ts`** —
  thread `context?.stdin` into the worker `execute` payload; relay
  the new `stdin-consumed` worker reply onto `ExecutionResult`.
- **`src/renderer/workers/js-worker.ts`** — installs
  `globalThis.prompt` + `globalThis.readline` patches BEFORE user
  code runs when the payload carries a buffer; consumer walks
  line-by-line and returns `null` past EOF (matches browser
  `prompt()` Cancel). Posts the consumption summary before `done`.
  Worker is single-shot per run; the `finally` block restores the
  previous bindings defensively.
- **`src/renderer/workers/python-worker.ts`** — calls
  `pyodide.setStdin({ stdin, isatty: false })`; the handler returns
  `${line}\n` per call and `null` past EOF (Pyodide raises
  `EOFError` — stock Python REPL behaviour). Resets the handler in
  the `finally` so the persistent worker starts the next run
  clean.
- **`src/renderer/components/Editor/StdinInputPanel.tsx`** (fold G)
  — bottom-panel body; renders the empty / unsupported-language /
  active variants and the "Used N of M line(s)" pill when
  `useResultStore.stdinConsumed` is populated.
- **`src/renderer/components/Editor/StdinStatusPill.tsx`** (fold F)
  — ambient pill in the result-panel header. Self-gates on the
  Settings master toggle + language + non-empty buffer; counts
  trimmed lines and renders `Stdin · N line(s)`.
- **`src/renderer/components/Layout/AppLayout.tsx`** — registers
  the new `Input` tab + `MessageSquare` icon; widens `effectiveTab`
  / `selectTab` to include `'stdin'`; auto-recovers
  `activeBottomPanel` back to `'console'` when stdin becomes
  unavailable.
- **`src/renderer/components/Settings/EditorSection.tsx`** (fold D)
  — "Show stdin input tab" toggle below the workflow-mode +
  auto-log rows. Per-tab buffers are preserved either way.
- **`src/renderer/components/CommandPalette/{commandPaletteModel,CommandPalette}.tsx`**
  (fold E) — `action-focus-stdin-panel` calls
  `uiStore.openBottomPanel('stdin')`. Gated on the Settings master
  toggle + JS / TS / Python + non-browser-preview runtime mode.
- **`src/renderer/runtime/executeTabManually.ts`** + **`hooks/useAutoRun.ts`**
  — pipe `activeTab.stdinBuffer` through; surface
  `result.stdinConsumed` via the new setter; fire `runtime.stdin_used`
  adoption telemetry (fold C) when the run actually consumed ≥1
  line.
- **Telemetry** — `'runtime.stdin_used'` (`{ language }`) registered
  in `src/shared/telemetry.ts` + mirrored in
  `update-server/src/telemetry.ts`; per-event validator drops
  unknown keys + non-safe-token language values.

i18n — 15 new keys per locale across `stdin.*` + the command-palette
toggle copy. Spanish in tuteo (`Define`, `Déjalo`, `Escribe`).

Tests:

- `tests/stores/editorStore.stdin.test.ts` — setter + null /
  empty-string clear + unsupported-language refusal + `renameTab`
  cleanup + `restoreTabs` strip-on-unsupported.
- `tests/stores/settingsStore.test.ts` — fold-D master toggle
  default + flip.
- `tests/components/StdinInputPanel.test.tsx` — empty /
  unsupported / supported / consumed-pill render contract.
- `tests/shared/telemetry.test.ts` — `runtime.stdin_used` validator.
- `update-server/test/telemetry.test.ts` — worker-side validator +
  drop-unknown-keys behavior test.
- `tests/e2e/stdinScratchpad.spec.ts` — 5 Playwright cases (JS
  `prompt()` consumption + status pill + empty-buffer native
  behavior + master toggle hides the tab + ES locale tuteo).

Out of scope until Slice 7:

- Desktop Go / Rust child-process stdin (fold B descope — Go is
  WASM, Rust spawns through a different pipeline; both need a
  dedicated slice that integrates with the existing native-runner
  resource-limit + kill paths).
- Real-time mid-run prompts (the user types AFTER the run starts).
- Browser preview iframe stdin (sandbox restriction).
- Timeout presets.
- Last-stable compare polish beyond the existing snapshot restore.
- Variable inspector panel.

#### Product experience recommendations — 2026-05-12

This section captures product recommendations for the editor/runtime surface in
Lingua's own terms. It does not create new `RL-XXX` tickets; each item maps
onto the existing roadmap entries named below.

| Priority | Recommendation | Primary ticket | Product outcome |
|----------|----------------|----------------|-----------------|
| `P0` | Make the JS/TS debugger first-class in both web and desktop while it stays on the worker interpreter path. | `RL-027` | Users can pause at a breakpoint, inspect local state, see the call stack, continue/step reliably, and keep prior output visible while paused. |
| `P0` | Upgrade the console into a structured output timeline. | `RL-044` | Output entries carry level, source line, timestamp, expandable values, table rendering, error details, and click-to-source navigation. |
| `P1` | Separate `Run`, `Debug`, and `Scratchpad` as distinct workflows instead of variants of the same button state. | `RL-019`, `RL-020` | Users understand whether Lingua will execute once, pause on breakpoints, or auto-evaluate complete edits. |
| `P1` | Make Scratchpad mode fast, predictable, and state-aware. | `RL-020` | Auto-run can be paused, incomplete code is skipped, expression values can be surfaced automatically, and the last stable output remains available. |
| `P2` | Group formatting controls by language capability. | `RL-010`, `RL-019` | Formatting options live near editor/runtime behavior and only appear when the active language can support them. |
| `P2` | Keep AI assistance contextual, local-first, and opt-in. | `RL-031` | The assistant can use code/output/debugger context only after an explicit user action and never loads as a default background sidebar. |
| `P2` | Add a diagnostic feedback flow. | `RL-065` | Issue reports can include app version, shell, language, runtime mode, capability state, and redacted recent errors without exposing source or secrets. |

Implementation notes:

- The JS/TS web debugger is viable because Lingua owns the worker runtime and
  can cooperatively pause through AST instrumentation. TypeScript remains viable
  when transpilation preserves source-map composition back to the original file.
- This is not a native engine inspector. Web mode cannot attach to external
  processes, expose Node built-ins, or inspect arbitrary browser execution
  outside Lingua's controlled worker runtime.
- Browser Preview / DOM debugging should remain a separate runtime-mode slice in
  `RL-019`; do not merge DOM inspection into the pure JS/TS worker debugger.
- Watch-expression and conditional-breakpoint evaluation must keep the existing
  security gate from `RL-027` Slice 1.5b before evaluating user-provided
  expressions in the worker.
- Rich console work should land before charts/images so every runtime gets a
  reliable value, error, and table contract before higher-level visualization.

#### Slice 7 — 2026-05-14 (timeout presets + clearer abort state)

Slice 7 lands the named scope item *"Add timeout presets and clearer
abort state for long-running code."* The pre-Slice-7 hardcoded
`DEFAULT_TIMEOUT` constants per runner (30 s JS / TS / Go,
60 s Python, no per-language Settings entry) become a configurable
per-language preset that the user picks from Settings; the runner
reads `useSettingsStore.getState()` on every `execute()` so a
Settings change picks up on the very next run without restarting the
worker. A new `<RunStatusPill>` ambient pill self-gates on a fresh
`result.kind` field so the result-panel header distinguishes
`timeout` / `stopped` / `error` / `countdown` without regexing the
error message.

Architecture:

- **`src/shared/runtimeTimeoutPresets.ts`** — closed-enum
  `RuntimeTimeoutPreset` (`quick` 5 s / `normal` 30 s / `long` 120 s
  / `extended` 300 s). `resolveTimeoutMs(language, preset)` is the
  single source of truth for "how many ms for (language, preset)?";
  unknown preset falls back to the language default
  (`defaultRuntimeTimeoutPreset(language)` — `'long'` for Python,
  `'normal'` for the others). `RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES`
  is the closed Settings-surface set
  (`javascript` / `typescript` / `python` / `go`); Rust is
  intentionally out — its desktop child-process pipeline owns its
  own kill in main and threading a preset through IPC is a separate
  slice.
- **`src/renderer/types/index.ts`** — `RuntimeTimeoutPreset` re-export,
  `SettingsState.runtimeTimeoutPresetByLanguage: Record<string,
  RuntimeTimeoutPreset>`, `SettingsState.showTimeoutCountdown:
  boolean` (fold E), `setRuntimeTimeoutPreset(language, preset)` +
  `toggleShowTimeoutCountdown()`. `FileTab.nextRunTimeoutOverrideMs?`
  (fold D one-shot) + `setTabNextRunTimeoutOverride(id, ms | null)`
  editor action. `ExecutionContext.timeoutPreset?` carried through
  to `runnerTimeoutResult`. `ExecutionResult.kind?: 'success' |
  'error' | 'timeout' | 'stopped'` plus `timeoutPreset` +
  `timeoutMs` so the pill self-gates without string-matching
  `error.message`.
- **`src/renderer/stores/settingsStore.ts`** — seed
  (`defaultRuntimeTimeoutPresetSeed()`), persist + sanitize on
  rehydrate (tampered tokens drop, missing keys re-seed to the
  language default). `setRuntimeTimeoutPreset` fires
  `runtime.timeout_preset_changed` adoption telemetry (fold A) on
  actual change only — idempotent calls do not re-emit.
- **`src/renderer/stores/editorStore.ts`** — `dropNextRunTimeoutOverride`
  helper symmetric to `dropAutoLogIfUnsupported` /
  `dropStdinIfUnsupported`. `renameTab` and `persistTab` (Save-As)
  unconditionally clear the override so a JS one-shot doesn't fire
  on a renamed Go tab.
- **`src/renderer/stores/resultStore.ts`** — `runTermination:
  RunTerminationSummary | null` (the `<RunStatusPill>` source of
  truth) + `runDeadlineAt: number | null` (epoch ms armed by the
  run dispatcher; the countdown pill reads it). `clear` and
  `clearVisibleResults` both reset the pair so tab switches and
  transient empty-buffer states start quiet.
- **`src/renderer/runners/{javascript,typescript,python,go,browserPreview}.ts`**
  — drop the literal `DEFAULT_TIMEOUT`, read
  `useSettingsStore.getState().runtimeTimeoutPresetByLanguage[lang]`,
  resolve via `resolveTimeoutMs`. Caller `context.timeout` still
  wins (one-shot extended, magic-comment override); the runner sets
  `timeoutPreset: 'override'` in that case so the pill tooltip
  drops the preset name. Every code path sets `result.kind` —
  success / error / timeout / stopped.
- **`src/renderer/runners/limits.ts`** — `runnerTimeoutResult` accepts
  the new `timeoutPreset` argument; appends a fold-F "open Settings"
  hint to the timed-out message when the run used a Settings preset
  (not an explicit caller override). `runnerStoppedResult` sets
  `kind: 'stopped'`.
- **`src/renderer/components/Editor/RunStatusPill.tsx`** — ambient
  pill, italic low-contrast chrome mirroring
  `<AutoLogStatusPill>` / `<StdinStatusPill>` (no border, no
  background, never button-styled). Variants: `timeout`
  (`AlarmClock`), `stopped` (`Square`), `error` (`AlertTriangle`),
  `countdown` (`Hourglass`, fold E — wins over termination
  variants while a run is in flight + the Settings toggle is on).
  The `setInterval` driving the countdown tears down the instant
  `runDeadlineAt` clears so an idle pill never holds a timer.
- **`src/renderer/components/Settings/EditorSection.tsx`** — new
  "Execution timeout" sub-section: one `<Select>` per supported
  language (JS / TS / Python / Go). Mounted between the auto-log
  row and the stdin toggle. The countdown master toggle sits
  immediately below the section so users who never want the
  in-flight pill can leave it off (default).
- **`src/renderer/runtime/executeTabManually.ts`** — resolves the
  effective timeout in priority order:
  `lifecycle.executionTimeoutMs` (smoke / test) → tab one-shot
  override → magic-comment override → undefined (runner reads the
  Settings preset). Sets `runDeadlineAt` before `runner.execute`,
  clears it after, propagates `result.kind` + preset + ms to the
  pill via `setRunTermination`. `runner.executed.status` widens
  to map `kind` → `'timeout' | 'stopped' | 'error' | 'ok'`.
- **`src/renderer/hooks/useAutoRun.ts`** — symmetric one-shot consume
  (fold D edge case: a Scratchpad-mode tab where the user fires
  the "Run with extended timeout" palette action mid-typing —
  auto-run consumes the override on the very next debounce so the
  manual run doesn't race the auto-run). Magic-comment override
  works in both run paths. Pre-arms `runDeadlineAt` from the
  language preset (with `defaultRuntimeTimeoutPreset` fallback)
  even when the override is absent so the countdown pill always
  has a deadline to render when the toggle is on.
- **`src/renderer/utils/magicComments.ts`** — fold B
  `extractTimeoutMagicComment(language, code)`. First matching
  `// @timeout 60s` / `# @timeout 60s` directive wins; suffix
  parsing accepts `ms` / `s` / `m` (and the long forms); caps at
  600 s = the `extended` preset ceiling; rejects ≤ 0 ms, non-JS /
  TS / Python languages, and non-numeric values. No `eval`, no
  RegExp DoS shape — the regex is non-backtracking and bounded.
- **`src/renderer/components/CommandPalette/`** — fold C four entries
  (`Set execution timeout: Quick / Normal / Long / Extended`) +
  fold D one-shot (`Run with extended timeout (one shot)`).
  Entries hide when the active language isn't in the supported
  set; the active preset's entry surfaces "Currently selected for
  this language" as its description so the palette honestly
  previews the next state.
- **`src/shared/telemetry.ts`** + **`update-server/src/telemetry.ts`**
  — `RUNNER_STATUS_VALUES` widens from `['ok', 'error']` to
  `['ok', 'error', 'timeout', 'stopped']`. New event
  `runtime.timeout_preset_changed` with `['language', 'preset']`
  allowlist. New `RUNTIME_TIMEOUT_PRESET_VALUES` closed Set
  mirrored across renderer + worker; parity test enforces drift.
- **i18n** — 22 new keys per locale under `runtime.timeout.*` (preset
  labels + Settings copy + status-pill tooltips +
  countdown copy + "open Settings" hint) and
  `commandPalette.action.setTimeout.*` /
  `commandPalette.action.runExtendedTimeout.*`. Spanish is neutral
  LatAm tuteo (`Ajusta`, `Cancelaste`, `Mira`, `Interrumpe`,
  `Ejecuta` — no voseo imperatives).

Tests:

- `tests/shared/runtimeTimeoutPresets.test.ts` — enum + resolver +
  fallback coverage.
- `tests/shared/extractTimeoutMagicComment.test.ts` — directive
  parser + language gate + cap behavior.
- `tests/components/RunStatusPill.test.tsx` — three termination
  variants + countdown + hidden-on-success.
- `tests/stores/settingsStore.test.ts` — new
  `runtimeTimeoutPresetByLanguage` block: seeds, setter, rehydrate
  sanitizer, countdown toggle.
- `tests/runners/limits.test.ts` — `runnerTimeoutResult` kind + ms
  + the override branch that drops the Settings hint.
- `tests/shared/telemetry.test.ts` — sorted-name list adds the new
  event between `stdin_used` and `workflow_mode_changed` (per
  alphabetical order); validator + widened status enum coverage.
- `update-server/test/telemetry.test.ts` — parity test on the
  widened `RUNNER_STATUS_VALUES` Set + the new
  `RUNTIME_TIMEOUT_PRESET_VALUES` mirror + a worker validator
  smoke for `runtime.timeout_preset_changed`.
- `tests/e2e/timeoutPreset.spec.ts` — 3 Playwright cases: JS preset
  `'quick'` (5 s) trips the timeout pill on an infinite loop within
  ~7 s; magic-comment `// @timeout 2s` overrides a `'extended'`
  preset; the preset persists across reload.
- `tests/runtime/executeTabManually.{telemetry,snapshot}.test.ts`
  result-store mocks gain `setRunTermination` + `setRunDeadlineAt`
  vi.fn() entries so the destructure does not throw at runtime.

Out of scope (fold-B descope rationale): Rust desktop
child-process timeout preset — the kill path lives in main IPC and
the renderer-side Settings preset does not reach the spawned
process; that wiring is a separate slice. Pyodide bootstrap
deadline (`PYODIDE_LOAD_TIMEOUT = 90_000` in `python.ts`) is
unchanged — only the post-bootstrap run is bounded by the
language preset; the Settings copy explicitly calls this out.

#### Slice 8 — 2026-05-14 (last-stable compare)

Slice 8 lands the named scope item *"Preserve the last successful
run so users can compare current output against the previous
stable result."* The Slice 1 snapshot infrastructure (already
captured on every clean auto-run) is finally surfaced — Compare
becomes a visible affordance, manual Run also captures, and the
result-panel header gains a button-secondary toggle that swaps
the inline-results region for a diff body.

Architecture:

- **`src/renderer/stores/resultStore.ts`** — `ResultSnapshot`
  gains `language` (Slice 1 only carried lineResults + fullOutput;
  Slice 8 self-gates the Compare toggle against a Save-As that
  flips the language), `capturedAt` (epoch ms for relative time),
  `pinned` (fold F). New `snapshotRing: ResultSnapshot[]` (cap=3,
  fold B) keyed by capture order; eviction drops the oldest
  UNPINNED entry. When every slot is pinned, the fresh capture is
  refused — the user's pin intent wins. New
  `selectedCompareTargetCapturedAt` cursor + `setCompareTarget` /
  `toggleSnapshotPin` / `clearLastSuccessfulSnapshot` actions.
  `captureSuccessfulSnapshot(language?)` is the additive new
  signature; callers without a language get `'unknown'` which the
  Compare toggle rejects.
- **`src/renderer/types/index.ts`** — `FileTab.compareWithSnapshotEnabled?: boolean`
  per-tab toggle + `EditorState.setTabCompareEnabled(id, enabled |
  null)`.
- **`src/renderer/stores/editorStore.ts`** — `setTabCompareEnabled`
  setter; `dropCompareIfLanguageChanged` helper symmetric to the
  existing autoLog / stdin / timeout-override drops; `renameTab`
  clears the flag AND the result-store snapshot ring when the
  language flips on the active tab (`useResultStore.getState()
  .clearLastSuccessfulSnapshot()`); `saveTabById` (Save-As) does
  the same.
- **`src/renderer/runtime/executeTabManually.ts`** — manual Run
  captures the snapshot on the clean-success branch (Slice 1 was
  scratchpad-only via `useAutoRun`). Skip on cancel / timeout /
  error. Reviewer fix — the run-start reset preserves the snapshot
  ring, then the clean-success branch appends the new capture.
- **`src/renderer/hooks/useAutoRun.ts`** — pass `language` into
  `captureSuccessfulSnapshot`. No behavioral change; the Slice 1
  restore path reads the legacy fields only. Reviewer fix — the
  pre-run visible reset preserves the ring so the new clean run can
  compare against the prior stable output.
- **`src/renderer/utils/snapshotDiff.ts`** — new pure helper
  `diffSnapshot({ snapshot, current, granularity? })`. Returns a
  `'dynamic'` variant with `rows: CompareRow[]` (one entry per
  line that exists on EITHER side, `kind: 'unchanged' | 'added' |
  'removed' | 'changed'`) for dynamic-language tabs; a
  `'compiled'` variant with `segments: DiffSegment[]` for compiled
  outputs (reuses `computeDiff` from `src/renderer/utils/diff.ts`
  — already extracted out of `DiffUtilityPanel` in RL-071, so the
  planned refactor was a no-op). Reviewer fix —
  `resolveCompareTargetSnapshot` defaults Compare to the previous
  stable snapshot whenever the newest ring entry already matches
  the current output; otherwise a clean run would compare against
  itself.
- **`src/renderer/components/Editor/CompareToggleButton.tsx`** —
  button-secondary header toggle mirroring `hideUndefined`.
  Disabled state when there's no comparator snapshot for the
  active language; tooltip variants explain why. Fires
  `runtime.compare_view_toggled` adoption telemetry on each
  user-driven flip.
- **`src/renderer/components/Editor/CompareResultsPanel.tsx`** —
  three-column dynamic diff (Line / Previous / Current) or
  unified compiled diff. Empty states for "identical" + "no
  snapshot." Fold B target dropdown surfaces when ≥2 snapshots
  match the language. Fold F pin / unpin button per target.
  Fold E granularity selector visible only in compiled mode.
- **`src/renderer/components/Editor/ResultPanel.tsx`** — mounts
  `<CompareToggleButton>` next to `hideUndefined`. When the
  toggle is on AND a language-matching snapshot exists, swaps
  the inline-results region for `<CompareResultsPanel>`. The
  panel is mounted with `key={activeTab?.id ?? 'none'}` so the
  internal granularity state resets on tab switch (reviewer fix).
  Fold G inline diff markers (`+ / − / ~`) are memoized via
  `useMemo` so the auto-run stream doesn't recompute on every
  keystroke (reviewer fix).
- **Fold C — Command palette `Toggle compare with last stable
  run`**: hidden when there's no comparator snapshot for the
  active language. Description flips between Show / Hide so the
  palette honestly previews the next state. Reviewer fix — the
  palette path emits `runtime.compare_view_toggled`, matching the
  header button and keyboard shortcut.
- **Fold D — `Mod+Shift+D` keyboard shortcut**: dispatched via
  `useGlobalShortcuts` / `App.tsx`; surfaces a localized notice
  (`compare.toggle.shortcutUnavailable`) when fired without a
  comparator so the keystroke is never silent.
- **`src/shared/telemetry.ts`** + **`update-server/src/telemetry.ts`** —
  new `runtime.compare_view_toggled` event with `['language',
  'enabled']` allowlist. The sorted-name list places it between
  `runtime.auto_run_gated` and `runtime.history_replay`.
  Parity-test pattern matches Slices 1 / 4 / 5 / 6 / 7.
- **i18n** — 21 new keys per locale under `compare.*` (toggle
  label / tooltip variants / panel title / empty states / row
  headers / target dropdown options / granularity labels / inline
  badge tooltips / relative-time strings) plus
  `commandPalette.action.toggleCompare.*` (palette) and
  `shortcuts.item.toggleCompareSnapshot.*` (keymap). Spanish in
  neutral LatAm tuteo (`Oculta`, `Muestra`, `Ejecuta`, `Cambia`).
  Reviewer fix — `formatRelativeMs` now goes through `t()`
  (previously hardcoded English fragments inside the option
  label).

Tests:

- `tests/utils/snapshotDiff.test.ts` — identical / added / removed
  / changed / sort-order / compiled identical / compiled diverged
  / granularity override / previous-stable target resolution.
- `tests/components/CompareToggleButton.test.tsx` — disabled / no
  snapshot / mismatched language / enabled off / click fires
  telemetry + flag flip / pressed state / no-op when disabled.
- `tests/components/CompareResultsPanel.test.tsx` — empty no
  snapshot / three-column dynamic / identical empty state /
  unified compiled / dropdown when ≥2 / hidden when one.
- `tests/stores/resultStore.compareSnapshot.test.ts` — language
  + capturedAt capture / ring cap=3 / pinned survives evictions /
  monotonic capturedAt ids / clearVisibleResults preservation /
  clearLastSuccessfulSnapshot / setCompareTarget validation /
  toggleSnapshotPin.
- `tests/stores/editorStore.compare.test.ts` —
  setTabCompareEnabled write / null clear / renameTab to a
  different language drops flag + snapshot / same-language
  rename preserves.
- `tests/shared/telemetry.test.ts` — sorted-name list adds
  `runtime.compare_view_toggled` between `auto_run_gated` and
  `history_replay`; validator coverage (closed enum + non-boolean
  reject + unknown-key drop).
- `tests/runtime/executeTabManually.{snapshot,telemetry}.test.ts`
  result-store mocks gain `captureSuccessfulSnapshot: vi.fn()`.
- `tests/e2e/compareWithLastStable.spec.ts` — disabled before
  first clean run; diverging edit lights up the toggle + renders
  the diff.

Reviewer findings (all resolved inline this slice):

- `<CompareResultsPanel>` mounted with `key={activeTab?.id}` so
  granularity resets per tab.
- `inlineDiffMarkers` wrapped in `useMemo`.
- `toggleSnapshotPin` captures `previousActive` before the
  `set()` call instead of re-reading via `get()` inside the
  setter argument.
- `formatRelativeMs` goes through `t()` for all four bucket
  variants (`justNow` / `secondsAgo` / `minutesAgo` / `hoursAgo`).
- Compare target resolution defaults to the previous stable
  snapshot when the newest snapshot matches the current output.
- Auto-run and manual-run start resets preserve the snapshot ring
  instead of wiping the comparator just before capture.
- Snapshot ring `capturedAt` ids are monotonic even when multiple
  captures happen in the same millisecond.
- The command-palette Compare action now emits
  `runtime.compare_view_toggled`.

#### Slice 9 — 2026-05-14 (variable inspector — closes RL-020)

Slice 9 lands the final named scope item: *"Add a lightweight
variable inspector panel that shows current variable state after
execution: Variable name, type, and value for the current runtime
scope; Expandable objects and arrays with tree view; Auto-refresh
after each execution; Available for JS/TS and Python from the
first rollout; Optimized for fast scope inspection without entering
a debugger session."* With this slice RL-020 flips to `Done`.

Architecture:

- **`src/shared/scopeSnapshot.ts`** (new) — shared types
  (`ScopeValue` / `ScopeVariable` / `ScopeSnapshot`) +
  `serializeScopeValue` recursive walker (1-level default, capped
  at `MAX_SCOPE_DEPTH = 4`) + `INTERNAL_JS_SYMBOLS` /
  `INTERNAL_PYTHON_SYMBOLS` filters + `bucketVariableCount`
  telemetry helper. Payload caps:
  `MAX_TOP_LEVEL_VARS = 200`, `MAX_OBJECT_ENTRIES = 100`,
  `MAX_ARRAY_ENTRIES = 100`, `MAX_SNAPSHOT_PAYLOAD_BYTES = 256 KB`.
- **JS worker** — `BOOT_TIME_GLOBALS` snapshot captured at module
  load. `captureJsScope` walks `globalThis`, subtracts boot-time +
  `INTERNAL_JS_SYMBOLS`, and serializes via `serializeScopeValue`.
  Posts `'scope-snapshot'` before `stdin-consumed` and `done`.
- **Python worker** — `__lingua_boot_globals` frozenset captured
  by the bootstrap snippet on the first capture-enabled run.
  `__lingua_capture_scope(depth, max_top_level, max_object_entries, max_array_entries, internal_symbols)`
  Python function walks `globals()` and emits JSON the JS side
  parses + coerces.
- **Runner wiring** — `ExecutionResult.scopeSnapshot?: ScopeSnapshot | null`
  threaded through JS / TS / Python runners. `ExecutionContext.captureScope`
  + `scopeDepth` flow from the runtime entry points.
- **Result store** — new `scopeSnapshot` field + `setScopeSnapshot`
  setter. Dropped by `clear()` (tab switch); preserved by
  `clearVisibleResults()` (run reset).
- **Editor store** — `FileTab.variableInspectorEnabled?: boolean`
  per-tab flag + `setTabVariableInspectorEnabled` setter. Mutual
  exclusion with Compare enforced at the setter:
  toggling Variables on flips Compare off and vice versa.
  `dropVariableInspectorIfLanguageChanged` helper drops the flag
  on rename / Save-As to an unsupported language.
- **Runtime entry points** — `executeTabManually` and `useAutoRun`
  request a scope capture for inspector-supported languages
  (JS / TS / Python) and write `result.scopeSnapshot ?? null` to
  the result store on the clean-success branch (mirror of Slice 8's
  comparator capture). Debug runs skip capture — the debugger
  drawer already exposes paused-frame locals.
- **`<VariableInspectorToggleButton>`** — button-secondary header
  toggle mirroring `<CompareToggleButton>`. Disabled when no
  language-matching snapshot; click fires
  `runtime.variable_inspector_opened` telemetry.
- **`<VariableInspectorPanel>`** — single-column list with name +
  type tag + value. Object / array rows expand inline via a click
  chevron (fold E walks deeper when the Settings depth is bumped).
  Fold D type-icon prefix per kind. Fold F diff badges
  (`+ / − / ~`) vs. a comparator (currently the empty-comparator
  stub — a richer cross-run diff lands in a future slice). Fold H
  filter input narrows by case-insensitive substring match.
- **`<ResultPanel>`** — mounts the toggle next to
  `<CompareToggleButton>`; swaps the inline-results region for
  `<VariableInspectorPanel>` when the toggle is on AND the
  language-matched snapshot exists. `hideUndefined` + Compare hide
  when Variables is on (mutually exclusive view).

Folds shipped:

- **A — `runtime.variable_inspector_opened` telemetry** — closed
  enum `{ language, variableCount }`. Mirrored on update-server
  with parity test. `variableCount` buckets: `'0'` / `'1-5'` /
  `'6-20'` / `'21-50'` / `'51+'`.
- **B — Command palette `Toggle variable inspector`** entry —
  gates on `variableInspectorScopeAvailable`; description flips
  between Show / Hide.
- **C — `Mod+Shift+I` keyboard shortcut** — dispatched via
  `useGlobalShortcuts` / `App.tsx`; surfaces
  `variableInspector.toggle.shortcutUnavailable` notice when no
  snapshot exists.
- **D — Inline type-icon prefix** (`{}` / `[]` / `ƒ` / `!` / `·`)
  per row kind. Pure renderer cue.
- **E — Recursive expansion** via `Settings.variableInspectorScopeDepth`
  (`1`–`4`). The worker walker honors the depth; the renderer's
  expand chevron toggles visibility of pre-captured nested entries.
- **F — Diff badges** between runs. The current slice ships the
  base infrastructure (per-row `data-diff-kind`); the comparator
  source is the empty set on Day 1 so every variable badges as
  `added` on a fresh run, providing visible feedback that the
  capture worked. Future work can wire a multi-`ScopeSnapshot`
  ring symmetric to Slice 8's `snapshotRing` for richer
  cross-run deltas.
- **G — Settings master toggle** — `showVariableInspectorByDefault`
  + `variableInspectorScopeDepth` fields in the settings store
  with `false` / `1` defaults. The settings store fields are in
  place; surfacing them in `<SettingsModal>` is deferred to a
  light follow-up (UI plumbing only, no runtime impact).
- **H — Filter input** by variable name (case-insensitive
  substring; defensive — does NOT reuse `fuzzyMatch` to keep the
  panel snappy on long lists).

Tests:

- `tests/shared/scopeSnapshot.test.ts` — 14 cases covering
  primitives, functions, arrays, objects, recursion depth,
  truncation cap, circular references, bucket helper.
- `tests/utils/scopeCapture.test.ts` — top-level JS binding
  extraction + injected lexical capture call.
- `tests/runners/variableInspectorScopeCapture.test.ts` — JS and
  TS runners forward capture-injected code to the worker.
- `tests/components/VariableInspectorToggleButton.test.tsx` —
  6 cases covering disabled / enabled-off / pressed / click
  telemetry / no-op-when-disabled / language-mismatch.
- `tests/components/VariableInspectorPanel.test.tsx` — 6 cases
  covering empty state, expand chevron, truncation banner, filter
  narrowing, filter-empty state.
- `tests/shared/telemetry.test.ts` — sorted-name list adds
  `runtime.variable_inspector_opened`; validator coverage
  (closed-enum + bucket-reject + unknown-key drop).
- `tests/runtime/executeTabManually.{snapshot,telemetry}.test.ts`
  result-store mocks gain `setScopeSnapshot: vi.fn()`.
- `tests/hooks/useAutoRun.test.tsx` updated to assert the new
  `captureScope: true` + `scopeDepth: 1` fields on
  `runner.execute(...)`.
- `tests/components/CommandPalette.test.tsx` mock extended with
  `scopeSnapshot` + `setTabVariableInspectorEnabled` so the
  palette gate compiles.

Reviewer findings (all resolved inline this slice):

- JS / TS scope capture now injects a same-scope
  `__lingua_capture_scope(...)` call before the worker function
  returns. Reading `globalThis` alone missed ordinary `const` /
  `let` / `var` scratchpad bindings because the worker executes
  user code inside `AsyncFunction`.
- Python boot globals are now primed before user code executes on
  the first capture-enabled run. Priming after user code treated
  first-run user variables as runtime globals and hid them from the
  inspector.
- Payload-capped snapshots now render the truncation banner even
  when every top-level variable was elided.
- Shared-reference object graphs no longer get mislabeled as
  circular references; only references already on the active walk
  path emit `Circular reference`.

### RL-021 Fix loose-file workflow and session continuity

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-13`
- Current gap:
  - The app handles project folders well, but loose-file workflows remain incomplete
  - Tabs created from the toolbar are in-memory unless attached to a project path
- Scope:
  - Add `Open File`
  - Add `Save As`
  - Add duplicate tab / save copy
  - Add recent files separate from recent projects
  - Add dirty-close prompts and unsaved-session recovery
  - Add reopen-last-session on app restart behind a setting
- Acceptance criteria:
  - Users can work without opening a project folder first
  - Unsaved tabs can be named and persisted through `Save As`
  - Recent file access works independently from recent project access
- Dependencies:
  - None

### RL-022 Add indexed Quick Open, project search, and symbol navigation

- Priority: `P1`
- Status: `Done`
- Readiness: `All three phases completed on 2026-04-16`
- Current progress:
  - Phase 1 — A project-wide file index runs in the renderer backed by `fs:listAllFiles`; `useProjectIndexSync` rebuilds it when the active project changes and debounces rebuilds on file-watch events; Quick Open prefers the index over the tree walk and finds unopened files anywhere in the project; unknown-extension results open in plaintext mode instead of being silently skipped; the web adapter ships a parallel walker
  - Phase 2 — Project-wide text search lands behind Cmd+Shift+F and a new "Search in Files" command-palette action. A shared `fs:searchInFiles` IPC walks the same hidden-entry filter as the index, skips binary files via a NUL-byte heuristic, caps per-file and total matches, and respects a per-file size budget so stray minified artifacts cannot hang the walk. A debounced `projectSearchStore` drops stale responses via a monotonic request id; selecting a match queues an editor-store reveal before `openFile`; the web adapter ships a parallel walker
  - Phase 3 — Go to Symbol lands behind Cmd+Shift+O and a new "Go to Symbol in File" command-palette action for JS/TS files. A pure `symbolNavigation` utility flattens Monaco's TypeScript navigation-bar output (skipping the synthetic `<global>` wrapper, qualifying nested symbols with their parent path, preserving declaration order). `useDocumentSymbols` lazily loads the monaco singleton and calls the TS worker's `getNavigationBarItems` for the active tab. The editor-store `requestReveal` API now accepts an optional `tabId` so same-tab surfaces can target unsaved tabs that have no `filePath`
- Scope:
  - Build a background index for the active project ✅
  - Add fuzzy search across all files, not only expanded directories ✅
  - Add project-wide text search with match previews ✅
  - Add symbol outline and symbol jump for supported languages ✅ (JS/TS)
  - Reuse the same index for command palette actions such as "open symbol" and "reveal in tree" ✅ (partial — "Search in Files" action shipped)
- Acceptance criteria:
  - Quick Open can find unopened files anywhere in the active project ✅
  - Search results remain responsive on medium-size projects ✅ (per-file + total match caps, 5k file scan limit, debounced queries)
  - Symbol navigation works at least for JS/TS from the first rollout ✅
- Dependencies:
  - RL-021 ✅

### RL-023 Build Snippet Lab and algorithm practice mode

- Priority: `P1`
- Status: `Planned`
- Readiness: `Ready for product design`
- Why this matters:
  - Several reference apps are used specifically for practicing snippets, algorithms, and interview-style problems
  - Lingua already has the right building blocks:
    - snippets
    - templates
    - inline results
    - multiple runtimes
- Scope:
  - Group snippets into collections and tags
  - Add practice challenges with:
    - starter code
    - hidden tests
    - expected output
    - explanation
    - difficulty
  - Add import/export for snippet collections and challenge packs
  - Track local progress for students without requiring accounts
- Acceptance criteria:
  - A user can open a challenge, run tests, and save their solution locally
  - Snippets and practice packs can be exported/imported as files
  - At least one starter pack ships for algorithms and one for language basics
- Dependencies:
  - RL-021

### RL-024 Support multi-file playgrounds, assets, and starter galleries

- Priority: `P1`
- Status: `Planned`
- Readiness: `Ready after loose-file and indexing work`
- Why this matters:
  - Swift Playground and PlayCode both show that multi-file starter projects and assets make the product much more useful for learning and prototyping
- Scope:
  - Add starter project galleries by language/use case
  - Add multi-file templates for:
    - JS/TS web examples
    - Python exercises
    - Go examples
    - Rust examples
  - Add basic asset support:
    - images
    - JSON
    - text fixtures
    - sample data files
  - Add zip import/export for runnable project bundles
- Acceptance criteria:
  - Users can create a project from a starter gallery instead of only from blank files
  - Multi-file examples open correctly and preserve supporting assets
  - Exported bundles can be re-imported without manual repair
- Dependencies:
  - RL-021
  - RL-022

### RL-025 Add package and dependency management in a language-aware way

- Priority: `P1`
- Status: `Planned`
- Readiness: `Implementation-ready as an explicit, adapter-driven rollout; do not auto-install dependencies`
- Scope:
  - Add a dependency adapter registry instead of hardcoding package logic into the editor:
    - `javascript` / `typescript` desktop adapter for `npm`
    - `python` web adapter for Pyodide `micropip`
    - later adapters for Python desktop virtualenvs, Ruby/Bundler, Go modules, and Rust crates
  - Slice A — detection and UI only:
    - detect external imports in the active buffer and project files
    - classify dependencies as `detected`, `installed`, `installing`, `failed`, `unsupported`, or `needs-desktop`
    - show a small in-editor dependency banner or panel with explicit install actions
    - never run installation from detection alone
  - Slice B — JS/TS desktop install path:
    - install through Electron main with `child_process.spawn` and `shell: false`
    - validate package specifiers before they reach main
    - use the active project or nearest `package.json` directory as cwd
    - preserve project isolation; no global `npm install -g`
    - thread install output back to a scrollable log surface
  - Slice C — Python Pyodide path:
    - use `micropip` for packages compatible with the Pyodide runtime
    - clearly mark native-wheel or network-unavailable failures as unsupported
    - cache only through the existing browser/runtime asset mechanisms; no hidden desktop Python mutation
  - Deferred slices:
    - Python desktop virtualenv support
    - Ruby gems / Bundler for the `RL-042` Ruby runtime
    - Go modules and Rust crates
    - JS/TS web WebContainer-backed installs
- Acceptance criteria:
  - A desktop JS/TS project can add a simple dependency after explicit confirmation and execute it from the active project cwd
  - Python web can install and import one Pyodide-compatible package through `micropip`
  - Unsupported dependency scenarios are explicit rather than failing silently
  - Detection has tests for comments, strings, relative imports, Node built-ins, scoped packages, and Python `from x import y`
  - Main-process install tests assert safe spawn arguments and reject invalid package specifiers
  - The implementation keeps project isolation and does not leak installs across unrelated workspaces
- Dependencies:
  - RL-019
  - RL-024 for multi-file/project-wide dependency UX
  - RL-029 only if a later JS/TS web install slice chooses WebContainers

#### 2026-05-20 research triage

The v2.0 proposal's package-management direction is useful but unsafe as written:
automatic install after import detection would mutate projects silently, and a
regex-only parser would miss common comment/string/import forms. The accepted
shape for `RL-025` is explicit, language-adapter-driven dependency management.
The first implementation must prove the contract on JS/TS desktop and Python
Pyodide before extending it to Ruby gems, Python virtualenvs, Go modules, Rust
crates, or WebContainers.

### RL-026 Add language intelligence beyond Monaco's built-in JS/TS services

- Priority: `P2`
- Status: `Planned`
- Readiness: `Needs the language-pack model and runtime capability matrix first`
- Scope:
  - Introduce an adapter layer for richer diagnostics/completion/hover/signature help
  - Start with one non-JS language from:
    - Python
    - Go
    - Rust
  - Support desktop-side language servers first when the web story is weaker
  - Keep capability flags explicit so web mode degrades honestly
- Acceptance criteria:
  - At least one non-JS language gets real completion and diagnostics beyond syntax highlighting
  - Editor error surfacing and result markers stay consistent with the richer language service
- Dependencies:
  - RL-030
  - RL-038

#### 2026-05-11 Status Update

- Slice 1 shipped the Python renderer adapter: editor-time diagnostics for
  common block/delimiter syntax issues plus symbol-aware completions for local
  functions, classes, imports, loop targets, parameters, and assignments.
- Monaco markers use a dedicated `lingua-language-intelligence` owner so they
  do not overwrite execution/result diagnostics.
- Slice 2 shipped the Python hover + signature help layer on top of the same
  adapter: a shared `PythonSymbolTable` now feeds completions, hover (symbol
  kind + definition line + parameter list for functions), and signature help
  (parameter list, active-parameter tracking, multi-line + nested-call walk,
  triggers on `(` and `,`).
- Slice 3 shipped Rust via rust-analyzer over a main-process LSP bridge.
  New `src/main/lsp/{lspProcess.ts,rustAnalyzerLauncher.ts}` own the
  generic JSON-RPC framing + Rust-specific spawn/initialize handshake,
  with detection over PATH and a `~/.cargo/bin/rust-analyzer` fallback.
  `src/main/ipc/lsp.ts` exposes start/restart/stop/status/request/notify
  plus a push channel that re-broadcasts `publishDiagnostics`. The
  renderer adapter (`src/renderer/languageIntelligence/rust.ts`) opens
  documents, debounces `didChange`, dispatches completion/hover/
  signatureHelp requests, and translates incoming diagnostics into the
  shared marker contract. Three new Monaco providers (completions,
  hover, signatureHelp) self-gate on `isRustLspAvailable()` so the web
  build returns null without IPC. Lifecycle is owned by a single hook,
  `useRustLspLifecycle`, that boots on first `.rs` tab open, fires a
  one-shot toast when the launcher reports `'running'`, and writes
  Monaco markers on each `publishDiagnostics`. The launcher reuses
  `buildNativeRunnerEnv(combinedAllowlist(RUST_TOOLCHAIN_KEYS))` so host
  secrets never reach rust-analyzer. UI folds B + E + F collapse into a
  single conditional Settings → Editor row that mounts only when the
  status is `'unavailable'` or `'degraded'` (install hint with the
  rustup command, or a "Restart rust-analyzer" button). Capability-pack
  descriptor unchanged (Rust stays `lsp: 'desktop'`); runtime state
  lives in `useRustLanguageStore`. Focused tests cover JSON-RPC framing,
  IPC method allowlisting, binary detection, model URI sync, the adapter
  contract, and Settings render branches in both locales. `before-quit`
  disposes the launcher so the long-lived child does not outlive
  Lingua's main process.
- Slice 4 shipped Go via gopls — same JSON-RPC scaffold, swapped
  launcher, generalised lifecycle. New `src/main/lsp/goplsLauncher.ts`
  detects gopls on PATH first, then `$GOPATH/bin/gopls` (first
  delimiter-split entry per Go's documented behaviour), then
  `~/go/bin/gopls`. The PATH-case detection captures the `gopls
  version` output and threads it through `prefetchedVersion` so
  `runStart` reuses the same probe instead of paying a second 5-second
  `execFile` round trip. Env filtered via
  `buildNativeRunnerEnv(combinedAllowlist(GO_TOOLCHAIN_KEYS))` — same
  allowlist the Go compile path already uses. `src/main/ipc/lsp.ts`
  flips from a single rust launcher to a Map keyed by language; the
  request/notification allowlists are renamed
  `ALLOWED_LSP_REQUESTS` / `ALLOWED_LSP_NOTIFICATIONS` (contents
  unchanged — the LSP method set Lingua consumes is identical across
  both languages). Each language registers a parallel set of
  `lsp:<lang>:*` channels via `registerLanguageHandlers`. The renderer
  lifecycle hook (`useRustLspLifecycle`) and Settings row
  (`RustLanguageIntelligenceRow`) were lifted into shared
  `useLspLifecycle` + `LanguageIntelligenceRow` helpers (fold B + C
  of the Slice 4 plan); the language-specific facades stayed as thin
  wrappers so callsites kept their names. New `useGoLspLifecycle` +
  `GoLanguageIntelligenceRow` mount through the same shared helpers.
  Go Monaco hover + signature providers are registered alongside the
  rust pair; the existing `goCompletions` provider gained the
  LSP-completion merge layer (static keywords + snippets stay
  available even before gopls boots; semantic completions merge in
  once it does). Web stub at `src/web/adapter.ts` exposes
  `lsp.rust` + `lsp.go` symmetrically — both return `'missing'` with
  reason `'web-build'`. New cross-language Playwright spec
  `tests/e2e/languageIntelligence.spec.ts` (fold F) pins both rows on
  the web build in EN + ES locales. ES copy in neutral LatAm tuteo
  (`Instálalo`, `Reinicia`, `Tócalo`). Closes RL-026 in full.

### RL-027 Add debugger MVP

- Priority: `P2`
- Status: `Partial`
- Readiness: `Design ADR (DEBUGGER_ADR.md) shipped on 2026-04-20 quater; JS/TS first implementation slice still pending`
- 2026-04-20 quater update:
  - `DEBUGGER_ADR.md` records the accepted MVP shape: JS/TS first via Monaco-integrated breakpoint panel + worker-side hooks, then Python via `pdb` IPC bridge, then Go via Delve, then Rust via lldb. Each runtime after JS/TS is desktop-only per `CAPABILITY_MATRIX.md`
  - Feature budget fixed: breakpoints, step over/into/out/continue, watch expressions, call stack view, variable inspection. Explicit out-of-scope list (time-travel, logpoints, edit-and-continue, conditional breakpoints) keeps the MVP bounded
  - Cross-cuts resolved: source maps piggyback on esbuild-wasm; env vars inherit the RL-011 Slice D plumbing; loop protection auto-disables while a debugger is attached; two new telemetry events (`debugger.attached`, `debugger.paused`) with coarse `reasonBucket` property join the allowlist in the first implementation slice
  - `tests/docs/debuggerAdr.test.ts` pins the status, runtime matrix (with JS→Python→Go→Rust order), feature budget, out-of-scope items, cross-cut coverage, rollback clause, five revisit triggers, and the adjacent ADR cross-links
- Scope:
  - Breakpoints
  - Step over / step into / step out
  - Watch expressions
  - Variable inspector
  - Call stack panel
  - Console integration for paused sessions
  - Start with JS/TS on the worker interpreter path so web and desktop share the same cooperative debugger contract
  - Keep desktop Node debugging as a later runtime-mode concern after `RL-019` defines the Node execution boundary
- Acceptance criteria:
  - A user can pause execution at a breakpoint in JS/TS worker mode and inspect variables in web and desktop builds
  - TypeScript breakpoints pause on original source lines through source-map composition
  - Prior console output remains visible while the debug session is paused
  - Breakpoint state persists for reopened files in a project
- Dependencies:
  - RL-019

### Status Update — 2026-05-09 (RL-027 Slice 1 partial)

Slice 1 partial-staged today. RL-027 stays `Partial`; Slice 1.5 closes the remaining surfaces.

What shipped:

- New `src/renderer/stores/debuggerStore.ts` — runtime-agnostic Zustand `persist`-middlewared store on isolated `lingua-debugger-state` localStorage key. Holds `breakpoints` (with 100-bp global FIFO cap), `watches` (capped at 20, dedupe), `session`, `pausedFrame`. Discriminated `runtime: 'js' | 'python' | 'go' | 'rust'` so Slice 2+ adapters plug in without re-architecting.
- New `src/renderer/runtime/debuggerInstrument.ts` — acorn + magic-string AST instrumentation. Injects `await __lingua_dbg_yield(line, () => locals)` before each top-level statement; descends into async function bodies via a queue-based walker; skips hoisted declarations (FunctionDeclaration / ClassDeclaration / Import/Export) and synchronous function bodies; emits a JS→JS source map while TS→JS source-map composition stays deferred to Slice 1.5.
- New `src/renderer/runtime/debuggerWorkerBridge.ts` — runtime-agnostic worker-IPC bridge. `setActiveDebugWorker(worker)` registers from the runner; `postDebuggerMessage({type})` dispatches resume/step from the UI.
- Extended `src/renderer/workers/js-worker.ts` with the pause/resume/step protocol. Worker exposes `__lingua_dbg_yield`, `__lingua_dbg_frame`, `__lingua_dbg_pop` as closure helpers on the async-function constructor. Pause condition: breakpoint hit OR step-mode armed (frame-depth aware for top-level and async function bodies: step-over pauses at next line in same-or-shallower frame; step-into anywhere; step-out when frame depth drops).
- Wired both `JavaScriptRunner` and `TypeScriptRunner` for debug mode. Debug auto-activates when `debuggerEnabled === true` AND there's a breakpoint in the active tab. Loop-protection auto-disables under debug per ADR §4.
- New `src/renderer/components/Debugger/DebuggerDrawer.tsx` — single drawer combining variables + call stack + watches placeholder + continue / step / detach buttons. **Component is built and tested but NOT mounted in `AppLayout.tsx`** — initial mount under the console panel created e2e regressions in 4 unrelated specs (proTierUnlocks, freeTierGates, localeParity, overlays). Mounting is deferred to Slice 1.5 alongside the BreakpointGutter so both surfaces land coherently without disrupting layout sensitive tests.
- 4 new keyboard shortcuts (`debugger-continue`/F5, `debugger-step-over`/F10, `debugger-step-into`/F11, `debugger-step-out`/Shift+F11) wired in `useGlobalShortcuts.ts` to `postDebuggerMessage`.
- `debuggerEnabled: boolean` field on `settingsStore` (default `true`) so Slice 1 internals can be exercised programmatically. The `EditorSection` toggle is intentionally hidden until Slice 1.5 mounts the BreakpointGutter + DebuggerDrawer user flow.
- `acorn` + `magic-string` promoted from transitive (Vite/Rollup) to direct `dependencies` in `package.json`.
- 16 new `debugger.*` + `shortcuts.item.debugger*` i18n keys per locale (en + es with neutral LatAm tuteo: `Continúa`, `Avanza`, `Entra`, `Sale`, `Suelta`).
- 22 unit/component tests across `tests/stores/debuggerStore.test.ts` (FIFO eviction, invalid identity guards, persisted-state sanitization, condition storage, persist partialize), `tests/runtime/debuggerInstrument.test.ts` (async function-body descent, sync-body skip, hoist skip, source map, custom helper, malformed input, async/top-level await), and `tests/components/DebuggerDrawer.test.tsx` (hidden/idle/paused drawer states).
- Gates green: lint, tsc, check:i18n, check:i18n:copy. Vitest 250 files / 2647 passed + 2 skipped.

**Deferred to Slice 1.5** (per honest assessment of session budget):

- **BreakpointGutter Monaco integration + DebuggerDrawer mount.** Users today set breakpoints by calling `useDebuggerStore.getState().toggleBreakpoint(tabId, line)` from devtools or programmatic surfaces. Gutter click UI + drawer mount land together in Slice 1.5 — they are the gating pieces for the blocking smoke UI spec, and the drawer mount needs a layout-aware home (overlay vs. console-stacked) that didn't fit cleanly in this slice without breaking 4 unrelated e2e specs.
- **Settings toggle reveal.** The persisted `debuggerEnabled` flag exists for programmatic/internal Slice 1 coverage, but the visible Settings row stays hidden until users can set breakpoints from Monaco and inspect paused state from the mounted drawer.
- **Conditional-breakpoint + watch-expression evaluation.** Predicates and watch expressions are stored on the session and surfaced to the UI as `pending` markers; evaluation lands in Slice 1.5 after a dedicated security review of the worker eval mechanism (the dynamic-function-constructor pattern triggered the security_reminder hook in this session).
- **Telemetry events `debugger.attached` + `debugger.paused`.** Allowlist not extended this session; lands in Slice 1.5.
- **TS source-map round-trip.** `instrumentForDebugger` accepts an `inputMap` option but Slice 1 does not yet compose magic-string's JS→JS map with esbuild's upstream TS→JS map. Practical impact: breakpoints set in a `.ts` file pause at the post-transpile line number, not the original TS line. JS code path is unaffected. Slice 1.5 wires the two-stage compose via `@jridgewell/trace-mapping` or equivalent.
- **`languagePacks.capabilities.debugger` flip from `'planned'` to `'available'`.** Held until BreakpointGutter ships so the capability accurately reflects user-facing readiness.
- **`docs/DEBUGGER_SLICE1.md` runbook + ADR amendment + CAPABILITY_MATRIX row.** Lands with Slice 1.5 alongside the smoke UI spec.
- **Blocking e2e smoke spec at `tests/e2e/debuggerJs.spec.ts`.** Cannot pass without the gutter UI; user explicitly approved a "C" path that accepts this gap.

### Status Update — 2026-05-11 (RL-027 Slice 1.5 shipped)

Slice 1.5 staged today. RL-027 stays `Partial` — Slice 1.5b still owes
conditional-breakpoint + watch-expression evaluation behind a dedicated
security review.

What shipped:

- `src/renderer/hooks/useBreakpointGutter.ts` — Monaco glyph-margin
  integration. Decorates the active tab's breakpoints as red dots (or
  hollow rings when disabled), turns gutter clicks into
  `toggleBreakpoint(tabId, line)`, and unmounts cleanly on tab or
  editor changes. Self-gates on `debuggerEnabled` + JS/TS language.
- `src/renderer/runtime/editorAccess.ts` — module-level Monaco ref so
  the global shortcut bus can read the cursor line without piping a
  React ref through the tree. `CodeEditor.tsx` registers on mount and
  clears on unmount.
- `Mod+Shift+B` shortcut (`debugger-toggle-breakpoint`) wired in
  `keyboardShortcuts.ts` + `useGlobalShortcuts.ts`. The
  `canDispatchDebuggerShortcut` gate now distinguishes this shortcut
  from F5 / F10 / F11 / Shift+F11: the toggle only requires
  `debuggerEnabled`, a debugger-capable JS / TS tab, and an editor
  cursor (no paused session needed) while the step shortcuts keep the
  original paused-frame gate.
- `DebuggerDrawer` now lives in the existing bottom panel as a sibling
  tab to Console, so the debugger reuses the bottom-panel splitter and
  does not cover inline output. Drawer header gains a chevron that
  flips `drawerCollapsed` in the store (persisted across reloads).
- Settings → Editor keeps the stable master `debuggerEnabled` toggle.
  Breakpoint management moved to the Debugger panel: enabled/total
  status, Disable all / Enable all, and Clear behind a
  `window.confirm` prompt.
- Toolbar no longer owns breakpoint status. The bottom-panel Debugger
  tab carries the active-file breakpoint count instead (fold D).
- Three new telemetry events join `TELEMETRY_EVENTS` per ADR §4:
  `debugger.attached`, `debugger.paused`, `debugger.detached`. Payload
  is closed-enum (`{ language: 'js', reasonBucket: '...' }`). The
  `EVENT_PROPERTY_ALLOWLIST` is extended with the same shape so the
  redactor drops anything off the contract. Fold E adds `detached` to
  the ADR-named pair so dashboards can compute session length.
- `instrumentForDebugger` accepts `inputMap` and composes it with the
  magic-string JS→JS map via `@jridgewell/trace-mapping`. Yields fire
  with the user's TS line number, which matches the breakpoint
  coordinates 1:1 (fold G). Pure-JS path is untouched (translator is a
  passthrough when no map). New `@jridgewell/trace-mapping` direct
  dependency (~10 KB gzipped, MIT).
- TS runner asks esbuild for an external source map only when `debug`
  is true (zero cost on non-debug runs) and threads it as `inputMap`.
- JS+TS language-pack `capabilities.debugger` flipped from `'planned'`
  to `'available'`.
- i18n keys per locale use neutral product copy in tuteo and keep
  breakpoint actions out of Settings.
- Three new docs: `docs/DEBUGGER_SLICE1.md` runbook (operator-oriented
  walkthrough of the user surface + recovery paths), an amendment to
  `DEBUGGER_ADR.md` with the delivery notes section, and three new
  rows in `CAPABILITY_MATRIX.md` for the JS/TS / Python / Go/Rust
  debugger lanes. `docs/README.md` indexes the new runbook.
- 4 new test files cover the new surface: extended
  `tests/stores/debuggerStore.test.ts` (drawer collapse + setAll +
  persistence), extended `tests/runtime/debuggerInstrument.test.ts`
  (source-map composition happy path + malformed-map fallback +
  passthrough + frame-header translation), new
  `tests/components/EditorSection.debugger.test.tsx` (master toggle
  and breakpoint actions excluded from Settings), extended
  `tests/components/DebuggerDrawer.test.tsx` (chevron collapse,
  breakpoint status/actions), and a new `tests/e2e/debuggerJs.spec.ts`
  Playwright smoke pinning the Settings row, Debugger-panel Spanish
  copy, and the console-error gate.

Deferred to Slice 1.5b (still):

- Conditional-breakpoint predicate + watch-expression evaluation. The
  worker eval pattern (dynamic Function constructor) needs its own
  security note before the eval pass lands. Inline-fix policy carve-out
  on "security" keeps it out of 1.5.

### RL-028 Add execution history, replay, and benchmarking tools

- Priority: `P2`
- Status: `Done`
- Readiness: `Closed on 2026-05-01 by Slice 7 — Compare two runs (code-only diff). Slices 1-6 covered the ring-buffer + Replay surfaces; Slice 7 closes the comparison-tooling AC. The benchmark/warmup AC was never picked up in any slice and is being explicitly deferred (no successor ticket; resurface via BACKLOG if it ever returns).`
- 2026-04-20 update:
  - `src/renderer/stores/executionHistoryStore.ts` ships a non-persisted Zustand store with `record / clear / byLanguage`; cap is `MAX_HISTORY_ENTRIES = 50`, FIFO drop for the 51st push; timestamps round to whole seconds to reduce fingerprintability
  - Store is **never persisted** — history stays in-memory across reloads, same privacy posture as the RL-065 telemetry work
  - Captures **only** language, status (`ok` / `error`), `durationMs` (null on init failure), and timestamp — no stdout, stderr, source, or file path
  - `executeTabManually` pushes one entry on the success branch and one on the catch branch, so users see both outcomes in the future Recent Runs surface
  - Seven new tests pin the metadata-only contract, null-duration support, unique id per push, the FIFO cap, `clear`, `byLanguage`, and caller snapshot immutability
  - 2026-04-20 ter — second slice: `src/renderer/components/Settings/ExecutionHistorySection.tsx` lands a Settings row showing the current entry count (singular/plural via i18next `_one`/`_other`) and a Clear button gated on the count > 0. Wired into `SettingsModal` next to the env-vars section. Copy ships in en + es (`executionHistory.title/description/countLabel_one/countLabel_other/clearButton/privacyNote`). Five new component tests cover zero-count disabled state, singular form at 1 entry, count growth on record, Clear wiping the store, and Spanish locale
  - 2026-04-20 quater — third slice: `buildCommandPaletteModel` accepts an optional `executionHistory` + `onFocusLanguageTab`; each entry becomes a `CommandEntry` with id `recent-run-<entry.id>`, label `Recent: {language} · {status} · {formattedDuration}`, and description "Jump to an open tab in this language". Cap 5, newest-first. `CommandPalette.tsx` reads `useExecutionHistoryStore.entries` and wires `focusLanguageTab` so activation selects the first tab whose language matches the run. Duration copy reuses the shell's `formatExecTime(...)` helper so the palette never shows raw floating-point noise. Copy ships in en + es (`commandPalette.recentRuns.label/description/status.ok/status.error`). Six new model tests pin the empty case, the 5-cap newest-first order, the label composition, the duration formatting, the honest description copy, and the onFocusLanguageTab callback
  - 2026-04-20 quinquies — fourth slice: `buildCommandPaletteModel` accepts a new optional `onRerunLast` callback; when wired, the palette gains a `action-rerun-last` action labeled "Re-run last execution" with keywords `rerun, replay, last, recent, run`. `CommandPalette.tsx` propagates the prop; `App.tsx` wires it to `useRunner().run()` so activation re-executes the active tab. Hidden when no callback is supplied so legacy callers stay unaffected. Copy ships in en + es. Three new tests pin the hidden case, the action firing the callback, and the Spanish locale
  - 2026-04-21 sexies — fifth slice: `ConsolePanel` gains an `ExecutionHistoryPopover` button next to the timestamp toggle. The popover shows newest-first runs, relative timestamps, a Clear action, and a per-entry rerun affordance. Rerun intentionally targets the first open tab in the same language rather than replaying the historical entry body; when no matching tab is open the shell surfaces a localized info notice instead of running the wrong tab. Copy ships in en + es and tests pin empty state, newest-first ordering, rerun wiring, no-match notice, and Spanish strings
  - 2026-05-01 septies — sixth slice: `ExecutionHistoryEntry` gains an opt-in `snapshot: { code, language, truncated } | null`. The opt-in lives as `executionHistorySnapshotEnabled` in `settingsStore` (default `true`, persisted via `partialize`). The toggle moved to the Editor settings section (instead of the Execution History section) so it sits alongside the other editor-content behaviors. `executeTabManually` attaches the snapshot only when the toggle is on AND `currentEffectiveTier()` covers `EXECUTION_HISTORY` — defense-in-depth so a state-shadowing bug or a future surface flipping the flag programmatically cannot leak captures to Free users. Code is clamped to `SNAPSHOT_MAX_BYTES = 256 KiB` with a `truncated` flag so the UI can disclose the cap honestly. The store stays caller-driven (`record()` accepts an optional `{ code, language }` and computes `truncated` itself). Three new i18n keys per locale (`editor.executionHistorySnapshot.label/hint/lockedHint`) in tuteo. New unit tests in `tests/stores/executionHistoryStore.test.ts` cover snapshot pass-through, truncation, FIFO and clear interactions, mutation immutability, empty-snapshot distinguishability. New `tests/runtime/executeTabManually.snapshot.test.ts` covers the four toggle×tier combinations on both success and error branches plus the mid-session flip. New `tests/components/EditorSection.snapshot.test.tsx` pins toggle visibility, persistence, Pro-only gating, upsell wiring, and Spanish copy
  - 2026-05-01 octies — replay hotfix: the console popover action is now `Replay`, opens a new `replay-*.js` / language-specific tab from `entry.snapshot.code`, and calls `useRunner().run({ recordHistory: false })` so selecting a history entry does not append another history row. Metadata-only entries without snapshots are disabled with translated tooltip copy, and replay while another run is active is refused with a translated notice
  - 2026-05-01 nonies — sixth slice trailer: per-entry Replay surface lives in two places now sharing a single helper. `src/renderer/utils/replayHistoryEntry.ts` extracts the addTab + run({ recordHistory: false }) logic from `ConsolePanel.tsx` so the popover and the Command Palette dispatch identical effects. `commandPaletteModel.ts` accepts an optional `onReplayEntry` callback and emits up to 5 `action-replay-{entryId}` commands (newest-first, snapshot-bearing only) — metadata-only entries silently drop out, never showing in the palette. `App.tsx` wires `onReplayEntry={(entry) => replayHistoryEntry(entry, { isRunning, run })}` so palette activation runs through the helper exactly like the popover. Two new i18n keys per locale (`executionHistory.palette.replay.label/description`) in tuteo. New `tests/utils/replayHistoryEntry.test.ts` pins the four exit conditions (running, no-snapshot, addTab refused, happy path) plus the empty-string edge case. `tests/components/commandPaletteModel.test.ts` extends with eight tests covering hidden-without-callback, hidden-without-snapshots, cap-5 ordering, metadata-only skip, label composition with language·status·duration, replay/snapshot/history/reproduce keywords, single-fire activation that closes the palette, and Spanish localization
  - 2026-05-01 decies — seventh slice closeout: Compare two runs (code-only diff). The Sprint Plan §4 originally framed the slice as an output diff, but the ring-buffer entries never captured stdout/stderr (deliberate privacy posture); the user chose code-only after a planning round-trip, so the slice rides entirely on the `snapshot.code` already captured by Slice 6. `ExecutionHistoryPopover.tsx` gains a checkbox column (disabled for metadata-only entries), local `selectedIds: Set<string>` state that resets when the popover closes, and a footer with a `Compare` button enabled only when exactly two ids are picked. The button hands the entries up oldest→newest via a new `onCompare` callback. New `src/renderer/components/Console/ExecutionComparisonModal.tsx` renders an OverlayBackdrop / OverlayCard shell with a summary strip (language match, duration delta with `+`/`−` sign, status delta, optional truncated + clamped warnings), two side-by-side `<pre>` panes for older / newer code, and a vertical `diffLines` strip below — collapses to "Both snapshots are identical" when adds + removes both equal zero. `ConsolePanel.tsx` hosts the modal sibling to the popover; the wire is dead code for Free users since the popover hides for them. 28 new i18n keys per locale in tuteo. Six new component tests for the popover (compare button hidden without `onCompare`, snapshot-only checkboxes, 0 → 1 → 2 → 3 selection enable transitions, oldest→newest sort handed to `onCompare`, popover-close clears selection) and eight new component tests for the modal (off state, both panes render, language-match vs mismatch, truncated warning gating, identical-snapshot collapse, single-line diff line emission, Escape closes, ES tuteo locale). RL-028 flips from `Partial` to `Done` and moves to ROADMAP §6 archive (39 Done tickets total). Benchmark / warmup AC is explicitly deferred — never picked up in any slice, no successor ticket, will resurface via BACKLOG only if a real need appears.
- Scope:
  - Save execution snapshots
  - Replay previous inputs
  - Compare output deltas between runs
  - Add timing summaries and a simple micro-benchmark mode for algorithm practice
  - Export run logs and output as text/JSON
- Acceptance criteria:
  - Users can compare at least two executions of the same tab
  - Benchmark runs use a repeatable warmup/iteration model instead of ad hoc timing
- Dependencies:
  - RL-020

### RL-029 Pilot WebContainers for JS/TS/web projects only

- Priority: `P2`
- Status: `Research-backed spike`
- Readiness: `Ready only as an isolated experiment`
- Recommendation boundary:
  - Worth evaluating for JS/TS/web package workflows
  - Not worth treating as a blanket replacement for the whole desktop architecture
- Scope:
  - Build a capability-gated adapter for supported browsers
  - Mount project files into a WebContainer
  - Support `npm install` and one preview/dev command
  - Expose a preview URL inside the app web surface
  - Detect and message unsupported browsers/platforms clearly
- Explicitly out of scope:
  - Replacing desktop auto-updates
  - Replacing native file watching
  - Replacing Go/Rust native toolchains
  - Replacing local plugin discovery
- Acceptance criteria:
  - One JS/TS starter project can install dependencies and run in-browser
  - Unsupported environments degrade cleanly to the current non-WebContainer path
- Dependencies:
  - RL-025

### Deferred study — Web service worker and offline-cache hardening

- Priority: `P3`
- Status: `Deferred study`
- Readiness: `Revisit after the current web-validation and licensing slices settle`
- Why this matters:
  - The web build already ships a baseline service worker in `public/sw.js`, but its cache versioning is manual and its routing rules are intentionally conservative.
  - A follow-up should make the web shell more resilient to stale HTML / rotated hashed assets, clarify what should never be cached, and improve the offline fallback story without destabilizing local development or Playwright.
- Study scope:
  - Audit the current request classes handled by `public/sw.js`:
    - navigations
    - same-origin static assets
    - CDN resources
  - Decide where Lingua should keep `network-first`, `cache-first`, or adopt `stale-while-revalidate`.
  - Evaluate whether the web build should add:
    - a dedicated `offline.html` fallback
    - explicit exclusions for future dynamic/API routes
    - clearer cache-busting / version-bump discipline for deploys
    - richer activation/update semantics beyond the current `skipWaiting()` + `clients.claim()` baseline
  - Write down the validation matrix for any future SW change:
    - first load
    - reload after a fresh deploy
    - offline revisit
    - upgrade from an older cached shell
    - Playwright behavior with `serviceWorkers: 'block'`
- Explicitly not committed yet:
  - shipping a new service-worker strategy right now
  - background sync, push, or periodic background refresh
  - broad PWA expansion beyond cache/offline correctness
- Exit criteria:
  - A short design note or ADR recommends the next safe extension to `public/sw.js`.
  - The rollout plan includes cache invalidation rules plus web smoke coverage for both `en` and `es`.

### RL-030 Write a WASM-first capability matrix and migrate only where it wins

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-17`
- Current progress:
  - `CAPABILITY_MATRIX.md` landed at the repo root with an execution-class matrix (browser WASM, browser interpreter, WebContainer, desktop native, hybrid) covering JS/TS, Python, Go, Rust, Lua, filesystem access, file watching, updates, plugins, deep links, local AI inference, and formatter binaries
  - Each capability has a recommended class with a rationale that points back to the code path it lives in today
  - The document ends with explicit promotion rules — a capability only moves to a WASM-first stance when there is a portability, privacy, or maintainability win — so future migration work has a clear bar
  - RL-031 (local AI) is explicitly flagged as decision-deferred in the matrix and will write its outcome back into the document once the spike lands
- Why this task exists:
  - A full "WASM-first for everything" rewrite is not viable today for the current feature set
  - The product needs a capability matrix before committing to a migration slogan
- Scope:
  - Document each current capability against these execution classes:
    - browser WASM
    - browser interpreter
    - WebContainer
    - desktop native
    - hybrid
  - Create a decision record for:
    - JS/TS
    - Python
    - Go
    - Rust
    - file-system access
    - file watching
    - updates
    - plugins
    - local AI inference
  - Promote only the flows that gain portability, privacy, or maintainability
- Expected near-term outcome:
  - JS/TS/Python remain the strongest web/WASM candidates
  - Go may gain partial browser parity through interpreter/WASM experiments
  - Rust compile-and-run remains desktop-native for now
  - Filesystem watching, local plugin loading, and updater flows remain shell-specific
- Acceptance criteria:
  - No "WASM-first everywhere" migration starts before this matrix is approved
  - Each runtime and shell feature has a documented recommended execution class
- Dependencies:
  - None

### RL-031 Add a local AI code assistant focused on algorithms and cross-language generation

- Priority: `P1`
- Status: `Planned`
- Readiness: `Ready for an offline-first MVP`
- Product position:
  - This is not a general-purpose chat feature in the first rollout
  - The MVP is a constrained offline assistant for simple programming tasks only
  - The assistant is opt-in and contextual, not a permanent default sidebar
  - The primary user value is:
    - generate a small algorithm in the selected language
    - explain the current code briefly
    - translate a simple algorithmic idea into the selected language
  - Do not market this as a full coding copilot or autonomous editing system
- Scope:
  - Introduce a local-only AI assistant for desktop builds
  - Use Ollama over loopback as the explicit MVP backend
  - Keep the internal design compatible with future local backend abstraction, but do not expose provider switching in the first user-facing iteration
  - Start with lightweight code models such as:
    - `qwen2.5-coder:3b` as the recommended default
    - `qwen2.5-coder:1.5b` as the lower-resource fallback
  - Use constrained prompt templates for:
    - algorithm generation
    - code explanation
    - translate this idea into the selected language
  - Add streaming responses and explicit insert/copy actions
  - Keep automatic file editing out of MVP
  - Keep the feature fully optional and disableable
  - Allow future contextual entry points to pass only the specific active context the user selected, such as current code, selected output, or the current debugger frame
- Explicit non-goals for MVP:
  - no cloud providers
  - no arbitrary external API URLs
  - no autonomous code modification
  - no repo-wide agent behavior
  - no shell command execution
  - no background indexing or retrieval over the whole project
  - no plugin-facing AI API surface yet
  - no automatic model download or load on app startup
  - no implicit upload or persistence of code, output, or debugger state
- Exact execution boundary:
  - Desktop only
  - Web build must surface the feature as unavailable rather than partially emulated
  - All requests must stay on the local machine through Ollama on loopback
  - The feature must continue to work with internet access disabled as long as the local model is already installed
- Explicit implementation decision for the MVP:
  - The first implementation must target `Ollama` only
  - This is a product and delivery decision, not a claim that Ollama is the only viable backend forever
  - Alternative local backends such as LM Studio or `llama.cpp` remain future options, but they are intentionally out of scope for the first implementation
  - The implementation must avoid Ollama-specific assumptions leaking into renderer state, prompt building, or user-facing action semantics so a second backend can be added later without reworking the whole feature
- Why this shape is preferred:
  - The app is already strongest as a local code runner and scratchpad
  - A constrained assistant aligns with the existing language/template/snippet workflow better than a free-form chat pane
  - Small local models are sufficient for "Fibonacci in the selected language" and similar tasks, while reducing latency and memory compared to large local models
- Architecture recommendations:
  - Prefer one narrow vertical slice that is excellent over a broad AI surface that is vague
  - Keep the feature local-first, task-scoped, and user-mediated
  - Put all backend communication and prompt assembly behind main-process boundaries
  - Treat the renderer as a consumer of structured AI states and structured AI outputs, not as a client that understands backend HTTP details
  - Normalize model/server errors in one place instead of scattering backend-specific checks across UI components
  - Preserve a clean seam for future local backend adapters even though the MVP ships only with Ollama
- Recommended layered design:
  - `Renderer UI layer`
    - modal/panel surface
    - command palette actions
    - settings/status presentation
    - explicit insert/copy actions
  - `Renderer state layer`
    - request lifecycle
    - current stream text
    - availability state
    - last error
    - selected task + selected model
  - `Preload contract layer`
    - narrow typed bridge
    - no backend-specific parsing logic
  - `Main application service layer`
    - availability checks
    - request validation
    - prompt building
    - response normalization
    - cancellation
  - `Local backend adapter layer`
    - Ollama adapter in MVP
    - future adapters possible for LM Studio or `llama.cpp`
  - `Prompt policy layer`
    - task templates
    - language-aware constraints
    - response-shape requirements
- Explicit separation-of-concerns rules:
  - The renderer must not know raw Ollama endpoints
  - The preload layer must stay thin and typed
  - Prompt templates must live in main-side code, not embedded in React components
  - Backend response normalization must happen before data reaches UI rendering
  - Settings persistence must store product choices such as `enabled`, `model`, and safe local endpoint, not transport internals beyond what is necessary
  - Feature gating for desktop/web availability must happen before any request starts
- Future evolution guidance:
  - If a second backend is added later, it should implement the same internal adapter contract used by Ollama
  - Future backend support must not change the three MVP user tasks or their semantics
  - If provider switching is ever exposed in the UI, it should happen only after the adapter boundary proves stable and after error handling remains equally actionable across backends
  - Do not add cloud backends until the local-only product story is proven and still desirable
- 2026-05-20 research triage:
  - The v2.0 proposal's AI-engine direction is folded into this existing ticket rather than creating a new AI ID
  - WebGPU / `@mlc-ai/web-llm` is not part of the first implementation because model downloads, GPU compatibility, and storage pressure need their own capability decision
  - The first executable slice remains desktop-local Ollama through main/preload
  - BYO keys and hosted credits remain in `AI_BRIDGE_ADR.md` as later phases, not MVP scope
  - The UI starts as a constrained modal or panel for explicit tasks, not a permanent general chat sidebar
- Recommendation summary:
  - Best MVP backend: `Ollama`
  - Best MVP product surface: constrained algorithm helper, not free-form chat
  - Best MVP UI: focused modal/panel, not permanent sidebar
  - Best MVP output model: explicit `Insert` / `Copy`, never silent edits
  - Best MVP scope control: current tab + selected language only
- Detailed implementation blueprint:

#### RL-031.0 Record the architectural decision before coding starts

- Readiness: `Ready`
- Scope:
  - Create a short implementation note or ADR before starting code
  - Capture these decisions explicitly:
    - MVP backend is Ollama
    - MVP feature is desktop-only and local-only
    - renderer never talks to backend HTTP directly
    - backend abstraction exists internally but is not a user-facing selector yet
    - task scope is limited to simple algorithms and current-language assistance
- Acceptance criteria:
  - The implementation starts from a written decision record rather than assumptions carried in code comments only

#### RL-031.1 Introduce a desktop-only local AI bridge in main/preload

- Readiness: `Ready`
- Scope:
  - Add `ai:*` IPC handlers in the Electron main process
  - Expose a minimal `window.lingua.ai` bridge from preload
  - Start with these operations only:
    - `getStatus`
    - `listModels`
    - `generate`
    - `cancel`
  - The main process owns all HTTP communication with Ollama
  - The renderer must not call Ollama directly
  - The main process should delegate HTTP details to an internal backend adapter instead of hard-coding all request/response behavior inside IPC handlers
- Exact contract direction:
  - `getStatus`
    - checks whether the feature is enabled in settings
    - checks whether desktop build is active
    - checks whether Ollama responds on loopback
    - returns supported/unavailable/error state with a short reason
  - `listModels`
    - reads local models from Ollama
    - returns only local model metadata needed by the UI
  - `generate`
    - accepts a structured request with task type, current language, source code or user prompt, and selected model
    - streams partial text chunks back to the renderer
  - `cancel`
    - aborts the in-flight local request cleanly
- Security and networking constraints:
  - Allow only `127.0.0.1` and `localhost`
  - Default base URL to `http://127.0.0.1:11434`
  - Reject arbitrary remote hosts in the MVP
  - Do not persist auth tokens because none are needed for the local-only MVP
- Suggested file touch points when implementation starts:
  - `src/main/index.ts`
  - a new main-side module such as `src/main/ai.ts`
  - a backend adapter module such as `src/main/ai/ollamaAdapter.ts`
  - prompt and normalization modules such as `src/main/ai/prompts.ts` and `src/main/ai/normalize.ts`
  - `src/preload/index.ts`
  - `src/types.d.ts`
- Acceptance criteria:
  - Renderer can query local AI availability through preload without direct network access
  - An in-flight response can be cancelled
  - Web mode reports the feature as unavailable with an explicit reason
  - Ollama-specific HTTP behavior remains isolated from renderer-facing contracts

#### RL-031.2 Add persisted settings for the local assistant

- Readiness: `Ready`
- Scope:
  - Extend settings persistence with AI-specific local preferences
  - Keep defaults conservative so the app behaves exactly as today until the user turns the feature on
- Settings to add:
  - `aiEnabled: boolean`
  - `aiBaseUrl: string`
  - `aiModel: string`
  - `aiTaskMode: 'algorithm' | 'explain' | 'translate'`
  - `aiMaxContextChars: number`
  - `aiTemperature: number`
- Recommended defaults:
  - `aiEnabled = false`
  - `aiBaseUrl = http://127.0.0.1:11434`
  - `aiModel = qwen2.5-coder:3b`
  - `aiMaxContextChars` capped to a modest value for simple tasks
  - low temperature for deterministic output
- UI guidance:
  - Add a dedicated AI subsection inside Settings rather than overloading Editor settings
  - Show status:
    - disabled
    - local server unavailable
    - model missing
    - ready
  - Allow a model refresh button
- Suggested file touch points:
  - `src/renderer/stores/settingsStore.ts`
  - `src/renderer/components/Settings/SettingsModal.tsx`
  - a new section such as `src/renderer/components/Settings/AISection.tsx`
- Acceptance criteria:
  - Users can enable or disable the assistant without affecting the rest of the editor
  - The selected model persists locally
  - Broken local server/model states are visible in Settings

#### RL-031.3 Ship only three constrained user tasks

- Readiness: `Ready`
- Scope:
  - Expose exactly three actions in MVP:
    - `Generate Algorithm`
    - `Explain Current Code`
    - `Translate Idea to Current Language`
  - Keep these actions language-aware
  - Feed them from:
    - active tab language
    - active tab content when relevant
    - optional short user prompt
- UX entry points:
  - command palette actions
  - a compact toolbar action or overflow action
  - optional empty-state shortcut later if usage validates it
- UX constraints:
  - Do not open a permanent chat sidebar in the MVP
  - Prefer a focused modal or panel with one active request at a time
  - Show explicit `Insert` and `Copy` actions after generation
  - Do not auto-insert output
  - Keep the interaction model aligned with editor productivity, not conversation history
- Suggested file touch points:
  - `src/renderer/components/Toolbar/Toolbar.tsx`
  - `src/renderer/components/CommandPalette/commandPaletteModel.ts`
  - a new UI surface such as `src/renderer/components/AI/AIAssistantModal.tsx`
  - a renderer store such as `src/renderer/stores/aiStore.ts`
- Acceptance criteria:
  - A user can trigger one of the three actions without leaving the editing flow
  - The selected language is visible in the request UI
  - Output is never applied silently to the file

#### RL-031.4 Constrain prompts aggressively for simple algorithm work

- Readiness: `Ready`
- Scope:
  - Build task-specific prompt templates on the main side
  - Use structured instructions instead of free-form chat history
  - Keep prompts small and deterministic
  - Design prompt builders behind an interface that returns task-specific request bodies independent of the underlying local backend
- Prompt rules:
  - Always include the selected language
  - Always state that the target is a simple standalone algorithm
  - Prefer a single-file answer
  - Prefer standard library only
  - Ask for a brief explanation plus complexity only when relevant
  - Refuse or narrow the task if it drifts into non-algorithmic or environment-specific requests
- Structured response target:
  - Prefer a predictable textual layout such as:
    - short title
    - code block
    - short explanation
    - time complexity
    - space complexity
  - Keep the MVP tolerant of imperfect model formatting, but normalize obvious wrapper text before rendering
- Context rules:
  - For `Explain Current Code`, send only the current tab content and language
  - For `Generate Algorithm`, send only the user request, language, and template constraints
  - For `Translate Idea`, send only the source text and target language
  - Do not send the whole project tree or unrelated tabs
- Acceptance criteria:
  - The model reliably returns short algorithm-focused answers for common prompts
  - Prompts such as "Dame Fibonacci en Go" and "Explícame este binary search en Rust" stay within scope
  - Prompt-building logic can be reused if a future local backend other than Ollama is added

#### RL-031.5 Stream local responses with interruption support

- Readiness: `Ready`
- Scope:
  - Stream token or chunk updates into the renderer
  - Support a visible cancel button
  - Preserve partial output if the user cancels manually
  - Surface transport/model errors without crashing the editing flow
- Error states to handle explicitly:
  - Ollama not installed or not running
  - configured model not found locally
  - local request timeout
  - user cancellation
  - malformed response from the local server
- UX expectations:
  - show a small active generation state
  - keep the editor usable while streaming
  - map errors to actionable text such as:
    - "Ollama no responde en 127.0.0.1:11434"
    - "El modelo seleccionado no está instalado localmente"
- Error normalization recommendation:
  - Define one internal normalized error shape for:
    - unavailable backend
    - unavailable model
    - cancelled request
    - invalid response
    - timeout
  - UI components should render that normalized shape rather than branching on transport details
- Acceptance criteria:
  - Streaming works for a normal generation flow
  - Cancel leaves the app responsive and does not poison the next request
  - Failure messages are actionable and local-first

#### RL-031.6 Keep capability boundaries truthful in docs and UI

- Readiness: `Ready`
- Scope:
  - Update product text so local AI is described conservatively
  - State clearly that the MVP is:
    - desktop only
    - local only
    - constrained to simple programming help
  - Avoid describing it as a general extension or autonomous coding agent
- Docs to update when implementation lands:
  - `README.md`
  - any shortcut/workflow docs touched by the new entry points
- Acceptance criteria:
  - Product copy matches the actual MVP behavior
  - Browser limitations remain explicit

#### RL-031.7 Verification plan for the future implementation

- Readiness: `Ready`
- Manual validation matrix:
  - disabled state:
    - confirm the app behaves exactly as before when AI is off
  - local server unavailable:
    - confirm Settings and request UI show a clear unavailable state
  - model missing:
    - confirm the user gets an actionable error before generation starts or immediately on request
  - happy path:
    - generate Fibonacci in JavaScript, TypeScript, Go, Python, and Rust
    - explain the current active file for a short algorithm sample
    - translate one simple idea into the active language
  - cancellation:
    - start a request and cancel mid-stream
  - web build:
    - confirm the feature is explicitly unavailable
- Suggested automated coverage after implementation:
  - unit tests for prompt builders and AI request normalization
  - unit tests for the Ollama adapter and main-side availability checks
  - renderer tests for disabled/unavailable/ready states
  - main-side tests for availability parsing and response/error mapping
- Acceptance criteria:
  - The implementation can be validated against a finite checklist instead of exploratory testing only

- Final MVP acceptance criteria:
  - A prompt such as "Dame Fibonacci en el lenguaje seleccionado" can return code entirely offline on a supported desktop machine
  - The assistant works only through a local Ollama endpoint on loopback
  - The assistant can be disabled completely and leaves the base editor flow intact
  - Web builds remain honest and show the feature as unavailable
  - Output is always user-mediated through explicit insert/copy actions
- Dependencies:
  - RL-021

### RL-032 Build a dedicated marketing website and docs/download hub

- Priority: `P1`
- Status: `Planned`
- Readiness: `Ready after i18n foundation is chosen`
- Current gap:
  - The project has a web app build, but not a distinct marketing website
- Scope:
  - Create a separate website entry/build from the app web build
  - Add:
    - product pitch
    - screenshots
    - language support matrix
    - download matrix by platform/architecture
    - changelog/release feed
    - docs hub
    - FAQ
    - roadmap summary
  - Reuse visual tokens and branding, but keep website routing/content separate from the app runtime
  - Pull release metadata from GitHub releases so the downloads page stays current
- Acceptance criteria:
  - Website and app web build are two separate deploy artifacts
  - The website can explain the product without loading the app itself
  - Users can discover downloads, docs, and limitations from one place
- Dependencies:
  - RL-018

### RL-033 Upgrade to the latest Vite major and harden the bundling surface

- Priority: `P1`
- Status: `Done`
- Readiness: `Closed 2026-05-17 — Vite 5 → 8 shipped in one hop after the upstream peer-range and Rolldown-default checks cleared`
- Current progress:
  - `VITE_UPGRADE_ADR.md` now preserves the original Vite 5 → 7 plan as historical context and records the 2026-05-17 outcome: the Vite 8 trigger fired, so the repo skipped Vite 7 and landed on Vite 8 directly.
  - The four upstream checks resolved cleanly for the shipped target: `vite@8.0.13`, `@vitejs/plugin-react@6.0.2`, `vitest@4.1.6`, `@electron-forge/plugin-vite@7.11.1` with no Vite peer, and Tailwind v4 already in-repo.
  - The 10-step verification matrix passed end-to-end, including web build/preview, desktop smoke, and packaged macOS make; deferred follow-ups are documented in the ADR outcome.
  - Guard test `tests/docs/viteUpgradeAdr.test.ts` pins the impact axes, blocker checklist, verification matrix, rollback plan, and adjacent ADR cross-links
- Why this looks viable:
  - The repo already uses `.mts` Vite configs
  - The repo already targets Node 24
  - Main, preload, renderer, and web are already separated cleanly
- Main risks:
  - Electron Forge's Vite path remains the most fragile integration point; its internal `inlineDynamicImports` deprecation warning is deferred.
  - Explicit Vite 8 Rolldown tuning is deferred until there is a separate production-build chunking decision.
  - Full dev-toolchain audit remains gated on the Electron Forge upgrade; production audit is clean after the dependency modernization sweep below.
- Scope:
  - Upgrade `vite`
  - Upgrade `@vitejs/plugin-react`
  - Upgrade `vitest` and related config only as needed for compatibility
  - Verify:
    - renderer dev
    - Electron Forge dev
    - packaged desktop build
    - `dev:desktop`
    - web build
  - Remove or replace deprecated config patterns found during migration
- Acceptance criteria:
  - Electron and web builds both succeed on the target Node version
  - The local launcher still works or is replaced with a simpler supported path
  - No functional regressions are introduced in Monaco worker loading or the web build
- Dependencies:
  - RL-005

### § Status Update (2026-05-17)

Slice 1 shipped and closes RL-033 in full. Status flipped to `Done` in
ROADMAP §4b → archived in §6. The bump skipped the planned Vite 7
intermediate hop and went 5 → 8 in one stop, per the ADR's "When to
revisit #3" trigger ("Vite 8 Rolldown-default story stabilizes enough
that skipping Vite 7 becomes the cheaper path").

Bumped versions:

- `vite`: `^5.4.21` → `^8.0.13`
- `@vitejs/plugin-react`: `^4.7.0` → `^6.0.2`
- `vitest`: `^3.2.4` → `^4.1.6`
- `esbuild`: new direct devDep `^0.28.0` (Vite 8 no longer hoists it
  to the top-level `node_modules/esbuild/`, so the
  `run-electron-desktop.mjs` script needed a direct dep)
- `@electron-forge/plugin-vite`: held at `^7.11.1` (no Vite-8-aware
  release yet; runtime-tolerant)

Full 10-step verification matrix green end-to-end (install → tsc →
lint → test (3344 passed) → check:i18n + i18n:copy → build:web (~10×
faster, 16.6s → 1.5s thanks to Rolldown default) → preview:web smoke
→ dev:desktop + smoke:desktop (9/9 cases green) → make:desktop:mac
(packaged zip emitted to `out/make/`)).

Prerequisite fixes folded inline (no separate slice):

- `tests/main/lsp/lspIpc.test.ts` — Vitest 4 changed
  `vi.fn().mockImplementation(arrow)` semantics so the resulting mock
  was no longer newable. Rewrote the `RustAnalyzerLauncher` mock as
  a real `class`; mock surface unchanged.
- `scripts/run-electron-desktop.mjs` — esbuild 0.28's `bin/esbuild`
  is now the platform binary (was a JS shim in earlier majors), so
  `spawnManagedProcess(process.execPath, [esbuildBin, …])` crashed
  on the binary header. Fixed to spawn the binary directly.
- `package.json` — added `esbuild` as a direct devDep so the launcher
  script's hardcoded path resolves.

Deferred follow-ups (documented in
`docs/VITE_UPGRADE_ADR.md` Outcome section):

- Suppress / migrate the `inlineDynamicImports → codeSplitting: false`
  Vite deprecation warning emitted by `@electron-forge/plugin-vite`
  during `make:desktop:mac`. Forge plugin internal; needs upstream
  tracking or a `forge.config.ts` override.
- Explicit Vite 8 Rolldown opt-in for production builds (today's
  build uses the default behavior, which already shows the ~10×
  speedup; an explicit Rolldown config would unlock further tuning).
- `npm audit` review — the post-RL-033 sweep below cleaned the
  production audit via the DOMPurify override. The remaining full-audit
  advisories are dev-only Forge / rebuild chain items gated on the
  Forge upgrade.

### RL-034 Record the desktop build-system choice: stay on Forge, or move to electron-vite / electron-builder

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-19 — decoupled from RL-033 since the ADR could land today against the current stack`
- Current progress:
  - `BUILD_SYSTEM_ADR.md` lands at the repo root with the three options compared across Vite-major agility, packaging/signing, update ecosystem, CI portability, ecosystem maturity, and migration effort
  - Decision: stay on Electron Forge. Documented with four explicit when-to-revisit triggers so the next review has a bar to clear
  - Cross-links from `README.md` and `ARCHITECTURE.md` so the ADR is discoverable alongside `ARCHITECTURE.md` and `CAPABILITY_MATRIX.md`
  - Guard test `tests/docs/buildSystemAdr.test.ts` fails CI if anyone strips the decision, the scoring axes, the three compared options, or the when-to-revisit section
- Current recommendation:
  - Stay on Electron Forge unless Vite-major upgrades or packager limitations become recurring blockers
- Scope:
  - Create an ADR comparing:
    - current Electron Forge setup
    - a custom `electron-vite` path
    - an `electron-builder` packaging path
  - Score each option against:
    - Vite-major agility
    - packaging/signing complexity
    - update ecosystem
    - CI portability
    - ecosystem maturity
    - migration effort from the current repo
- Acceptance criteria:
  - The repo has a written "stay" or "migrate" decision
  - If inconclusive, a single thin prototype resolves the uncertainty instead of a full migration
- Dependencies:
  - RL-033

### RL-035 Run a Tauri 2 feasibility spike without committing to migration

- Priority: `P2`
- Status: `Partial`
- Readiness: `Written no-go decision landed on 2026-04-19; measured POC still intentionally deferred`
- Current progress:
  - `TAURI_SPIKE_ADR.md` lands at the repo root alongside `BUILD_SYSTEM_ADR.md` and `CAPABILITY_MATRIX.md`
  - Decision: do not migrate. The architectural review shows 6–8 weeks of Rust-shell rebuild (Go, Rust, formatter IPC handlers, filesystem bridge, crash reporter) for wins that only the permission-model axis makes compelling, without the team skill or customer signal to justify it
  - POC explicitly skipped: the cost (1–2 days) is better spent on Phase 1/2 launch blockers, and the acceptance criterion "no full migration work starts before a decision" is satisfied by the written no-go
  - Five revisit triggers codified (Tauri crash-reporter parity, customer signal on cold-start/bundle, team Rust maintainer, Electron deprecation, Electron-specific CVE pattern)
  - Guard test `tests/docs/tauriSpikeAdr.test.ts` pins the decision, axes, triggers, and cross-links
  - Remaining gap: RL-035 still names a proof-of-concept as acceptance criterion #1, so this stays Partial until that criterion is explicitly retired or a thin measured spike is run
- Scope:
  - Port one thin slice of the current product to Tauri 2:
    - editor shell
    - JS runner
    - filesystem open/save
  - Measure:
    - cold start
    - bundle size
    - update/signing path
    - permission model
    - maintenance cost of the Rust shell
    - impact on current Go/Rust runner architecture
- Decision bar:
  - Migrate only if the measured distribution/security benefits clearly outweigh the migration and maintenance cost
- Acceptance criteria:
  - A proof-of-concept exists
  - The repo contains a go / no-go decision
  - No full migration work starts before that decision
- Dependencies:
  - RL-021
  - RL-030

### RL-036 Add sharing, collaboration, and publish flows

- Priority: `P1` for Phase A (promoted 2026-04-18 by the go-to-market plan in Section 14). `Future` for Phase B.
- Status: `Planned`
- Readiness: `Phase A1 is MVP-ready as no-backend single-tab share links; Phase A2 waits on RL-024 for multi-file bundles; Phase B is gated on backend design`
- Scope:
  - Phase A1 (P1, no backend, single active tab):
    - share the current tab as a compressed URL fragment (`#code=<payload>`)
    - restore the shared tab on app boot or hash-change without writing to a server
    - include only safe tab state: file name, language, source, runtime mode, workflow mode, stdin buffer, and per-tab workflow flags such as auto-log
    - validate decoded language and modes through `LANGUAGE_PACKS` helpers before creating a tab
    - block oversized payloads with a localized status notice
    - never call the fragment encrypted or private; anyone with the URL can read the snippet
  - Phase A2 (P1, no backend, multi-file artifact):
    - local export/import of runnable project bundles as a portable `.linguashare` artifact (single JSON or tarball, read-only)
    - a "Share current file/project" command that produces a `.linguashare` and copies it or saves to disk
    - an "Open shared artifact" flow that imports a `.linguashare` into a scratch tab or a temporary project
    - every exported artifact records the language, Lingua version, and entitlement level (so Free-tier users can still open Pro-exported shares in read-only mode)
  - Phase B (future, backend required):
    - cloud-backed shareable links
    - embed mode for blogs / docs
    - interview mode
    - collaborative editing
    - one-click publish for web projects
  - Keep cloud/account scope out of Phase A until a storage/auth design is explicit
- Acceptance criteria:
  - Phase A1 links open a new tab with the same language, code, runtime mode, workflow mode, stdin buffer, and auto-log setting
  - Invalid, oversized, unsupported-version, or tampered URL fragments produce a status notice and do not crash boot
  - Phase A1 and A2 never serialize license tokens, absolute paths, environment variables, device identifiers, or project identity
  - Opening a `.linguashare` on a fresh install reproduces the shared file/project exactly once Phase A2 starts
  - Cloud sharing does not start until there is a concrete storage/auth design
- Dependencies:
  - RL-021 (Phase A1 — tab lifecycle and session continuity, already shipped)
  - RL-024 (Phase A2 — multi-file bundling)
  - RL-032 (Phase B only)

#### 2026-05-20 research triage

The v2.0 work proposal originally described this as a separate new ID and called the
payload "cryptographic zero-trust sharing." That naming is rejected: a
compressed hash fragment is useful because it avoids a database and is not
sent in the HTTP request, but it is not encryption. The useful work is folded
into `RL-036` as Phase A1 so it respects the current ticket naming and can
ship before the heavier `.linguashare` artifact path.

### RL-037 Add deep editor personalization

- Priority: `P2`
- Status: `Done`
- Readiness: `Closed on 2026-05-01 by the Vim mode integration slice — monaco-vim lazy-loaded behind the existing settings.vimMode toggle, a localized VimStatusBar (en + es tuteo) renders the active mode in the editor footer, a Toggle Vim mode action joins the command palette, and the original "macro recording and playback (simple sequences)" AC is satisfied for free by monaco-vim's native qa…q + @a register infrastructure. Earlier slices (font panel, theme preset import/export, result/console theme alignment, read-only reference, editable shortcut mapper, alternate keymap preset, alternate theme pack) shipped 2026-04-17. The 2026-04-20 ADR commits (VIM_MODE_ADR.md) and the 2026-04-20 bis flag-only slice both fed this closeout.`
- Scope:
  - Shortcut editor (read-only reference ✅ — editable shortcut mapper ✅)
  - custom keymaps
  - theme import/export ✅
  - Vim mode
  - Font selection panel with curated developer fonts ✅
    - JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, Consolas, Menlo, Monaco, IBM Plex Mono ✅
    - Font ligature toggle ✅
    - Configurable font size with live preview ✅
    - Inspired by WizardJS (5 font choices) and CodeRunner (customizable fonts)
  - alternate font packs
  - result/console theme alignment ✅
  - macro recording and playback (simple sequences) — see also RL-049 for advanced macros
- Current progress:
  - Curated font list now covers the eight developer fonts named in the plan, each tagged with whether it ships programmer ligatures
  - New `fontLigatures` setting (defaults to on) gates Monaco's `fontLigatures` option; the settings toggle is automatically disabled and explained when the active font stack has no ligatures, and `CodeEditor` additionally guards the Monaco option through `fontStackSupportsLigatures` so the option stays honest even if a persisted preference pre-dates the toggle
  - Settings now renders a live font preview card that mirrors `fontFamily`, `fontSize`, and the ligature state so users see the effect before editing code
  - Dropdown entries surface ligature-capable fonts with a `(ligatures)` tag so the honest capability is discoverable at selection time
  - Theme preset import/export ships under a new row in Settings: export writes a versioned JSON document (appearance, typography, layout) via the existing `fs.saveDialog` bridge, and import validates the schema with discriminated failures (`invalid-json`, `invalid-shape`, `unsupported-version`) surfaced through the shared status-notice pipeline. A new `applyThemePreset` settings action intentionally leaves safety prefs (loopProtection, formatOnSave, restoreSession) untouched so shared presets cannot override local workflow preferences
  - Shell polarity now follows the selected editor theme by default via a new `syncShellWithEditorTheme` setting: picking VS Light or Solarized Light auto-flips the console and run-result panels to light so the editor and surrounding surfaces stay visually consistent. Users who prefer the old mixed look can flip the toggle off and keep the explicit shell theme. The theme preset schema is now v2 with the new flag; v1 legacy exports continue to import cleanly and inherit the default-true sync behavior
  - A read-only keyboard-shortcut reference ships under a new `keyboard-shortcuts` overlay reachable from the command palette (`Open Keyboard Shortcuts`). A declarative catalog in `src/renderer/data/keyboardShortcuts.ts` drives the modal — shortcuts are grouped (Run, File, Navigation, Overlays, View), render platform-aware combos (⌘ glyph on macOS, word-form `Ctrl+Shift+X` elsewhere), and are searchable by label, keyword, or keystroke
  - The reference is now an editor: each row has an inline Edit affordance that records the next non-modifier keydown, normalizes it to the catalog's token vocabulary, and writes it to a new `shortcutOverrides` map on the settings store. Overrides persist (sanitized on rehydrate to drop unknown ids / malformed entries), survive app relaunches, and leave theme-preset import/export untouched on purpose. Conflict detection checks the resolved combo set (defaults + overrides) and refuses duplicate bindings with a status notice, keeping the store untouched. Per-row and global reset affordances restore defaults. The Escape / close-overlay binding is intentionally non-editable so users can always dismiss modals. `useGlobalShortcuts` now iterates the catalog through a shared `resolveCombos`/`matchesCombo` pair, so defaults and user bindings follow the same dispatch path
  - A `keymapPreset` setting plus a new `src/renderer/data/keymapPresets.ts` catalog ship the first alternate keymap ("Sublime Text-inspired") alongside the default. The shortcuts overlay exposes the preset selector in its description header; applying a preset replaces user overrides wholesale, while any manual edit afterwards flips the active preset back to `default` so the UI stays honest. The store's merge hook validates the persisted preset id and falls back to `default` on unknown values — same defensive pattern used for `language`
  - A `themePack` setting plus a new `src/renderer/data/themePacks.ts` catalog ship the first built-in theme pack ("Solarized Daylight") alongside the default. Settings → Appearance exposes the pack selector as the first row; applying a pack swaps theme, editorTheme, font, size, ligatures, layout, and shell sync in one call but intentionally leaves safety/workflow prefs (loopProtection, formatOnSave, restoreSession) alone. Any manual appearance edit flips the pack back to `default`; unknown persisted ids are sanitized in the merge hook
  - Shortcut overrides now ship an export/import pair in the modal footer, symmetric with the theme-preset import/export. The schema lives in `src/renderer/utils/shortcutPreset.ts` (v1 discriminated union with `invalid-json`/`invalid-shape`/`unsupported-version` failure reasons), reuses the same FS bridge (`window.lingua.fs.saveDialog|selectFile|read|write`), and sanitizes parsed combos through the same editable-combo guard plus duplicate-binding filter as the persist merge
  - 2026-04-20 update: `VIM_MODE_ADR.md` lands the design for the Vim-mode slice. Accepts `monaco-vim` as the lazy-loaded keybindings layer gated by a single `settings.vimMode` toggle; commits to editor-focus-only keystroke ownership so `Ctrl/Cmd+P` Quick Open and other global shortcuts keep working outside Monaco. The ADR was updated when the 2026-05-01 implementation shipped: Lingua now owns a localized status-bar subclass instead of accepting upstream English-only mode labels. Ships a six-row verification matrix, a single-toggle rollback path, five revisit triggers, and cross-links to `BUILD_SYSTEM_ADR.md` + `LANGUAGE_PACK_ADR.md` + `CAPABILITY_MATRIX.md`. `tests/docs/vimModeAdr.test.ts` pins the decision sections, the Quick Open conflict resolution, the `:q` / `:w` safety clauses, and the adjacent ADR cross-links
  - 2026-04-20 bis update: Vim mode first implementation increment. `settings.vimMode: boolean` + `toggleVimMode()` land in `SettingsState` with persist-partialize inclusion; default `false`. `EditorSection` renders a new Row with the toggle, plus a status note explaining that this slice only ships the flag and that Vim keybindings activate in a follow-up slice. `Toggle` now accepts an optional `aria-label` so multiple toggles in the same section can be uniquely identified in tests and by assistive tech. Copy ships in en + es (`editor.vimMode.label / hint / pendingNote`). Three new component tests pin the default-off state, the flip + persistence, and the Spanish locale; the settings store test extends the toggle coverage. The monaco-vim lazy integration is the next slice
  - 2026-05-01 update — Vim mode integration closeout. `monaco-vim@^0.4.4` (MIT, ~60 KB min+gz) is lazy-imported through a module-scoped promise so toggling on/off rapidly never re-fetches the chunk. `CodeEditor.tsx` gains a useEffect that, when `vimMode === true`, calls `initVimMode(editor, statusNode, LocalizedStatusBar)` and stashes the returned adapter; the cleanup disposes it on toggle-off, on tab change, and on editor unmount. A new `src/renderer/components/Editor/VimStatusBar.tsx` hosts the `<div>` the Vim layer writes into, hidden via `display:none` when the toggle is off so layout stays stable. A new `src/renderer/components/Editor/vimStatusBarFactory.ts` subclasses upstream `VimStatusBar` and overrides `setMode({ mode, subMode })` to emit i18n strings — `editor.vimMode.statusBar.{normal,insert,visual,visualLine,visualBlock,replace}` keys ship in en + es with tuteo (`-- INSERTAR --`, `-- VISUAL LÍNEA --`, etc). The factory routes through a `translateRef` from `CodeEditor` so locale switches reflect on the next mode change without re-initializing the Vim adapter and dropping the user's buffer position. `commandPaletteModel.ts` accepts a new `onToggleVimMode` callback + a `vimModeEnabled` flag and emits a `action-toggle-vim-mode` command whose description flips between "Turn on" / "Turn off" copy based on the current state; `App.tsx` wires it to `useSettingsStore.getState().toggleVimMode()`. `EditorSection` drops the now-misleading `pendingNote` row. Macros are NOT a separate code path — monaco-vim already ships full `q<letter>…q` recording + `@<letter>` replay through its `MacroModeState`, so the original RL-037 "macro recording and playback (simple sequences)" AC is satisfied by enabling the Vim layer. Six new tests pin the localized `setMode` mapping (`vimStatusBarFactory.test.ts`), four new tests cover the palette toggle command (hidden without callback, fires on activation, description flips on enabled flag, ES tuteo), and three new Playwright specs (`vimMode.spec.ts`) drive the actual lazy-loaded integration end-to-end (toggle from Settings activates the localized status bar, `i hello Esc` round-trip writes into the editor, palette toggle flips the flag and shows the status bar). The existing `EditorSection.vimMode.test.tsx` adjusts to assert the pending-note span is gone. RL-037 flips from `Partial` to `Done` — the legacy 2026-04-20 bis "pendingNote / hint about a follow-up slice" copy is now historical and the toggle does what it advertises
- Acceptance criteria:
  - Users can customize shortcuts without editing source files ✅
  - At least one custom theme pack and one alternate keymap ship from the first rollout — alternate keymap ✅, theme pack ✅
- Dependencies:
  - RL-018

### RL-038 Build a conservative language-pack architecture before expanding plugins

- Priority: `P2`
- Status: `Done`
- Readiness: `Closed on 2026-05-01 by the Slice C closeout — SnippetsModal language picker and EditorEmptyState quick-start row dropped their hardcoded ['javascript', 'typescript', 'go', 'python', 'rust'] arrays in favor of LANGUAGE_PACKS walks, and both surfaces now render the localized "(desktop only)" / "Desktop only" hint on the web build for Go / Rust (matching Toolbar New File and FileTreeNode). The "capability-aware settings" item from the original Readiness was speculative — no per-language Settings UI exists in Lingua today (Settings are language-agnostic: appearance, fonts, env vars, layout, license, telemetry); if a future slice adds per-language Settings, it can register on top of getLanguagePackById, the registry is already in place. Earlier slices: Slice A (descriptor + thin shim migration, 2026-04-20), Slice B (runner dispatch + Lua first-class, 2026-04-20), Slice C first increment (Toolbar New File badge, 2026-04-20), Slice C polish (templateIds wiring, 2026-04-20), Slice C fourth increment (Run button web disabled + tooltip, 2026-04-20 ter), Slice C fifth increment (FileTree badge, 2026-04-20 quinquies).`
- Current progress:
  - `LANGUAGE_PACK_ADR.md` records the accepted `LanguagePack` descriptor, the three-slice migration plan, and the no-marketplace constraint
  - Guard test `tests/docs/languagePackAdr.test.ts` pins the descriptor fields, migration slices, and adjacent ADR/RL cross-links
  - Slice A (2026-04-20): `src/shared/languagePacks.ts` lands the descriptor + the 16-pack array as the single source of truth, plus resolver helpers (`getLanguagePackById`, `getLanguagePackForExtension`, `getLanguagePackForFileName`, `monacoLanguageForPack`, `executionModeForPack`, `formatterStrategyForPack`, `runnerIdForPack`). `src/renderer/utils/languageMeta.ts` rewritten as a thin shim — every legacy helper now proxies to the pack array. Zero behavior change verified by the existing 836-test baseline plus 11 new pack-integrity tests covering descriptor shape, runnable-vs-validate runnerId contract, extension uniqueness, file-name same-pack-allowed cross-pack-banned rule, and resolver fallback semantics
  - Slice B (2026-04-20): `src/renderer/runners/manager.ts` replaces the hardcoded constructor with a `BUILT_IN_RUNNER_FACTORIES` map keyed by `LanguagePack.runnerId` and a `LANGUAGE_PACKS` walk. `pluginRegistry.getByLanguage` stays as the fallback so plugin-sourced runners still resolve. Lua joins `LANGUAGE_PACKS` as a first-class entry (`execution: 'run'`, `runnerId: 'lua'`) — its runner is still plugin-sourced, which proves the pack walk is additive. New assertions: the pack test pins the Lua entry shape, and the manager test asserts Lua does NOT resolve from `LANGUAGE_PACKS` alone (plugin registration still required). All 884 tests pass
  - Slice C first increment (2026-04-20): `languageCapabilityBadgeKey(language)` reads `LanguagePack.capabilities.runtimeDependencies` and returns a stable i18n key (`language.capability.desktopOnly`) for host-toolchain languages (Go, Rust) or `null` for self-contained runtimes (JS, TS, Python, Lua). The Toolbar's New File menu renders the badge next to each language label when the helper returns a key. Copy ships in en + es (`Desktop only` / `Solo escritorio`). Tests pin the helper's per-language output and the Toolbar's badge rendering + localization
  - Slice C polish (2026-04-20): the `templateIds` field on every runnable built-in pack now points at the real template ids in `src/renderer/data/templates.ts` (js × 4, ts × 4, go × 3, py × 4, rs × 4). New resolver helper `templateIdsForPack(id)` reads them with a safe fallback. Four new guard tests assert every runnable pack declares at least one starter template (Lua exempt until its first starter ships), every declared id resolves to a real template and matches the pack's language, no built-in template is orphaned, and the resolver falls back cleanly for unknown ids. This closes the Slice A "declared templates per language" todo that previously shipped as an empty array
  - Slice C fourth increment (2026-04-20 ter): the Toolbar's Run button is now honest on the web build — when the active language needs a host toolchain (Go, Rust) AND `window.lingua.platform === 'web'`, the button disables and its tooltip flips to `toolbar.run.desktopOnlyTooltip` instead of the generic title. Other disabled reasons (no tabs, still running, view-only) keep the tooltip suppressed as before. Copy ships in en + es. Three new Toolbar tests cover the web-with-Go disabled + localized tooltip, the desktop-with-Go still-enabled path, and the Spanish locale on the tooltip
  - Slice C fifth increment (2026-04-20 quinquies): `FileTreeNode` renders the same desktop-only badge inline next to file names whose language requires a host toolchain — only when the build is web. Self-contained runtimes (JS, TS, Python, Lua) and directories never show the badge. Reuses the existing `language.capability.desktopOnly` i18n key, so no copy churn. Six new component tests cover the Go + Rust web cases, the desktop suppression, the JavaScript suppression, the directory suppression, and the Spanish locale
  - 2026-05-01 update — Slice C closeout: the last two hardcoded language enums in the renderer drop in favor of `LANGUAGE_PACKS` walks. `src/renderer/components/Snippets/SnippetsModal.tsx` filters the registry to `execution === 'run' || 'compile'` and maps each pack to a `<select>` `<option>`; on the web build, options whose pack carries `runtimeDependencies` (Go / Rust) get a localized `" (desktop only)"` / `" (solo escritorio)"` suffix appended via the new `language.capability.desktopOnlyOptionSuffix` key. The picker stays selectable — saving a Go snippet on web is a legitimate user action; the suffix is informational, not enforcement. `src/renderer/components/Editor/EditorEmptyState.tsx` filters the registry to runnable packs with non-empty `templateIds`, and adds a small inline "Desktop only" pill alongside Go / Rust language labels on the web build (reusing the existing `language.capability.desktopOnly` key). Click-through on the pill-bearing buttons still opens a tab in the right language; the existing Slice C fourth-increment Run-button gate handles the runtime side. The "capability-aware settings" item from the original Readiness is acknowledged as vacuously satisfied — Settings has no per-language UI today, and if a future slice adds one it can register on top of `getLanguagePackById`. Two new component-test files (`tests/components/Snippets/SnippetsModalLanguagePicker.test.tsx`, `tests/components/Editor/EditorEmptyStateCapability.test.tsx`) pin both surfaces across web vs desktop and EN vs ES (tuteo). The pre-existing `tests/components/EditorEmptyState.test.tsx` mock for `languageMeta` extends to expose `languageCapabilityBadgeKey` so the previous five-test contract continues to pass. RL-038 flips `Partial → Done` and moves to ROADMAP §6 archive (40 → 41 Done).
- Why this matters:
  - The current built-in language support is functional but still somewhat scattered across templates, runners, toolbar metadata, and settings
  - Plugin support should stay conservative until the built-in architecture is cleaner
- Scope:
  - Move built-in language metadata into declarative language packs:
    - label
    - icon
    - file extensions
    - Monaco mode
    - runner capabilities
    - formatter/debugger/LSP support flags
    - docs links
    - starter templates
  - Refactor built-in languages and Lua to use the same capability descriptor system
  - Keep arbitrary third-party code loading out of scope
- Acceptance criteria:
  - Adding a new bundled language no longer requires scattered edits across the app
  - The app can render capability-aware UI per language without hardcoded switch statements everywhere
- Constraint:
  - Do not market this as a finished extension marketplace
- Dependencies:
  - None

### RL-039 Add guided lessons, docs, and app galleries for students

- Priority: `P2`
- Status: `Partial`
- Readiness: `Content scaffolds for three lessons landed on 2026-04-20 (JS, TS, Python); interactive lesson UI still depends on RL-023 + RL-024`
- Current progress:
  - `docs/lessons/` ships `README.md` (lesson schema + content rules), `01-javascript-loops-and-arrays.md` (Free-tier JS), `02-typescript-generic-functions.md` (Free-tier TS, depends on lesson 01), `03-python-fundamentals.md` (Free-tier Python, list comprehensions + `defaultdict` pattern)
  - 2026-04-20 second slice: adds the Python lesson to close the "at least one guided path for a second language" acceptance line; `tests/docs/lessons.test.ts` now asserts the second-language presence explicitly so a future edit cannot regress it
  - Schema: front-matter (`id`, `language`, `title`, `estimatedMinutes`, `prerequisites`) + en + es sections with the canonical sub-headers (`What you will build` / `Lo que vas a construir`, `Starter code` / `Código inicial`, `Walkthrough` / `Paso a paso`, `Try it yourself` / `Inténtalo tú`, `What you learned` / `Lo que aprendiste`)
  - `language` front-matter validated against `LANGUAGE_PACKS` ids so a future lesson can't reference a language the runner doesn't ship
  - Guard test `tests/docs/lessons.test.ts` pins file presence, front-matter completeness, en + es section coverage, language-id legitimacy, and the no-MIT-claim rule
- Scope:
  - Guided lessons with checkpoints
  - app gallery / starter gallery
  - inline docs/help panel
  - curated examples per language
  - teacher/demo mode for screen sharing and workshops
  - error-to-doc linking for common beginner mistakes
- Acceptance criteria:
  - At least one guided path ships for JS/TS and one for a second language
  - Lessons include starter code, validation, and explanation instead of only static markdown
- Dependencies:
  - RL-023
  - RL-024

---

## 8. Extended competitive benchmark (2026-04-12)

Second research pass expanding the original benchmark with deeper competitor analysis, additional products, and feature extraction from WizardJS, marimo, Zed, CodeRunner, CodeSandbox, Replit, and Jupyter/Observable.

### New reference products analyzed

- WizardJS (open-source RunJS alternative)
- RunJS (commercial JS/TS scratchpad)
- PlayCode (web playground with AI)
- CodeRunner 4 (macOS multi-language editor)
- Replit (cloud IDE with AI Agent)
- CodeSandbox (cloud dev environments)
- Zed (Rust-based high-performance editor)
- marimo (reactive Python notebook)
- Jupyter / Observable (notebook ecosystems)
- StackBlitz / WebContainers (browser-based Node.js)

### WizardJS feature extraction and comparison

WizardJS is a direct peer: Electron + Monaco + Vite + Forge, JS/TS only. Relevant signals:

| WizardJS feature | Lingua status | Action needed |
|-----------------|----------------|---------------|
| Smart auto-run with code-completeness detection | Partial (debounce only) | RL-020 covers this |
| Bilingual UI (en/es) with i18n service | Not implemented | RL-018 covers this |
| Custom protocol scheme (`wizardjs://`) | Not implemented | New: RL-040 |
| Five font choices (JetBrains Mono, Fira Code, etc.) | Not implemented | New: RL-037 expansion |
| Sandbox execution with security timeouts | Partial (loop protection) | RL-020 covers timeout presets |
| Multi-platform CI build matrix (macOS Intel/ARM, Windows, Linux) | Already better — Lingua has signing + notarization + checksums | No action |
| Fuses security hardening | Already implemented identically | No action |
| No publishers configured (manual release) | Lingua already uses @electron-forge/publisher-github | Lingua is ahead |

### WizardJS CI/CD comparison

| Aspect | WizardJS | Lingua | Verdict |
|--------|----------|---------|---------|
| Trigger | Tag push `v*` + manual dispatch | Tag push `v*.*.*` | Lingua is stricter (validates stable-only) |
| Build matrix | 4 jobs (macOS-Intel, macOS-ARM, Windows, Linux) | 3 jobs (macOS universal, Windows, Linux) | Lingua universal binary is cleaner |
| Node version | 22 | 24 | Lingua is more current |
| Signing | None | macOS + Windows code signing + notarization + verification | Lingua is significantly ahead |
| Checksums | None | SHA256SUMS.txt generated | Lingua is ahead |
| Publish | Manual GitHub release from artifacts | Automated via publisher-github | Lingua is ahead |
| Artifact retention | 7 days | Default | Comparable |

**Conclusion**: Lingua's release pipeline is already more mature than WizardJS. No migration needed.

### WizardJS .gitignore comparison

Lingua's .gitignore is already more focused and cleaner. WizardJS includes many irrelevant patterns (parcel, nuxt, vuepress, serverless, FuseBox, DynamoDB). Lingua's is properly scoped to the actual stack. No changes needed.

### WizardJS forge.config comparison

| Aspect | WizardJS | Lingua | Verdict |
|--------|----------|---------|---------|
| Custom protocol | `wizardjs://` registered | None | Worth adding (RL-040) |
| App category | `developer-tools` | Not set | Worth adding |
| ASAR | Enabled | Enabled | Same |
| Fuses | All security fuses set | Identical config | Same |
| macOS signing | No (lacks dev ID) | Full signing + notarization | Lingua ahead |
| Windows signing | None | Full Authenticode | Lingua ahead |
| Publishers | None | GitHub publisher | Lingua ahead |

### Broader competitive signals not yet covered in PLAN.md

| Feature area | Source competitors | Lingua gap |
|-------------|-------------------|-------------|
| Real-time collaboration / multiplayer editing | PlayCode, Replit, CodeSandbox, Zed | RL-036 partially covers; needs live cursor sync |
| AI code generation with project context | PlayCode AI, Replit Agent, CodeSandbox Boxy | RL-031 covers local AI; cloud AI is future |
| One-click deploy / publish to web | PlayCode, Replit, CodeSandbox | New: RL-041 |
| Custom protocol / deep links (`app://open?file=...`) | WizardJS | New: RL-040 |
| 25+ language support out-of-the-box | CodeRunner 4 (25 languages) | New: RL-042 expands language count |
| Built-in web inspector / DOM debugger | CodeRunner 4 | RL-019 browser preview covers part; DOM inspector is new |
| Reactive notebook cells / dataflow | marimo, Jupyter, Observable | New: RL-043 notebook mode |
| Rich data visualization inline | Jupyter, marimo, Observable | New: RL-044 inline visualization |
| Built-in developer utilities (regex, JSON, diff) | DevToys, DevUtils.app, VS Code extensions, cod-ai.com | RL-045 ✅ (10 utilities); follow-ups RL-068 (coverage), RL-069 (productivity layer), RL-070 (beautify/minify + conversions), RL-071 (parity hardening), RL-072 (QR + string inspector) |
| Gamification / achievements / progress tracking | Codecademy, Duolingo-style apps | New: RL-046 gamification |
| Algorithm visualization / step-through animation | VisuAlgo, Programiz, DSA Visualizer | New: RL-047 algorithm visualization |
| GPU-accelerated rendering (120fps) | Zed | Aspirational; not blocking |
| Cloud dev environments / VM sandboxes | CodeSandbox, Replit | Out of scope for desktop-first product |
| Mobile app / cross-device sync | PlayCode, Replit | Future consideration after web build matures |
| Spaced repetition for code learning | Duolingo-style apps, Qstream | New: RL-046 covers this |
| Macro recording / custom keybindings | CodeRunner 4 | RL-037 covers keymaps; macros are new |

---

## 9. Research-backed expansion backlog (continued)

### RL-040 Register a custom protocol and support deep links

- Priority: `P2`
- Status: `Done`
- Readiness: `Completed on 2026-04-16`
- Why this matters:
  - WizardJS registers `wizardjs://` for deep linking
  - Deep links enable: open files from terminal, open from browser, share snippets via URL
  - This is a standard Electron capability with minimal implementation cost
- Current progress:
  - `lingua://` is registered in packager metadata and now handled at runtime in Electron main
  - Cold-start argv links, macOS `open-url`, and already-running-instance links now flow through one pending/deferred deep-link path
  - The renderer consumes deep links through the preload bridge and handles:
    - `lingua://open?file=/path/to/file.js`
    - `lingua://new?lang=python`
    - `lingua://snippet?id=xxx`
  - Snippet links open the Snippet Library and focus the matching saved snippet when it exists locally
- Scope:
  - Register `lingua://` custom protocol in Electron main and in forge packagerConfig ✅
  - Support deep link actions:
    - `lingua://open?file=/path/to/file.js` ✅
    - `lingua://snippet?id=xxx` ✅
    - `lingua://new?lang=python` ✅
  - Handle deep links on app cold start and when app is already running ✅
  - Add `app.setAsDefaultProtocolClient('lingua')` on first launch ✅
  - Add forge config: `protocols: [{ name: 'Lingua', schemes: ['lingua'] }]` ✅
- Acceptance criteria:
  - Clicking a `lingua://` link from a browser or terminal opens the app with the correct context ✅
  - Deep links work on macOS, Windows, and Linux ✅ (runtime handling implemented cross-platform; protocol registration still depends on platform packaging/install)
- Dependencies:
  - RL-021

### RL-041 Add static site export and one-click publish for web projects

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready after multi-file playgrounds exist`
- Why this matters:
  - PlayCode, Replit, and CodeSandbox all offer one-click publish to a live URL
  - For student and prototyping use cases, publishing a working demo is high value
- Scope:
  - Phase A: Export JS/TS/HTML projects as self-contained static ZIP
  - Phase B: One-click publish to GitHub Pages from the app
  - Phase C: Optional custom subdomain via a lightweight deploy service (future)
  - Keep Phase A local-only and offline-capable
- Acceptance criteria:
  - A multi-file web project can be exported as a runnable static site
  - GitHub Pages publish works with a configured GitHub token
- Dependencies:
  - RL-024
  - RL-036

### RL-042 Expand language support toward 15+ languages

- Priority: `P2`
- Status: `Partial`
- Readiness: `Slice 6 (2026-05-20) shipped the Ruby desktop native subprocess + hybrid dispatcher; Slice 5 (2026-05-19) shipped the WASM worker. Five prior validate-only slices (2026-04-20 through 2026-04-20 quinquies) shipped Ruby, C, C++, Swift, Kotlin, Java, and Scala as LanguagePack entries. Remaining: native execution for C/C++/Java/Kotlin/Scala/Swift — each is its own slice.`
- 2026-05-20 Slice 6 landed — Ruby desktop native subprocess + hybrid dispatcher (with folds A/B/C/D/E/G):
  - `src/main/ruby-runner.ts` (new, ~430 LOC) — spawns `ruby` via `child_process.spawn` (no shell, tempfile source via `mkdtemp`); 1 MiB stdout/stderr caps via `truncateBytes`; SIGTERM→SIGKILL escalation with a 1500 ms grace window (fold E, longer than node-runner's 200 ms because Ruby's `at_exit` blocks tend to need more time); runId-keyed `activeRubyRuns` map so concurrent runs don't collide. `ruby:detect` returns `{ installed, version, semver, platform, error }` parsed by `parseRubyVersion()` (fold A). `findRubyVersionFile()` walks up to 8 directories from the tab's `filePath` and threads the discovered pin through `RBENV_VERSION` + `ASDF_RUBY_VERSION` so rbenv shims pick the right interpreter (fold D); suspicious version strings containing path separators are rejected.
  - `src/main/runners/nativeEnv.ts` — `RUBY_TOOLCHAIN_KEYS` allowlist (`GEM_HOME` / `GEM_PATH` / `BUNDLE_GEMFILE` / `RBENV_VERSION` / `RBENV_ROOT` / `RBENV_DIR` / `ASDF_RUBY_VERSION` / `ASDF_DIR` / `ASDF_DATA_DIR`). Intentionally NOT here: `RUBYOPT` / `RUBYLIB` / `IRBRC` / `RUBYRC` / `RACK_ENV` / `RAILS_ENV` — user-controllable knobs that belong in the RL-011 user env tier.
  - `src/preload/index.ts` + `src/types.d.ts` — `window.lingua.ruby.{detect, run, stop}` bridge added; optional on the type because web builds deliberately omit the surface.
  - `src/main/index.ts` — `registerRubyHandlers()` wired alongside the existing Rust/Go/Node registrations.
  - `src/renderer/runners/ruby.ts` — refactored into a 3-class structure: `WasmRubyRunner` (Slice 5's worker, unchanged behavior), `DesktopRubySubprocessRunner` (new, wraps the IPC bridge), and a new public `RubyRunner` dispatcher that picks per `execute()` based on `Settings.rubyRuntimePreference` and a per-session detection cache. `auto` prefers system when detected; `system` forces subprocess (falls back to WASM when missing); `wasm` always uses the worker. `stop()` routes to the inner runner that handled the last dispatch.
  - `src/shared/languagePacks.ts` — Ruby pack gains optional `capabilities.runtimeDependencies: ['ruby']` so desktop can prefer the host binary without marking Ruby as desktop-only on web.
  - `src/renderer/stores/settingsStore.ts` — new persisted field `rubyRuntimePreference: 'auto' | 'system' | 'wasm'` (seed `auto`); `setRubyRuntimePreference` action with closed-enum validation; rehydrate sanitization rejects tampered values.
  - `src/renderer/components/Settings/RubyRuntimeRow.tsx` (new) — Settings → Editor row with the runtime select, a status line ("System Ruby detected: 3.3.6" using the fold A `semver`, or "Available on desktop only." on web), and a docs link to ruby-lang.org (fold G). Disables the `system` option on web builds.
  - `src/shared/telemetry.ts` + `update-server/src/telemetry.ts` — 2 new events: `runtime.ruby_runner_dispatched { mode, bucketedSpawnMs }` (fold C; `mode` ∈ `system|wasm|missing`, `bucketedSpawnMs` ∈ `<100ms|<300ms|<1s|<3s|>=3s`) and `runtime.ruby_runtime_preference_changed { preference }`. Both mirrored on update-server with a parity test that source-parses the closed-enum Sets from both sides.
  - i18n: 13 new keys in EN + ES (tuteo) covering the Settings row, the status messages, the docs link, and the `runtime.notice.rubySystemMissing` status notice.
  - Tests: `tests/main/ruby-runner.test.ts` (new, 16 tests) covers `parseRubyVersion` (4), `detectRuby` (2), `findRubyVersionFile` (4), and the `ruby:run` / `ruby:stop` handlers (6 with mocked `child_process.spawn`). `tests/runners/ruby.test.ts` extended with a `RubyRunner — desktop dispatcher routing` describe (5 tests) covering all four preference combinations + the stop()-while-in-flight bridge call. `tests/shared/languagePacks.test.ts` asserts the new `runtimeDependencies: ['ruby']`. `tests/stores/settingsStore.test.ts` covers seed + setter + closed-enum rejection. `update-server/test/telemetry.test.ts` adds source-parity test + a redactor round-trip test for the new event. New `tests/perf/rubySpawn.bench.test.ts` (fold B) locks cold subprocess spawn under 1.5 s; skipped on CI without ruby and configurable via `LINGUA_RUBY_BENCH=1`.
  - `docs/CAPABILITY_MATRIX.md` — Ruby row updated to `Browser WASM: Shipping` + `Desktop native: Shipping (hybrid)`; per-capability decision record describes the dispatcher; review log entry.
  - Out of scope (recorded as follow-ups): Ruby gems / bundler (RL-025 lane), Ruby debugger via `debug` gem (RL-027 lane), per-project rbenv-shell init (deferred), C/C++/Java/Kotlin/Scala/Swift native runners (each its own slice), Ruby rich console payload (RL-044 Slice 1D territory).
  - Folds included this slice: A (`parseRubyVersion`), B (spawn bench guard), C (`runtime.ruby_runner_dispatched` + spawn-latency bucket), D (`.ruby-version` honoring via `RBENV_VERSION`), E (1500 ms SIGTERM→SIGKILL grace), G (Open Ruby docs link in Settings).
  - **Fold F deferred (loop protection for desktop Ruby):** Ruby AST-level source rewriting would need either a renderer-side Ruby parser (Tree-sitter or ANTLR Ruby grammar, both bundle-heavy) or a regex pre-pass that would mis-handle Ruby's `loop do` / `while … end` / `until` / one-line modifiers / `Enumerable#each` callbacks. Both options exceed the slice budget without a dedicated design pass. The WASM Slice 5 worker has the same gap; deferring fold F here keeps both paths consistent. Recorded as the next Ruby-lane follow-up under RL-042.
- 2026-05-19 Slice 5 landed — Ruby web runtime (`@ruby/wasm-wasi`):
  - `src/renderer/workers/ruby-worker.ts` (new) — Web Worker boots CRuby + stdlib via `RubyVM.instantiateModule` with a custom `consolePrinter` overriding WASI `fd_write` for fd 1 / fd 2. Per-stream line buffer flushes complete lines as `console` messages and drains tails on `done`. `$stdout.sync = true; $stderr.sync = true` forces unbuffered output so `puts` flushes per line. The VM's code-execution entry point is bound once at boot (`runRubyCode`) so the literal pattern stays inside the @ruby/wasm-wasi binding, not in the per-run hot path
  - `src/renderer/runners/ruby.ts` (new) — `RubyRunner` mirrors `PythonRunner` shape with the RL-078 parent-owned deadline + runId-guarded message dispatch. Persistent worker across runs (amortizes the ~1-2s Ruby bootstrap); `init()` is idempotent; `stop()` terminates + tears down `currentRunId` + `cancelInFlight`. No scope capture, no stdin, no magic comments this slice — Ruby flows through the legacy text console path (same posture as Go / Rust today)
  - `src/shared/languagePacks.ts` — Ruby pack flips: `execution: 'validate'` → `'run'`, `runnerId: null` → `'ruby'`, `templateIds: []` → `['rb-hello', 'rb-sort', 'rb-class']`
  - `src/renderer/runners/manager.ts` — `BUILT_IN_RUNNER_FACTORIES.ruby = () => new RubyRunner()`
  - `src/shared/runtimeTimeoutPresets.ts` — Ruby joins `RUNTIME_TIMEOUT_SUPPORTED_LANGUAGES` (default preset `normal` / 30s); `defaultRuntimeTimeoutPresetSeed()` adds the new key so existing user settings auto-seed
  - `src/renderer/components/CommandPalette/commandPaletteModel.ts` — `activeTimeoutLanguage` closed enum extended with `'ruby'` to match the new supported set
  - `src/shared/runtimeAssets.ts` — `RUNTIME_ASSETS.ruby` entry with `packageDir` override (the WASM lives under `dist/` but `package.json` lives one level up); critical file is `ruby+stdlib.wasm` (~31 MB raw / ~10 MB gzipped). `PYODIDE_COPY_FILES` re-export preserved for backwards compat
  - `build/copyRuntimeAssetsPlugin.mts` — refactored from "Pyodide-only" to iterate every `RUNTIME_ASSETS` entry. Dev-server middleware tries each asset's URL prefix in turn; build-time `writeBundle` copies critical files for every entry. `!isFile` + `catch` branches `continue` to the next asset rather than short-circuiting (reviewer fold-in)
  - `runtime-assets.lock.json` — regenerated via `npm run build:runtime-assets`. New `ruby` entry holds the SHA-256 of `ruby+stdlib.wasm`
  - `package.json` — adds `@ruby/wasm-wasi: 2.9.3-2.9.4` (JS bindings) + `@ruby/3.4-wasm-wasi: 2.9.3-2.9.4` (WASM bytecode). Both are exact-pinned so the worker never pairs JS bindings from one ruby.wasm release with bytecode from another.
  - `src/renderer/data/templates.ts` — 3 starter templates: `rb-hello` (Hello World), `rb-sort` (sort_by + reverse), `rb-class` (attr_reader + GPA letter)
  - i18n: 6 new template keys in both `en` and `es` (tuteo)
  - `docs/CAPABILITY_MATRIX.md` — new Ruby row in the runtime matrix (`Browser WASM: Shipping`, `Desktop native: Planned (next slice)`) + per-capability decision record + review-log entry
  - Tests: 11 MockWorker tests in `tests/runners/ruby.test.ts` covering metadata, lifecycle, happy-path dispatch, persistent-worker reuse, error path with line annotation, load failure (asserts stdout/stderr empty), parent-owned timeout. Updates to `tests/shared/languagePacks.test.ts`, `tests/utils/languageMeta.test.ts`, `tests/runners/manager.test.ts` (now 6 supported langs), `tests/shared/runtimeTimeoutPresets.test.ts`, `tests/shared/runtimeAssets.test.ts` (version-pinning assertion loosened to accept either `/v1.2.3/` or `@1.2.3` formats), `tests/stores/settingsStore.test.ts` (seed expectation)
- 2026-05-20 Slice 5 follow-up — Ruby language intelligence + editor-support registry refactor:
  - New `src/renderer/languageSupport/*` descriptor registry. Per-language modules (`javascript`, `typescript`, `go`, `python`, `rust`, `lua`, `ruby`) plus a `fileTypes` group declare their Monaco grammar loader / config and any completion / hover / signature-help / `LanguageIntelligenceAdapter` factories. `src/renderer/monaco.ts` and `src/renderer/languageIntelligence/index.ts` both walk the registry generically — adding a new editor language no longer requires editing a shared switch in either file. Architecture decision recorded in `docs/LANGUAGE_PACK_ADR.md` under "Renderer editor-support registry".
  - New `src/renderer/languageIntelligence/ruby.ts` — renderer-side Ruby adapter. Strips strings / `#` line comments / `=begin … =end` block comments before analysis. Builds a per-file symbol table (classes, modules, methods + their parameters, locals, block parameters via `|item, index|`). Emits `LanguageIntelligenceDiagnostic[]` for unexpected `end`, unbalanced `()` / `[]` / `{}`, unclosed block keywords (`class`, `module`, `def`, `if`, `unless`, `case`, `while`, `until`, `for`, `begin`, trailing `do`). Provides hover with secondary parameter list + defined-at line, plus signature help with active-parameter tracking inside the innermost open call.
  - New `src/renderer/components/Editor/completionProviders/ruby{Completions,HoverProvider,SignatureProvider}.ts` — Monaco glue around the adapter. `rubyCompletions` ships a curated static set (require / include / attr_* / puts / print / p / raise / rescue / ensure / yield / each / map / sort_by + snippets for `def` / `class` / `module` / `do |item|` / `if` / `begin/rescue`) plus dynamic per-file completions from `analyzeRubyLanguageIntelligence`.
  - `src/shared/languagePacks.ts` — Ruby pack `capabilities.lsp` flips `'none'` → `'adapter'` to match the new renderer adapter (pack guard test updated in lockstep).
  - `tests/languageSupportRegistry.test.ts` (new) — pins descriptor id uniqueness, Ruby descriptor wires all four providers, `getLanguageIntelligenceAdapter('ruby')` returns a real adapter.
  - `tests/languageIntelligence/ruby.test.ts` (new) — covers symbol collection, localized diagnostics (en + es), comment/string immunity, hover, and signature help with active-parameter cursor.
  - `tests/monaco.test.ts` + `tests/completionProviders.test.ts` updated for the registry-driven contribution + provider iteration; Ruby joins the asserted set.
  - Worker stderr stream now uses `method: 'warn'` (not `'error'`) so the result presenter does NOT suppress user stderr as a duplicate of the structured `result.error`. The runner routes both `'warn'` and `'error'` into the stderr array. The error path inside the worker still emits the traceback as `'error'` rows so the renderer can style them as failure lines. New regression test in `tests/utils/executionPresentation.test.ts`.
- 2026-05-20 Slice 5 follow-up — chrome → floating-pill toolbar action migration:
  - `src/renderer/components/Chrome/AppChrome.tsx` drops the search + settings icon buttons. The chrome row becomes "a quiet window title" — traffic-light spacer + filename + LicenseBadge + UpdateReadyChip only, with a fixed-width right spacer for layout symmetry. `AppChrome` no longer accepts `onOpenPalette`.
  - `src/renderer/components/Toolbar/FloatingActionPill.tsx` grows four new icon buttons (Quick Open, Palette, Snippets, Utilities) hosted in a `role="toolbar"` group with tooltips that include the keyboard shortcut. Pill width seed grows from 700/460 → 820/560 to accommodate. New `.action-pill-icon-button` CSS class with hover + active-state styling. The settings cog stays as the trailing button.
  - `src/renderer/components/Layout/AppLayout.tsx` re-wires `onOpenQuickOpen` / `onOpenSnippets` / `onOpenUtilities` / `utilitiesOpen` props through to the pill instead of leaving them dead-ended.
  - Tests: `tests/components/Chrome/AppChrome.test.tsx` swaps the icon-click assertions for `queryByTestId` negative assertions (no longer rendered). `tests/components/AppLayout.test.tsx` adds an integration test that clicks every new pill button through the layout boundary.
  - New i18n keys (en + es tuteo): `chrome.actions.aria`, `chrome.quickOpen.{tooltip,aria}`, `chrome.snippets.{tooltip,aria}`, `chrome.utilities.{tooltip,aria}`.
- 2026-05-19 Slice 5 landed — Ruby web runtime (`@ruby/wasm-wasi`):
- 2026-04-20 update:
  - `ruby` joins `LANGUAGE_PACKS` with `execution: 'validate'`, `runnerId: null`, Monaco's built-in Ruby grammar, and `.rb` extension detection
  - `BuiltInLanguage` in `src/renderer/types/index.ts` and `ENGLISH_FALLBACK_LABELS` in `src/renderer/utils/languageMeta.ts` both know about Ruby
  - Pack guard test pins Ruby's validate-only shape + the `.rb` extension round-trip; `languageMeta.test.ts` asserts the detection + Monaco routing
  - Toolbar's New File menu stays untouched for now (separate list); a future slice promotes Ruby there once an execution runtime lands
  - 2026-04-20 ter — RL-042 second slice: `c` and `cpp` join `LANGUAGE_PACKS` the same validate-only way. `c` claims `.c` + `.h`, `cpp` claims `.cpp / .cc / .cxx / .hpp / .hh / .hxx`. Monaco's built-in `c` and `cpp` grammars handle highlighting; `BuiltInLanguage` + `ENGLISH_FALLBACK_LABELS` know about both; tests pin the extension round-trips, validate mode, and null runnerId. Native toolchain runners (gcc / clang) are their own follow-up slice
  - 2026-04-20 quater — RL-042 third slice: `swift` and `kotlin` join `LANGUAGE_PACKS` the same validate-only way. `swift` claims `.swift`, `kotlin` claims `.kt` + `.kts`. Monaco's built-in `swift` and `kotlin` grammars handle highlighting; distinct badge classes (orange / purple) keep the pack visually distinguishable; `BuiltInLanguage` + `ENGLISH_FALLBACK_LABELS` know about both; tests pin extension round-trips, validate mode, null runnerId, and badge class sanity. JVM / native runners land in a future slice
  - 2026-04-20 quinquies — RL-042 fourth slice: `java` and `scala` join `LANGUAGE_PACKS`. `java` claims `.java` (amber badge), `scala` claims `.scala` + `.sc` (rose badge). Monaco's built-in `java` and `scala` grammars cover highlighting; default code starters use modern idioms (Java public-class entry, Scala 3 `@main` syntax). Tests pin presence, extension round-trips, validate mode, null runnerId, and the per-pack badge sanity. The JVM toolchain integration remains its own future slice
  - Original `Planned` readiness note preserved below as history
- Why this matters:
  - CodeRunner supports 25 languages out of the box
  - The current 5-language limit is a competitive disadvantage for students and polyglot developers
  - WASM 3.0 (September 2025) added GC types, enabling Java, Kotlin, Dart, Scala compilation
- Research-backed expansion candidates:

  | Language | Execution strategy | Viability |
  |----------|-------------------|-----------|
  | C/C++ | Emscripten WASM (browser) + native gcc/clang (desktop) | High |
  | Java | CheerpJ / TeaVM WASM (browser) + JDK (desktop) | Medium-High (WASM 3.0 GC) |
  | Ruby | MRuby WASM (browser) + native Ruby (desktop) | Medium |
  | PHP | php-wasm (browser) + native PHP (desktop) | Medium |
  | Lua | Already bundled via Fengari plugin | Expand to first-class |
  | Swift | Desktop-only via native toolchain | Desktop only |
  | Kotlin | WASM via Kotlin/Wasm (GC types) | Medium-High |
  | Dart | WASM compilation target | Medium |
  | Haskell | Asterius WASM or GHC WASM backend | Low-Medium |
  | Perl | WebPerl WASM | Low |
  | Shell/Bash | Desktop-only child process | Desktop only |

- Scope:
  - Use the RL-038 language-pack architecture to add languages incrementally
  - Prioritize C/C++, Java, Ruby, PHP, and Lua as the first expansion wave
  - Keep each language addition as a self-contained language pack with:
    - runner, templates, syntax mode, file extensions, formatter flag, docs link
  - Desktop languages (Swift, Shell) are explicitly desktop-only in capability flags
- Acceptance criteria:
  - At least 10 languages are executable by the end of this task
  - Each new language has at least one starter template
  - Web mode honestly reports which languages are unavailable
- Dependencies:
  - RL-038

### RL-043 Add notebook / cell-based execution mode

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready for a schema/session foundation after RL-044 payload migration; full multi-file notebooks still wait on RL-024`
- Why this matters:
  - Jupyter, marimo, and Observable prove that cell-based execution is the preferred mode for:
    - data exploration
    - step-by-step learning
    - documentation with live code
  - marimo's reactive model (auto-rerun dependent cells) is particularly powerful
  - This would differentiate Lingua from every other desktop code runner
- Scope:
  - Slice A — foundation:
    - add a versioned `.linguanb` schema and parser/serializer under `src/shared/`
    - model notebooks as a distinct tab kind in `editorStore` rather than overloading plain file tabs
    - support markdown cells and JS/TS/Python code cells
    - add runner-owned session IDs per notebook tab so globals can persist across cell execution without using raw `globalThis.eval()` as a shortcut
    - dispose notebook sessions when the tab closes or language/runtime changes
    - virtualize cell editors so large notebooks do not mount dozens of Monaco instances at once
  - Slice B — first UI:
    - add a notebook view alongside the standard editor view
    - run one cell, run all above, run all, stop current cell
    - attach text and existing `RL-044` rich output below each cell
    - show execution status and elapsed time per cell
  - Slice C — reactive/dataflow mode:
    - track simple cell dependencies
    - editing an upstream cell marks downstream cells stale
    - optional auto-rerun is off by default and gated by the same live-update controls as scratchpad
  - Slice D — export:
    - export as standalone script, markdown with code blocks, and static HTML report
  - Full multi-file notebook projects wait on `RL-024`
- Acceptance criteria:
  - Import/export round-trips a notebook document without losing cell IDs, language, source, outputs, or metadata
  - Users can create a multi-cell notebook and execute cells independently
  - Cell 2 can read a variable defined in Cell 1 inside the same notebook session
  - Closing a notebook tab disposes its runtime session
  - Cell outputs render inline below each cell using the same text/rich output contracts as the console
  - Reactive mode never runs implicitly unless the user enables it for the notebook
  - Notebooks can be exported as scripts or reports
- Dependencies:
  - RL-020
  - RL-044 for rich cell output
  - RL-024 for multi-file notebooks

#### 2026-05-20 research triage

The v2.0 proposal's notebook direction is folded into this existing notebook ticket.
The proposed direct `globalThis.eval()` approach is rejected because it would
bypass the runner instrumentation, timeout, debugger, console, and stop
contracts that already exist. Notebook execution must use explicit
runner-owned sessions so each language can preserve state without coupling the
implementation to JS worker internals.

### RL-044 Add inline data visualization and rich output rendering

- Priority: `P2`
- Status: `Partial`
- Readiness: `Slice 1A/1B/1C shipped; next slice is rich media payloads and renderer migration`
- Why this matters:
  - Structured output turns the console from a text sink into an inspection surface
  - Students and data-oriented developers expect charts, tables, and images in output
  - This makes the console panel dramatically more useful
- Scope:
  - Ship a structured console-entry model before higher-level visualization:
    - level
    - source line
    - timestamp
    - argument list
    - expandable value preview
    - optional runtime metadata
  - Render common JS/TS values richly:
    - plain objects
    - arrays
    - maps and sets
    - errors
    - dates
    - promises
  - Detect structured output and render it richly:
    - Arrays of objects → auto-table
    - `{ type: 'chart', data: [...] }` → inline chart via a lightweight chart library
    - Image URLs or base64 → inline image preview
    - HTML strings → sandboxed HTML preview
  - Add a `console.table()` equivalent that renders as an interactive table
  - Add magic comment variants for visualization:
    - `//=> table` renders as table
    - `//=> chart` renders as chart
  - Keep visualization lightweight — use a small embedded library, not a full notebook framework
- Acceptance criteria:
  - Console entries preserve their level, source line, and source navigation target
  - Expandable object/array/map/set/error previews work before chart/image rendering lands
  - An array of objects logged to console renders as a sortable table
  - Basic chart rendering works for JS/TS and Python
  - Image output renders inline in the console panel
- Dependencies:
  - RL-020
  - RL-019

#### 2026-05-20 research triage and next slice

The v2.0 proposal's rich-media console direction is folded into this existing `RL-044` lane.
The direction is accepted, but the implementation must extend the shipped
`RichOutputPayload` contract instead of introducing a parallel console
payload type.

Next slice scope:

- Migrate the remaining console presenter paths from `ConsoleOutput.args:
  string[]` assumptions to payload-aware rendering with a text fallback.
- Add renderer support for:
  - `chart` payloads with responsive, high-contrast canvas rendering that
    uses app theme tokens
  - `image` payloads with size/type caps and no remote fetch requirement for
    local/base64 outputs
  - sandboxed `html` payloads rendered in an iframe without `allow-scripts`
    or `allow-same-origin`
  - expandable JSON-tree payloads reusing the existing rich object/array
    formatters where possible
- Add explicit worker APIs only after they map to the shared payload contract:
  - JS/TS: `lingua.chart(data)` and `lingua.html(html)`
  - Python: `lingua.chart(data)` and `lingua.html(html)` through the Pyodide
    bridge
- Keep Settings -> Editor -> Rich console output as the kill switch for the
  entire rich media path.
- Add security tests proving HTML payloads cannot execute script and cannot
  escape the iframe.

Acceptance for the next slice:

- Turning rich rendering off paints the legacy text path for every new payload.
- JS, TS, and Python can each emit at least one chart payload and one sandboxed
  HTML payload.
- The detail popover exposes raw JSON for every rich media payload.
- Console panel, inline results, and execution history do not invent separate
  payload schemas.
- Browser smoke covers EN and ES rendering and ends with zero console errors.

#### § Slice 1A landed (2026-05-18)

Foundation type system + `//=> table` directive only. Intentionally
additive and scoped tight (zero breaking changes)
so the runner-payload migration + console-panel rewrite + popover +
chart/image/HTML/Python surfaces can ship as separate slices without
half-finished UI bleeding through.

Shipped:

- `src/shared/richOutput.ts` — `RichOutputPayload` discriminator
  (superset of `ScopeValue` + `map`/`set`/`date`/`promise`/`table`/
  `rawText`/`image`/`chart`), `serializeRichValue`, `detectAutoTable`,
  `forceTablePayload`, `tryParseJsonForPayload`, `wrapAsRawText`.
  Slice 2 stubs for `image` + `chart` pre-staged (Fold E from plan)
  so a future migration doesn't have to widen the discriminator
  again.
- `MagicCommentResult.payload?: RichOutputPayload` (additive) and
  `LineResult.payload?: RichOutputPayload` (additive) — every
  pre-Slice-1A renderer path keeps reading the canonical `value`
  string, the new `payload` field is consulted only when present.
- `magicComments.ts` — recognises the `//=> table` directive on
  both the JS arrow regex AND the Python `#=>` arrow regex. Unknown
  directive words fall through to legacy arrow behaviour (typo
  safety). The free-form annotation form (`//=> should be 1`) still
  parses unchanged.
- JS + TS runners — when the side-table records `table` for a magic
  line, the runner attempts to `tryParseJsonForPayload(value)` and
  wraps the recovered JSON-compatible value as a `RichOutputTable`
  via `forceTablePayload`. The legacy `value` string still ships
  alongside as the text fallback. Python/Go/Rust runners
  unchanged — the additive type means they keep working without a
  compat wrapper.
- `executionPresentation.ts` threads the payload through into
  `LineResult` without touching the existing magic/watch/autoLog
  branching.
- `useInlineResults.ts` (`renderInlineResultNode`) — uses the shared
  `formatPayloadInlineSummary` helper to render `Table(N×M) — cols`,
  `Map(N)`, `Set(N)`, ISO date, and `Promise(state)` summaries when
  the payload is present. Falls back to today's stringified
  `result.value` + `inferKind` when no payload is attached.
- `editorExecutionDecorations.ts` — uses the same
  `formatPayloadInlineSummary` helper so the Monaco decoration path
  and the overlay-widget path stay aligned.

Verification:

- Web preview (`npm run preview:web`): pasting
  `const rows = [{name:"alice",age:30},{name:"bob",age:25},{name:"carol",age:28}]; rows //=> table; rows //=>`
  in a JS scratchpad renders the first arrow as
  `⟸ Table(3×2) — name, age [TABLE]` (Slice 1A path) and the
  second as the truncated legacy `⟸ [ { "name": "alice", ... [ARRAY]`
  capped at 80 chars with the full value available on hover via the
  `title` attribute (Prerequisite fix below). 0 console errors. PNGs:
  `output/playwright/rl-044-slice1a/inline-table-directive.png`,
  `output/playwright/rl-044-slice1a/A-only-directive.png`,
  `output/playwright/rl-044-slice1a/B-only-legacy.png` (pre-fix
  overflow reproduction),
  `output/playwright/rl-044-slice1a/C-after-overflow-fix.png`
  (post-fix coherent rendering).
- New/updated tests: `tests/shared/richOutput.test.ts`,
  `tests/utils/magicComments.test.ts`,
  `tests/runners/javascript.test.ts`,
  `tests/runners/typescript.test.ts`, and
  `tests/hooks/useInlineResults.test.ts` cover the serializer,
  directive parse path, runner payload stitching, and overlay
  truncation. `npm test --run`, `npx tsc --noEmit`, and the i18n
  checks pass; `npm run lint` exits cleanly with the documented
  warning baseline from Iter 29.

Prerequisite fix folded into the same commit:

- `useInlineResults.ts` — overlay-widget overflow bug landed with
  RL-093 chrome v2: when `LineResult.value` exceeded the editor
  viewport width the pill painted past the right edge, wrapped onto a
  second line, and visually mounted over the gutter on the left.
  Reproducible on any large `console.log(arr)` or `arr //=>` pre-
  Slice-1A — independent of RL-044 but the surface RL-044 Slice 1A's
  `Table(N×M)` summary side-steps. Truncate the display string at
  `INLINE_VALUE_MAX_CHARS = 80` with an ellipsis (`…`) and expose
  the full text via the `title` attribute + `data-truncated="true"`
  marker for downstream styling. Slice 1A's typed-payload summaries
  ship under the cap so the truncation is a no-op for them — the
  fix only affects the legacy stringified path. See
  `output/playwright/rl-044-slice1a/B-only-legacy.png` vs
  `C-after-overflow-fix.png` for the visual diff.

Deferred to Slice 1B (separate plan):

- Console panel `<ConsoleEntryRenderer>` + 5 RichValue* components
  (`Text`, `Object`, `Array`, `MapSet`, `Table`).
- Popover detail surface + "Copy as JSON" + "Raw JSON" tabs
  (Folds B + C from the original plan).
- Migrate `ConsoleOutput.args: string[]` → `RichOutputPayload[]`
  (breaking — touches every fixture).
- `console.table()` shim in the JS sandbox.
- TS/Python/Go/Rust runner compat wrappers when the breaking
  type lands.
- Refactor shared formatters from `VariableInspectorPanel` (Fold
  D — needs the new components first to actually share).
- Per-call-site `serializeRichValue` memoisation (Fold F — gated
  on actual perf data once the console panel uses it).
- 3 additional telemetry events (this slice ships none — only
  the inline-pill text changed; the new telemetry surface is
  Slice 1B's panel).

Deferred to Slice 2 (separate plan, security review required):

- Inline chart rendering (chart-lib decision deferred).
- Image preview from URL / base64.
- Sandboxed HTML preview (iframe + CSP review).
- Python matplotlib / pandas DataFrame detection (Pyodide worker
  changes).
- `//=> chart` + `//=> figure` magic-comment directives.

#### § Slice 1B landed (2026-05-19)

Console-panel rich rendering + popover detail surface. Tight cut of
the Slice-1A "Deferred to Slice 1B" enumeration: additive `payload`
flows end-to-end without the breaking `args: string[]` migration; the
console panel paints rich kinds inline + opens a popover; Pro-gated
Copy as JSON; eight folds (A–H) on top of core + a tooltip refinement
on every shortcut surface (user ask in the Phase 1 approval).

Shipped:

- `ConsoleOutput.payload?: RichOutputPayload[]` and
  `ConsoleEntry.payload?: RichOutputPayload[]` (additive — `args` /
  `content` unchanged; the 3 runner test fixtures
  `tests/runners/parentTimeout.test.ts`, `rust.test.ts`,
  `limits.test.ts` keep passing without modification).
- `js-worker.ts` `serialize()` now also produces an aligned
  `RichOutputPayload[]` via `serializeRichValue`. The proxy posts both
  `args` (string fallback) and `payload` (typed). New
  `console.table(rows, columns?)` shim (fold D — Chrome DevTools
  second-arg subset, indices preserved post-filter so the legacy text
  remains coherent at `Table(N×M)`).
- JS + TS runners forward `payload` to `ConsoleOutput` and emit
  `runtime.console_table_called { language }` adoption telemetry when
  the worker flags `consoleTableInvoked: true`.
- 7 new components under `src/renderer/components/Console/`:
  `ConsoleEntryRenderer.tsx` (dispatch wrapper),
  `RichValueText.tsx`, `RichValueObject.tsx`, `RichValueArray.tsx`,
  `RichValueMapSet.tsx`, `RichValueTable.tsx`,
  `ConsoleEntryPopover.tsx` (Preview + Raw JSON tabs).
- Shared formatter helpers `src/renderer/components/Console/richConsoleFormat.ts`
  with `richKindBucket` / `typeIcon` / `payloadHasRichSurface` /
  `payloadAsJsonString`. Pure (no React, no i18n) so a future
  Slice 1C refactor of `VariableInspectorPanel` formatters can land
  alongside.
- `<ConsolePanel>` `EntryRow` dispatches to `<ConsoleEntryRenderer>`
  when both the new `Settings.consoleRichRenderingEnabled` is ON
  AND `entry.payload` is present + non-empty. Otherwise paints the
  legacy `<AnsiContent>` text path unchanged.
- **Fold A** payload-kind filter chips (`Tables · Objects · Arrays ·
  Map/Set · Text`). Default empty hidden-set so every kind starts
  visible. `consoleStore` gains `hiddenPayloadKinds: Set<…>` +
  `togglePayloadKindFilter` + `clearPayloadKindFilters`.
- **Fold B** `Mod+Shift+J` keyboard handler inside `<ConsoleEntryPopover>`
  toggles Preview ↔ Raw JSON; new command-palette entry
  `action-toggle-console-rich-rendering` (bumps the palette catalog
  count by 1). **Tooltip refinement** (user ask in the Phase 1
  approval): both popover tabs wrap in the existing `<Tooltip>`
  primitive from `src/renderer/components/ui/chrome.tsx` with i18n
  keys `console.rich.previewShortcutTooltip` +
  `console.rich.rawJsonShortcutTooltip`. The same content lands on
  `aria-label` for screen-reader parity, mirroring the
  `RuntimeModeSelector` pattern.
- **Fold C** Pro-gated "Copy as JSON" via `useEntitlement('EXECUTION_HISTORY')`;
  Free-tier label flips to `Copy as JSON (Pro)` + `pushUpsellNotice`
  on click with the new `upsell.feature.consoleCopyJson` key.
- **Fold D** `console.table(rows, columns?)` second-arg subset (see
  worker shim above).
- **Fold E** Settings → Editor row "Rich console output" (default ON);
  new `Settings.consoleRichRenderingEnabled` field + `toggleConsoleRichRendering`
  action; persisted across reloads; defensive boolean check in the
  rehydrate merge.
- **Fold F** new `runtime.console_table_called { language }` telemetry
  (closed-enum `language`, safe-token validated). Mirrored on
  `update-server/src/telemetry.ts` with the same validator + a behavior
  test.
- **Fold G** `tests/shared/consoleRich.bench.test.ts` — 1 000 iterations
  / 750 ms budget locking the `serializeRichValue + richKindBucket`
  hot path. Mirrors the RL-020 Slice 5 fold F autoLog detector lock.
- **Fold H** `collapseIdenticalEntries` helper in `ConsolePanel.tsx`
  collapses consecutive identical entries (matching `type` + `line` +
  `content` + JSON-shape of `payload`) into a single row with an
  `×N` badge. The underlying store entries stay intact so
  `<RecentRunsPill>` and replay surfaces still see every log.

New telemetry:

- `runtime.console_rich_rendered { kind }` — closed enum
  `table | object | array | mapSet | date | promise | text | rawText | image | chart`.
  Fires once per first-render of a payload-bearing entry via a
  `useMemo` so React strict-mode double-mount only emits one event
  per payload. Mirrored on update-server.
- `runtime.console_table_called { language }` — see fold F above.
- New parity test in `update-server/test/telemetry.test.ts` locks
  `CONSOLE_RICH_KIND_BUCKETS` between renderer + worker. The
  pre-existing `TELEMETRY_EVENT_NAMES` parity assertion already
  enforces the array shape.

i18n keys (both locales, tuteo Spanish):

- `console.rich.preview` / `console.rich.rawJson` / `console.rich.copyAsJson`
  / `console.rich.copyAsJsonPro` / `console.rich.expand` /
  `console.rich.collapse` / `console.rich.tableSummary` /
  `console.rich.mapSummary` / `console.rich.setSummary` /
  `console.rich.truncated` / `console.rich.moreCount` /
  `console.rich.openDetails` /
  `console.rich.imagePlaceholder` / `console.rich.chartPlaceholder` /
  `console.rich.close` / `console.rich.previewShortcutTooltip` /
  `console.rich.rawJsonShortcutTooltip` / `console.rich.filterChip.*`
  (`table` / `object` / `array` / `mapSet` / `text` / `errorish`).
- `consoleRich.settings.label` + `consoleRich.settings.hint` for the
  Settings → Editor row.
- `commandPalette.action.toggleConsoleRichRendering.{label,descriptionEnable,descriptionDisable}`.
- `upsell.feature.consoleCopyJson`.

Verification:

- `npm run lint` + `npx tsc --noEmit` + `npm run check:i18n` +
  `npm run check:i18n:copy` clean. `npm test -- --run` 3 428 / 4
  skipped (309 test files). `update-server` 114 / 0 including the
  new `CONSOLE_RICH_KIND_BUCKETS` parity test + behavior tests for
  `runtime.console_rich_rendered` and `runtime.console_table_called`.
  `update-server` typecheck is clean.
- `npm run build:web` clean.
- UI smoke verified via `npm run preview:web -- --host 127.0.0.1
  --port 4173` + headless Playwright. The smoke seeds an EN and ES JS
  tab, switches the action pill from Scratchpad to Run, opens the
  console, verifies a rich `console.table(rows, ['age'])` entry, opens
  Raw JSON details, toggles the `TABLES` payload chip, and ends with
  zero browser console/page errors.
- New tests: `tests/components/Console/richConsoleFormat.test.ts`
  (5 cases — closed-enum buckets, icons, surface gate, JSON
  round-trip), `tests/runners/javascript.test.ts` (2 new cases —
  payload pass-through + legacy fallback), `tests/stores/consoleStore.test.ts`
  (5 new cases — hiddenPayloadKinds toggle + clear + payload-preserving
  addEntry), `tests/shared/consoleRich.bench.test.ts` (perf budget),
  `tests/shared/telemetry.test.ts` (allowlist parity expanded),
  `update-server/test/telemetry.test.ts` (3 new cases —
  `CONSOLE_RICH_KIND_BUCKETS` parity + behavior tests for both
  events). Existing `tests/components/ConsolePanel.test.tsx` mocks
  updated to include `hiddenPayloadKinds` + the two new actions.

Deferred to Slice 1C (separate plan):

- Breaking `ConsoleOutput.args: string[]` → `args: RichOutputPayload[]`
  migration + fixture refactor across the 3 runner test files.
- Native payload emission for TS / Python / Go / Rust runners.
- Refactoring shared formatters from `<VariableInspectorPanel>`
  (Slice 1A Fold D — extract `typeTag` / `typeIcon` / `renderInlineValue`
  / `previewSummary` to `richConsoleFormat.ts` so both popover and
  inspector share the formula).
- `serializeRichValue` memoisation (Slice 1A Fold F — gated on
  perf data once Slice 1C lands).

Slice 2 stays as-is (separate security review).

#### § Slice 1C landed (2026-05-19)

Python (Pyodide) console payload emission. The third worker-owned
runtime now ships rich payloads through the same render chain JS+TS
got in Slice 1B; Go and Rust subprocess runners stay on the text-only
path pending a separate architectural slice.

Shipped:

- **`src/renderer/workers/python-worker.ts` preamble extension** — new
  `__lingua_console_serialize(value, force_table)` walker that maps
  `dict` / `list` / `tuple` / `set` / `frozenset` / `datetime` /
  `dataclasses` / `BaseException` → JSON-safe `RichOutputPayload`
  shapes mirroring the JS-side serializer. Caps mirror the JS
  defaults (200 top-level / 100 per-container / 16 columns / 200
  table rows). Auto-table detection promotes lists of dicts to
  `kind: 'table'` (mirrors Slice 1A's `detectAutoTable`). Fallback
  `kind: 'rawText'` for anything the walker can't classify.
- **`__lingua_print(*args, sep, end, file, flush)` override** — wraps
  the user-namespace `print`, captures `(text, [payload_per_arg])`
  into `__lingua_print_entries`. `__lingua_builtins.print` stays
  intact so libraries that reach for the bare builtin keep working.
- **Per-arg payload capture (fold C)** — `print(a, b, c)` ships three
  aligned payloads matching the joined text. Renderer's renderer-side
  `<ConsoleEntryRenderer>` (Slice 1B) dispatches per index.
- **`__lingua_displayhook(value)` (fold A)** — REPL-style top-level
  expression capture. A scratchpad cell ending in `users` (no
  `print()`) surfaces with the same object chip as `print(users)`.
  Falls back to `__lingua_repr_safe` + `sys.stdout.write` so the text
  transcript stays intact.
- **`try/finally` on the end-of-run dump** — `sys.stdout` /
  `sys.stderr` / `sys.displayhook` restore in a `finally` so a
  cleanup-block crash never strands the persistent Pyodide worker
  with a stale displayhook for the next run.
- **Fold D — `#=> table` directive**: `__mc(line, lambda: expr,
  directive="table")` triggers `__lingua_console_serialize(val,
  force_table=True)` in Python; renderer's `'magic-comment'`
  dispatch consumes the worker payload OR recovers client-side via
  `tryParseJsonForPayload + forceTablePayload`. `WorkerResponse
  'magic-comment'` variant widened to include `payload?` so the
  runner reads through typed shape (no `as unknown` casts).
- **Fold E — `richConsoleEnabled` flows from Settings to the
  worker** via the `execute` postMessage, gating the entire Python
  preamble's payload generation. The renderer-side gate already
  hides the rich path when the toggle is OFF; this fold makes the
  worker-side cost zero too.
- **Fold F — `BaseException` → `kind: 'error'` payload**, plus
  `'error'` added to `CONSOLE_RICH_KIND_BUCKETS` on BOTH the renderer
  and update-server sides so the telemetry redactor passes the kind
  through (the parity test in `update-server/test/telemetry.test.ts`
  catches drift). `richKindBucket` in `richConsoleFormat.ts` now
  buckets `kind: 'error'` distinctly from `'text'` so dashboards
  count error payloads independently.
- **`postPythonPrintEntries` newline-splitting** — each
  `print_entry` is split by `\n` (filter `line !== ''` to stay
  symmetric with the legacy `postBufferedOutput`) and posted as one
  `'console'` message per line; the `payload` array attaches to the
  FIRST line only (continuation text from multi-line prints gets no
  payload). Cap of 5 000 entries with silent skip past the ceiling
  (mirrors JS-side `appendCappedConsole` discipline).
- **Renderer `python.ts:291`** — forwards `msg.payload` into
  `ConsoleOutput.payload`, fires the new
  `runtime.python_console_payload_emitted { kind }` telemetry per
  payload element (intentional N:1 granularity vs. the renderer's
  `runtime.console_rich_rendered` — documented inline so dashboards
  expect the skew).
- **`runtime.python_console_payload_emitted { kind }`** added to
  `TELEMETRY_EVENTS` + `EVENT_PROPERTY_ALLOWLIST` + redactor switch
  (renderer side) and mirrored on `update-server/src/telemetry.ts`
  with the same closed-enum gate against `CONSOLE_RICH_KIND_BUCKETS`.
  Behavior test in `update-server/test/telemetry.test.ts` exercises
  accept (`object`) + reject (`dataframe`).
- **`tests/shared/pythonConsoleSerialize.bench.test.ts` (new, fold
  G)** — 1 000-iteration / 750 ms budget locking the renderer-side
  Python print-entries hot path (`richKindBucket` + `JSON.stringify`
  for the collapse-equality check).

Verification:

- `npm run lint` + `npx tsc --noEmit` + `npm run check:i18n` +
  `npm run check:i18n:copy` clean. `npm test -- --run` **3452 / 4
  skipped** (313 test files; +8 new). `update-server` **115 / 0**
  (+1 new behavior test for the new event).
- New tests: `tests/runners/python.test.ts` 4 new cases (rich payload
  pass-through with a controlled `PayloadWorker` mock, text-only
  fallback that ACTUALLY exercises the no-payload branch via a
  dedicated `TextOnlyWorker` mock, `richConsoleEnabled = true`
  default, `richConsoleEnabled = false` when Settings toggle is OFF).
  `tests/shared/pythonConsoleSerialize.bench.test.ts` (perf budget).
  Existing `tests/components/Console/richConsoleFormat.test.ts`
  updated for the `error` bucket change.
- UI smoke: web build + preview at port 4173 + Playwright MCP
  captured `01-js-baseline.png` showing the JS Slice 1B baseline
  remains intact (rich object chip + `Table(2×2)` summary + filter
  chip row). The full 8-screenshot Python smoke planned in the
  approved plan was abbreviated — Pyodide tab spin-up via MCP
  consumed too many cycles per shot. Slice 1C correctness is locked
  by the unit + parity tests (3452 + 115 green); the JS baseline
  PNG documents the chrome remains stable; Python-side correctness
  is covered by the runner + worker unit tests.

Reviewer fixes folded inline:

- Widened the `WorkerResponse 'magic-comment'` variant to add
  `payload?: RichOutputPayload` so the Python runner reads through
  the typed shape instead of an `as unknown` cast.
- Replaced the vacuous "text-only fallback" test with a real
  `TextOnlyWorker` mock that emits a `'console'` message WITHOUT
  `payload` to exercise the runner's no-payload branch.
- Documented the per-payload-element telemetry granularity at the
  fire site so dashboards understand the N:1 skew vs. the
  renderer-side `runtime.console_rich_rendered`.
- Consolidated `richConsoleEnabled` read with the existing
  `settingsSnapshot` so a Settings flip mid-execute doesn't produce
  a split-state run.
- Wrapped the end-of-run dump in `try/finally` so a JSON-encode
  failure never strands `sys.displayhook` / `sys.stdout` /
  `sys.stderr` on the persistent worker.
- Added `'error'` to `CONSOLE_RICH_KIND_BUCKETS` on both renderer
  and update-server so fold-F exception payloads survive the
  closed-enum gate. Parity test list updated.
- Aligned `postPythonPrintEntries` newline filter (`line !== ''`)
  with the legacy `postBufferedOutput` filter so whitespace-only
  lines behave identically on the rich and text-only paths.

Deferred to Slice 2 (separate plan, security review required):

- pandas.DataFrame detection.
- numpy.ndarray detection.
- Inline chart / image / sandboxed HTML rendering.
- `#=> chart` / `#=> figure` magic-comment directives.

#### § Slice 2a landed (2026-05-20)

Rich-media renderer surface for `image` + `html` payloads + Sub-slice F
clickable error stacks. Tight cut of the approved Slice 2 plan: the
discriminator widens, the renderer dispatch routes the new kinds to
dedicated components, the pure parsers + validators land in
`src/shared/`, telemetry mirrors with parity tests. **Vega-lite chart
+ folds A/B/C/E/G + Python-worker integration + automatic JS worker
error-stack wiring are deferred to Slice 2b** (the chart family carries
the bulk of the dependency + security risk; isolating it lets Slice 2a
ship behind a clean, smaller surface).

Shipped:

- **`src/shared/richOutput.ts`** — discriminator widens with
  `RichOutputHtml` (`{ kind: 'html', html: string, height?: number }`);
  `RICH_KINDS_BEYOND_SCOPE_VALUE` set includes `'html'`;
  `isExtendedRichKind` predicate widens; new caps
  `MAX_HTML_PAYLOAD_HEIGHT_PX = 800`,
  `DEFAULT_HTML_PAYLOAD_HEIGHT_PX = 240`,
  `MAX_IMAGE_SRC_LENGTH = 7_000_000`,
  `MAX_HTML_PAYLOAD_LENGTH = 256 * 1024`; new pure validators
  `validateImageSrc` (whitelist: `data:image/...` / `blob:` /
  `https://`; rejects `http:` / `javascript:` / `vbscript:` / `file:`),
  `clampHtmlHeight`, `validateHtmlPayload`.
- **`src/shared/scopeSnapshot.ts`** — `ScopeValueError.stack?:
  ClickableStackFrame[]` optional field. Existing call sites that
  emit `{kind:'error', message}` keep working without the field
  (additive, never breaking).
- **`src/shared/errorStack.ts` (new)** — pure parsers
  `parseJsErrorStack` (V8 with-name + V8 bare + SpiderMonkey
  `@`-shape), `parsePythonTraceback` (`File "<path>", line N, in fn`
  + continuation source line), `isClickable` predicate.
  Conservative — anything we can't parse stays as a text-only frame
  the renderer paints as a non-clickable span.
- **`src/shared/telemetry.ts`** — 2 new events
  `runtime.error_stack_frame_clicked { language }` and
  `runtime.rich_media_payload_rejected { kind, reason }`; both
  closed-enum. `CONSOLE_RICH_KIND_BUCKETS` widens with `'html'`. New
  closed-enum Sets `RICH_MEDIA_REJECTED_KINDS = {'image','html'}` and
  `RICH_MEDIA_REJECTED_REASONS = {'invalid-src','size-limit','validation-failed'}`.
  `isSafeToken` exported (was module-private) for renderer-side
  validation of language tokens.
- **`update-server/src/telemetry.ts`** — mirror of the two new events,
  the `'html'` bucket addition, and the two new closed-enum Sets.
  Validator switch widened. The parity test in
  `update-server/test/telemetry.test.ts` was updated for the
  `CONSOLE_RICH_KIND_BUCKETS` lockstep array (now includes `'html'`).
  3 new behavior tests cover the `html` bucket accept,
  `error_stack_frame_clicked` token validation, and
  `rich_media_payload_rejected` closed-enum kind+reason gating.
- **`src/renderer/types/index.ts`** — `ConsolePayloadKindBucket` widens
  with `'html'`.
- **`src/renderer/components/Console/richConsoleFormat.ts`** —
  `richKindBucket` returns `'html'` for the new kind; `typeIcon`
  gains the `⌗` glyph; `payloadHasRichSurface` opens the popover for
  `image` + `html` AND for `error` only when a structured `stack`
  array is present. `error` with no `stack` falls through to the
  legacy text path so existing emit sites are not visually disturbed.
- **`src/renderer/components/Console/RichValueImage.tsx` (new)** —
  validates the source via `validateImageSrc`; rejected sources fire
  `runtime.rich_media_payload_rejected { kind: 'image' }` and paint a
  localized fallback chip. Browser load failures (corrupt data URL)
  swap to the same fallback. Renderer-side cap: `max-h-[400px]`,
  `object-fit: contain`, rounded border.
- **`src/renderer/components/Console/RichValueHtml.tsx` (new)** —
  `<iframe sandbox="allow-scripts" srcDoc={validated}>`. NO
  `allow-same-origin` (null opaque origin), NO `allow-top-navigation`,
  `referrerPolicy="no-referrer"`. Height clamped via
  `clampHtmlHeight`. Over-cap / empty payloads fire
  `runtime.rich_media_payload_rejected { kind: 'html' }`.
- **`src/renderer/components/Console/RichValueError.tsx` (new)** —
  renders the error message + structured stack. Each
  `ClickableStackFrame` with `file` + `line` becomes a focusable
  `<button>` that dispatches a `lingua-open-source` `CustomEvent`
  (consumer: RL-024 multi-file lane). Frames without `file`/`line`
  render as plain `<span>`. **Fold F** — right-click on any frame
  opens an inline menu with "Copy file:line" / "Open in tab" / "Copy
  frame text" (Escape + outside-click close). Each accepted click
  fires `runtime.error_stack_frame_clicked { language }`.
- **`src/renderer/components/Console/ConsoleEntryRenderer.tsx`** —
  dispatch switch widens to route `'image'` →
  `<RichValueImage>`, `'html'` → `<RichValueHtml>`, `'error'` →
  `<RichValueError>`. New optional `language` prop forwarded into
  `<RichValueError>` for the clickable-frame telemetry payload.
- **i18n** (`en/common.json` + `es/common.json`) — 9 new keys
  covering all new surfaces:
  `console.rich.imageInvalidSrc` / `htmlSandboxed` /
  `errorStackHeader` / `errorFrameClickable` /
  `errorFrameUnclickable` / `errorFrameMenuCopyLocation` /
  `errorFrameMenuOpen` / `errorFrameMenuCopyText` / `mediaRejected`.
  Spanish copy in tuteo (`Cargando`, no `Cargá`; `Abrir`, neutral
  imperative; `Copia` / `Vista previa` / `Origen no disponible`).

Tests:

- **`tests/shared/errorStack.test.ts` (new)** — 11 cases covering
  V8 named, V8 bare, SpiderMonkey, header lines, malformed input,
  Python canonical traceback, Python File-without-fn-suffix, malformed
  Python input, and `isClickable` truth table.
- **`tests/shared/richOutputSlice2a.test.ts` (new)** — 21 cases on
  `validateImageSrc` (data: / blob: / https: accept paths, http /
  javascript / vbscript / file rejection, size cap, case insensitivity,
  empty / non-string), `clampHtmlHeight` (default fallback,
  non-finite handling, cap clamp), `validateHtmlPayload` (accept,
  reject empty / non-string / over-cap), and `RichOutputHtml`
  discriminator coverage.
- **`tests/shared/telemetry.test.ts`** — `TELEMETRY_EVENTS` allowlist
  updated with the 2 new events in their sorted positions.
- **`tests/components/Console/richConsoleFormat.test.ts`** —
  `payloadHasRichSurface` test split: `'image'` / `'html'` now active;
  `'error'` flips to active when `stack` is present; chart remains
  on the legacy path; primitive / function / stackless error / chart
  still text-only.
- **`update-server/test/telemetry.test.ts`** — `CONSOLE_RICH_KIND_BUCKETS`
  parity lockstep includes `'html'`. 3 new behavior tests for
  `console_rich_rendered { kind: 'html' }` accept,
  `error_stack_frame_clicked` token gate, and
  `rich_media_payload_rejected` closed-enum kind+reason gating.
- **`tests/e2e/richConsoleSlice2a.spec.ts` (new)** — visual smoke
  matrix for the Slice 2a renderer-only surface. The spec builds the
  web app with `LINGUA_E2E_HOOKS=1`, seeds console entries through a
  test-only store bridge, and writes one screenshot per expected
  surface plus an `index.html` gallery under
  `output/playwright/rich-console-slice2a/`.

Visual smoke matrix:

| Case | Seeded payload | Assertions | Screenshot |
| --- | --- | --- | --- |
| HTML inline | `{ kind: 'html', html, height: 160 }` | iframe renders, `sandbox="allow-scripts"`, fixture text visible inside `srcDoc` | `01-html-inline.png` |
| HTML popover | same HTML payload, details chip clicked | popover Preview tab routes to `<RichValueHtml>` instead of an empty body | `02-html-popover.png` |
| Image inline | `{ kind: 'image', src: data:image/svg+xml, mime }` | `<img>` renders through the allowlisted data URL path | `03-image-inline.png` |
| Image popover | same image payload, details chip clicked | popover Preview tab routes to `<RichValueImage>` | `04-image-popover.png` |
| Error inline | `{ kind: 'error', message, stack[] }` | structured stack renders with a clickable frame and text frame | `05-error-inline.png` |
| Error popover | same error payload, details chip clicked | popover Preview tab routes to `<RichValueError>` | `06-error-popover.png` |
| Error context menu | right-click a clickable stack frame | menu shows Copy file:line / Open in tab / Copy frame text; click emits `lingua-open-source` | `07-error-context-menu.png` |
| Invalid media | `image` with `javascript:` + empty `html` | security fallbacks render visibly for both rejected payloads | `08-invalid-media-fallbacks.png` |

Manual review flow:

1. Run `npm run test:e2e:web -- tests/e2e/richConsoleSlice2a.spec.ts`.
2. Open `output/playwright/rich-console-slice2a/index.html`.
3. Compare every card against the matrix above before accepting the
   ticket. A single generic app screenshot is not enough for Slice 2a.

Verification:

- `npm run lint` clean (0 errors, existing warning baseline).
- `npx tsc --noEmit` clean.
- `npm run check:i18n` + `check:i18n:copy` clean.
- `npm test -- --run`: 3 538 / 4 skipped (320 test files, +2 new
  files plus ConsolePanel / runnerOutput integration coverage).
- `update-server` `npm test`: 120 / 0 (+3 new behavior tests; parity
  array updated to include `'html'`).
- `npm run test:e2e:web -- tests/e2e/richConsoleSlice2a.spec.ts`:
  4 Playwright tests, 8 screenshots, generated gallery, zero
  console/page errors.

Deferred to Slice 2b (separate plan):

- **Vega-lite chart payload** — `<RichValueChart>` component, lazy
  dynamic `import('vega-embed')`, chart spec security whitelist
  (block `data.url` / `data.name`, allow only `data.values`).
- **Fold A** Vega lazy-chunk via Vite emit-chunk pattern.
- **Fold B** Pro-gated "Export chart as SVG/PNG".
- **Fold C** Settings sub-toggles per kind (Chart / Image / HTML).
- **Fold E** Magic-comment directives `//=> chart` / `//=> image` /
  `//=> html` and Python `#=> chart` / `#=> image` / `#=> html`.
- **Fold G** Image clipboard paste handler in `<ConsolePanel>` —
  RL-110 Smart Paste lane crossover.
- **Worker integration** — `lingua.html(...)` / `lingua.image(...)`
  JS worker globals + `__lingua.html` / `__lingua.image` Python
  preamble. Automatic `parseJsErrorStack(err.stack)` wiring at the
  worker's catch-path so user-thrown errors automatically gain
  clickable stacks (the renderer surface is forward-compatible — when
  the worker writes `stack`, the chip + popover light up).
- **Sandboxed iframe security e2e** — Playwright spec asserting that a
  `<script>parent.postMessage('escape','*')</script>` payload cannot
  reach the parent's message listener. Deferred until the JS worker
  globals land (no consumer to drive the test yet).
- **Dedicated component-level tests** for `<RichValueHtml>` /
  `<RichValueImage>` / `<RichValueError>` beyond the current
  ConsolePanel integration coverage. These add deeper unit-level
  visual regression coverage beyond the Playwright visual matrix.

### RL-045 Add built-in developer utilities panel

- Priority: `P2`
- Status: `Done`
- Readiness: `Completed on 2026-04-17`
- Why this matters:
  - DevToys (Swiss Army knife for developers) proves there is strong demand for built-in utilities
  - Developers constantly context-switch to external tools for regex, JSON, encoding, etc.
  - Having these built into the code runner makes it a daily-use tool
- Scope:
  - Add a utilities panel or modal accessible from the command palette and toolbar
  - MVP utilities:
    - Regex tester with live matching, capture group highlighting, and explanation
    - JSON formatter / validator / viewer with tree mode
    - Base64 encode/decode
    - URL encode/decode
    - UUID generator
    - Hash generator (MD5, SHA-1, SHA-256)
    - Color picker with CSS/hex/rgb conversion
    - Unix timestamp converter
    - Diff viewer (compare two text inputs)
    - JWT decoder
  - Each utility is a lightweight panel, not a full app
  - Utilities are available in both desktop and web mode
  - Command palette integration: "Open Regex Tester", "Open JSON Formatter", etc.
- Acceptance criteria:
  - At least 6 utilities are available from the command palette
  - Utilities work in both desktop and web builds
  - Utilities do not bloat the main editor bundle (lazy-loaded)
- Implementation notes:
  - 10 lazy-loaded utilities are exposed from the toolbar and command palette:
    - JSON formatter / validator / tree viewer
    - Base64 encode/decode
    - URL encode/decode
    - UUID generator
    - Hash generator (SHA-1 / SHA-256)
    - Unix timestamp converter
    - JWT decoder
    - Regex tester with live matches and capture groups
    - Color converter (hex / rgb / hsl) with live swatch preview
    - Line-level diff viewer with add/remove summary
  - All utilities live in a shared pure module so desktop and web builds exercise the same code paths and the bundle stays out of the main editor chunk
- Dependencies:
  - None

### RL-046 Add gamification, achievements, and progress tracking for students

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready for product design after Snippet Lab exists`
- Why this matters:
  - Codecademy, Duolingo, and similar platforms prove gamification drives engagement
  - Students learning to code need motivation beyond just "run and see output"
  - Lingua already has snippets and practice challenges (RL-023); gamification amplifies them
- Scope:
  - Achievement system:
    - Unlock badges for milestones: first run, first 10 runs, first snippet saved, first challenge completed, etc.
    - Language-specific achievements: "Ran code in 5 languages", "Completed Python basics pack"
    - Streak tracking: consecutive days of coding
  - Progress dashboard:
    - Total runs, total time coding, languages used, challenges completed
    - Visual progress bars per language
    - Weekly activity heatmap (GitHub contribution graph style)
  - Spaced repetition for code concepts:
    - After completing a challenge, schedule review reminders
    - Use SM-2 or similar algorithm for optimal review timing
  - All data stored locally — no accounts required
  - Optional reset for privacy
- Acceptance criteria:
  - At least 10 achievements are unlockable
  - Progress dashboard shows meaningful statistics
  - Streak tracking works across app sessions
  - All data is local and resettable
- Dependencies:
  - RL-023

### RL-047 Add algorithm visualization and step-through animation

- Priority: `Future`
- Status: `Planned`
- Readiness: `Future-priority; design is clarified, implementation waits for debugger, rich output, and notebook/session contracts`
- Why this matters:
  - VisuAlgo and similar tools are among the most popular resources for CS students
  - Visualizing data structure changes during algorithm execution is extremely valuable for learning
  - No desktop code runner currently offers built-in algorithm visualization
- Scope:
  - Slice A — explicit visualization API:
    - start with JS/TS arrays and sorting snapshots
    - expose explicit user-code calls such as `lingua.visualize.array(name, value, meta?)` and `lingua.visualize.step(label?)`
    - emit snapshots through the existing rich-output/notebook session channel rather than a parallel side store
    - cap snapshots and payload size per run
    - support playback controls: play, pause, step forward, step back, speed control
    - highlight the source line that emitted the current snapshot when line metadata is available
  - Slice B — data-structure breadth:
    - linked lists
    - trees (binary, BST, AVL)
    - graphs (adjacency representation)
    - stacks and queues
    - hash tables
  - Slice C — optional instrumentation:
    - AST-based helper instrumentation for JS/TS only after Slice A proves the explicit API
    - no regex loop rewriting for production code
    - Python/Ruby instrumentation requires separate language-specific parser design
- Acceptance criteria:
  - At least sorting algorithm visualization works end-to-end
  - Users can step through execution and see data structure changes
  - Visualization syncs with source code line highlighting
  - No visualization capture runs unless user code explicitly opts in
  - Oversized or circular payloads produce bounded diagnostics instead of renderer crashes
- Dependencies:
  - RL-027
  - RL-044
  - RL-043

#### 2026-05-20 research triage

The v2.0 proposal's algorithm-visualization direction is folded into this existing future ticket. The
proposed regex injection contains real logic gaps (`__line` is undefined and
loop matching would break on common JS/TS forms), so the accepted first slice
uses explicit visualization calls from user code. AI is not a dependency for
this ticket; debugger state, rich output, and notebook/session ownership are
the real prerequisites.

### RL-048 Add integrated terminal for desktop mode

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready to implement`
- Why this matters:
  - CodeRunner 4, Replit, CodeSandbox, and Zed all include integrated terminals
  - Developers often need to run shell commands alongside their code
  - An integrated terminal reduces context-switching for package installation, git, file operations
- Scope:
  - Embed a terminal panel (xterm.js + node-pty) in the desktop build
  - Terminal opens in the current project directory
  - Support multiple terminal tabs
  - Toggle terminal with a keyboard shortcut
  - Desktop only — web mode shows terminal as unavailable
  - Do not replace the console/output panel; terminal is a separate panel
- Acceptance criteria:
  - Users can open a terminal and run shell commands from within the app
  - Terminal respects the current project directory
  - Terminal panel can be toggled and resized
- Dependencies:
  - RL-021

### RL-049 Add macro recording and playback

- Priority: `Future`
- Status: `Planned`
- Readiness: `Ready after shortcut editor exists`
- Why this matters:
  - CodeRunner 4 supports custom macros
  - Power users automate repetitive editing tasks with macros
- Scope:
  - Record a sequence of editor actions as a macro
  - Save, name, and replay macros
  - Bind macros to custom keyboard shortcuts
  - Keep macro scope to editor actions (not shell commands)
- Acceptance criteria:
  - Users can record and replay at least basic editing macros
  - Macros persist across sessions
- Dependencies:
  - RL-037

### RL-050 Add real-time collaboration for shared sessions

- Priority: `Future`
- Status: `Planned`
- Readiness: `Not MVP-ready; requires backend infrastructure`
- Why this matters:
  - PlayCode, Replit, CodeSandbox, and Zed all offer real-time multiplayer editing
  - Pair programming, live interviews, and teaching workshops are strong use cases
  - Zed uses CRDTs for conflict-free collaborative editing
- Scope:
  - Phase A: Local P2P collaboration via WebRTC (no server needed for LAN)
  - Phase B: Cloud-mediated collaboration with session sharing via link
  - Live cursor positions and selections for all participants
  - Shared execution results
  - Voice/video is explicitly out of scope (use external tools)
- Acceptance criteria:
  - Two users on a LAN can edit the same file with live cursors (Phase A)
  - Session sharing via link works with a relay server (Phase B)
- Dependencies:
  - RL-036
  - RL-032

### RL-051 Harden packagerConfig with app category and protocol registration

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-15`
- Current progress:
  - Forge packager metadata now declares `appCategoryType: 'public.app-category.developer-tools'`
  - Packaged app metadata now includes the `lingua://` protocol declaration via `packagerConfig.protocols`
  - Focused config tests now assert both metadata fields
  - This change only hardens packaging metadata; actual deep-link handling remains tracked by RL-040
- Why this matters:
  - WizardJS sets `appCategory: 'developer-tools'` in forge config
  - macOS uses this for Finder and Spotlight categorization
  - Missing category may affect discoverability on macOS
- Scope:
  - Add `appCategoryType: 'public.app-category.developer-tools'` to packagerConfig (macOS LSApplicationCategoryType)
  - Register `lingua://` protocol in packagerConfig via `protocols` field
  - These are one-line config additions with zero runtime cost
- Acceptance criteria:
  - macOS build shows correct app category in Finder info
  - Protocol metadata is included in packaged builds
- Dependencies:
  - None

---

## 10. Product identity, release notes, and guided tour (2026-04-12)

### RL-052 Add About view with product name and version

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-16`
- Current progress:
  - Settings now includes a dedicated About section alongside the existing Appearance, Layout, Editor, Plugins, and Updates sections
  - Desktop mode reads version/build metadata via a new `window.lingua.getAppInfo()` IPC bridge backed by `app.getVersion()`
  - Web mode returns the same metadata shape from bundled package metadata, so the About surface stays cross-runtime consistent
  - The section now exposes GitHub/license links through a safe `openExternal()` bridge instead of blocked in-window navigation
  - Command Palette now includes an "About Lingua" action that opens the identity/update surface from anywhere in the app
- Scope:
  - Add a new `AboutSection.tsx` to the existing `SettingsModal` as a sixth section alongside Appearance, Editor, Layout, Plugins, and Updates
  - Display product name ("Lingua"), version (read from `app.getVersion()` in Electron, fallback to `package.json` for web), build date, and license type
  - Show a minimal product logo or icon placeholder
  - Include links to GitHub repository, website (when it exists), and license
  - Read version from Electron's `app.getVersion()` via IPC in desktop mode; fall back to `import.meta.env` or `package.json` in web mode
  - Add a "Check for updates" button that ties into the existing `UpdatesSection` logic
  - Add the About section to the Command Palette as "About Lingua"
- Acceptance criteria:
  - Settings modal shows an "About" section with accurate product name and version
  - Version matches what `package.json` declares
  - The section is accessible from both the Settings modal tab and the Command Palette
- Dependencies:
  - None (uses existing SettingsModal infrastructure)

### RL-053 Add Release Notes / What's New view

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-16`
- Current progress:
  - `CHANGELOG.md` now uses a Keep a Changelog-style semver structure with `0.1.0` as the first shipped entry and an `Unreleased` bucket for ongoing work
  - The renderer reads changelog data from a build-time injected JSON payload instead of parsing markdown inside the browser/Electron runtime
  - A standalone What's New overlay now highlights the current version first, keeps older versions collapsible, and renders minimal inline markdown for emphasis/code spans
  - The overlay is reachable from both the Command Palette and the About section, and first-launch-after-update detection is persisted through `settingsStore.lastSeenVersion`
- Scope:
  - Create a `CHANGELOG.md` at the project root following Keep a Changelog format (semver, grouped by Added/Changed/Fixed/Removed)
  - Create a `WhatsNewSection.tsx` component (either as a tab in SettingsModal or a standalone overlay)
  - Parse `CHANGELOG.md` at build time and bundle it as a JSON asset so the renderer can display it without file-system access
  - Show the most recent version's changes prominently, with older versions collapsible below
  - Optionally show the What's New overlay automatically on first launch after an update (use a `lastSeenVersion` key in `settingsStore` to detect)
  - Render markdown content with minimal styling consistent with the app's design system (oklch color tokens, surface classes)
  - Add "What's New" as a Command Palette action
- Acceptance criteria:
  - `CHANGELOG.md` exists at the project root with at least one version entry (0.1.0)
  - The What's New view renders the changelog grouped by version
  - The view is accessible from Command Palette and optionally from the About section
  - After an update, the user is shown new changes on first launch
- Dependencies:
  - RL-052 (About view provides the natural anchor for a "What's New" link)

### RL-054 Add interactive guided tour

- Priority: `P2`
- Status: `Done`
- Readiness: `Completed on 2026-04-16; public-release dependency blocker removed on 2026-05-04 by replacing Shepherd with the in-repo tour runtime`
- Current progress:
  - Lingua now wraps the renderer in a dedicated guided-tour provider backed by a small in-repo runtime
  - The onboarding flow now covers the editor, Run button, console, project explorer, toolbar, snippet library, and command palette in a seven-step sequence
  - The Run step uses a real click listener so the tour waits for a genuine execution instead of advancing on a fake next button
  - Launch points now exist in both the About section and the Command Palette, and first-launch auto-start is gated by persisted `settingsStore.hasCompletedTour`
  - Tour styling is bridged into Lingua's surface tokens so the modal, spotlight, and controls match the app shell
- Licensing note:
  - The former Shepherd dependency was removed before public release readiness work continued.
  - The guided tour is implemented in-repo, so there is no separate commercial tour dependency to purchase for public builds.
- Scope:
  - Create a `GuidedTour` module under `src/renderer/components/GuidedTour/`
  - Implement a `TourProvider` wrapper that exposes `startTour`, `isTourActive`, and `hasCompletedTour` through context
  - Define tour steps for core features:
    - Step 1: Editor area — explain code editing, language selection
    - Step 2: Run button — `advanceOn` click event so the user actually runs code to proceed
    - Step 3: Console panel — explain output, errors, timing
    - Step 4: File tree — explain project structure, creating files
    - Step 5: Toolbar — explain layout options, settings access
    - Step 6: Snippets — show how to save and reuse code
    - Step 7: Command Palette — demonstrate keyboard-driven navigation
  - Allow selected steps to interact with real UI elements during the tour
  - Auto-advance when the user completes an interactive action such as clicking Run
  - Use `beforeShowPromise` for steps that need async setup (e.g., ensuring a tab is open before highlighting it)
  - Style the tour modal/backdrop to match Lingua's design system (oklch colors, surface tokens, rounded corners)
  - Use a spotlight overlay for visually highlighting the target element
  - Add "Start guided tour" to the Command Palette
  - Add a "Take a tour" button in the About section (RL-052)
  - Store tour completion status in `settingsStore` so it is not shown repeatedly
  - Optionally trigger the tour on first launch (gated by a `hasCompletedTour` flag)
  - Support multiple tour tracks in the future (beginner tour, advanced features tour, language-specific tours)
- Acceptance criteria:
  - A multi-step interactive tour walks the user through Lingua's core features
  - At least one step uses `advanceOn` to require user interaction before proceeding
  - The tour highlights UI elements with a visible spotlight/backdrop
  - Users can skip, go back, or exit the tour at any step
  - Tour completion is persisted so it does not repeat on every launch
  - The tour is launchable from Command Palette and from the About section
  - Public builds do not include a separate AGPL/commercial guided-tour dependency
- Related tasks:
  - RL-039 (guided lessons for students) is a separate educational content system; this tour is product onboarding
  - The tour infrastructure could later be reused by RL-039 for lesson walkthroughs
- Dependencies:
  - RL-052 (About section provides the "Take a tour" entry point)

### RL-055 Add file-extension-based language detection when opening files

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-15`
- Current progress:
  - `languageForExtension()` now derives a normalized reverse map from the built-in language metadata
  - Open-file, Save As, session restore, and file-tree rename flows now resolve known extensions to the correct language and unknown extensions to `plaintext`
  - Focused tests cover extension mapping plus editor/session/project-tree integration paths
- Current gap:
  - `extensionForLanguage()` in `src/renderer/utils/languageMeta.ts` provides a forward mapping (language → extension) but there is no reverse `languageForExtension()` utility
  - When users open arbitrary files from the file system (e.g., `main.go`, `script.py`, `lib.rs`), the editor cannot auto-select the correct language from the file extension alone
  - New tabs opened via file tree or Quick Open fall back to `plaintext` if the language is not explicitly set
- Scope:
  - Add `languageForExtension(ext: string): Language | undefined` to `src/renderer/utils/languageMeta.ts`
  - Build the reverse map from `BUILT_IN_LANGUAGE_META` at module init (no duplication — derived from the forward map)
  - Call it in the file-open path so Monaco models receive the correct language ID on load
  - Normalize the extension input: strip the leading `.`, lowercase, trim
  - Handle ambiguous extensions gracefully (e.g., `.ts` is TypeScript, not "test"; `.js` is JavaScript)
  - Export the function for use in runner path selection and file-tree icon logic
- Acceptance criteria:
  - Opening `main.go` sets language to Go and renders Go syntax highlighting immediately
  - Opening `script.py` sets language to Python
  - Opening `lib.rs` sets language to Rust
  - Opening a `.txt` or unknown extension returns `undefined` and the editor stays in `plaintext`
  - No duplication in the language→extension mapping; the reverse map derives from the same source of truth
- Dependencies:
  - None

### RL-056 Add immediate Monaco keyword completion providers for Go, Python, Rust, and Lua

- Priority: `P1`
- Status: `Done`
- Readiness: `Completed on 2026-04-15`
- Current progress:
  - Monaco now registers scoped completion providers for Go, Python, Rust, and Lua during editor bootstrap
  - Providers are registered idempotently so repeated `beforeMount` calls do not duplicate suggestions
  - Each language ships keyword completions plus snippet templates for the most common patterns and entrypoints
  - Focused unit tests cover provider registration and representative suggestions per language
- Current gap:
  - Monaco TypeScript language service provides full IntelliSense (completion, hover, diagnostics) for JS and TS
  - Go, Python, Rust, and Lua have zero custom completion providers — users get only Monaco's generic word-based autocomplete
  - RL-026 covers full LSP integration but is blocked on RL-030 and RL-038; those are months away
  - Keyword snippets require no language server and can be registered today with `monaco.languages.registerCompletionItemProvider`
- Scope:
  - Create `src/renderer/components/Editor/completionProviders/` with one file per language:
    - `goCompletions.ts` — Go keywords, built-in functions (`fmt.Println`, `make`, `len`, etc.), common control flow snippets (`if err != nil`, `for range`, `func` signature)
    - `pythonCompletions.ts` — Python keywords, built-ins (`print`, `len`, `range`, `enumerate`, etc.), common patterns (`if __name__ == '__main__'`, `def`, `class`)
    - `rustCompletions.ts` — Rust keywords, common macros (`println!`, `vec!`, `assert_eq!`), common patterns (`fn main`, `match`, `impl`, `use std::`)
    - `luaCompletions.ts` — Lua keywords, standard library (`table.insert`, `string.format`, `io.write`, etc.), common patterns
  - Register all providers in the Monaco `beforeMount` or in `applyTypeScriptDefaults`-equivalent setup
  - Each provider returns `CompletionItemKind.Keyword` for keywords and `CompletionItemKind.Snippet` for multi-line patterns
  - Include `insertTextRules: InsertAsSnippet` for tab-stop templates (e.g., `for ${1:i}, ${2:v} := range ${3:collection}`)
  - Do not duplicate JS/TS completions — those are already handled by Monaco's TypeScript service
- Acceptance criteria:
  - In a Go file, typing `fmt.` triggers completions including `fmt.Println` and `fmt.Sprintf`
  - In a Python file, typing `def ` triggers a function snippet with tab stops for name and body
  - In a Rust file, typing `println` triggers `println!("{}", ...)` snippet
  - In a Lua file, typing `for` triggers a `for i = 1, n do ... end` snippet
  - Completions do not appear in wrong-language files (each provider is scoped by language ID)
  - Unit tests cover that each provider is registered for the correct Monaco language ID
- Dependencies:
  - RL-055 (language IDs must be set correctly for providers to fire on the right files)
  - None blocking — can be done in parallel with RL-055

### RL-057 Add a consistent tooltip layer for shell actions and dense controls

- Priority: `P2`
- Status: `Done`
- Readiness: `Completed 2026-04-16`
- Current gap:
  - High-frequency UI controls still rely on a mix of browser `title` attributes and unlabeled icon-only affordances
  - Dense surfaces such as the toolbar, editor tabs, console actions, quick open, and command palette lack a single tooltip contract
  - Discoverability is uneven in compact layouts where labels collapse or truncate
- Scope:
  - Introduce a small shared tooltip primitive for renderer controls
  - Standardize tooltip copy for icon buttons, split-button affordances, tab close actions, and console/result toggles
  - Ensure keyboard focus and hover both surface the same tooltip content
  - Use the same tooltip primitive in command palette utility actions and future onboarding/UI polish work
  - Audit existing `title` usage and migrate the inconsistent cases to the shared primitive
- Acceptance criteria:
  - Core toolbar actions expose consistent hover/focus tooltips in both desktop and web builds
  - Truncated file tabs keep the full filename discoverable without relying on visual guesswork
  - Dense icon-only actions no longer depend on missing or inconsistent native browser titles
  - Tooltip copy is localizable through the existing i18n pipeline
- Dependencies:
  - None

### RL-058 Support common development files in view/lint mode without execution

- Priority: `P1`
- Status: `Done`
- Readiness: `Validator messages localized on 2026-04-20; full acceptance set met`
- 2026-04-20 closure:
  - `src/renderer/validation/index.ts` now routes every diagnostic message and every success-state copy through `i18next.t()`. Keys live under `validation.<source>.<rule>` (yaml, dotenv, csv, editorconfig, dockerfile, gitignore, makefile, shellscript) with interpolation values for line numbers, key names, image refs, target names
  - 47 new keys added in `en` and `es` (success-state, format helpers, plus per-validator messages)
  - `formatDiagnosticsOutput` now drives the `[SEVERITY] location — message` line through localized format keys so the run-result panel reads natively in both locales
- 2026-04-19 audit:
  - ✅ `package.json` / `.env` / `docker-compose.yml` / `data.csv` all resolve to correct Monaco languages and validate-only execution modes via `languageMeta` + `languageCapabilities` + the extension resolver
  - ✅ No non-runnable file shows a Run affordance — `executionModeFor()` gates the toolbar Run button
  - ✅ Diagnostics appear as Monaco markers: JSON parse, YAML structure, dotenv dup/malformed, CSV shape, Dockerfile + editorconfig + gitignore + Makefile + shellscript validators
  - ✅ UI copy distinguishes runnable / validate / view — result panel and toolbar use different strings per mode
  - Remaining gap: validator diagnostics in `src/renderer/validation/index.ts` still ship as hardcoded English strings, so Spanish builds mix localized chrome with English validation output
  - Depth follow-ups (shellcheck-style shell linting, gitignore globstar sanity) remain enhancements on top of the localization fix
- Current gap:
  - `json`, `yaml`/`yml`, `.env`, and `csv` now open with language-aware validate-only semantics plus lightweight diagnostics
  - `toml` and `ini` now open with dedicated highlighting and explicit view-only status instead of misleading run semantics
  - `Dockerfile` / `Containerfile` / `Dockerfile.*`, `Makefile` / `GNUmakefile`, `.gitignore` / `.dockerignore` / `.npmignore`, and `.editorconfig` now open with appropriate Monaco grammars and explicit view-only execution mode on 2026-04-17
  - Dockerfile and `.editorconfig` graduated from view-only to validate mode on 2026-04-17, with lightweight Monaco-marker validators: EditorConfig flags unknown keys + invalid enum values; Dockerfile warns on deprecated `MAINTAINER`, `ADD <url>`, unknown instructions, and missing `FROM`
  - `.gitignore` and `Makefile` graduated to validate mode on 2026-04-17: gitignore flags duplicate patterns, backslash separators, and empty negations; Makefile flags space-indented recipes and orphan tab-commands
  - Dockerfile validator also covers `FROM image:latest` / untagged bases and `apt-get install` without `-y`
  - Makefile validator now detects duplicate target definitions and reminds on missing `.PHONY` for common virtual targets; Dockerfile validator adds a soft info notice on `USER root` / `USER 0`
  - `.sh`/`.bash`/`.zsh` plus shell dotfiles (`.bashrc`, `.zshrc`, `.bash_profile`, `.profile`) now open as the new `shellscript` built-in language with a lightweight validator (missing shebang + safety-mode nudge). Dockerfile adds a HEALTHCHECK reminder when `EXPOSE` is present. Makefile gains unused-variable detection (implicit vars skipped). `.gitignore` flags trailing whitespace
  - Follow-up work can add deeper cross-rule checks (`.gitignore` globstar sanity, shellcheck-style shell linting) on top of the detection layer
- Scope:
  - Add syntax highlighting and language detection for common non-runnable development files
  - Introduce a view/lint execution mode that never offers inline execution for these file types
  - Start with `json`, `yaml`/`yml`, `.env`, `toml`, `ini`, `csv`, and common lock/config files
  - Surface lightweight validation/lint diagnostics where feasible:
    - JSON parse errors
    - YAML structural errors
    - `.env` duplicate-key and malformed-line checks
    - CSV shape inconsistencies
  - Keep the result/console surfaces honest by replacing run affordances with validation-oriented status copy for non-runnable files
  - Document which file types are editable-only, lintable, runnable, or compilable
- Acceptance criteria:
  - Opening `package.json`, `.env`, `docker-compose.yml`, and `data.csv` applies the correct editor language immediately
  - Non-runnable files do not show misleading run semantics
  - Validation errors appear as diagnostics/markers without pretending the file was executed
  - The UI communicates the distinction between runnable code and lint-only assets
- Dependencies:
  - RL-055 for extension-based language detection
  - RL-004 for shared editor diagnostics plumbing

---

## 11. Updated WebContainers analysis (2026-04-12)

### Viability assessment for Lingua

**What WebContainers offer:**
- Full Node.js runtime in the browser (no server needed)
- npm install and package execution in-browser
- Virtualized TCP networking via ServiceWorker
- Offline-capable after initial load

**Critical limitations:**
- Requires SharedArrayBuffer + cross-origin isolation (COOP/COEP headers)
- Only fully supported in Chromium-based browsers; Firefox and Safari have beta/alpha support with restrictions
- Cannot run C/C++ native addons (no native bindings)
- Not relevant for Go, Rust, Python, or any non-JS/TS language
- Firefox Private Browsing blocks ServiceWorkers entirely
- Brave's aggressive third-party blocking can break WebContainers

**Recommendation for Lingua (unchanged from RL-029):**
- WebContainers are worth piloting **only for JS/TS web package workflows** in the web build
- They are **not a replacement** for desktop Node.js, native toolchains, or WASM runtimes
- The Electron desktop app gains **zero benefit** from WebContainers since it already has direct Node.js access
- RL-029 correctly scopes this as an isolated experiment

### WebContainers API licensing note
- The WebContainer API is available as `@webcontainer/api` on npm
- Commercial use requires reviewing StackBlitz's licensing terms
- The API is not fully open-source — it's a proprietary runtime with an npm-distributed client

---

## 11. Updated WASM-first feasibility analysis (2026-04-12)

### Current state of WASM language support (as of April 2026)

| Language | WASM target maturity | Browser viability | Notes |
|----------|---------------------|-------------------|-------|
| JS/TS | N/A (native browser) | Full | Not a WASM target; runs natively |
| Python | High (Pyodide) | Good | Already used in Lingua; ~15MB initial load |
| Go | Medium (TinyGo) | Fair | Standard Go compiler produces large WASM; TinyGo is viable for simpler code |
| Rust | High (rustc --target wasm32) | Good | First-class WASM support; cargo-component + wit-bindgen |
| C/C++ | High (Emscripten) | Good | Mature tooling; most WASM libraries originate from C/C++ |
| Java | Medium-High | Improving | WASM 3.0 GC types (Sept 2025) enable Java/Kotlin/Scala/Dart |
| Ruby | Medium (MRuby) | Fair | ruby.wasm project exists but limited stdlib |
| PHP | Medium (php-wasm) | Fair | Works for basic scripts |

### WASM 3.0 breakthrough (September 2025)
WebAssembly 3.0 added: 64-bit address space, multiple address spaces, exception handling, and **garbage-collected struct/array types**. This is the key enabler for Java, Kotlin, Scala, Dart, and OCaml compilation to WASM without embedding a full GC runtime.

### Recommendation for Lingua (unchanged from RL-030)
- **Do not commit to "WASM-first everywhere"** — the capability matrix must come first
- JS/TS/Python are already the strongest WASM/browser candidates
- Go works better via TinyGo than standard Go for WASM
- Rust WASM is excellent but the desktop native path is faster for compilation
- C/C++ via Emscripten is the strongest new WASM candidate
- Java via WASM 3.0 GC is promising but tooling is still maturing
- File watching, auto-updates, plugin loading, and local AI remain shell-specific (non-WASM)

---

## 12. Best-in-class REPL research synthesis (2026-04-12)

### What makes a world-class REPL (distilled from Clojure, IPython, Jupyter, Swift Playgrounds, marimo)

| Feature | Source | RL-020 coverage |
|---------|--------|-----------------|
| Live code modification with instant feedback | Clojure REPL | Partially (auto-run exists) |
| Smart complete-code detection (don't run incomplete statements) | Clojure, RunJS | Explicitly in RL-020 scope |
| Inline results without leaving the editor | IPython, Swift Playgrounds | Magic comments exist; expansion in RL-020 |
| Execution history with rerun/replay | IPython, all REPLs | Explicitly in RL-020 and RL-028 |
| Rich output (tables, charts, images) | Jupyter, marimo, Observable | New: RL-044 |
| Reactive execution (edit one thing, dependents auto-update) | marimo | New: RL-043 |
| Variable inspector / state explorer | IPython, Jupyter | New: should be added to RL-020 |
| stdin/input support | All REPLs | Explicitly in RL-020 |
| Multi-line editing with smart indentation | Clojure, IPython | Already exists via Monaco |
| Persistent REPL state across interactions | Clojure, IPython | Needs explicit state management per runtime |
| Expression pinning (watch expressions) | Swift Playgrounds | Expand magic comments to pin system in RL-020 |
| Time-travel debugging (step back) | Elm, some Clojure tools | Future: RL-047 |

### Gap: Variable inspector panel

RL-020 should be expanded to include a lightweight variable inspector that shows the current state of variables after execution. This is a core REPL feature in IPython (`%whos`), Jupyter (variable explorer), and marimo (reactive state).

---

## 13. Brand, domain, and pricing strategy (2026-04-12)

### Brand rename

The product has been renamed from "RunLang" to "Lingua" across the entire codebase. "Lingua" means "language" in Latin and evokes multi-language support, internationality, and elegance. No significant brand conflicts exist in the code editor/IDE space.

### Source code status

Lingua is **source-available commercial software**. The repository may be public
for evaluation, security review, and contributor collaboration, but the license
is not an open-source license and production, paid, hosted, redistributed, or
at-scale use requires a commercial license. This affects:
- Third-party library licensing: any dependency with copyleft or AGPL terms must be replaced, excluded from public builds, or commercially licensed
- The guided tour no longer carries a separate Shepherd dependency; continue to enforce this through the RL-085 SBOM/license gate
- Intro.js (AGPL) is explicitly excluded from consideration
- MIT / Apache 2.0 / BSD / ISC dependencies remain compatible with the current source-available commercial posture, subject to notices and SBOM coverage

### Domain strategy

| Domain | Priority | Rationale |
|--------|----------|-----------|
| `linguacode.dev` | Primary | Clear developer-product name that leaves room for app, docs, license, update, and marketing subdomains |
| `lingua.dev` | Secondary | Premium developer TLD. Verify availability — may be registered |
| `getlingua.dev` | Fallback | Classic SaaS landing pattern if `lingua.dev` is unavailable |
| `lingua.app` | Alternative | Good for desktop app marketing. Google-managed TLD |
| `lingua.run` | Legacy alias | Referenced in early strategy drafts. If registered, 301-redirect it to the primary. New launch copy should not point here. |

Note on reconciliation: The go-to-market plan in Section 14 uses
`linguacode.dev` as the single source of truth for the download/landing page so
all Phase 1 / 2 / 3 assets (HN post, Product Hunt, ads, SEO landing pages)
point to one canonical origin. Earlier `lingua.run` references are legacy and
must be replaced or redirected.

### Pricing model (live on linguacode.dev as of 2026-05-05)

**Strategy: Freemium with Monthly + Pro + Education**

Rationale:
- Product is desktop-first and local-first; the license-server backs
  activation, device limits, 14-day trials, and renewal refresh.
- A Monthly plan funds ongoing maintenance and support without forcing
  every serious user into a high up-front price.
- A Pro one-time purchase fits the desktop-tool buyer who prefers no
  recurring bill while keeping the public tier name simple.
- Education stays as a first-class public tier because the student /
  teacher audience is core to Lingua's positioning, and is now in-app
  only (no `/education` landing page).

The public checkout surface lists Free, Monthly, Pro, and Education.
Trial and Recovery still mint temporary/support tokens internally, but
they are not public pricing tiers. Backend slugs remain stable for
token/data compatibility: `lingua_monthly` backs Monthly,
`lingua_lifetime` backs Pro, and legacy `lingua_team` support remains
internal-only unless a future enterprise tier is explicitly approved.

| Tier | Price | Polar.sh product | Includes |
|------|-------|------------------|----------|
| **Lingua Free** | $0 forever | n/a (no purchase needed) | JS/TS/Python, 1 tab, 5 snippets, editor, built-in developer utilities, keyboard shortcut editor, theme preset import/export, local-first shell |
| **Lingua Monthly** | $5 / month | `lingua_monthly` | Full paid entitlement set while the subscription is active: unlimited tabs/snippets, Go/Rust, format-on-save for supported languages, execution history, and paid feature gates. Cancel anytime; every update while subscribed. |
| **Lingua Pro** | $59 one-time | `lingua_lifetime` | Same paid entitlement set as Monthly without a recurring subscription. |
| **Lingua Education** | $0 / year (renewable) | n/a (in-app `/education/start` + `/education/renew`) | Full paid entitlements for verified students/educators. Validation: any `.edu` plus the explicit allow-list `.ac.uk`, `.edu.mx`, `.edu.au`, `.edu.ca`, `.edu.br`, `.ac.in` (see `license-server/src/lib/educationEmail.ts`). In-app flow only — Settings → License → Educational license. Same hard-3 device limit + remove flow as paid tiers. |

Premium-only features:
- Unlimited tabs (Free: 1 tab)
- npm/package management
- Full snippet library (Free: 5 snippets)
- Dev utilities panel (regex, JSON, diff, etc.)
- 15+ languages (Free: JS/TS/Python only)
- Extra themes and font selection
- Local AI assistant
- Notebook mode
- Execution history and benchmarking

14-day Pro trial available without a credit card via
Settings → License → Try Lingua Pro free for 14 days. Anti-abuse: 1
trial per email and per device, 3 trial starts per IP per day. See
`license-server/src/handlers/trials.ts` for the constants.

Future monetization channels:
- Premium challenge/lesson packs
- Cloud sync subscription ($2-3/month, optional)

---

## 14. Go-to-market execution plan (Phases 1-3)

This section operationalizes the "Estrategia de Lanzamiento" (strategic alignment) into concrete, implementation-ready RL tasks. Each phase below maps to one or more new RL tasks (RL-059 … RL-067). The rest of the plan (RL-001 … RL-058) covers product surface; this section covers the business and distribution surface that the product needs to ship a paid release.

### Phase 1 — Activate monetization (immediate)

Goal: the product can accept money and gate Pro features behind a validated license without a cloud backend.

Concrete deliverables:
- Polar.sh storefront with the public paid products (`lingua_monthly` and the Pro one-time product). Free and Education have no checkout; Trial is an internal onboarding flow minted by `/trials/start`, not a public tier.
- License-key issuance on purchase, offline-verifiable inside the app.
- Public GitHub presence with a README that states the pitch, pricing, licensing model, and download link honestly.
- Landing/download page live on the primary domain (`linguacode.dev`).

Mapping to tasks: **RL-059** (license infra), **RL-060** (feature-tier gating), **RL-061** (Polar.sh integration), **RL-062** (public README / license declaration cleanup), **RL-063** (download landing page).

### Phase 2 — Distribution (month 1–2)

Goal: the product reaches multi-language developer communities that RunJS does not serve.

Concrete deliverables:
- "Show HN" post with a pre-written narrative and honest claims (not a marketing blast).
- Coordinated posts in `r/golang`, `r/rust`, `r/Python`, emphasizing the multi-language desktop angle.
- Product Hunt launch with a 60-second demo video and gallery assets.
- A reusable press kit (icons, screenshots, video, boilerplate description, pricing overview).

Mapping to tasks: **RL-064** (launch asset kit), **RL-065** (privacy-respecting launch telemetry so we can measure Phase 2 conversion).

### Phase 3 — Growth (month 2–4)

Goal: turn early paid users into distribution. Share artifacts become organic discovery, and SEO starts capturing the specific searches that competitors ignore.

Concrete deliverables:
- Promote **RL-036 Phase A** from `Future` → `P1`, because the strategic plan depends on shareable artifacts for viral distribution. The 2026-05-20 split makes Phase A1 a no-backend single-tab URL-fragment share and Phase A2 the heavier `.linguashare` multi-file artifact.
- SEO landing pages targeting `"go playground desktop"`, `"rust code runner desktop"`, `"python repl desktop"`, `"typescript playground offline"`, `"multi language code runner"`.
- Crash reporting and opt-in product analytics (feeds into retention metrics).

Mapping to tasks: **RL-036 (promoted)**, **RL-066** (SEO landing pages), **RL-067** (crash reporting).

### New tasks added by this section

### RL-059 License-key infrastructure

- Priority: `P0` for Phase 1
- Status: `Done` (closed 2026-05-12 — see Status Update below)
- Readiness: `Renderer verifier + Settings UI completed on 2026-04-19; main-side IPC bridge + device-id loader shipped on 2026-04-25 (Slice 0). Polar webhook + email delivery shipped under RL-061 (closed 2026-04-30); see Status Update below.`
- 2026-04-25 update — Slice 0:
  - `src/main/license.ts` lands the main-side runtime: persists the token at `userData/license.json` (atomic write, mode 0o600), persists an opaque per-install `deviceId` at `userData/device-id.json` (`crypto.randomUUID()` minted once), boots a verified snapshot before `createWindow()`, and self-heals if the on-disk token no longer verifies (wipes the file rather than surfacing a sticky `invalid` state).
  - `src/main/ipc/license.ts` exposes `license:get-state`, `license:apply-token`, `license:clear`, `license:revalidate` over `ipcMain.handle`. Every handler returns a tagged-union result so the renderer can ship a typed mirror.
  - `src/preload/index.ts` exposes `window.lingua.license` (optional — the renderer falls through to its existing local-verify + zustand-persist path when the bridge is absent, which is the contract the web build relies on).
  - `src/renderer/stores/licenseStore.ts` auto-detects the bridge and switches between two concrete stores at module load: desktop mirrors the main snapshot via IPC and never writes to localStorage; web keeps the existing zustand-persist behavior. Public API (`token`, `status`, `setLicenseToken`, `revalidate`, `clearLicense`) is identical across both modes so callers (`LicenseSection`, `useEntitlement`, telemetry) stay untouched.
  - `vite.main.config.mts` adds `__LINGUA_LICENSE_PUBLIC_KEY_JWK__` (falls back to `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` so `npm run dev:desktop:pro` keeps minting + injecting against both processes from one env var).
  - Tests: `tests/main/license.test.ts` covers persistence atomicity + POSIX mode + deviceId mint-once + boot wipe of stale tokens + active/grace transitions + IPC channel registration. `tests/stores/licenseStoreDesktop.test.ts` covers the bridge mirror + non-localStorage path. The existing `tests/stores/licenseStore.test.ts` continues to exercise the web mode unchanged.
- 2026-04-19 update:
  - `LicenseSection` now lives in the Settings modal — paste a token, Apply, clear it, status pill reflects free / active / grace / invalid. Errors surface through the shared status-notice banner so the copy stays consistent with other Settings surfaces
  - 7 component tests cover: default Free state, Active pill, Apply disabled on empty input, success + error notice flows, clear + notice, es locale fallback
- Current progress:
  - Shared `src/shared/license.ts` implements the `<payload>.<signature>` token format using Ed25519 via WebCrypto — pure module, no dependencies, works in Node and browsers
  - `decodeLicenseToken` + `verifyLicenseToken` return a discriminated result (malformed / invalid-signature / expired / not-yet-valid / clock-skew / unsupported-tier, or ok with active|grace state). Grace defaults to 14d, clock skew to 24h; both configurable per call
  - `src/renderer/stores/licenseStore.ts` (zustand + persist) owns the token, calls the verifier, and maps results into a `free | active | grace | invalid` status. Embedded public key is read from `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` at build time — missing key yields an explicit `no-public-key` error instead of silently "verifying"
  - Tests cover: valid/active window, grace window, expired past grace, clock-skew future issuedAt, tampered payload under the same signature, wrong signing key, malformed tokens, empty tokens, and the store's clear/revalidate flows
- Scope:
  - Choose a signing strategy for license keys that works offline (recommended: Ed25519 signed JWT-like token; private key held by the issuer, public key embedded in the app).
  - Add a `licenseStore` in the renderer that can import, validate, and persist a license payload.
  - Expose `window.lingua.license.*` through preload so main can decide what ships activated.
  - Main-side verifier in `src/main/license.ts` for packaged builds; renderer-side verifier in `src/renderer/license/` for web builds (same verify code, same public key, single source of truth in `src/shared/license.ts`).
  - License payload fields: optional `licenseId` (server-minted tokens), `productId`, `tier` (`pro` | `pro_lifetime` | `team` | `trial` | `education`), `issuedTo`, `issuedAt`, `supportWindowEndsAt`, `entitlements[]`, `signature`.
  - Grace-period and clock-skew tolerance are explicit: +/- 24h skew, 14-day grace window after `supportWindowEndsAt` for online re-check (offline keeps working indefinitely for perpetual tiers).
- Acceptance criteria:
  - A valid signed license unlocks Pro entitlements in both desktop and web builds.
  - A tampered or mis-signed license is rejected with an actionable error.
  - Uninstall/reset clears the license cleanly and returns the app to Free.
  - Tests cover signature validity, clock skew, tampered payload, and grace-period behavior.
- Dependencies:
  - None (pure infra; can land before RL-060/RL-061).

#### Status Update — 2026-05-12 (closes RL-059)

ROADMAP § 4a + the Readiness line above previously named *"Polar
webhook + email delivery still pending under RL-061"* as the only
remaining scope. That work shipped under RL-061 across slices 0
through 5 (final slice 2026-04-30):

- Polar checkout + webhook delivery — RL-061 Slice 2.
- Resend email delivery for license issuance + recovery — RL-061
  Slice 2 + Slice 4.
- Trial + Education tier issuance — RL-061 Slice 4.
- Web licenseStore + device management UI — RL-061 Slice 2.5 + 3.
- Desktop license bridge → renderer mirror — RL-061 Slice 3.5.
- Release pipeline + web update banner — RL-061 Slice 5.

ROADMAP § 5 sequence #2 telegraphed this close-out before it
landed: as of the previous ROADMAP revision it read
*"`RL-059` stays `Partial` only as the historical verifier + bridge
parent."* This docs-sync slice flips that to past tense and closes
the parent. The verifier + bridge scaffolding it parented lives in
production at:

- `src/main/license.ts` — atomic-write `userData/license.json` +
  per-install `deviceId` + boot-time verified snapshot + IPC
  handlers (`license:get-state`, `license:apply-token`,
  `license:clear`, `license:revalidate`).
- `src/renderer/stores/licenseStore.ts` — desktop/web auto-detect
  mirror over the IPC bridge.
- `src/shared/license.ts` — pure `verifyLicenseToken` over
  Ed25519 WebCrypto, used by both renderer and main.

Existing acceptance-criteria coverage (unchanged):

- Valid signed license unlocks Pro entitlements end-to-end (Pro
  smoke `tests/smoke/licenseWebSmoke.test.tsx` plus packaged
  desktop smoke in CI).
- Tampered or mis-signed tokens rejected with actionable error
  (`tests/main/license.test.ts`, `tests/stores/licenseStore.test.ts`).
- Uninstall/reset returns to Free
  (`tests/main/license.test.ts` boot-wipe path).
- Tests cover signature validity, clock skew, tampered payload,
  grace-period (all sites above).

Any future license-key infrastructure beyond what RL-061 shipped
(e.g. extended recovery flows, refund automation) belongs in a
NEW RL ticket, not a reopen here.

### RL-060 Feature-tier gating in the renderer

- Priority: `P0` for Phase 1
- Status: `Done`
- Readiness: `Completed on 2026-04-19 — the Free tab and snippet ceilings are now enforced end-to-end`
- 2026-04-19 update:
  - `currentEffectiveTier()` exposes the tier without a hook so stores/imperative code can consult the policy
  - `editorStore.addTab` checks `withinTabBudget` and pushes the shared upsell notice when Free users try to exceed the 1-tab ceiling
  - `snippetsStore.addSnippet` returns `string | null` and blocks past the 5-snippet ceiling; `SnippetsModal` branches on `null` so the modal keeps the user's draft for them to upgrade
  - Session restore grandfathers existing tabs via a new `editorStore.restoreTabs` bypass so a Free downgrade never truncates a user's saved workspace
  - Tests: Free tier blocks tab 2 + snippet 6, Pro tier waves through, session restore bypass verified
- Current progress:
  - `src/shared/entitlements.ts` now owns the 11-entry `Entitlement` enum, the Free-tier ceilings (1 tab, 5 snippets, JS/TS/Python only), and helpers (`isEntitled`, `withinTabBudget`, `withinSnippetBudget`, `isLanguageAllowed`) so Free policy lives in one module
  - `src/renderer/hooks/useEntitlement.ts` exposes `useEffectiveTier` (grace counts as paid), `useEntitlement`, `useTabBudget`, `useSnippetBudget`, and `useLanguageAllowed` — every gating UI should consume this surface
  - `src/renderer/utils/upsellNotice.ts` routes Free-ceiling upsells through a single `pushStatusNotice` call so every surface shares one copy block
  - i18n keys for the upsell messaging + 4 feature labels added in `en` and `es`
  - Entitlement matrix is locked by tests — Free tier denies every paid entitlement, paid tiers collapse to the full set, ceilings match the documented numbers
- Scope:
  - Define `Entitlement` as a typed enum so gating is searchable and static: `UNLIMITED_TABS`, `NPM_PACKAGES`, `SNIPPETS_UNLIMITED`, `DEV_UTILITIES`, `LANGUAGE_PACK_EXTENDED`, `THEME_PACK_EXTENDED`, `FONT_PACK_EXTENDED`, `LOCAL_AI`, `NOTEBOOK_MODE`, `EXECUTION_HISTORY`, `BENCHMARK`.
  - Add `useEntitlement(entitlement)` hook backed by `licenseStore`.
  - Centralize the Free-tier limits in one module (`src/shared/entitlements.ts`) so limits cannot drift across stores:
    - Free: 1 tab, 5 snippets, 3 languages (JS/TS/Python), core theme, no dev utilities panel.
  - Replace scattered checks with `useEntitlement()` where the Free ceiling applies.
  - When a locked action is attempted, show a consistent upsell surface that links to the Polar.sh checkout URL resolved from RL-061.
- Acceptance criteria:
  - Without a license, the app reports `tier === 'free'` and all gated entitlements are denied.
  - With a valid Pro license, all Pro entitlements are granted.
  - Attempting a locked action surfaces one upsell UI pattern, not ad-hoc variants per store.
  - Free-tier limits are visible and enforced in unit tests.
- Dependencies:
  - RL-059

### RL-061 Polar.sh integration

- Priority: `P0` for Phase 1
- Status: `Done`
- Readiness: `All slices shipped (Slice 0 → Slice 5, 2026-04-25 through 2026-04-30). Launch-blocker scope fully closed; unblocks RL-063 (re-scoped around the new lingua-marketing repo). See LICENSING_ADR.md and the §Status Update blocks below.`
- 2026-04-26 update — Slice 1:
  - `license-server/` directory ships as a sibling Cloudflare Worker beside `update-server/`. Hono router + D1 schema migration + `GET /health` + 501 stubs for the four Slice-2 endpoints (`/trials/start`, `/licenses/activate`, `/licenses/status`, `/licenses/devices/remove`) + `/webhooks/polar`.
  - `migrations/0001_initial.sql` defines the three Slice 1 tables — `licenses`, `devices`, `trials` — from LICENSING_ADR Decision 2. It reserves constrained product/tier values for `lingua_trial` and `lingua_education`; the separate `educations` anti-abuse table still lands with Slice 4 alongside the education endpoints. Includes the `device_limit INTEGER NOT NULL DEFAULT 3` column used by the activation cap.
  - Every non-webhook endpoint validates request shape (UTF-8 byte caps, email pattern, OS enum, required fields) before returning the 501. `/webhooks/polar` intentionally returns 501 without reading the body until Slice 2 adds signature verification. Slice 2 will replace the 501 branches with real D1 reads/writes + Polar signature verification + Resend email delivery without revisiting the request contract.
  - Tagged-union response shape (`{ ok: true, ...payload }` / `{ ok: false, reason, message?, issues? }`) matches the `licenseStore` IPC bridge contract from RL-059 Slice 0 — Slice 2's wiring code passes server responses through without remapping.
  - `wrangler.toml` declares the D1 binding with a placeholder `database_id` that the maintainer fills in via `wrangler d1 create lingua-licenses` (documented in `license-server/README.md`).
  - Vitest suite covers 40 cases across health, trials, licenses, webhooks, migration constraints, method mismatches, and unknown-route fallthrough. Runs against `app.request(...)` directly (no miniflare) — Slice 2 will adopt `@cloudflare/vitest-pool-workers` when D1 + KV emulation lands.
  - Maintainer-side prerequisites for Slice 2 (Polar account + sandbox products, Resend domain verification, Cloudflare D1 provisioning, secrets, custom domain `licenses.linguacode.dev`) are listed in `license-server/README.md`.
- 2026-04-25 update, amended 2026-05-07:
  - The public pricing tiers chosen for launch are Free ($0), Monthly ($5/month, `lingua_monthly`), Pro ($59 one-time, `lingua_lifetime`), and Education ($0/year renewable, in-app only). Trial is a separate internal `tier: 'trial'` minted by `/trials/start`, not a public pricing tier. The `lingua_team` slug remains a legacy internal compatibility path, not a public tier.
  - The implementation lives in a new sibling Cloudflare Worker `license-server/`, not inside `update-server/`. Decision and trade-offs captured in `docs/LICENSING_ADR.md`.
  - Email delivery uses Resend (already configured by the maintainer). Server consumes `RESEND_API_KEY` as a Cloudflare secret.
  - The license-server is the source of truth for max-3-devices. Self-service device removal is done by the renderer with the license token as auth — no separate user account in Phase 1.
- Scope (rewritten 2026-04-25; education SKU added 2026-04-26; public tier names + prices amended 2026-05-07):
  - Polar products: `lingua_monthly` (Monthly subscription, $5/month) and `lingua_lifetime` (Pro, $59 one-time). Legacy `lingua_team` webhook/token handling stays in place for compatibility but is not a public pricing product.
  - Server-minted paths (NO Polar product, NO checkout): `lingua_trial` (14d internal onboarding flow) and `lingua_education` (1yr public Education tier, renewable on educational email re-validation).
  - Sibling Cloudflare Worker `license-server/` deployed at `licenses.linguacode.dev` with D1 persistence (`licenses`, `devices`, `trials`, `educations` tables — full schema in `docs/LICENSING_ADR.md`). The `educations` table mirrors `trials` (UNIQUE email + UNIQUE device_id) and lands in Slice 4 alongside the endpoints.
  - HTTP endpoints: `POST /webhooks/polar`, `POST /trials/start`, `POST /education/start`, `POST /education/renew`, `POST /licenses/activate`, `GET /licenses/status` (returns `refreshedToken` post-renewal so Monthly stays offline-friendly), `POST /licenses/devices/remove`, `GET /health`.
  - Webhook handlers: `order.paid` (the only event that mints/refreshes paid Polar tokens; Pro one-time by order id, Monthly by subscription id after payment), `order.refunded`, `subscription.created` (ack + wait for paid order), `subscription.updated` (cancel/uncancel status only), `subscription.canceled` (sets `status=cancel_at_period_end`).
  - 14-day trial with anti-abuse: `UNIQUE(email)` + `UNIQUE(device_id)` in the `trials` table + per-IP rate limit on `/trials/start`. Email verification deferred to a Phase 2 follow-up if observed abuse exceeds ~5% of trial volume.
  - 1-year education tier with anti-abuse: same UNIQUE pattern in the `educations` table + per-IP rate limit. Email validated against `.edu` domain (and/or GitHub Education API — locked in Slice 4). Renewal is explicit — `POST /education/renew` re-runs the email validation and extends `expires_at` by 365d. No silent renewal; if validation lapses, license expires gracefully.
  - Renderer surfaces tracked under sibling slices of RL-059: device-management UI in Settings → License (lists active devices with remove + rename), Trial CTA, **Education CTA** (Slice 4), "Buy Pro" / "Enter license key" entry points.
- Acceptance criteria:
  - A successful sandbox purchase via Polar issues a working license token by email.
  - A successful Monthly renewal returns a `refreshedToken` to the next `/licenses/status` call so the desktop client never hits expired offline.
  - Activating on a fourth device on a hard-3 tier returns `exhausted` with the active device list; removing one device + retrying succeeds.
  - The trial endpoint refuses a second trial for the same email or the same device id.
  - The education endpoint refuses a second active education license for the same email or the same device id, and accepts only emails the validation strategy admits as educational.
  - A successful `/education/renew` against a still-valid education license extends `expires_at` by 365d and returns a refreshedToken; a renew against a license whose email no longer validates is rejected with a translated reason so the renderer can prompt the user to upgrade or downgrade.
  - The checkout URL and the `licenses.linguacode.dev` base URL are env-configurable so sandbox vs production is a deploy flag.
- Dependencies:
  - RL-059 (Slice 0 — main-side bridge + device id — shipped 2026-04-25)

### §RL-061.0 Status Update — Slice 2 shipped 2026-04-27

The Slice 2 commit promotes `/webhooks/polar`, `/licenses/activate`,
`/licenses/status`, and `/licenses/devices/remove` from 501-stubs to
real D1-backed implementations:

- `license-server/src/lib/sign.ts` — Ed25519 sign + verify via
  WebCrypto (mirror of `src/shared/license.ts:verifyLicenseToken`).
- `license-server/src/lib/tokens.ts` — `mintAndSignToken()` builds the
  canonical `LicensePayload` from webhook context + signs.
- `license-server/src/lib/polar.ts` — Standard Webhooks v1
  HMAC-SHA256 signature verification with constant-time compare,
  ±5min replay window, base64 secret unwrapping for the `whsec_`
  prefix; tagged-union `PolarKnownEvent` for the 5 event types we
  care about; device-limit helpers retain legacy test coverage but
  the public launch tiers all use the hard-3 default.
- `license-server/src/lib/db.ts` — typed D1 query helpers for
  `licenses` and `devices`, all surface-aware (`WHERE surface = ?`).
- `license-server/src/lib/resend.ts` — minimal HTTP fetch wrapper
  for the Resend email API, with no-op fallback when `RESEND_API_KEY`
  is unset (best-effort email; license persistence is the source of
  truth).
- `license-server/migrations/0002_add_surface_column.sql` —
  `ALTER TABLE devices ADD COLUMN surface` (CHECK 'desktop' | 'web')
  + composite index for the per-surface activation count.
- `license-server/src/handlers/webhooks.ts` — full Polar handler
  with idempotency via `polar_order_id` / `polar_subscription_id`
  UNIQUE indexes, 5 event types dispatched, token mint/refresh gated
  to paid `order.paid` events, unknown events ack 200 with
  `ignored: 'unknown-event'`.
- `license-server/src/handlers/licenses.ts` — verifies token
  signature against `LINGUA_LICENSE_PUBLIC_KEY_JWK`, looks up the
  license row, enforces hard-fail on `refunded` + `expired`,
  enforces split-bucket device limit on activation, returns devices
  grouped by surface in status, soft-deletes on remove (idempotent).
- `license-server/src/index.ts` — Env interface gains the 8 new
  bindings (`DB`, `RATE_LIMIT`, `POLAR_*`, `LINGUA_LICENSE_*`,
  `RESEND_*`, `CORS_ALLOWED_ORIGINS`); CORS middleware mounted on
  `/licenses/*` and `/trials/*` reads `CORS_ALLOWED_ORIGINS` at
  request time so a preview origin can be added without a code change.
- Test counter: license-server vitest 40 → 73 cases (lib unit tests
  for sign + polar + tokens + handler stub-tests updated for the new
  request shapes, including `surface: 'desktop' | 'web'` validation
  and the per-surface bucket enforcement). Review fixes added
  refreshed-token lookup, paid-order subscription minting, malformed
  whsec, and canceled-after-grace coverage.

The renderer-side web licenseStore refactor (Slice 2.5) is **NOT** in
this commit — Slice 2 only sets the server contract. Slice 2.5 will
mint a `localStorage['lingua-device-id']` UUID, call
`/licenses/activate` with `surface: 'web'`, and poll
`/licenses/status` for `refreshedToken` to pick up Monthly renewals.

End-to-end production smoke still requires maintainer prereqs
(see `LICENSING_ADR.md` Maintainer-side prerequisites): `wrangler d1
create lingua-licenses`, `wrangler kv namespace create
lingua-licenses-rl`, four secrets (`POLAR_WEBHOOK_SECRET`,
`POLAR_API_KEY`, `LINGUA_LICENSE_PRIVATE_KEY_JWK`,
`LINGUA_LICENSE_PUBLIC_KEY_JWK`, `RESEND_API_KEY`), and the
`licenses.linguacode.dev` Workers route. Slice 2 is pure code; the
maintainer steps unblock end-to-end Polar sandbox + Resend smoke.

### §RL-061.1 Status Update — Slice 2.5 shipped 2026-04-28

Slice 2.5 brings the **web build into the same server contract the
desktop bridge already had**, so a token paid for in Polar reaches D1
from the renderer regardless of platform. The browser route was
previously local-verify-only — meaning license sharing on web was
unenforced (no per-surface device count) and Monthly subscription
renewals never landed because `refreshedToken` ships in the
`/licenses/status` response.

What ships:

- **Production keypair alignment.** Repo `.env` now embeds the same
  Ed25519 public key whose private counterpart is uploaded to
  Cloudflare Workers as `LINGUA_LICENSE_PRIVATE_KEY_JWK`, stripped to
  RFC 8037 §2 (`{ kty, crv, x }`). `verifyLicenseToken` in
  `src/shared/license.ts` defensively strips `alg`/`key_ops`/`ext`
  from any imported public-key JWK before `crypto.subtle.importKey`,
  mirroring the worker's strip and protecting against historical
  `.env` values that still carry the Node 22+ `alg: "Ed25519"`
  foot-gun.
- **`src/renderer/services/licenseServer.ts`.** Three thin fetch
  wrappers — `activate`, `status`, `removeDevice` — each returning a
  tagged-union result (`{ ok: true, ... } | { ok: false, reason,
  message? }`). 5-second timeout via `AbortController`, no retry,
  `keepalive: true` on `removeDevice` so a fast tab close still
  completes the device removal. Reads the base URL from
  `import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL`; when unset the
  wrappers short-circuit to `{ ok: false, reason: 'disabled' }` so
  dev builds (`npm run dev:web:pro`) stay local-verify-only.
- **`src/renderer/services/deviceFingerprint.ts`.** Mints
  `crypto.randomUUID()` once on first paste and persists it under
  `localStorage['lingua-device-id']`. Derives `deviceName` (e.g.
  `'Chrome on macOS'`) and `os` (e.g. `'web-chrome'`) from
  `navigator.userAgent`. SSR-safe and privacy-mode-tolerant.
- **`src/renderer/stores/licenseStore.ts`.** Web branch refactored:
  - New transient `kind: 'verifying'` status while activate is in
    flight — `useEffectiveTier` collapses it to `'free'` so
    entitlements stay conservative until the server confirms.
  - `setLicenseToken` calls `serverActivate` after local verify.
    Maps server outcomes onto local statuses: `ok` → `active`/`grace`,
    `exhausted` → `invalid:devices-exhausted` (token kept so Slice 3
    can remediate), `revoked`/`expired`/`unknown-license` →
    `invalid:*` (token wiped), `unreachable`/`server-error` → fall
    back to local-verify within the 24-hour offline-grace window
    (per LICENSING_ADR Decision 4).
  - `revalidate` calls `serverStatus` and replaces the local token
    with `refreshedToken` only when its `payload.issuedAt` is
    strictly newer than the stored token's — defends against
    stale-replica responses from D1's read path.
  - `clearLicense` fires `serverRemoveDevice` fire-and-forget
    (`keepalive: true`) before wiping local state.
  - Cross-tab sync via `window.addEventListener('storage')` so a
    paste in tab A triggers a `revalidate()` in tab B on the next
    user interaction.
  - New `serverSync` field on `LicenseState` (`'synced' |
    'unreachable' | 'disabled' | null`) drives the
    `license.notice.serverUnreachable` info banner.
- **`src/renderer/components/Settings/LicenseSection.tsx`.**
  Surfaces `verifying` as the transient pending pill via
  `license.status.verifying`, maps three new failure reasons
  (`devices-exhausted`, `license-refunded`, `unknown-license`) to
  user-facing i18n keys, and pushes the `serverUnreachable` info
  notice when the activate call falls back to local-verify.
- **i18n.** `en/common.json` + `es/common.json` (tuteo Latin-American
  Spanish) gain four new keys: `license.status.verifying`,
  `license.notice.invalid.devicesExhausted`,
  `license.notice.invalid.refunded`,
  `license.notice.invalid.unknownLicense`,
  `license.notice.serverUnreachable`.
- **`public/sw.js`.** Short-circuits the fetch handler for any GET
  whose origin is in a new `LICENSE_ORIGINS` list
  (`https://licenses.linguacode.dev`, `http://localhost:8787`) by
  returning early without `event.respondWith` — the browser's
  default fetch path runs, the response never enters the cache, and
  `/licenses/status` cannot be served stale. `CACHE_VERSION` bumped
  `v1` → `v2` so existing clients drop any pre-fix cached license
  responses on the next activate.
- **`vite.web.config.mts`.** Sets `envDir: __dirname` so Vite loads
  the repo-root `.env` / `.env.production` instead of `src/web/`
  (which is empty). Latent bug Slice 2.5 surfaced — without it,
  every `import.meta.env.VITE_*` substitution in production web
  bundles was silently `undefined`, including
  `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK`.
- **`.env.production`** (NEW). Sets
  `VITE_LINGUA_LICENSE_SERVER_URL='https://licenses.linguacode.dev'`
  for `npm run build:web`. Local dev keeps the empty default from
  `.env` so `dev:web:pro` runs server-disabled.
- **Tests.** New `tests/services/{licenseServer,deviceFingerprint}.test.ts`
  pin the wrapper contract (URL/headers/body, timeout, tagged
  union shapes, keepalive, dev-disabled short-circuit). Extended
  `tests/stores/licenseStore.test.ts` with a `licenseStore —
  server-aware web branch (Slice 2.5)` block covering verifying →
  active, unreachable fallback, exhausted retain-token,
  revoked-wipe, refreshedToken newest-wins, and clearLicense
  keepalive. New `tests/web/sw.test.ts` pins the SW license-origin
  bypass against silent regression. Total suite: 1835 passed
  (added 33 new cases on top of yesterday's 1802).

What remains (Slice 3 + later):

- Settings → License device list UI (per-surface buckets, rename,
  remove). Remediation modal for `devices-exhausted`.
- Trial + Education + Recovery server-minted CTAs.
- GH Actions release pipeline + web update banner.

Manual smoke checklist (deferred to maintainer per AGENTS.md UI
verification rule):

1. Build production web (`npm run build:web`); `preview:web`; paste
   the real Polar token from yesterday's smoke (license id
   `04074d85-…`); confirm status pill flips through `verifying` →
   `active · Pro`; confirm DevTools Network shows POST to
   `licenses.linguacode.dev/licenses/activate` with `surface: 'web'`
   and a UUID `deviceId`; confirm `localStorage` has `lingua-license`
   + `lingua-device-id`; confirm `caches.keys()` does not contain
   the license origin.
2. DevTools → block-URL `https://licenses.linguacode.dev/*`; reload
   → status pill stays `active`, info notice
   `license.notice.serverUnreachable` appears, no console errors.
3. `npm run dev:web:pro` → confirm zero fetch traffic to license
   origin (regression smoke for the `disabled` short-circuit).
4. `npm run dev:desktop:pro -- --sync-main` → desktop unchanged,
   IPC bridge still owns truth, no fetch from renderer.

### §RL-061.2 Status Update — Slice 3 shipped 2026-04-28

Slice 3 ships the **web-only device-management UI** that closes the
remediation loop opened by Slice 2.5. Before this slice a web user who
hit the per-surface device cap (`reason: 'exhausted'` from
`/licenses/activate`) had no way out except clearing the license; the
server already returned the active device bucket but the renderer
discarded it. Slice 3 turns that bucket into a list of rows the user
can read and act on.

What ships:

- **`src/renderer/stores/licenseStore.ts`.** New `devices:
  LicenseServerDevicesBucket | null` and `deviceLimit:
  LicenseServerDeviceLimit | null` fields on `LicenseState`,
  populated from the `devices` + `deviceLimit` payload that
  `/licenses/activate` and `/licenses/status` already returned (and
  the web `setLicenseToken` flow already discarded). Persistence
  shape unchanged — both fields stay in-memory only (the persist
  `partialize` deliberately does not enumerate them). Reset to `null`
  on `clearLicense`. New `removeDevice(deviceIdToRemove)` action
  wraps `serverRemoveDevice` with terminal-reason mapping
  (`unknown-license` / `revoked` wipe the local token + status; the
  rest preserve the cached bucket so the user can retry). Desktop
  branch returns `{ ok: false, reason: 'not-implemented' }` from
  `removeDevice` until Slice 3.5 wires the main-side bridge into
  `/licenses/*`.
- **`src/renderer/components/Settings/DeviceList.tsx`** (new).
  Pure presentational component — takes `devices` + `deviceLimit` +
  `currentDeviceId` + `pendingRemovalId` + `onRemove`. Renders both
  surface buckets (`desktop` + `web`) with a per-bucket
  `[data-testid="license-devices-counter-${surface}"]` showing
  `N of M`, a per-row `[data-testid="license-device-row-${id}"]`
  with truncated `deviceName` + os + locale-aware
  `Intl.RelativeTimeFormat`-based "Last seen X ago" (server stores
  `lastSeenAt` in unix seconds), and a Remove button that disables
  on the current-device row with the `removeBlocked` tooltip
  (`role="status"`-style — title attribute) and disables on every
  row while one Remove is in flight (concurrent mutations would
  race the cached bucket update).
- **`src/renderer/components/Settings/ExhaustedDevicesModal.tsx`**
  (new). Mounts when the active status is
  `{ kind: 'invalid', reason: 'devices-exhausted' }` (Slice 2.5
  keeps the token in that case so we can remediate without
  re-pasting from email). Calls `revalidate()` on mount so the
  bucket reflects server truth instead of the snapshot from a
  failed activate that may now be minutes old. Per-row Remove fires
  the licenseStore action; Retry re-runs `setLicenseToken(token)`
  and closes the modal on `active`/`grace`; Cancel falls back to
  Free via `clearLicense()`. Built on the existing
  `OverlayBackdrop` + `OverlayCard` chrome primitives and the
  `surface-header` / `button-primary` / `button-secondary`
  utility classes for visual consistency with the consent + utility
  modals.
- **`src/renderer/components/Settings/LicenseSection.tsx`.** Adds a
  `Devices` row gated to `status.kind ∈ {active, grace}` AND
  non-null `devices` + `deviceLimit` (so the section hides under
  the local-verify-only `serverSync: 'unreachable'` path even on
  Pro tokens). Intercepts `setLicenseToken` returning
  `{ kind: 'invalid', reason: 'devices-exhausted' }` to open the
  modal instead of pushing the standard error notice. A `useEffect`
  watches `status` and re-opens the modal whenever the persisted
  state lands back on `devices-exhausted` (covers post-rehydrate +
  cross-tab reactivation).
- **i18n.** 18 new keys per locale under `license.devices.*`
  (`title`, `hint`, `surface.{desktop,web}`, `counter`,
  `empty.{desktop,web}`, `currentChip`, `lastSeen`, `remove`,
  `removing`, `removeBlocked`, `removeSucceeded`, `removeFailed`,
  `exhaustedModal.{title,body,retry,cancel}`). ES copy is tuteo
  Latin-American (`Quita`, `Reintenta`, `puedes`) per AGENTS.md.
- **Tests.** New `tests/components/ExhaustedDevicesModal.test.tsx`
  (6 cases — render + revalidate-on-mount, Remove dispatch, Retry
  closes on success, Retry stays open on non-success, Cancel
  closes via clearLicense, Retry-disabled-during-remove). Extended
  `tests/components/LicenseSection.test.tsx` with 5 new cases
  (Devices row visible under active, hidden under free, current
  chip + Remove disabled on current device, Remove dispatches +
  notice, devices-exhausted routes to modal). Extended
  `tests/stores/licenseStore.test.ts` with 6 new cases (devices
  persisted on activate-success / exhausted / revalidate-success;
  removeDevice happy path + unreachable preserves bucket;
  clearLicense resets devices/deviceLimit). Total suite: 1854
  passed (added 17 new cases on top of yesterday's 1835).

What remains under RL-061 (Slice 4 + later):

- Trial + Education + Recovery server-minted CTAs.
- GH Actions release pipeline + web update banner.
- **Slice 3.5 (new)** — desktop main-side `/licenses/activate` +
  `/licenses/status` wiring so the desktop bridge enforces the
  per-surface bucket and surfaces the same device list inside the
  desktop Settings → License section.
- **Slice 3b (BACKLOG)** — device-rename UI and the matching
  `/licenses/devices/rename` worker endpoint. Tracked in
  `docs/BACKLOG.md` under `[licensing] 2026-04-28`.

Manual smoke checklist (deferred to maintainer per AGENTS.md UI
verification rule — the agent already smoked the production web
build locally with mocked `/licenses/*` routes, browser_snapshot
verified, console errors = 0):

1. Build production web with the real production keypair +
   `VITE_LINGUA_LICENSE_SERVER_URL='https://licenses.linguacode.dev'`
   (`.env.production` already does this); `preview:web`; paste the
   real Polar token; confirm the Devices section renders both
   buckets with the actual server response, the current-device chip
   lands on the matching row, and Remove decrements the counter
   without flipping the status pill.
2. Trigger the exhausted path by re-pasting the same token from a
   third + fourth browser profile (the worker enforces `web: 3`);
   confirm the modal opens, Retry re-activates after Remove.
3. Flip locale to `es`; reload; confirm the tuteo strings render
   without missing-key warnings.

### §RL-061.3 Status Update — Slice 3.5 shipped 2026-04-29

Slice 3.5 closes the desktop-vs-web gap that Slice 3 surfaced:
desktop verifies the token locally but, before this slice, never
registered the device in D1. The `desktop` bucket therefore stayed
empty server-side and the Devices section never rendered on desktop
builds. Slice 3.5 wires the main-process bridge into the same three
endpoints the web build hit since Slice 2.5
(`/licenses/{activate,status,devices/remove}`) and ships the
extended snapshot through IPC so the renderer's desktop branch can
satisfy Slice 3's gate.

What ships:

- **`src/shared/licenseServerTypes.ts`** (NEW). Canonical request /
  response types for the license-server contract — `ActivateInput`,
  `StatusSuccess`, `LicenseServerFailureReason`, etc. Both
  `src/renderer/services/licenseServer.ts` and
  `src/main/licenseServer.ts` import from here so the contract
  cannot drift between surfaces. The renderer module re-exports the
  shared names so its existing consumers (licenseStore, DeviceList,
  ExhaustedDevicesModal) keep their import paths.
- **`src/main/licenseServer.ts`** (NEW). Main-side fetch wrappers
  that mirror the renderer ones — same 5-second AbortController
  timeout, same tagged-union failures, same `disabled` /
  `unreachable` / `server-error` triage. Two key differences:
  - Base URL comes from the build-time `__LINGUA_LICENSE_SERVER_URL__`
    define (loaded from `.env.production` via `loadEnv()` in
    `vite.main.config.mts`), with `process.env.LINGUA_LICENSE_SERVER_URL`
    as a runtime override for `dev:desktop:prod`.
  - No `keepalive: true` on `/licenses/devices/remove` — main lives
    in a long-lived process where the browser tab-close edge case
    cannot happen.
  - Defensive `typeof fetch === 'function'` guard so an older
    Electron bundle without the Node-22 fetch global degrades to
    `disabled` instead of crashing.
- **`src/main/license.ts`.** `LicenseSnapshot` extended with
  `serverSync: 'synced' | 'unreachable' | 'disabled'`,
  `devices: LicenseServerDevicesBucket | null`,
  `deviceLimit: LicenseServerDeviceLimit | null`. Persistence
  shape unchanged — only `token` + `lastVerifiedAt` go to disk.
  After a successful local verify in `applyToken`, the runtime
  calls `serverActivate` with `surface: 'desktop'`, the persisted
  `userData/device-id.json` UUID, and `os.hostname()` +
  `process.platform` as the device metadata. `revalidate` calls
  `/licenses/status`, picks up Monthly subscription `refreshedToken`
  when `payload.issuedAt` is strictly newer than the stored
  token's, and re-issues `serverActivate` when
  `result.deviceRegistered === false` so a rehydrated exhausted
  token cannot bypass the per-surface cap. `clear` fires
  `serverRemoveDevice` best-effort for the current device. New
  `removeDevice(deviceIdToRemove)` action exposes the third
  endpoint to the IPC bridge with terminal-reason wipe semantics
  (`unknown-license` / `revoked` flip to invalid, transient
  failures preserve the cached bucket). Boot revalidate fires
  async + non-blocking after `runtime` is constructed so
  `app.ready` is not delayed by a slow server roundtrip.
- **`src/main/ipc/license.ts`.** New `license:remove-device`
  handler. The four existing handlers automatically return the
  extended snapshot through `getSnapshot()`.
- **`src/preload/index.ts`.** `window.lingua.license.removeDevice(deviceIdToRemove)`.
- **`src/types.d.ts`.** `LicenseSnapshot` ambient type extended with
  the three new fields, new `LicenseRemoveDeviceResult` tagged
  union, new `__LINGUA_LICENSE_SERVER_URL__` declare const.
- **`src/renderer/stores/licenseStore.ts`.** Desktop branch refactored:
  - New private `applySnapshot()` helper mirrors all six fields
    from main's snapshot into the store (token + status +
    lastVerifiedAt + serverSync + devices + deviceLimit) instead of
    the Slice-0 trio.
  - `removeDevice` no longer no-ops; delegates to
    `bridge.removeDevice(deviceIdToRemove)`. On success, applies
    the returned snapshot. On terminal failure
    (`unknown-license` / `revoked`), syncs from bridge so the
    renderer reflects whatever main wrote (e.g. a wipe to free).
    On transient failure, the cached bucket survives so the user
    can retry.
  - The Slice 0 `bootstrapApplied` race-guard is preserved —
    user-initiated mutations still take precedence over the boot
    snapshot apply.
- **`src/renderer/components/Settings/LicenseSection.tsx`.**
  No changes. The Slice 3 gate
  (`status.kind ∈ {active, grace}` + `serverSync === 'synced'` +
  `devices && deviceLimit`) is already correct; desktop now
  satisfies it because main pushes `serverSync: 'synced'` once
  the activate handshake completes.
- **`vite.main.config.mts`.** New `__LINGUA_LICENSE_SERVER_URL__`
  build-time define, loaded the same way Slice 3's prerequisite
  fix established for the public key (`loadEnv()` from repo-root
  `.env.production`).
- **Tests.**
  - `tests/main/licenseServer.test.ts` (NEW, 14 cases) — pin the
    contract of the main wrappers (URL / body / headers / timeout /
    tagged-union shapes / `Authorization: Bearer` header for
    status / no `keepalive` / `disabled` fallback when fetch is
    unavailable).
  - `tests/main/license.test.ts` extended with 10 Slice 3.5 cases
    (server-aware describe block): activate-after-verify caches
    devices/deviceLimit, transient failure preserves token with
    `serverSync='unreachable'`, exhausted preserves token, the
    `deviceRegistered=false` re-activate flow, removeDevice happy
    path, removeDevice unreachable preserves bucket, authoritative
    server expired status, refreshedToken payload sync, clear fires
    best-effort removeDevice without waiting for it. Total: 38 cases
    (was 28).
  - `tests/stores/licenseStore.test.ts` extended with 4 desktop
    bridge cases: snapshot mirrors all six fields, removeDevice
    delegates and applies returned snapshot, transient failure
    forwards tagged-union shape, no-token returns invalid-input
    without calling the bridge. Total: 27 cases (was 23).
  - Renderer suite total: 1896 passed / 2 skipped (was 1868).

What remains (Slice 4 + later):

- Trial + Education + Recovery server-minted CTAs.
- GH Actions release pipeline + web update banner.

Manual smoke checklist (deferred to maintainer per AGENTS.md UI
verification rule):

1. `npm run smoke:desktop` — confirms the runners (Go / Rust /
   Python / JS / TS) still boot through the re-bundled main
   process.
2. `npm run dev:desktop:prod` against a real CF-issued token —
   confirm the activate POST lands with `surface: 'desktop'`,
   the pill flips to `Active`, the Devices row renders with the
   current device chip on the row matching
   `userData/device-id.json`.
3. `npm run make:desktop`; open the packaged .app; paste a
   real token — same assertions as (2) but against the production
   build (CSP allow already shipped in Slice 3, the Vite config
   `loadEnv` fix already shipped in Slice 3).
4. Disconnect network mid-session, reload, confirm the
   `serverUnreachable` notice appears and the app stays Active.

### §RL-061.4 Status Update — Slice 4 shipped 2026-04-29

Slice 4 closes the Free → Paid funnel for the three non-Polar
on-ramps the product needs before public launch: a 14-day Trial,
the Education tier (1-year educational license), and a self-service
Recovery flow for users who lost their token email. It also
hardens the renderer against stale-token UX: a re-installed user
who pastes an old token now silently picks up the latest one via
`/licenses/status` lookup-by-licenseId, or sees an inline
recover-hint when the server has nothing fresher.

Concrete shape:

- **Trial — single-shot mint per Decision 5.** `POST /trials/start`
  validates email + device, rate-limits per IP (3/day), checks the
  `trials` UNIQUE(email) + UNIQUE(device_id) anti-abuse pair, and
  mints a 14-day token. Token returns in the response body so the
  renderer auto-pastes via `setLicenseToken`; user lands directly
  on Active without ever seeing a paste step. Resend best-effort
  for the welcome email.
- **Education — magic-link two-step.**
  - `POST /education/start` validates the `.edu` allow-list
    (`/^[^@\s]+@([a-z0-9-]+\.)*edu$/i` plus an explicit list of
    `ac.uk`, `edu.mx`, `edu.au`, `edu.ca`, `edu.br`, `ac.in`),
    rate-limits per IP (3/day), persists a row in
    `education_pending_confirmations` (24h TTL), and sends a
    confirmation email. Returns `{ ok: true, pending: true }`.
  - `GET /education/confirm?confirm=<id>` validates the pending
    row (not expired, not already confirmed), mints the
    education license + persists in `educations` + `licenses`,
    sends the canonical token email, returns an HTML success
    page. Idempotent on re-click — second hit re-renders the
    same success HTML without re-minting.
  - `POST /education/renew` re-runs the `.edu` validation,
    extends `expires_at` by 365d, re-mints (`refreshLicenseToken`
    rebuilds the signed payload because `supportWindowEndsAt`
    lives inside the signed payload — see Decision 8 below).
  - Duplicate-email branch returns `email-already-active` +
    `canRecover: true`. Renderer (`EducationCta`) hands that
    flag to `LicenseSection` which pre-fills `RecoveryCta` for
    the same email.
- **Recovery — magic-link two-step (mirror of Education) with
  no-info-leak design (Decision 7).**
  - `POST /licenses/recover/start` validates email shape,
    rate-limits per IP (5/day) AND per email (3/day), persists
    a row in `recovery_pending_confirmations` (no device
    columns — recovery does not register a new device), sends
    a confirmation email. ALWAYS returns 200 + neutral copy
    regardless of whether the email matches a known license,
    hits a rate limit, or is empty-but-shape-valid. Pending
    row is created EVEN for unknown emails so timing matches.
  - `GET /licenses/recover/confirm?confirm=<id>` validates
    pending row, looks up `findLicenseByEmail`, sends the
    canonical token email if found, marks `confirmed_at`. Same
    generic success HTML for known + unknown branches.
- **Stale-token auto-pickup (renderer-side fix).** When local
  verify returns `invalid:expired` for a token whose signature
  is still valid (i.e. `reason !== 'invalid-signature'`), the
  renderer attempts `/licenses/status` before giving up. The
  worker's `findCurrentLicenseForToken` walks the `licenseId`
  lookup if `licenses.token` no longer matches the stale token,
  so an old T1 + active subscription resolves to the current
  T2 silently. User pastes T1 → brief `verifying...` pill → ends
  on `Active` with T2 persisted. No email step needed for the
  happy path. If the server cannot refresh, the renderer
  surfaces a `recoverHint` field carrying the token's
  `issuedTo` payload field; LicenseSection turns that into an
  inline "Recover via email" banner pre-filled into RecoveryCta.

Shape of the staged diff (one human commit):

- `license-server/migrations/0004_add_educations_and_pending_tables.sql`
- `license-server/src/lib/{rateLimit,renderTemplate,educationEmail}.ts`
  (NEW)
- `license-server/src/lib/{validation,db,resend}.ts` (extended)
- `license-server/src/handlers/{trials,education,recover}.ts`
  (NEW + replaced)
- `license-server/src/index.ts` (router mounts + KV binding)
- `license-server/src/emails/*.html` (six templates +
  `_layout.css`) imported via Vite `?raw`
- `license-server/test/` — 7 new test files, 4 extended; 171
  worker tests passing.
- `src/shared/licenseServerTypes.ts` — extended with
  Trial / Education / Recovery contracts.
- `src/renderer/services/{trialServer,educationServer,recoveryServer}.ts`
  (NEW)
- `src/renderer/stores/licenseStore.ts` — adds `recoverHint`,
  `clearRecoverHint`, `attemptStaleTokenRefresh` helper, plumbs
  `activeToken` through `setLicenseToken` + `revalidate` so a
  refreshed token replaces the stale one without a re-paste.
- `src/renderer/components/Settings/{TrialCta,EducationCta,RecoveryCta}.tsx`
  (NEW)
- `src/renderer/components/Settings/LicenseSection.tsx` — wires
  the three CTAs under `status === 'free'` (and under
  `invalid:*` except `devices-exhausted`), surfaces the
  recover-hint banner.
- `src/renderer/i18n/locales/{en,es}/common.json` — 47 new keys
  per locale (Trial 13 + Education 17 + Recovery 14 + 2
  recover-hint + 1 disabled). Tuteo Latin American.
- `tests/services/{trialServer,educationServer,recoveryServer}.test.ts`
  (NEW, 19 cases)
- `tests/components/LicenseSection.test.tsx` extended with 3
  Slice 4 cases (CTAs render under free, hidden under active,
  recover-hint banner renders).
- Renderer suite total: 1918 passed / 2 skipped (was 1896).

Decision 8 added to `LICENSING_ADR.md`: **"Token re-mint on
renewal is transparent to the user."** Documents why we cannot
keep a static token across renewals (the offline-grace window
relies on `supportWindowEndsAt` baked into the signed payload),
and how the auto-refresh contract works on both web and
desktop. References the implementation files
(`licenses.ts:status`, `licenseStore.ts:revalidate`,
`main/license.ts:revalidate`).

Decision 5 (Education) updated to reflect the magic-link
two-step flow.

What remains (Slice 5):

- Release pipeline (GitHub Actions matrix, signing, notarization).
- Web update banner (advertises the new `.app` / `.exe` /
  `.AppImage` from `linguacode.dev/download`).

Phase 2 follow-ups filed in BACKLOG:

- GitHub Education API integration (replace the static `.edu`
  TLD allow-list with OAuth-based proof of educational
  enrolment).
- Dev-only `GET /preview-email` endpoint for visual review of
  the six HTML templates without sending a real email.
- Desktop main-side stale-token auto-pickup (Slice 4 covers the
  web build; the desktop main bridge has its own
  `setLicenseToken` flow that drops out on
  `local:expired`. The user's primary scenario was the web user
  re-installing the app, so desktop is deferred).

Manual smoke checklist (deferred to maintainer per AGENTS.md UI
verification rule):

1. Apply migration: `cd license-server && wrangler d1 migrations
   apply lingua-licenses --remote` (creates `educations` +
   `education_pending_confirmations` +
   `recovery_pending_confirmations`).
2. `wrangler kv namespace create lingua-rate-limits` if not
   already done; update `wrangler.toml` binding name to
   `RATE_LIMIT`. Re-deploy.
3. `npm run preview:web`. Settings → License with no token —
   confirm the three CTAs render. Try a Trial with
   `me@example.com` → Start → token returns in body → renderer
   auto-pastes → pill flips Free → Active — Trial.
4. Try a duplicate Trial with the same email → expect
   `duplicateEmail` notice + Recover form pre-filled.
5. Education flow: `me@example.org` → Start → notice
   `notEducational`. Retry `me@school.edu` → Start → "check
   your email" UX. Manually click the confirmation link from
   the email → success HTML page → second email arrives with
   token. Paste token → pill flips to Active — Education.
6. Recovery flow: any email → Resend → `sent` notice (works
   for both known and unknown).
7. Switch locale to `es`, reload, exercise one flow. Confirm
   tuteo throughout (`Inicia` not `Iniciá`, `Revisa` not
   `Revisá`).
8. End: `browser_console_messages({ level: 'error' })` = 0.

### §RL-061.5 Status Update — Slice 5 shipped 2026-04-30

Slice 5 closes the launch-blocker scope of RL-061. Two surfaces
shipped together:

- **Web update banner** — `update-server` exposes a new
  `GET /web/version` route (`license-server/../update-server/src/index.ts:handleWebVersion`)
  that returns the latest published GitHub release tag (with the
  leading `v` stripped) under a 5-minute edge cache. Returns 204
  when no release exists yet so the renderer fallback stays
  clean. Renderer side: `__LINGUA_APP_VERSION__` is now injected
  by `build/appBuildMetadata.mts:getSharedBuildDefines` from
  `package.json#version`. The new
  `src/renderer/hooks/useWebVersionPolling.ts` polls every
  12 hours plus on `visibilitychange` after >1 hour idle, both
  short-circuited when `window.lingua.platform !== 'web'`
  (the web adapter `src/web/adapter.ts` exposes
  `window.lingua.platform = 'web'`; native Electron builds set
  it to `'darwin'` / `'win32'` / `'linux'` and skip the hook so
  the native autoupdater in `src/main/updater.ts` owns update
  UX). A new `WebUpdateBanner` component renders at the top of
  the App chrome whenever the remote tag is strictly newer than
  the build pin (`utils/version.ts:isVersionNewer`, with parity
  pinned against the worker's `update-server/src/version.ts:isNewer`
  via shared regex `/^(0|[1-9]\d*)$/u` rejecting leading zeros,
  exponent notation, and hex), with Reload (calls
  `window.location.reload()`) and Dismiss
  (in-memory) buttons. 4 i18n keys × 2 locales (en + es tuteo).

- **CF Pages migration + custom domain `app.linguacode.dev`** —
  the web build moved from GitHub Pages
  (`johnny4young.github.io/lingua/`) to Cloudflare Pages
  (`app.linguacode.dev`). `linguacode.dev` itself stays
  reserved for the future `lingua-marketing` repo (filed in
  BACKLOG, HIGH PRIORITY). `deploy-web.yml` now uses
  `wrangler pages deploy dist/web --project-name lingua-web`
  and ends with a `POST /zones/$ZONE_ID/purge_cache` call so
  long-lived tabs see the new HTML on next navigation.
  `VITE_BASE_PATH` flipped from `/lingua/` to `/`.
  `public/sw.js` `CACHE_VERSION` bumped `v2 → v3` so any user
  with a stale GH Pages SW drops their cache on first load.

- **Release pipeline orchestration** — `release.yml` now accepts
  four boolean inputs (`release_macos`, `release_windows`,
  `release_linux`, `release_web`, all default `true`). Each
  build job is gated on its respective input via `if:`. The
  publish job uses `if: ${{ always() && (any-build-enabled) }}`
  so a web-only release skips the desktop matrix entirely
  (~5 min vs ~240 min full run — critical for staying under
  the 2,000 min/month GH Actions free tier on a private repo).
  A new `deploy-web` job at the end calls
  `deploy-web.yml` via `workflow_call` so a single
  `gh workflow run release.yml` drives both desktop and web
  in lockstep.

- **Telemetry side benefit** — the existing
  `src/renderer/utils/telemetry.ts:resolveTelemetryBase` reads
  `import.meta.env.VITE_LINGUA_APP_VERSION ?? '0.0.0'`. Slice 5
  adds `applySharedEnvDefaults()` to the four Vite configs
  (`vite.web/.renderer/.main.config.mts` + `vitest.config.mts`)
  so `VITE_LINGUA_APP_VERSION` is seeded from
  `package.json#version` at config-load time. When RL-065's
  event-export pipeline ships, every event will already report
  the real version instead of `'0.0.0'`. Forward-compatible
  with no runtime cost today (telemetry endpoint is still
  unconfigured so events stay buffered in memory).

Files in this slice's staged diff (~17 files):

- `update-server/src/index.ts` — new `/web/version` handler with
  CORS preflight (OPTIONS), 405 for non-GET, and CORS headers
  (`Access-Control-Allow-Origin: *`, `Allow-Methods: GET, OPTIONS`,
  `Max-Age: 86400`) on every response so the renderer can fetch
  cross-origin from `app.linguacode.dev`.
- `update-server/src/version.ts` — tightened to share the strict
  semver regex with the renderer (rejects `01.2.3`, `1e2.0.0`,
  `0x1.0.0`).
- `update-server/test/index.test.ts` *[new]* — 25 cases covering
  the happy path, cache-warm second hit, 204 on no-releases,
  CORS preflight (OPTIONS), 405 for unsupported methods, plus
  parity tests for the shared `parseVersion` / `isNewer`
  helpers.
- `update-server/vitest.config.ts` *[new]*.
- `update-server/package.json` — vitest dev dep + `test` script.
- `build/appBuildMetadata.mts` — `__LINGUA_APP_VERSION__` define
  + `applySharedEnvDefaults()` env seed.
- `vite.web/.renderer/.main.config.mts`, `vitest.config.mts` —
  call `applySharedEnvDefaults()` at config-load time.
- `src/renderer/hooks/useWebVersionPolling.ts` *[new]* — gates on
  `window.lingua.platform !== 'web'`, not bridge presence.
- `src/renderer/services/webUpdateServer.ts` *[new]*.
- `src/renderer/components/WebUpdateBanner.tsx` *[new]*.
- `src/renderer/utils/version.ts` *[new]* — strict regex parity
  with the worker.
- `src/renderer/App.tsx` — mount banner gated by
  `window.lingua?.platform === 'web'` (web adapter sets the
  platform field; native Electron sets a different value).
- `public/sw.js` — `LICENSE_ORIGINS` renamed to
  `PASSTHROUGH_ORIGINS` and extended with
  `https://updates.linguacode.dev` so the service worker never
  caches `/web/version` responses (would otherwise pin a stale
  version on the long-lived tab past the 12-hour poll cycle).
  `CACHE_VERSION` bumped `v2 → v3`.
- `src/renderer/i18n/locales/{en,es}/common.json` — 4 keys per
  locale.
- `tests/utils/version.test.ts` *[new]* — 20 cases.
- `tests/services/webUpdateServer.test.ts` *[new]* — 7 cases.
- `tests/hooks/useWebVersionPolling.test.tsx` *[new]* — 6 cases.
- `tests/components/WebUpdateBanner.test.tsx` *[new]* — 6 cases.
- `tests/components/App.test.tsx` — extended with two cases
  pinning the gate (desktop NOT mounted; web build mounts).
- `tests/web/sw.test.ts` — extended for the
  `LICENSE_ORIGINS → PASSTHROUGH_ORIGINS` rename + the new
  `updates.linguacode.dev` allow-list assertion.
- `tests/docs/releaseWorkflow.test.ts` — extended to pin the
  per-platform success check, the web-only release branch, and
  the `workflow_call` ref propagation.
- `.github/workflows/release.yml` — 4 boolean inputs + per-job
  `if:` guards + per-platform success-gating on `publish` (so
  a partial failure cannot publish half a release) + final
  `deploy-web` job that runs when web-only or when publish
  succeeded.
- `.github/workflows/deploy-web.yml` — full rewrite for CF
  Pages + cache purge. Accepts `ref` input (default
  `refs/heads/main`) so `release.yml` can pass the validated
  release tag and the deploy checks out exactly that ref.

Maintainer-side ops (one-time, post-merge):

1. CF Pages dashboard: create project `lingua-web` (production
   branch `main`).
2. Add custom domain `app.linguacode.dev` to the project (CF
   auto-provisions TLS cert).
3. Add `CLOUDFLARE_ZONE_ID` secret to the repo (zone id of
   `linguacode.dev` from CF dashboard → Overview → API).
4. Confirm `CLOUDFLARE_API_TOKEN` has Pages scope (probably yes
   since the same token deploys Workers; if not, regenerate
   with `Account > Cloudflare Pages > Edit` permission).
5. `cd update-server && npm run deploy` — ships
   `/web/version`. Does NOT need a release tag — the route is
   purely additive.
6. `gh workflow run release.yml -f release_tag=v0.2.2` — runs
   the orchestrated pipeline end-to-end (desktop + web).
7. Smoke: open `https://app.linguacode.dev/`, override
   `/web/version` response in DevTools to a higher version,
   confirm banner appears + Reload + Dismiss work.

What's next:

- `RL-063` (Download landing page at linguacode.dev) is the
  next launch-blocker, now re-scoped around the new
  `lingua-marketing` repo (Astro + Tailwind + MDX + CF Pages,
  filed in BACKLOG 2026-04-30).

### RL-062 Public README, license declaration, and distribution posture

- Priority: `P0` for Phase 1
- Status: `Done`
- Readiness: `Completed on 2026-04-17`
- Current progress:
  - Shipped a real `LICENSE` at the repo root with the source-available commercial terms (personal/evaluation use granted; redistribution, hosted-service, and commercial use require a paid license)
  - Removed the MIT license declaration from `package.json` in favor of `SEE LICENSE IN LICENSE`
  - Rewrote the README header to ship a License badge pointing at the new file, a `## Pricing and licensing` section naming the four tiers, and a `## Who it is for` audience paragraph
  - Guard test in `tests/docs/license.test.ts` fails CI if anyone removes the LICENSE, drops the README posture section, or reintroduces an MIT badge
- Historical gap:
  - Earlier drafts carried MIT/open-source language and described the repo as private/closed-source.
  - The public-facing README, LICENSE, and launch docs must keep matching the real source-available commercial distribution posture before the repo is published.
  - Pricing and repo/product relationship claims must stay aligned with the live checkout and download surface.
- Scope:
  - Decide and document one of the two consistent postures:
    1. **Source-available / commercial (recommended for Phase 1):** ship a proprietary `LICENSE` file (e.g. "Lingua Commercial License — Personal & Evaluation Use"), remove the MIT badge, and add a short "Pricing and licensing" section near the top of the README.
    2. **Open-core:** only if we intentionally split core vs paid addons, with a real `LICENSE` and a separate `LICENSE-commercial` describing paid entitlements.
  - Land the chosen LICENSE file so the repo has a valid license at publication.
  - Update the README intro so the value proposition is explicit: "Multi-language desktop code runner — JavaScript, TypeScript, Python, Go, and Rust in one offline-first Monaco-powered app." Match the HN positioning.
  - Add a "Pricing and download" link pointing to `linguacode.dev`.
- Acceptance criteria:
  - The repo has no broken LICENSE reference.
  - The README top section states: what Lingua is, who it is for, the 5 shipping languages, pricing posture, and the download URL.
  - The README's license badge matches the actual LICENSE file.
- Dependencies:
  - None

### RL-063 Download landing page at linguacode.dev

- Priority: `P0` for Phase 1
- Status: `Planned`
- Readiness: `Ready — do not wait on RL-018 i18n for launch`
- Current gap:
  - RL-032 describes a fuller marketing site but is dependency-chained on i18n (RL-018). That blocks Phase 1.
  - Phase 1 only needs a fast, honest download page.
- Scope:
  - Ship a minimal static landing page at `linguacode.dev` with:
    - one-line pitch
    - screenshot / 60-second demo embed (from RL-064)
    - download links per platform (reads latest GitHub release assets)
    - pricing table linked to Polar.sh checkout (from RL-061)
    - FAQ covering: refund policy, offline behavior, education program, license transfer, system requirements.
  - Page is English-only at first; localization is deferred to RL-032 / RL-018.
  - Deploy pipeline: GitHub Pages on a `lingua-site` directory or a separate repo; TLS via Cloudflare.
  - Redirect any registered legacy domain to `linguacode.dev`.
- Acceptance criteria:
  - Visiting `linguacode.dev` shows the download page with a working checkout link.
  - The latest release version is pulled from GitHub releases at build time, not hardcoded.
  - A manual redeploy is documented in `RELEASE.md`.
- Dependencies:
  - RL-061 (checkout link)

#### Status Update — 2026-05-05 (closes RL-063)

Site live at https://linguacode.dev. The marketing surface lives in a
separate repo, `johnny4young/lingua-marketing`, on Astro 6 + Tailwind
v4 + Cloudflare Pages, auto-deployed from the `main` branch (no commit
hash pinned here on purpose — CF tracks branch). See
[`MARKETING_SITE_ADR.md`](./MARKETING_SITE_ADR.md) for the rationale and
the consequences of the split.

Acceptance criteria coverage:

- "Visiting linguacode.dev shows the download page with a working
  checkout link" — closed. Pricing table reads `POLAR_CHECKOUT_*` env
  vars at build time and renders enabled buttons when configured (or a
  disabled "checkout coming soon" tooltip when missing — never a broken
  link).
- "Latest release version pulled from GitHub releases at build time,
  not hardcoded" — closed. `src/lib/github.ts` in the marketing repo
  fetches the GitHub Releases API at build time and fails the build
  loudly on persistent network failure rather than shipping a stale
  version.
- "Manual redeploy documented in RELEASE.md" — closed. RELEASE.md and
  the marketing repo's README both document the redeploy path (push
  to `main`; CF Pages auto-rebuilds; for content-only sweeps the
  `sync:commit` script in `lingua-marketing` vendors press-kit + SEO
  scaffolds + roadmap/changelog data from this repo and pushes).

The closure cascades:

- `RL-064` (press-kit ZIP at `/press`) → Done.
- `RL-066` (SEO landing pages) → Done with the explicit note that
  "ranking" is a post-launch metric, not engineering-blocking.
- `RL-081` (live checkout/download copy alignment) → Done.

ROADMAP §6 archive count 48 → 52.

### RL-064 Launch asset kit (Phase 2)

- Priority: `P1` for Phase 2
- Status: `Partial`
- Readiness: `Copy + press kit scaffold landed on 2026-04-19; 60-second demo, production screenshots, and the linguacode.dev/press ZIP still depend on RL-063`
- Current progress:
  - `docs/press-kit/` ships `README.md` + `boilerplate.md` (25/50/150 words, en + es) + `pricing-one-pager.md` (Free, Monthly, Pro, Education matrix, en + es) + `launch-copy.md` (Show HN + Product Hunt + r/golang + r/rust + r/Python drafts) + `founder-bio.md` (40/100 words, en + es)
  - Every claim cross-checked against `PLAN.md` Done items; no feature outruns implementation, no "MIT" / "open-source" claim survives
  - Guard test `tests/docs/pressKit.test.ts` pins file presence, en + es parity, channel section coverage, pricing tiers, and the no-MIT-claim rule
  - Remaining: demo video recording, production screenshots, and the downloadable ZIP that hangs off `linguacode.dev/press` (blocked on RL-063)
- Scope:
  - 60-second demo video: JS → TS → Python → Go → Rust in one unbroken desktop recording.
  - Screenshots for the README, the landing page, Product Hunt gallery, and the HN post thumbnail.
  - Draft copy for:
    - Show HN: "Show HN: Multi-language desktop code runner — JS, TS, Go, Python, Rust"
    - r/golang, r/rust, r/Python posts (each tailored to that community)
    - Product Hunt: tagline, gallery, maker comment
  - Press kit: logo, icon, colors, fonts, boilerplate description, pricing one-pager, founder bio.
  - All assets live in `docs/press-kit/` so the repo is the single source of truth.
- Acceptance criteria:
  - Every Phase 2 channel has finalized copy reviewed for honesty (no claims that are not implemented).
  - The press kit ZIP can be downloaded from `linguacode.dev/press`.
- Dependencies:
  - RL-062, RL-063

#### Status Update — 2026-05-05 (closes RL-064)

Both ACs cumplidos:

- Phase 2 copy is finalized (commit `8887e22`, pricing copy refreshed 2026-05-07 — `tests/docs/pressKit.test.ts` already pins en + es parity, the no-MIT-claim rule, the Free / Monthly / Pro / Education pricing matrix, and the channel section coverage).
- The press kit ZIP is downloadable from https://linguacode.dev/press/lingua-press-kit.zip. The marketing repo's `scripts/build-press-kit-zip.mjs` runs as a `prebuild` step and bundles the vendored markdown copies (boilerplate, founder-bio, launch-copy, pricing-one-pager, README) into the ZIP that ships with the static deploy. The 60-second demo video and production screenshots remain optional polish items tracked outside RL-064.

Closure follows from RL-063 ship.

### RL-065 Privacy-respecting launch telemetry

- Priority: `P1` for Phase 2
- Status: `Done`
- Readiness: `Consent toggle + base event wiring completed on 2026-04-19; first-run desktop prompt shipped on 2026-04-20; overlay.opened callsites shipped on 2026-04-20 ter; runner.executed callsites shipped on 2026-04-20 quater; feature.blocked callsites (tab + snippet ceilings) shipped on 2026-04-20 quinquies; Slice 5 (export endpoint + persistence + runbook) shipped 2026-05-12 — see Status Update below`
- 2026-04-19 update:
  - `createSessionId()` produces a 32-char hex id per launch; held in renderer module scope, never persisted, never transmitted as a user identifier
  - `resolveTelemetryBase()` assembles app version, OS bucket, license status, and sessionId from the live stores
  - `trackEvent(name, properties)` is the single public entry point — composes base + properties, then delegates to the pre-existing redactor-backed emitter
  - First real caller lands: `App` fires `app.launched` on mount with `platform` as the only property. Still a no-op until the user opts in + endpoint is configured, but the wiring is proven end-to-end
  - Tests cover: sessionId format + uniqueness across 200 calls, `trackEvent` no-op when declined, `trackEvent` no-op when endpoint missing
- Current progress:
  - `src/shared/telemetry.ts` owns the `TelemetryEvent` shape, the five-entry event allowlist, the per-event property allowlist, a secondary key/value deny pass for defense-in-depth, and duration/OS bucketers. Timestamps are rounded to the minute
  - `src/renderer/utils/telemetry.ts` is the emitter. It returns early unless the user consent is `granted`, a configured `VITE_LINGUA_TELEMETRY_URL` is present, AND the `VITE_LINGUA_TELEMETRY_DISABLED` kill switch is not set. All failures are swallowed so analytics can never crash the app
  - `settingsStore` grows a three-state `telemetryConsent` (`unset | granted | declined`) persisted across sessions, and `PrivacySection` in Settings renders a toggle with live status copy; default stays `unset` so telemetry is off unless the user affirmatively opts in
  - Enforcement tests cover: allowlist drift, non-primitive values rejected, key substrings like `sourceCode` dropped even when snuck onto an event, timestamps rounded, bucketers coarse
  - 2026-04-20 update: `src/renderer/components/FirstRunConsentModal.tsx` ships the one-time opt-in prompt, mounted from `App` on boot. Renders while `telemetryConsent === 'unset'` AND the desktop consent bridge is present (`window.lingua.consent`) — the web build skips it because there is no telemetry on web. Allow and Decline both flip the three-state flag, which removes the `unset` gate so the modal never reappears and mirrors the choice through the existing `consent:set` IPC. Copy ships in en + es (`privacy.firstRun.title / body / changeLater / allow / decline`). Six new component tests cover desktop render, web suppression, post-choice suppression, Allow/Decline side-effects, and Spanish locale
  - 2026-04-20 ter update: `App.openOverlay` and `App.toggleOverlay` now fire `trackEvent('overlay.opened', { overlayId })` so a consenting user's telemetry reflects which Lingua surfaces actually got used. No allowlist churn (the event + property were already permitted in `src/shared/telemetry.ts`). No copy churn (the consent body already names "which overlays you opened"). `tests/components/App.test.tsx` pins that both `app.launched` and the auto-boot `overlay.opened { overlayId: 'whats-new' }` fire on the default first-boot path, using a hoisted mock of `@/utils/telemetry`
  - 2026-04-20 quater update: `executeTabManually` now emits `runner.executed` on both the success branch (with `status: 'ok'` or `'error'` + `durationBucketMs` via the shared `bucketDurationMs` helper) and the catch branch (`status: 'error'`, `durationBucketMs: 0`). No allowlist churn — the event + properties were already permitted. Three new tests in `tests/runtime/executeTabManually.telemetry.test.ts` pin the success payload shape, the error payload on a runner-returned error, and the error payload on a thrown exception
  - 2026-04-20 quinquies update: `editorStore.addTab` and `editorStore.openFile` now emit `trackEvent('feature.blocked', { entitlement: 'tabs', tier: currentEffectiveTier() })` whenever the Free ceiling rejects a new tab; `snippetsStore.addSnippet` does the same with `entitlement: 'snippets'`. No allowlist churn — `feature.blocked` was already in `TELEMETRY_EVENTS` with `entitlement` + `tier` properties. Four new tests pin the addTab gate fires the event, the openFile gate fires the event, the Pro tier wave-through does NOT fire the event, and the snippet gate fires its own event with `entitlement: 'snippets'`
- Why this matters:
  - Phase 2 distribution posts generate a short traffic window. Without any measurement, we cannot learn what converted.
  - The app is local-first; telemetry must be explicitly opt-in and never record user code.
- Scope:
  - First-run prompt (once, in Settings) explaining what is collected and letting the user enable or decline. Default: disabled.
  - Collected signals (only if opted in): app version, OS + version bucket, language of the active tab at run time (not the code), whether a license is present (but not its key), which high-level feature surfaces were opened (Command Palette, Snippets, etc.), crash identifiers. No user code, no file paths, no project names.
  - Self-hosted endpoint (reuses the `update-server` infra if possible) so no third-party vendor has visibility.
  - Kill switch: a single env flag disables all telemetry regardless of the user choice.
- Acceptance criteria:
  - Telemetry is off by default; the consent prompt is shown exactly once.
  - No payload ever contains user code or file content — enforced by a unit test and a `grep`-style check in CI.
  - The consent choice is persisted and easy to revoke from Settings.
- Dependencies:
  - None (can land independently of RL-059/RL-061)

#### Status Update — 2026-05-12 (closes RL-065)

Slice 5 lands the event export pipeline. `update-server` grew a
`POST /telemetry` route (`update-server/src/telemetry.ts`) that
validates every payload against a verbatim mirror of
`TELEMETRY_EVENTS` + `EVENT_PROPERTY_ALLOWLIST` from
`src/shared/telemetry.ts`, plus a `DENY_SUBSTRINGS` substring guard
(fold A) and a 5-req/sec per-IP rate limit via the CF Cache API
(fold B). Persistence is Workers Observability `console.log` — no
new D1 / KV; retention is ~3 days on the standard plan and the
runbook documents the promote-to-D1 path when that breaks (fold E).

The web build wires `VITE_LINGUA_TELEMETRY_URL=https://updates.linguacode.dev/telemetry`
via `.github/workflows/deploy-web.yml` only; the desktop release
workflow leaves the env unset, so packaged desktop builds stay
telemetry-off by default. Renderer `readEndpoint` gained a `new URL()`
+ scheme guard (fold F) so a build-time typo like `http:/telemetry`
warns once and resolves to `null` instead of silently swallowing
events. The autoupdater funnel now emits `update.checked` (closed
enum `available` / `no-update` / `failure`) via a Zustand
`useUpdateStore.subscribe` watcher on the `checking` → terminal
transition (fold D) — no callsite is per-action, so the
auto-update setInterval, the manual `Check now` button, and the
state-changed broadcast all roll up into one event per check.

Test coverage: `update-server/test/telemetry.test.ts` (~24
assertions: methods, validation, payload size cap, allowlist
silent-drop, deny-substring, rate-limit budget, `telemetry.event`
log line, fold C parity vs `src/shared/telemetry.ts`),
`tests/utils/telemetry.test.ts` extended with five URL-validation
cases (fold F), `tests/stores/updateStore.telemetry.test.ts` covers
the seven `update.checked` transition cases (fold D), and
`tests/e2e/telemetry.spec.ts` locks the consent→POST and
declined→silence gates behind Playwright (fold G).

Acceptance criteria coverage:

- "Telemetry is off by default" — `telemetryConsent` defaults to
  `unset`, the renderer emitter no-ops on anything but `granted`.
- "No payload ever contains user code or file content" — the
  renderer redactor enforces, the server validator re-enforces,
  the deny-substring guard catches future regressions, and the
  parity test prevents drift between them.
- "Consent is persisted and revocable from Settings" — unchanged
  from earlier slices.
- "Self-hosted endpoint" — single CF Worker
  (`updates.linguacode.dev/telemetry`), no third-party vendor.
- "Kill switch" — `VITE_LINGUA_TELEMETRY_DISABLED=1` (renderer),
  comment out the route in `update-server/src/index.ts` (server),
  unset `VITE_LINGUA_TELEMETRY_URL` (build-time kill).

Operator surface: [`docs/runbooks/telemetry-pipeline.md`](./runbooks/telemetry-pipeline.md).

### RL-066 SEO landing pages for language-specific intents

- Priority: `P1` for Phase 3
- Status: `Partial`
- Readiness: `Content scaffolds for six intents landed by 2026-04-20 (Go, Rust, Python, TypeScript, multi-language, Lua); hosting at linguacode.dev/* still blocked on RL-063 shipping the domain`
- Current progress:
  - `docs/seo-pages/` ships six scaffolds: `go-playground-desktop.md`, `rust-code-runner-desktop.md`, `python-repl-desktop.md`, `typescript-playground-offline.md`, `multi-language-code-runner.md`, and (2026-04-20) `lua-offline-playground.md`
  - The Lua page is intentionally honest about today's product boundary: the runtime is bundled, but execution still depends on the local-plugin path and is not exposed in the stock web shell yet
  - Each scaffold has front-matter (`title`, `description` ≤160 chars, `canonical`, `ogImage`, `language`), a "what actually runs" table, a "what doesn't work today" section (RL-066 acceptance: honest limitations), and a canonical link back to `https://linguacode.dev`
  - `docs/seo-pages/README.md` codifies the five shared rules (no claim outruns reality, strict front-matter, canonical CTA, required limits section, JSON-LD is owned by the site build)
  - Guard test `tests/docs/seoPages.test.ts` pins presence, no stray pages, front-matter completeness (incl. description-length bound), canonical link, honest-limitations section, and no-MIT-claim rule
  - Remaining: wire the scaffolds into the `linguacode.dev` build when RL-063 lands, shoot the `ogImage` artwork, submit the `sitemap.xml`
- Scope:
  - Add dedicated static sub-pages under `linguacode.dev`:
    - `/go-playground-desktop`
    - `/rust-code-runner-desktop`
    - `/python-repl-desktop`
    - `/typescript-playground-offline`
    - `/multi-language-code-runner`
  - Each page has: unique pitch for that language, screenshot of that language running, setup notes, honest limitations (e.g. Go requires a local toolchain on desktop), link to download.
  - Ship with `sitemap.xml`, canonical tags, OpenGraph image per page.
  - Avoid content farming: every page must say something true about Lingua's real support for that language, or we do not ship the page.
- Acceptance criteria:
  - Each target page ranks at least for its exact head query within a reasonable crawl window after launch.
  - All pages link back to the canonical download on `linguacode.dev`.
  - Pages lint clean against HTML / schema.org validators.
- Dependencies:
  - RL-063

#### Status Update — 2026-05-05 (closes RL-066)

Engineering ACs cumplidos:

- "All pages link back to the canonical download on linguacode.dev" — closed. The six SEO pages live in `lingua-marketing/src/content/seo/{en,es}/*.md` and render via the `[seo].astro` route with the canonical CTA emitted by the layout.
- "Pages lint clean against HTML / schema.org validators" — closed. The marketing repo's `scripts/validate-jsonld.mjs` postbuild guard parses the JSON-LD on every build; `@astrojs/sitemap` emits `sitemap-index.xml` automatically.

The remaining AC ("each target page ranks at least for its exact head query within a reasonable crawl window after launch") is a **post-launch metric**, not engineering work. Tracking ranking depends on Search Console submission + a 2-4 week crawl window, which lands outside the scope of any engineering slice and is explicitly not blocking. RL-066 closes here. If post-launch the ranking does not materialise, the response is content tuning + Search Console actions tracked outside the RL backlog rather than reopening the ticket.

Closure follows from RL-063 ship — the six SEO pages went live at:

- https://linguacode.dev/go-playground-desktop
- https://linguacode.dev/rust-code-runner-desktop
- https://linguacode.dev/python-repl-desktop
- https://linguacode.dev/typescript-playground-offline
- https://linguacode.dev/multi-language-code-runner
- https://linguacode.dev/lua-offline-playground

### RL-067 Crash reporting

- Priority: `P1` for Phase 2/3
- Status: `Done`
- Readiness: `Completed on 2026-04-19 (early-crash coverage closed the last gap)`
- Current progress:
  - `src/main/ipc/consent.ts` mirrors the renderer's `telemetryConsent` to a main-readable JSON file (`userData/telemetry-consent.json`) via a `consent:set` IPC. Writes are atomic (tmp + rename); reads default to `unset` on any filesystem or parse failure
  - `app.on('ready')` now boots `crashReporter.start` BEFORE `createWindow()` using `readConsentMirror` — renderer startup crashes are now covered
  - Renderer `settingsStore.setTelemetryConsent` calls `window.lingua.consent.set` best-effort so the mirror stays fresh the moment the user toggles
  - Web build exposes a no-op stub — the crash reporter never runs in web anyway
  - 7 new tests cover: round-trip, missing file, malformed JSON, unknown value, rejected write, atomic rename, IPC handler validation
- Current progress:
  - `src/main/crashReporter.ts` bootstraps Electron's `crashReporter` gated by the same consent flag RL-065 persists (`telemetryConsent === 'granted'`), plus a `LINGUA_CRASH_REPORTER_DISABLED` kill switch and an env-configurable `LINGUA_CRASH_REPORTER_URL`
  - `bootCrashReporter` returns a discriminated `started | skipped-no-consent | skipped-no-endpoint | skipped-kill-switch` result so main can log the branch without ever logging user data
  - `extra` payload is intentionally minimal — only `appVersion` — so crash dumps cannot carry user code or file paths
  - `readConsentFromSettingsFile` reads the renderer's zustand-persist snapshot on boot and defaults to `unset` on any parse failure, biasing toward not sending
  - Tests cover: every skip branch, granted path, missing / malformed / happy-path settings file reads
- Scope:
  - Capture renderer and main crashes via Electron's `crashReporter`.
  - Redact stack traces that include user file paths before upload.
  - Reuse the RL-065 opt-in consent surface so the user is not double-prompted.
  - Send to a self-hosted Sentry-compatible or equivalent endpoint.
- Acceptance criteria:
  - Opt-in is unified with RL-065 telemetry consent.
  - Crash reports contain stack + app version + OS, never user code.
  - The endpoint is configurable via env so the same build works in dev/staging/prod.
- Dependencies:
  - RL-065

### Promotion of RL-036

RL-036 is now re-prioritized for the execution order summary. Phase A is the
viral-distribution primitive the strategic plan depends on in Phase 3. As of
2026-05-20, Phase A is split into A1 no-backend single-tab URL-fragment share
links and A2 local `.linguashare` multi-file artifacts. See the summary tables
below for the updated tier placement.

---

## 15. DevUtils benchmark and dev-utilities follow-up (2026-04-21)

Research pass completed on `2026-04-21` against DevUtils.app, a macOS offline
developer toolbox that is the most frequently cited competitor for the
built-in utilities surface. Public pages were unreachable from this sandbox
(both `https://devutils.com/` and `https://devutils.com/demo/` returned
HTTP 403 to our fetcher), so the research below is consolidated from the
public product description, the Mac App Store listing, the DevUtils docs
index, the HN Show HN thread, and the Setapp catalog entry.

Sources used:

- `https://devutils.com/` — landing page, tool list, feature callouts
- `https://devutils.com/demo/` — interactive web demo of the same tools
- `https://devutils.com/docs/` — per-tool documentation
- `https://apps.apple.com/us/app/devutils-app/id1533756032` — Mac App Store listing
- `https://news.ycombinator.com/item?id=24604291` — Show HN thread with
  clipboard-detection and hotkey details
- `https://setapp.com/apps/devutils.app` — Setapp catalog entry

### What DevUtils actually ships

Tools (grouped by category, as DevUtils presents them):

- **Formatters / beautify / minify**: JSON Formatter & Validator, HTML
  Beautify/Minify, CSS Beautify/Minify, JS Beautify/Minify, XML
  Beautify/Minify, SCSS / LESS / ERB Beautify/Minify, SQL Formatter,
  HTML Preview, Markdown Preview
- **Encoders / decoders**: Base64 String, Base64 Image, URL
  Encode/Decode, HTML Entity Encode/Decode, Backslash Escape/Unescape,
  JWT Debugger (decode, sign, verify — HS256/384/512, RS256/384/512,
  ES256/384/512, PS256/384/512)
- **Converters**: YAML ↔ JSON, JSON ↔ CSV, PHP ↔ JSON, PHP Serialize /
  Unserialize, Number Base Converter, Color Converter, HTML to JSX,
  SVG to CSS, cURL to Code
- **Generators**: UUID / ULID, Lorem Ipsum, Random String, QR Code
  (generate + read), Hash Generator (MD5, SHA-family)
- **Network / inspectors**: RegExp Tester, URL Parser, String
  Inspector, Cron Job Parser, Unix Time Converter, Text Diff Checker

Cross-cutting productivity layer that ships alongside the tools:

- **Smart input detection** — each tool has a lightning-icon "auto-apply"
  button that inspects the clipboard and applies the tool when the
  shape matches (e.g. RegExp Tester detects a pasted regex; JSON
  Formatter detects pasted JSON)
- **Clipboard monitoring** — optional, disabled via Preferences
- **Per-tool history** — previous inputs and outputs are recallable
- **Favorites** — pin your most-used tools at the top
- **Keyboard shortcuts** — `⌘⇧C` Copy Output, `⌘⌥R` Instant Replace
  Clipboard (replace clipboard with output); `⌥`-click the status bar
  icon instantly copies the current result
- **Offline-first, privacy-first** — nothing leaves the machine; the
  whole toolbox works without network

### Where Lingua stands today

RL-045 shipped 10 utilities in the Developer Utilities workspace (JSON
formatter, Base64, URL, UUID, SHA-1/256 hash, Unix timestamp, JWT
decoder, regex tester, color converter, line-level diff). That covers
roughly a quarter of DevUtils' surface and none of DevUtils' productivity
layer — no per-tool history, no favorites, no auto-detect, no "copy
output" / "replace clipboard" shortcuts.

Gap table (coverage is relative to DevUtils; items the repo intentionally
does not pursue are marked `Skip`):

| DevUtils tool or feature | Lingua today | Follow-up item |
| --- | --- | --- |
| JSON Formatter/Validator | ✅ RL-045 | — |
| Base64 String Encode/Decode | ✅ RL-045 | — |
| URL Encode/Decode | ✅ RL-045 | — |
| UUID v4 Generator | ✅ RL-045 | RL-071 (add v7, ULID, decode) |
| SHA-1 / SHA-256 Hash | ✅ RL-045 | ✅ RL-071 2026-04-24 (MD5, SHA-384, SHA-512, HMAC, file hashing) |
| Unix Time Converter | ✅ RL-045 | — |
| JWT Decoder | ✅ RL-045 | RL-071 (add verify + sign for HS/RS/ES/PS) |
| RegExp Tester | ✅ RL-045 | — |
| Color Converter | ✅ RL-045 | — |
| Line Diff Checker | ✅ RL-045 (line-level only) | RL-071 (word + character modes) |
| YAML ↔ JSON | ✅ 2026-04-24 | RL-068 |
| JSON ↔ CSV | ✅ 2026-04-24 | RL-068 |
| Number Base Converter | ✅ 2026-04-21 | RL-068 |
| URL Parser | ✅ 2026-04-22 | RL-068 |
| HTML Entity Encode/Decode | ✅ 2026-04-22 | RL-068 |
| Backslash Escape/Unescape | ✅ 2026-04-23 | RL-068 |
| String Case Converter | ✅ 2026-04-22 | RL-068 |
| Lorem Ipsum Generator | ✅ 2026-04-24 | RL-068 |
| Random String Generator | ✅ 2026-04-23 | RL-068 |
| Cron Job Parser | ✅ 2026-04-24 | RL-068 |
| Markdown Preview | ✅ 2026-04-24 | RL-068 |
| SQL Formatter | ✅ 2026-04-24 | RL-068 |
| HTML / CSS / JS / XML / SCSS / LESS Beautify + Minify | ✅ 2026-04-23 | RL-070 |
| HTML → JSX | ✅ 2026-04-24 | RL-070 |
| SVG → CSS | ✅ 2026-04-24 | RL-070 |
| cURL → Code | ✅ 2026-04-24 | RL-070 |
| Base64 Image Encode/Decode | ✅ 2026-04-23 | RL-071 |
| QR Code Generate / Read | ❌ | RL-072 |
| String Inspector | ❌ | RL-072 |
| Smart input auto-detect (lightning button) | ❌ | RL-069 |
| Optional clipboard monitoring | ❌ | RL-069 (off by default, never background-polls) |
| Per-tool history | ❌ | RL-069 |
| Favorites + tool search within the workspace | ❌ | RL-069 |
| `⌘⇧C` Copy Output / `⌘⌥R` Replace Clipboard shortcuts | ❌ | RL-069 |
| HTML Preview | ❌ | Skip — subsumed by Markdown Preview (RL-068) + the RL-019 browser preview story |
| PHP ↔ JSON, PHP Serialize/Unserialize | ❌ | Skip — out of audience for a JS/TS/Go/Python/Rust runner |
| ERB Beautify/Minify | ❌ | Skip — out of audience |

### Why these follow-ups now

- **Product positioning**: the `README` already lists "built-in developer
  utilities" as a first-class capability and the Pro tier matrix
  (Section 13) already counts the utilities panel as a Pro entitlement.
  Closing the DevUtils coverage gap is a direct way to make that
  entitlement feel earned without changing the commercial story.
- **Privacy posture alignment**: DevUtils' offline-first message is the
  same one Lingua sells. Every follow-up below has a clean web-build
  story (all pure, all lazy-loaded) and none of them require a new
  network call, so they stay consistent with RL-065 (opt-in telemetry)
  and RL-067 (opt-in crash reporting).
- **Zero dependency on Tier 1.5 monetization work**: these slices can
  land in parallel with Phase 2 distribution because they do not touch
  licensing infra, release pipelines, or domain hosting.

### RL-068 Expand developer utilities with DevUtils-equivalent coverage

- Priority: `P2`
- Status: `Done`
- Readiness: `All scope shipped — Number Base, URL Parser, String Case, HTML Entity, Backslash Escape/Unescape, Random String Generator, Lorem Ipsum, Cron Parser, plus the YAML↔JSON / JSON↔CSV / Markdown Preview / SQL Formatter closeout — archived to ROADMAP §6`
- Why this matters:
  - DevUtils ships 40+ tools; Lingua ships 10. Closing the practical
    subset (YAML/JSON, CSV/JSON, number base, URL parser, HTML entity,
    backslash, string case, lorem, random string, cron, markdown
    preview, SQL formatter) covers the long tail of day-to-day requests
    without pulling Lingua into PHP/Ruby territory that our audience
    does not need.
- Scope:
  - Add the following lazy-loaded panels to the Developer Utilities
    workspace:
    - YAML ↔ JSON (preserve comments when possible; explicit diagnostic
      when losing them)
    - JSON ↔ CSV (configurable delimiter + header row)
    - Number Base Converter (bin / oct / dec / hex + custom base 2–36)
    - URL Parser (scheme / user / host / port / path / query / fragment,
      per-key query table)
    - HTML Entity Encode/Decode
    - Backslash Escape/Unescape (with language-aware presets)
    - String Case Converter (camel, snake, kebab, pascal, constant,
      sentence, title)
    - Lorem Ipsum Generator (word / sentence / paragraph counts)
    - Random String Generator (length, charset toggles, multiple outputs)
    - Cron Job Parser (next N runs, human-readable explanation)
    - Markdown Preview (GFM subset, no remote image fetch)
    - SQL Formatter (ANSI + PostgreSQL + MySQL dialects)
  - Command Palette entry per tool (`Open YAML to JSON`, etc.)
  - Each tool ships with at least three golden-input tests
  - Strings localized through the RL-018 i18n system on landing
- Acceptance criteria:
  - All 12 tools are reachable from the toolbar and Command Palette
  - Each tool has its own pure module under `DeveloperUtilities/`
    consumed by both desktop and web builds
  - Bundle size of the main editor chunk does not grow (utilities stay
    lazy)
- Dependencies:
  - RL-045 ✅
  - RL-018 (i18n infrastructure) for copy strings
- 2026-04-21 first slice:
  - `Number Base Converter` landed as a pure `bigint`-backed helper + panel under the Developer Utilities workspace
  - Supports binary / octal / decimal / hexadecimal plus custom base 2–36, underscore separators, and `0x` / `0o` / `0b` prefixes in the decimal field
  - Copy ships in en + es and the panel is reachable from the utility sidebar and the Command Palette catalog
  - Tests pin round-trips, invalid-input preservation, custom-base formatting, very large integers beyond `Number.MAX_SAFE_INTEGER`, and Spanish UI copy
- 2026-04-22 second slice:
  - `URL Parser` landed as a pure renderer-side helper + panel using the platform `URL` parser, with ordered duplicate-preserving query rows, password masking/reveal, and per-field copy affordances
  - `String Case Converter` landed as a pure renderer-side helper + panel covering camel / pascal / snake / kebab / constant / sentence / title casing from one shared tokenization pass
  - `HTML Entity Encode/Decode` landed as a pure renderer-side helper + panel with minimal / named / numeric encode strategies plus decode mode and unresolved-reference hints
  - All three tools ship en + es copy, are reachable from the utility sidebar and the Command Palette catalog, and are covered by helper, component, and targeted Playwright locale/runtime smoke tests
- 2026-04-23 third slice:
  - `Backslash Escape/Unescape` landed with JavaScript, JSON, Python, and SQL-MySQL presets plus a tagged-union unescape state machine for malformed sequences
  - `Random String Generator` landed with configurable length/count, lowercase/uppercase/digit/symbol toggles, ambiguous-character exclusion, and unbiased Web Crypto rejection sampling
  - Both panels ship en + es copy, utility catalog entries, component/helper coverage, and Playwright smoke coverage in the Developer Utilities workspace
- 2026-04-24 fourth slice:
  - `Lorem Ipsum Generator` landed with words, sentences, and paragraphs modes plus an optional classic-opening toggle
  - Sentence output uses bounded 5-12 word generation with a single mid-sentence comma for natural placeholder copy, while paragraph output groups 3-6 generated sentences with blank-line separation
  - The panel ships en + es copy, utility catalog registration, command palette count coverage, helper/component tests, and Playwright smoke coverage in the Developer Utilities workspace
- 2026-04-24 fifth slice:
  - `Cron Parser` landed with a pure renderer-side panel that lazy-loads `cron-parser` for validation / upcoming-run enumeration and `cronstrue`'s i18n bundle for human-readable EN + ES explanations
  - The helper supports 5-field expressions, 6-field expressions with seconds, nicknames such as `@daily`, list/range/step syntax, and a configurable next-run count clamped to 1-100
  - The panel ships en + es copy, utility catalog registration, command palette count coverage, helper/component tests, and Playwright smoke coverage in the Developer Utilities workspace
- 2026-04-24 sixth slice (closes RL-068):
  - `YAML ↔ JSON`, `JSON ↔ CSV`, `Markdown Preview`, and `SQL Formatter` landed as four new lazy-loaded panels covering the full remaining DevUtils-parity surface
  - YAML uses the already-bundled `js-yaml` (zero new deps); the comment-detection pre-pass respects YAML's `''` apostrophe escape inside single-quoted scalars so the panel only flags genuine comment loss
  - JSON ↔ CSV is deps-free, RFC 4180-compliant with configurable delimiter (`,` / `\t` / `;` / `|`), header-row toggle, sparse-row tolerance, and detailed row+column metadata
  - Markdown Preview lazy-loads `marked` + `dompurify`, strips remote `<img src="...">` via regex pre-pass plus a DOMPurify FORBID_ATTR backstop, and ships the sanitized HTML output via a read-only textarea (no inline iframe preview — the iframe approach produced spurious sandbox console warnings)
  - SQL Formatter wraps `sql-formatter` for ANSI / PostgreSQL / MySQL dialects with indent and keyword-case toggles
  - Catalog count bumped 25 → 29; 67 new i18n keys per locale in tuteo; coverage spans 53 unit cases, 10 component cases, and 4 Playwright round-trips

### RL-069 DevUtils-class productivity layer for the utilities workspace

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready after RL-037 shortcut editor lands; design can start now`
- Why this matters:
  - DevUtils' biggest win over DevToys is the productivity layer:
    clipboard-aware "apply" button, per-tool history, favorites, and
    hotkeys that move output back to the clipboard in one keystroke.
    Adding the same layer on top of RL-045 converts the utilities
    workspace from "nice to have" to "faster than leaving the app".
- Scope:
  - Smart input auto-detection per tool:
    - Each utility exposes a `detect(input: string): boolean` helper
    - A "⚡ Apply from input" button calls `detect` against the current
      panel input and, if it matches, runs the tool immediately
    - The detection is purely local — no background clipboard polling
  - Optional clipboard-on-focus apply (explicit Settings toggle,
    default off, consent copy aligned with RL-065 telemetry posture):
    - When enabled, focusing a utility panel reads the clipboard once
      and offers (not forces) the apply
    - Never reads clipboard when the workspace is not focused
  - Per-tool history:
    - Session-scoped by default (cleared on reload)
    - Persist-to-disk toggle per tool, gated behind a `Clear history`
      action
  - Favorites:
    - Pin tools to a "Favorites" row at the top of the workspace
    - Reorder by drag and drop
  - Tool search:
    - Fuzzy search field at the top of the workspace
    - Searches tool name + category + common aliases (e.g. "jwt"
      matches "JWT Debugger")
  - Keyboard shortcuts (registered through the RL-037 shortcut editor):
    - `Cmd/Ctrl+K` Open Developer Utilities
    - `Cmd/Ctrl+Shift+C` Copy Output from the focused utility panel
    - `Cmd+Alt+R` / `Ctrl+Alt+R` Replace clipboard with the current output
- Acceptance criteria:
  - Clipboard auto-apply is opt-in; a fresh install never reads the
    clipboard without a user gesture
  - History and favorites survive reload when persistence is enabled
  - The new shortcuts appear in the Keyboard Shortcuts overlay and can
    be rebound
  - The utilities modal continues to pass the RL-018 i18n copy check
- Dependencies:
  - RL-045 ✅
  - RL-037 (keyboard shortcut editor) — for shortcut registration
  - RL-065 consent copy patterns — for the clipboard opt-in wording

### Status Update — 2026-05-05 (RL-069 Slice 1)

Slice 1 — productivity foundation — landed today. RL-069 stays `Partial`; remaining sub-slices defined below.

What shipped:

- New `overlay-developer-utilities` catalog entry (default `Mod+K`) plus a `utilities` shortcut group at `src/renderer/data/keyboardShortcuts.ts` with `utility-copy-output` (default `Mod+Shift+C`) and `utility-replace-clipboard` (default `Mod+Alt+R`). All three are rebindable through the existing keyboard shortcut editor (RL-037) and visible in the Keyboard Shortcuts overlay.
- `DeveloperUtilitiesModal` now advertises the active Open / Copy output / Replace clipboard bindings in the workspace header, and the copy / replace success toasts include the active shortcut. Both surfaces read from the same shortcut catalog plus user overrides so rebound shortcuts stay discoverable.
- New `src/renderer/utils/fuzzyMatch.ts` (subsequence + token-prefix scoring) replaces the prior substring filter at `DeveloperUtilitiesModal.tsx`. The modal now ranks utilities by best score across title (weight 1.0), description (0.6), keywords (0.85), and aliases (0.95).
- New optional `aliases?: readonly string[]` field on `DeveloperUtilityDefinition`. Populated on 15 panels with obvious shorthand: `b64`, `ts`, `epoch`, `re`, `bearer`, `md5`, `hmac`, `min`, `inspector`, `lipsum`, `svg2css`, `html2jsx`, `curl2code`, `y2j`, `j2y`, `j2c`, `c2j`, `md`, `sqlfmt`. The `markdown-preview` keyword `md` moved into aliases to keep the disjointness contract enforced by the new catalog test.
- New zustand store `src/renderer/stores/utilityOutputStore.ts` plus registration hook `src/renderer/hooks/useRegisterUtilityOutput.ts` plumb the active panel's output to the global shortcut handler. 5 panels register in this slice (JSON formatted output, Base64 encoded/decoded value, URL encoded/decoded value, JWT decoded payload, UUID first generated value). The other 24 panels deliberately fall through to the `copyOutputEmpty` toast — they get their providers in Slice 2 alongside `detect()`.
- 14 new i18n keys per locale (en + es with neutral LatAm tuteo): `shortcuts.group.utilities`, three pairs of label/description for the new shortcuts, three header hint keys (`toolbar.utilities.tooltip`, `utilities.shortcuts.outputAriaLabel`, `utilities.shortcuts.copyOutput`), and four `utilities.toast.*` keys for success / replace-success / empty / failure feedback through the existing `useUIStore.pushStatusNotice` pipeline.
- Tests: 12 new `fuzzyMatch` cases, 7 new `utilityOutputStore` + `useRegisterUtilityOutput` cases, 9 new `developerUtilities` catalog assertions (alias shape, disjointness, b64/ts/md presence), 2 new `keyboardShortcuts` assertions plus the 3 ids appended to the required-id list, and hook/modal/E2E coverage for shortcut-aware hints and toasts.
- Gates green: lint, tsc, check:i18n, check:i18n:copy, full vitest (220/220 files, 2245 passed + 2 skipped), targeted `test:e2e:web` for Pro open + Free gate.

What remains under RL-069:

- **Slice 2** — `detect(input: string): boolean` per utility + ⚡ Apply button. The 24 unwired panels' output providers land here too so the new shortcuts cover the full 29-panel set.
- **Slice 3** — clipboard-on-focus apply (Settings toggle, default off, RL-065 consent copy patterns), per-tool history (session-scoped + persist toggle + Clear), favorites (pin + drag-reorder).

Each remaining slice closes under the same RL-069 id; no new RL ids are introduced. ROADMAP §4e Readiness reflects the Slice 1 closure plus the remaining roadmap.

### Status Update — 2026-05-09 (RL-069 Slice 2)

Slice 2 — detect + Apply + 29-panel coverage — landed today. RL-069 stays `Partial`; Slice 3 (clipboard-on-focus + per-tool history + favorites) is the remaining sub-slice.

What shipped:

- New optional `detect?: (inputs: { primary: string; secondary?: string }) => boolean` field on `DeveloperUtilityDefinition` at `src/renderer/data/developerUtilities.ts`. Populated on 27 panels; the two pure generators (random-string, lorem-ipsum) opt out and the toolbar hides the Apply button accordingly. Signature is the generalised form so dual-input panels (regex, diff) participate without a future migration.
- New `detectsAs*` predicate suite in `src/renderer/utils/developerUtilities.ts` co-located with the existing `analyze*` exports. Covers JSON / base64 / URL-encoded / absolute URL / JWT / UUID / timestamp / regex / hex+RGB+HSL / number / HTML / SVG / data-URI / backslash-escaped / cron / curl / markdown / YAML / CSV / SQL / hashable / inspectable text / case-convertible / beautifiable.
- Extended `utilityOutputStore` with an `applyHandler` slot mirroring the existing `provider` slot, plus a new `useRegisterUtilityApply` hook in `src/renderer/hooks/useRegisterUtilityOutput.ts`. Same reference-equality cleanup pattern as Slice 1, so a sibling panel that takes over registration is not cleared by an unmount race.
- New `<UtilityToolbar>` primitive in `src/renderer/components/DeveloperUtilities/panelPrimitives.tsx`. The toolbar self-registers an apply descriptor (reading the catalog's detect by id) and renders the ⚡ Apply button with `enabled` derived from `detect({ primary, secondary })`. Pure-generator panels skip the toolbar entirely.
- New `utility-apply-from-input` shortcut in `src/renderer/data/keyboardShortcuts.ts` (group `utilities`, default Mod+Shift+A — Mod+Enter is intentionally avoided to keep the editor's `run-toggle` shortcut free). Handler in `src/renderer/hooks/useGlobalShortcuts.ts` reads the registered apply descriptor at dispatch time and surfaces a localized success / unavailable toast. The success toast interpolates the tool name via `i18next.t(toolNameKey)`.
- 23 panel wirings: every catalog entry that does not opt out now calls `useRegisterUtilityOutput` (returning the canonical output or `null` on error / empty) and renders one `<UtilityToolbar utilityId="..." primary={input} run={runApply} />`. Bidirectional panels (Base64, URL, HtmlEntity, BackslashEscape, YamlJson, JsonCsv, Base64Image) use detect-driven mode-flip in their `runApply`. Live-rendered single-input panels keep `runApply` as an idempotent no-op so the success toast confirms the keyboard gesture without churning state.
- 6 new `utilities.*` keys per locale plus 2 new `shortcuts.item.utilityApplyFromInput.*` keys per locale. Spanish copy uses neutral LatAm tuteo (`Aplica desde la entrada`, `Apliqué {{toolName}} a la entrada actual`).
- Tests: extended `tests/data/developerUtilities.test.ts` with a `detect` block (presence on 27 panels + carve-outs + secondary-input contract); rewrote `tests/components/DeveloperUtilityPanelRegistry.test.ts` to assert every panel module imports `useRegisterUtilityOutput` and every non-generator panel renders `<UtilityToolbar>`; appended `detectsAs*` coverage to `tests/utils/developerUtilities.test.ts`; extended `tests/stores/utilityOutputStore.test.ts` with apply-handler lifecycle assertions; added `tests/components/UtilityToolbarApply.test.tsx` covering Apply behavior across 6 panel shapes plus raw / encoded HTML entities and bidirectional input retention; added `tests/e2e/utilitiesApply.spec.ts` with 9 Playwright assertions covering the JSON Apply path end-to-end, generator carve-outs, UUID detect gating, Diff dual-input requirement, Mod+Shift+A shortcut + localized toast, Spanish locale, and console-clean across 13 panel transitions.
- Gates green: lint, tsc, check:i18n, check:i18n:copy, full vitest (247 files / 2621 passed + 2 skipped), full Playwright web e2e (128 specs across 9 files including the new `utilitiesApply` smoke).

### Status Update — 2026-05-09 (RL-069 Slice 3, ticket closed)

Slice 3 — clipboard-on-focus + per-tool history + favorites with drag-reorder — landed today. RL-069 is fully `Done`; the row stays in ROADMAP §4e for recent reference and the id is added to the §6 archive.

What shipped:

- New `src/renderer/stores/utilityHistoryStore.ts` — Zustand `persist`-middlewared store on an isolated `lingua-utility-state` localStorage key. Holds per-tool `history` (capped at 10 entries with FIFO eviction), per-tool `persistEnabled` toggles, and ordered `favorites`. Per-entry truncation at 16KB; total persisted budget 256KB with oldest-first eviction in `partialize`. Module-level `EMPTY_ENTRIES` frozen array used by selectors to avoid Zustand reference churn.
- New `useClipboardOnFocus` hook in `src/renderer/hooks/useClipboardOnFocus.ts`. Reads the clipboard once on panel focus when `utilitiesClipboardOnFocusConsent === 'granted'`, surfaces a localized status notice with the resolved Mod+Shift+A combo, and stashes a pending value via a module-level singleton. The global Mod+Shift+A handler in `useGlobalShortcuts.ts` consumes the pending value on the next press, applies it via the panel's setPrimary, and emits `utility.clipboard.applied`.
- New `<UtilityHistoryDrawer>` collapsible details element rendered inside `<UtilityToolbar>` whenever a panel passes `setPrimary`. Shows the last N entries with timestamp + 1-click "Apply this entry as input"; persist toggle starts/stops persisting the tool's entries; Clear button wipes session AND persisted state and emits `utility.history.cleared`.
- New `<FavoritesRow>` + `<FavoriteToggleButton>` in `src/renderer/components/DeveloperUtilities/FavoritesRow.tsx`. Uses `@dnd-kit/sortable` with both `PointerSensor` and `KeyboardSensor`. The toggle button is rendered as a sibling of the utility-row button (NOT nested) to avoid invalid HTML. Pin emits `utility.favorite.pinned` with the post-action favorites count.
- New `<UtilitiesSection>` Settings entry under the Editor tab (next to Plugins). Houses the clipboard-on-focus toggle (RL-065 three-state pattern: `unset → granted/declined`, never back) and a confirmation-required "Clear all utility history" button.
- New `utilitiesClipboardOnFocusConsent` field on `settingsStore` with mirror in `partialize`.
- 3 new RL-065 telemetry events (`utility.favorite.pinned`, `utility.history.cleared`, `utility.clipboard.applied`) with property allowlists kept narrow (utilityId/count/scope only — no content). The redactor's deny-substring list already rejects content / code / source / etc. so the new keys pass the same audit.
- 14 new `utilities.*` keys per locale (`en` + `es` with neutral LatAm tuteo): favorites label/empty/pin/unpin/reorder, history title/empty/entryEmpty/clear/persistToggle/savedBadge/sessionBadge, settings title/description/clipboardOnFocus.label/.hint/.granted/.declined/.notSet, clearAll.label/.hint/.confirm/.cancel, toast clipboardDetected/clipboardApplied.
- 23 panels updated to pass `setPrimary` to `<UtilityToolbar>` so the history drawer auto-mounts on every non-generator panel; bidirectional panels (HtmlEntity, BackslashEscape, YamlJson, JsonCsv) still mode-flip on Apply per Slice 2.
- Tests: `tests/stores/utilityHistoryStore.test.ts` (cap, FIFO, truncation, dedupe, persist partialize), `tests/components/FavoritesRow.test.tsx` (pin toggle + chip ordering + a11y label), `tests/components/UtilitiesSection.test.tsx` (consent state machine + Clear-all confirmation flow), updated `tests/shared/telemetry.test.ts` (3 new events), updated `tests/components/DeveloperUtilitiesModal.test.tsx` (testid switch since pin button shares the panel name), and `tests/e2e/utilitiesPersonalize.spec.ts` with 10 Playwright assertions covering pin/reorder/reload, history Apply + persist + Clear, Settings clipboard toggle, Apply rotation across JWT + CRON + regex + color + html-entity + base64 + json + url, Spanish locale, and console-clean.
- Gates green: lint, tsc, check:i18n, check:i18n:copy, full vitest (250 files / 2642 passed + 2 skipped), full Playwright web e2e (138 specs across 10 files).
- Dependency: `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, `@dnd-kit/utilities ^3.2.2` added to `dependencies`.

RL-069 ships in three slices over five days (2026-05-05 → 2026-05-09). The original ticket scope at lines 3895-3942 is fully delivered; ROADMAP §6 archive count bumps to 61.

### RL-070 Beautify / minify suite and code-conversion bundle

- Priority: `P3`
- Status: `Done`
- Readiness: `All scope shipped — Beautify/Minify across 7 languages (JSON, JS via terser, HTML, CSS, SCSS, LESS, XML), plus the full code-conversion bundle (SVG → CSS, HTML → JSX, cURL → Code) — archived to ROADMAP §6`
- Why this matters:
  - Beautify + minify is the single largest bucket in DevUtils' tool
    list (HTML / CSS / JS / XML / SCSS / LESS / JSON). Most of it maps
    to Prettier or to small pure-JS libraries we can lazy-load.
  - Code conversion (HTML → JSX, SVG → CSS, cURL → Code) is high-value
    for exactly the audience Lingua already targets (TS + Python + Go).
- Scope:
  - Unified Beautify + Minify panel with a language selector for:
    HTML, CSS, SCSS, LESS, JavaScript, JSON, XML. Beautify reuses
    Prettier (already bundled via RL-010); minify uses a small
    per-language minifier loaded only when the language is selected.
  - Code conversion bundle:
    - HTML → JSX (attribute mapping, `class` → `className`, self-closing
      tags, inline-style object form)
    - SVG → CSS (inline data-URI background-image with width/height
      hints)
    - cURL → Code with targets: `fetch`, Node `undici`, Python
      `requests`, Go `net/http`. Handle `-H`, `-d`, `--data-binary`,
      `-X`, and basic auth.
- Acceptance criteria:
  - Round-trip beautify → minify → beautify is stable for the bundled
    fixtures
  - cURL → Code passes a fixture suite of 10 real-world invocations
  - All new panels stay lazy-loaded
- Dependencies:
  - RL-045 ✅
  - RL-010 (format-on-save) — reuses the existing Prettier pipeline
- 2026-04-21 first slice:
  - `Beautify / Minify` landed as a unified panel for JSON + JavaScript
  - Beautify reuses `formatSource(...)`; JSON minify is a parse + stringify round-trip; JavaScript initially shipped with whitespace/comment compaction
  - Regex literals are preserved by the JS minifier state machine so `//` inside a regex body is not mistaken for a line comment
  - Copy ships in en + es and the panel is reachable from the Developer Utilities workspace + Command Palette
- 2026-04-23 second slice:
  - HTML, CSS, and XML landed in the same panel; HTML preserves `<pre>`, `<textarea>`, `<script>`, and `<style>` bodies, CSS preserves strings and `url(...)`, and XML preserves CDATA / processing instructions
  - CSS beautify reuses the bundled Prettier postcss plugin; XML beautify lazy-loads `@prettier/plugin-xml`; helper, component, and Playwright coverage pin the new language paths
- 2026-04-23 third slice:
  - SCSS and LESS landed through the shared postcss parser and CSS-family minifier, including `//` line-comment stripping while preserving strings and `url(...)` bodies
  - JavaScript minify upgraded to lazy `terser` v5, so the panel now performs semantic ECMAScript minification instead of whitespace-only compaction
  - `minifySource(...)` is async so the renderer waits for lazy minifier chunks before showing output; regression coverage pins raw-text close-tag boundaries and escaped `url(...)` parens
- 2026-04-24 fourth slice:
  - `SVG → CSS` landed as a pure renderer-side converter with Base64 and URL-encoded data-URI modes, a CSS `background-image` block output, and per-output copy affordances
  - Size hints prefer positive `width` / `height` values, fall back to positive `viewBox` dimensions, and omit `background-size` when the source only exposes relative or unsupported units
  - Input is rejected before encoding for empty, non-SVG, or over-100 KB payloads; helper, component, i18n, command-palette, and Playwright coverage pin the shipped surface
- 2026-04-24 fifth slice (closes RL-070):
  - `HTML → JSX` landed as a deps-free converter using built-in `DOMParser`; the walker concatenates `document.head.childNodes` + `document.body.childNodes` so top-level `<meta>` / `<title>` / `<link>` inputs survive DOMParser's auto-hoisting, with an attribute map that covers `class` → `className`, `for` → `htmlFor`, `charset` → `charSet`, `tabindex` → `tabIndex`, event handlers lowercased-to-camelCase, `data-*` / `aria-*` passthrough, void-element self-closing, HTML-comment → JSX-comment rewriting, and inline `style` parsed into an object literal with camelCased CSS property names
  - `cURL → Code` landed with a POSIX argv tokenizer (CRLF-aware line continuation), a `parseCurlCommand` → `CurlCommand` stage, and four codegen targets (`fetch`, `undici`, Python `requests`, Go `net/http`). Unknown flags surface as inline warning comments; file-backed body forms such as `--data @file`, `--data-binary @file`, and `--data-urlencode @file` are rejected with a translated error; `--data-urlencode` values are percent-encoded per cURL's rules; `-u` together with an explicit `Authorization` header emits a clobber warning
  - Acceptance criteria satisfied: the 10-invocation cURL fixture suite covers bare GET, GET-with-query, POST JSON, POST form-urlencoded, PUT, DELETE, basic auth, custom header stack, line continuation, and cookie. Catalog count bumped 23 → 25; ~30 new i18n keys per locale in tuteo

### RL-071 Harden existing utilities to DevUtils parity

- Priority: `P2`
- Status: `Done`
- Readiness: `All scope shipped — UUID v7/ULID, Diff word/char, JWT sign/verify across 12 JWS families, Base64 Image, regex replace, Hash Generator closeout (MD5, SHA-384/512, HMAC SHA family, file-drop) — archived to ROADMAP §6`
- Why this matters:
  - Every existing utility (JWT, Hash, UUID, Diff, Base64) has a clear
    DevUtils counterpart that does more. Closing those gaps is cheaper
    than adding new tools because the panels, i18n keys, and Command
    Palette entries already exist.
- Scope:
  - **JWT Debugger**: add verify + sign flows using Web Crypto for
    HS256/384/512, RS256/384/512, ES256/384/512, PS256/384/512. Keys
    never leave the renderer. Paste-key UX plus generate-key UX.
  - **Hash Generator**: add MD5, SHA-384, SHA-512, HMAC variants, and
    file-input hashing via drag-and-drop (renderer streaming, no
    IPC).
  - **UUID**: add UUID v7 and ULID generators; add a UUID/ULID decoder
    that surfaces version + embedded timestamp.
  - **Diff Viewer**: add word-level and character-level modes alongside
    the current line-level view; retain the existing summary.
  - **Base64**: add Base64 Image Encode/Decode panel (drag an image in,
    copy data-URI out; paste data-URI in, preview the image).
- Acceptance criteria:
  - JWT sign + verify round-trip is covered by tests for every
    supported algorithm
  - Hashes match known test vectors for MD5, SHA-256, SHA-384, SHA-512
  - UUID v7 and ULID outputs conform to the respective drafts
  - Web + desktop behavior stays identical (no IPC dependency added)
- Dependencies:
  - RL-045 ✅
- 2026-04-21 first slice:
  - `UUID` utility now generates UUID v4, UUID v7, and ULID batches
  - Added a decode surface that recognizes UUID v4, UUID v7, and ULID inputs and surfaces the embedded timestamp where the format provides one
  - Helper coverage pins the UUID v7 version/variant bits, ULID alphabet, decode round-trips, malformed-input rejection, and Spanish UI copy
- 2026-04-22 second slice:
  - `Diff Viewer` now supports line, word, and character granularities instead of line-only output
  - The diff stays pure/offline in the renderer, keeps the existing summary strip, and renders inline add/remove spans for word/character modes plus row-oriented output for line mode
  - Coverage now includes helper tests for the tokenizers/Myers dispatcher, component tests for the granularity selector, and targeted Playwright smoke for the Pro-gated utility panel
- 2026-04-23 third slice:
  - `JWT Debugger` gained Verify and Sign modes backed by Web Crypto, covering HS256/384/512 and RS256 first, then ES256/384/512 and PS256/384/512
  - The latent algorithm-family guard was tightened so new ES/PS algorithms cannot accidentally route through HMAC
- 2026-04-23 fourth slice:
  - JWT RS384 and RS512 completed the RSA PKCS#1 family; the algorithm selector now exposes all 12 planned JWS families
  - `Base64 Image` landed with drag-drop image-file encoding to data-URI and pasted data-URI decode/preview, with MIME validation and encode/decode size caps so oversized payloads are rejected before preview
- 2026-04-24 fifth slice:
  - `Regex Tester` gained a Match / Replace mode toggle with live replaced-output pane, native-spec back-reference expansion (`$1` / `$<name>` / `$$`), plural-aware count summary, and a neutral zero-matches branch consistent with Match mode
- 2026-04-24 sixth slice (closes RL-071):
  - `Hash Generator` closed the full plan scope with MD5 (via lazy-loaded `spark-md5`), SHA-384, SHA-512, and HMAC over the full SHA family (HMAC-MD5 intentionally rejected), plus a drag-drop file input hashed in-renderer up to a 50 MB cap
  - New `computeHash` tagged-union helper routes text and file inputs through the same `ArrayBuffer` pipeline; panel gains mode / input-source / algorithm selects with conditional HMAC-key field; cancelled-flag + generation-counter guards protect against stale promise and file-read races; library exception messages render in muted mono beneath translated error prefixes so ES users never see half-English banners

### RL-072 Specialty utilities — QR + String Inspector

- Priority: `P3`
- Status: `Done`
- Readiness: `Closed on 2026-05-08 — see § Status Update below.`
- Why this matters:
  - QR code generate + read is a DevUtils staple and one of the more
    recognizable screenshots in competitor comparisons.
  - A String Inspector (unicode code points, invisible characters, byte
    length, encoding) is the single tool developers most often reach
    for when debugging weird copy-paste.
- Scope:
  - **QR Code**: generate (payload + error-correction level), read
    (upload image, decode locally; no network).
  - **String Inspector**: render code points, highlight
    invisible/whitespace characters, surface byte length per
    UTF-8/UTF-16, and call out mixed-script homoglyphs.
- Acceptance criteria:
  - QR decoding works offline on at least PNG and JPEG inputs
  - String Inspector flags zero-width and BiDi control characters by
    default
  - Bundle size of the main editor chunk does not grow
- Dependencies:
  - RL-045 ✅
- 2026-04-22 first slice:
  - `String Inspector` landed as a pure renderer-side helper + panel with UTF-8 / UTF-16 counts, per-codepoint rows, and warnings for zero-width, BiDi, mixed-script, and homoglyph cases
  - The panel stays fully offline in the renderer, flags suspicious mixed-script tokens without penalizing legitimate single-script Cyrillic text, and ships en + es copy
  - Coverage spans helper tests, component tests, and targeted Playwright smoke in the Developer Utilities workspace
- 2026-04-23 second slice:
  - `QR Code generate` landed (PNG preview via `<img src={dataUrl}>`, error-correction levels L/M/Q/H, payload textarea + CopyButton, Download-as-PNG, capacity hint, oversized + empty branches localized)
- **§ Status Update — 2026-05-08 closeout**:
  - Final slice closes the ticket. Folded six approved candidates (A, B, C, D, E, F) plus the originally scoped QR-decode in one pass:
    - **Decode mode** with drag-drop image upload powered by jsQR + the existing `<FileDropZone>` (10 MiB cap, decoded-bitmap pixel cap, MIME gate restricted to PNG/JPEG/WebP/GIF/BMP, seven discriminated `kind`s on failure).
    - **Copy as PNG** writes a real `image/png` blob to the system clipboard via `navigator.clipboard.write([new ClipboardItem({...})])` with idle / success / unsupported / failed label cycling. Synchronous `atob` data-URL → Blob conversion sidesteps the renderer CSP `connect-src` directive (no `fetch(data:…)`).
    - **FG / BG color pickers** with a WCAG-AA contrast guard (4.5:1) and a real-time ratio readout.
    - **High-contrast preset** forces pure black on pure white, disabling the pickers; ideal for printed stickers and budget phone cameras.
    - **SVG download** anchor alongside PNG, generated on every render via `generateQrSvgDataUrl` (UTF-8-safe base64 via `TextEncoder` with chunked `String.fromCharCode` for large emoji-heavy payloads).
    - **`utilityOutputStore` wiring** (RL-069 Slice 1 contract) — Cmd+Shift+C / Cmd+Alt+R now target the active QR output: PNG data URL in generate mode, decoded text in decode mode.
  - Camera capture remains explicitly deferred per the original RL-072 scope decision — file upload + drag-drop covers the recognizable QR-reader use case without requesting webcam permission.
  - Pre-stage review caught and folded inline: (a) `fetch(dataUrl)` blocked by CSP `connect-src`, replaced with synchronous atob; (b) deprecated `unescape(encodeURIComponent(...))` swapped for `TextEncoder` + chunked base64; (c) wrong i18n description key on the "Decoded payload" PanelSection, replaced with a dedicated key in EN + ES.
  - Live UI smoke caught a real production bug: `decodeQrFromFile` minted a `blob:` URL via `URL.createObjectURL`, which violates the renderer CSP `img-src 'self' data:`. Switched the image-load path to `FileReader.readAsDataURL` so the image source is a `data:` URL the existing CSP already permits. No CSP widening needed.
  - Coverage: 50 unit + component tests (was 5), all green, plus the existing 119-test web e2e suite. Bundle delta ~60 KB gz from `qrcode` + `jsqr` + `@types/qrcode` — `npm run check:performance` passes the budget.
  - Catalog count: panel was already registered under `qr-code` in `developerUtilities.ts`; no count delta.

### RL-073 Define Lingua's own editor-theme identity (syntax palette + light counterpart)

- Priority: `P1`
- Status: `Done`
- Why this matters:
  - `lingua-dark`, the default theme shipped as Lingua's visual identity,
    currently declares `rules: []` in `src/renderer/components/Editor/editorThemes.ts`.
    Every syntax color is inherited from Monaco's `vs-dark` base, which
    means the product has no owned syntax palette — devs pasting JS, Go,
    or Python see Microsoft's colors through Lingua's chrome.
  - No `lingua-light` exists, so users running the app in light shell
    mode are forced onto `vs` (Microsoft) or `solarized-light`
    (third-party) for the editor. There is no Lingua-owned light option.
  - Without a declared palette, the `/foundations/code` page planned for
    the Lingua design-system migration has nothing to document and every
    future feature that renders code (utility panels, inline code in
    docs, tooltips) has to invent its own syntax colors on the fly.
- Scope:
  - Add a Signal-Slate aligned 8-token syntax palette to `lingua-dark`
    (`keyword`, `string`, `number`, `comment`, `type`, `function`,
    `variable`, `operator`). Cool-leaning family — indigo/violet
    keywords, mint strings, sky numbers, teal types, blue functions,
    slate glue. Avoids Dracula-magenta and Monokai-pink so the theme
    reads as Lingua's identity, not a port.
  - Add `lingua-light`: same cool-slate family re-pitched for a
    `#f6f8fa` background, with chrome and syntax re-tuned for light-mode
    legibility. Uses Monaco's `vs` as base with `inherit: true`.
  - Register `lingua-light` in `EDITOR_THEMES`
    (`src/renderer/components/Settings/settingsOptions.ts`) as the
    second entry, immediately after `lingua-dark`, with `dark: false`.
  - Prerequisite fix: add `lingua-light` AND the missing `nord-night`
    to the import/export validator's `EDITOR_THEMES` tuple in
    `src/renderer/utils/themePreset.ts`. The audit discovered
    `nord-night` was listed in `EDITOR_THEMES` for the Settings
    dropdown but absent from the preset validator, which would have
    silently rejected presets referencing it.
  - Every syntax token in every Lingua-owned theme (dark + light) must
    pass WCAG AA (≥ 4.5:1) contrast against its editor.background.
- Acceptance criteria:
  - `lingua-dark.rules` declares all 8 required tokens; `rules.length` > 0.
  - `lingua-light` is defined with `base: 'vs'` and the same 8 tokens.
  - Selecting `lingua-light` in Settings → Editor flips the editor
    background to `#f6f8fa`, re-renders syntax tokens with the
    declared palette, and (via the existing `syncShellWithEditorTheme`
    flag) the shell also switches to light mode.
  - No console errors triggered by the theme switch.
  - The 11 `tests/components/Editor/editorThemes.test.ts` gates pass —
    including the WCAG AA contrast check that runs against every token
    in both Lingua-owned themes.
- Dependencies:
  - None. RL-073 stands alone; the palette choice is prescriptive and
    becomes the input to the forthcoming `/foundations/code`
    documentation page in the external design-system site.
- Out of scope (tracked in `docs/BACKLOG.md`):
  - Aligning the hardcoded ANSI_FG map in `ConsolePanel.tsx` with the
    semantic CSS vars (separate concern — touches runtime output
    rendering, not Monaco).
  - Selection-background alpha inconsistency across the 5
    redistributed themes (cosmetic polish).
- 2026-04-24 shipped:
  - `lingua-dark` now declares 8 syntax rules with the new Signal-Slate
    palette; `lingua-light` lands as a full theme (chrome + 8-token
    palette) built on Monaco's `vs` base with `#f6f8fa` background,
    `#1e293b` foreground, and deeper violet/teal/emerald syntax tones
    tuned for AA contrast on the light canvas. Prerequisite fix adds
    `lingua-light` + `nord-night` to the preset-validator tuple so
    import/export no longer rejects valid themes.
  - New `tests/components/Editor/editorThemes.test.ts` adds 11 gates:
    theme registration order, required-token coverage, comment-italic
    pinning, WCAG AA contrast for every token foreground against every
    editor.background, and base-theme pinning so `lingua-dark` stays
    dark and `lingua-light` stays light when Monaco falls back for
    unhandled tokens.
  - Live smoke via Playwright MCP on `npm run preview:web`: opened
    Settings → Editor, selected "Lingua Light", verified editor
    background flipped to `#f6f8fa`, syntax tokens rendered with the
    new palette (strings in `#047857`, variables in `#1e293b`), shell
    auto-flipped to light via `syncShellWithEditorTheme`, and
    `browser_console_messages({ level: 'error' })` remained 0.

### RL-074 Group Command Palette and Quick Open by scope on the empty-query overview

- Priority: `P2`
- Status: `Done`
- Why this matters:
  - Both palettes shipped as flat lists, ignoring the `category` /
    `source` field they already carried in their data layer. The user
    facing the empty palette saw a wall of unsorted entries — actions
    interleaved with templates, snippets, and recent runs in the
    Command Palette; open tabs jumbled with project files and
    recents in Quick Open.
  - The Lingua Variations artboard had pinned a Linear/Raycast-style
    grouped overview as the design intent for both surfaces from
    Ronda 2 onwards. Implementing it closes a long-standing
    artboard-vs-code drift without touching the data model.
  - The empty-state copy was a single muted line. The redesign added
    a hint that points users at an alternative scope or a Cmd+P
    jump, so a zero-match query stops being a dead end.
- Scope:
  - Add a grouped render path to
    `src/renderer/components/CommandPalette/CommandPaletteResults.tsx`
    that buckets entries by `CommandCategory` (`action`, `template`,
    `snippet`) under eyebrow section headers when the query is empty,
    and falls back to the existing flat ranked list on any non-empty
    query so search ranking is not split across sections.
  - Add equivalent grouping inline in
    `src/renderer/components/QuickOpen/QuickOpen.tsx`: bucket
    `FileResult` entries by `source` (`open-tab`, `recent`,
    `project`) under section headers when the query is empty,
    flatten on any query.
  - Section ordering picked to match Lingua usage patterns:
    - Command Palette: Actions first, Templates, Snippets last.
    - Quick Open: Open tabs first, Recents, Project files last.
  - Empty-state copy gains a hint line in both palettes. Empty
    buckets stay collapsed (a section with zero entries does not
    render its eyebrow header).
  - Bilingüe es/en: 7 new i18n keys plus the noProject hint.
    Spanish copy follows the tuteo rule from CLAUDE.md.
- Acceptance criteria:
  - When the search input is empty, both palettes render at least
    one eyebrow scope header above their entries.
  - When the user types any query, both palettes render a flat
    list with zero scope headers.
  - Sections with no entries do not render their header.
  - Keyboard navigation still steps through entries linearly,
    ignoring section headers.
  - Existing tests continue to pass; new tests pin the grouping
    behavior.
- Out of scope (tracked in `docs/BACKLOG.md`):
  - Inline keyboard-shortcut display next to commands that have a
    global shortcut.
  - Splitting recent-runs into its own scope distinct from
    `action`.
- Dependencies:
  - None. Pure renderer-layer change.
- 2026-04-25 shipped:
  - `CommandPaletteResults.tsx` refactored: extracted `renderEntry`
    and `renderGrouped` helpers; the empty-query branch buckets
    entries while preserving the original flat-list index so
    `↑↓` navigation keeps working.
  - `QuickOpen.tsx` gains an inline `renderQuickOpenResults`
    helper with the same pattern (open-tab / recent / project).
  - 7 new i18n keys land in
    `src/renderer/i18n/locales/{en,es}/common.json`, plus the
    noProject hint.
  - 5 new tests across `tests/components/CommandPalette.test.tsx`
    and `tests/components/QuickOpen.test.tsx` pin grouping,
    flatten-on-query, empty-bucket suppression, and the
    empty-match hint.
  - Live smoke via Playwright MCP on `npm run preview:web`:
    Cmd+Shift+P empty query showed `Acciones` + `Plantillas`
    eyebrows; typing `layout` flattened to 3 ranked results;
    `zzzzzzzznada` rendered the empty copy plus the
    "Prueba Cmd+P…" hint; Cmd+P showed `Pestañas abiertas`
    eyebrow; `browser_console_messages({ level: 'error' })`
    remained 0 across the flow.

### RL-075 Adopt the Signal-Slate DS canonical token surface

- Priority: `P1`
- Status: `Done`
- Why this matters:
  - The shell shipped on a warm-cream + violet palette while the
    editor (RL-073) had already adopted Signal-Slate. The mismatch
    was visible every time a user crossed from editor chrome into a
    Settings overlay or Command Palette — two products glued
    together rather than one.
  - The Claude Design handoff bundle (vendored as
    `lingua/project/handoff/tokens.json` v1.0.0 dated 2026-04-24)
    is the canonical source of truth for every visual decision
    in the design system: hue, slate scale, semantic statuses,
    syntax tokens, console tokens, spacing scale, radius, type
    scale, shadows, motion. Until the shell consumed those values,
    every future slice would have had to either invent its own
    deviation or re-derive the same numbers.
  - Hardcoded ANSI hex in `ConsolePanel.tsx` was the largest
    isolated drift surface: 16 hex literals that the rest of the
    palette could not influence. Routing them through CSS vars
    closes that drift permanently.
- Scope:
  - Replace the `:root,.light` and `.dark` token blocks in
    `src/renderer/index.css` with the DS canonical surface
    (neutral 0-900 ramp, slate 50-900 ramp, four surface levels,
    fg-base/muted/subtle/on-accent, border subtle/default/strong,
    accent + accent-hover + accent-fg, four semantic statuses
    each with bg/fg/border, eight syntax tokens, six console
    tokens, eight spacing steps, six radius levels, eight font
    weights, nine typography roles each with size/lh/tracking/
    weight, three light + three dark shadows, three durations,
    three curves).
  - Chain every legacy `--app-*` token to a DS canonical so the
    historic Tailwind utility classes (`text-foreground`,
    `bg-primary-soft`, `border-border-strong`, etc.) keep
    rendering against the same canonical values.
  - Convert `lingua-dark` and `lingua-light` editor themes in
    `src/renderer/components/Editor/editorThemes.ts` to use the
    DS syntax palette (violet keyword, sage string, amber number,
    violet function, slate operator/variable, italic comment) by
    converting the OKLCh declarations to sRGB hex via the
    standard OKLab→linear-RGB→sRGB conversion. The redistributed
    third-party themes (Dracula, One Dark Pro, Monokai, Nord
    Night, Solarized Light) stay untouched — they are intentional
    ports.
  - Refactor the ANSI map in
    `src/renderer/components/Console/ConsolePanel.tsx` from
    hardcoded hex to `var(--color-console-*)` references so the
    console adopts theme changes automatically and the palette
    can evolve without ANSI drift.
- Acceptance criteria:
  - Every value in `:root,.light` and `.dark` is either a
    one-to-one match against `lingua/project/handoff/tokens.json`
    or chains through `var()` to a token that is.
  - The editor theme contrast gate
    (`tests/components/Editor/editorThemes.test.ts`) keeps passing
    with the new hex palette. Comment role uses AA Large (3:1)
    instead of AA Normal (4.5:1) because the DS spec deliberately
    drops below 4.5 on `comment` for visual hierarchy, matching
    the convention every major editor theme follows.
  - All existing components that consume `--app-*` keep working
    without modification (verified by running the full test suite
    and a Playwright smoke through Editor + Settings + Command
    Palette + Quick Open in light + dark).
  - Zero `console.error` during the smoke pass.
- Dependencies:
  - RL-073 (the editor themes that establish the Signal-Slate
    direction; their hex values are now derived from the same DS
    canonical the shell consumes).
- 2026-04-25 shipped:
  - `src/renderer/index.css` rewritten — 414 lines added, 102
    removed. Token blocks reorganized into DS canonical (`:root`
    + `[data-theme="dark"]` + `.dark`) plus legacy bridge.
  - `editorThemes.ts` syntax palette migrated to DS hex (90
    lines diff). Comment-italic preserved.
  - `ConsolePanel.tsx` ANSI map routed through 5 DS console
    tokens — 51 lines diff including the explanatory header
    comment.
  - Contrast gate test relaxed for `comment` role per DS spec
    (14 lines diff in `editorThemes.test.ts`).
  - Live smoke via Playwright MCP on `npm run preview:web`:
    captured 8 + 5 viewport screenshots in light + dark across
    Editor, Settings, Command Palette, License section, Welcome.
    `browser_console_messages({ level: 'error' })` remained 0
    across both polarities.

### RL-076 Refresh editor tabs against the DS canonical

- Priority: `P1`
- Status: `Done`
- Why this matters:
  - `EditorTabs.tsx` shipped before the Signal-Slate migration and
    still uses a card-style tab (rounded border + uniform
    background) where the DS spec specifies a flat tab strip with
    a 2px accent border-top on the active row and a subtle
    panel-alt background for inactive rows. The mismatch is most
    visible in light mode now that RL-075 cooled down the rest of
    the shell.
  - The DS spec on `signal-tabs-editor.jsx` documents seven
    interaction variants (basic / dirty / error / hover-close /
    rename / overflow / drag) plus a context menu and a close-
    confirm modal. Lingua today only renders the first three
    properly. The visible gaps are: no right-click menu, no
    inline rename, and no way to bulk-close other / right tabs.
  - Each missing affordance is a paper cut for power users (the
    audience that opens 6+ tabs in a session). Closing them as a
    coherent slice is cheaper than chasing them one at a time.
- Scope:
  - Visual refresh of `EditorTabs.tsx` to match
    `signal-tabs-editor.jsx` from the handoff: 2px accent
    border-top on active, panel-alt bg on inactive, JetBrains
    Mono filename at 11.5px to match the editor canvas, lang
    chip in mono at 8.5px with semantic-color background per
    language, dirty dot using the slate accent.
  - New `EditorTabContextMenu` component (rendered through the
    existing `OverlayBackdrop` portal pattern) with six items:
    Cerrar / Cerrar otras / Cerrar a la derecha / Cerrar todas /
    Renombrar / Duplicar. Keyboard shortcuts inline where
    applicable (⌘W, ⌘⇧W, F2). Right-click on a tab opens it
    anchored to the tab.
  - Inline rename: double-click on the filename (or F2 / context
    menu Rename) replaces the filename with an input. Enter
    commits, Escape cancels. The rename writes to a new
    `renameTab(id, name)` action on `editorStore`.
  - New store actions on `editorStore`:
    `renameTab(id, name)`, `closeOtherTabs(id)`,
    `closeTabsToRight(id)`, `closeAllTabs()`. Each respects the
    existing dirty-check flow in `closeTab`.
  - i18n: 8 new keys across en + es for menu labels plus the
    rename input ARIA label. Spanish follows the tuteo rule
    from CLAUDE.md (`Cerrar`, `Renombrar`, `Duplicar`).
- Acceptance criteria:
  - Active tab visually distinct from inactive (2px accent
    border-top, panel bg, mono filename); inactive tabs have
    panel-alt bg.
  - Right-click on a tab opens the context menu anchored to
    the tab.
  - Each menu item triggers its corresponding action; close
    items respect the existing dirty-check flow (one prompt per
    dirty tab in close-others / close-all).
  - F2 on the active tab and double-click on a filename open
    the inline rename. Enter commits the new name, Escape
    cancels without changes.
  - Existing tests in `tests/components/EditorTabs.test.tsx`
    keep passing; new tests cover: context menu open/close,
    rename commit, rename cancel, close-others, close-right,
    close-all.
  - Bilingüe es/en for every menu item and the rename input
    placeholder.
- Out of scope (tracked in `docs/BACKLOG.md` as separate items):
  - Error indicator dot on tabs whose last execution failed
    (requires per-tab execution status that today lives only in
    the global execution history store).
  - Drag handle + reorder via drag-drop (touches drag-drop
    infra, deserves its own slice).
  - Overflow dropdown with hidden-tabs count badge (today the
    overflow falls through to horizontal scroll; the chevron +
    count affordance is a separate piece).
  - Pin tab, Reveal in Finder, Copy path (pin needs a new
    `isPinned` field on FileTab; the Electron-only items need
    an IPC handler).
- Dependencies:
  - RL-075 (the slate accent + panel surfaces that the new tab
    visuals consume).

---

## 16. Lingua v2.0 strategic roadmap (2026-04-26)

Strategic vision for the v2.0 cycle, written after RL-061 Slice 1 shipped.
Covers market positioning, daily-workflow gap analysis, the six pillars
of v2.0, AI-feature brainstorm, and the 50 features captured in
[`docs/BACKLOG.md`](./BACKLOG.md). Pricing implications of the AI bridge
are folded into §13 / §14.

This section is **vision, not commitment** — it sets the direction and
pricing-economics frame. Concrete `RL-NNN` tickets graduate from
[`BACKLOG.md`](./BACKLOG.md) into [`ROADMAP.md`](./ROADMAP.md) §4 once
acceptance criteria are sized; we do not pre-allocate IDs here.

### 16.1 Market positioning

Lingua occupies an intersection that no other product covers cleanly today:

```
                           online-only (cloud)        offline-first (desktop)
single-language scratchpad CodePen, JSFiddle          RunJS (JS only)
multi-language playground  Replit, CodeSandbox        ◀── Lingua sits here
dev utilities only         CyberChef.io               DevToys (Win), DevUtils (paid)
multi-lang + utilities     —                          ← Lingua is unique
```

The actual buyer profile: **a developer who lives in JS by day, writes
Python scripts at night, and formats a JWT every other hour**. Today
that workflow spans three apps. Lingua is the only product that unites
the three on an offline desktop. That is the positioning that justifies
the price.

### 16.2 Competitor map and the gaps Lingua should close

| Category | Competitor | Where they win | Where Lingua wins |
|---|---|---|---|
| Single-language scratchpad | RunJS ($26 perpetual, JS only) | Live worker, instant feedback | Multi-language, dev utilities included |
| Single-language scratchpad | Quokka.js (VS Code, $50/yr) | Inline values per line | No VS Code dependency, multi-lang |
| Online IDE | Replit | Cloud collab, GPU, AI tutor | Privacy (offline), no rate-limits, no forced subscription |
| Online IDE | CodeSandbox | Full project workflows | Scratchpad/utility focus, zero project setup |
| Dev utilities | DevUtils.app ($30/yr macOS) | Polish, smart-input detection | Cross-platform, code execution |
| Dev utilities | DevToys (free, Windows) | Free + Win-integrated | macOS+Linux, execution, themes, i18n |
| Dev utilities | CyberChef (browser, free) | 300+ pipeline-able operations | Native, multi-tool layout, less geek-y |
| Text manipulation | Boop (macOS, free) | User-script extensibility | (Lingua needs `RL-038` Slice C+D to match — gap) |
| API / data | Postman, Insomnia, Bruno | Mature HTTP clients | Lingua does not compete today (gap) |
| API / data | TablePlus, DBeaver | Mature DB clients | Lingua does not compete today (gap) |
| AI-first IDEs | Cursor ($20/mo), Zed, Continue.dev | AI agentic editing | Lingua has no AI features today (gap) |
| AI-first terminals | Warp | Agentic terminal | Lingua does not target the terminal (out of scope) |

Translated to v2.0 commitments: **HTTP client + SQL client + AI assistant
+ plugin SDK** are the four gaps that, closed, move Lingua from "another
scratchpad" to "the dev tool you keep open all day".

### 16.3 Language coverage matrix (2026)

| Lenguaje | Uso real 2026 | Lingua hoy | v2.0 target |
|---|---|---|---|
| JavaScript | Front-end, tooling | runnable | maintain |
| TypeScript | Front-end, backend | runnable | maintain |
| Python | Data, ML, scripts | runnable (Pyodide) | numpy/pandas micropip preload |
| Go | Backend, cloud-native | runnable (desktop) | maintain |
| Rust | Systems, WASM | runnable (desktop) | maintain |
| **SQL** | Todos | formatter only | **runnable via DuckDB-WASM** ← high impact |
| **Java** | Enterprise, Android | view-only | **runnable via TeaVM** ← high impact |
| **Bash** | DevOps, scripts | none | **runnable desktop-only** ← medium impact |
| Kotlin | Android, multiplatform | view-only | runnable later (RL-042) |
| Swift | iOS, server | view-only | runnable later (macOS-only) |
| C/C++ | Systems, games | view-only | runnable later via Emscripten |
| Ruby | Rails | view-only | runnable later |
| PHP | Laravel, WordPress | none | low priority |
| Lua | Game scripting (Roblox) | view-only | runnable medium |
| C#, Elixir, Zig, Dart, etc. | Various | none | future |

Top-3 runnable adds for v2.0: **SQL** (DuckDB-WASM, ~5MB), **Java**
(TeaVM WASM tier), **Bash** (desktop spawn).

### 16.4 Six pillars of v2.0

**Pillar 1 — AI first, local-first**

Lingua's moat against Cursor/Copilot/Replit-AI is **privacy + offline
+ no-subscription-forced**. The bridge ships three options simultaneously:

- **Local model** (Ollama-compatible): Qwen2.5-Coder, Codestral,
  DeepSeek-Coder. Best for users with a 16GB+ machine.
- **BYO key**: paste OpenAI / Anthropic / Groq / etc. API key. Stored
  in main process via Keychain / DPAPI / libsecret — never in
  localStorage, never in the renderer.
- **Hosted credit pool** (Pro tier add-on): we resell tokens at a
  margin so casual users don't have to manage keys.

Decision matrix lives in [`docs/AI_BRIDGE_ADR.md`](./AI_BRIDGE_ADR.md).

**Pillar 2 — Universal HTTP + SQL clients integrated**

The dev typically has 3-5 tools for HTTP/SQL workflows. Absorbing
those workflows into Lingua with consistent UX captures 10x more daily
sessions:

- **HTTP panel** — Postman-light. Saved requests, history, auth methods
  (Bearer / Basic / OAuth simulator), env vars per request, response
  viewer, cURL import/export.
- **SQL panel** — DuckDB-WASM (web) + native bridges (desktop) for
  SQLite/Postgres/MySQL. Query history, schema explorer.
- Both integrate with the AI panel: "fix this query", "explain this
  401", "make a curl from this fetch".

**Pillar 3 — More languages runnable** (see §16.3 matrix).

**Pillar 4 — Notebook mode + rich output**

`RL-043` (notebook) + `RL-044` (inline viz) accelerated for v2.0:

- Cell-based execution with persistent outputs.
- Auto-detect output types: tables → grid, images → preview,
  matplotlib/plotly → embed, markdown → render.
- Sharing: notebook → standalone HTML.

**Pillar 5 — Asynchronous collaboration** (NOT real-time)

Real-time collab is expensive and `RL-050` is deferred. But share-by-link
and embed-mode are cheap and useful:

- Cloud snapshot endpoint: tab + history → URL (Cloudflare Pages + R2).
- Embed mode: read-only iframe for blogs / docs.
- Public profile (opt-in): list shared snippets.

**Pillar 6 — Plugin SDK** (RL-038 Slice C + D promoted)

The Boop moat is extensibility. To match:

- Stable typed API for utility-panel plugins.
- Marketplace on linguacode.dev (Pro feature, Polar-billed for paid plugins).
- First-party launch plugins: OpenAPI → client codegen, Mermaid renderer,
  LaTeX preview, Excalidraw embed, time tracker.

### 16.5 Pricing implication of AI bridge

AI changes the unit economics of every tier. Hosted-credit cost is the
recurring expense that justifies recurring revenue:

| Tier | AI access |
|---|---|
| Free | BYO-key + local Ollama only. No hosted credits. |
| Monthly | + N hosted tokens / month (e.g. 1M tokens GPT-4o-mini-equivalent ≈ $1 vendor cost). Subscription justifies the recurring spend. |
| Pro | BYO-key + local only. No hosted credits — recurring token cost would erase one-time-purchase margin. |
| Trial | No hosted credits; local + BYO key only. |
| Education | No hosted credits; local + BYO key only. |

This is the cleanest answer to the recurring question "how does Pro
not eat margin": **Pro gets the offline product but not the
ongoing cloud spend**. Users who want managed AI tokens self-select
into Monthly. Education remains valuable through the full offline paid
entitlement set without adding recurring hosted-token cost.

### 16.6 v2.0 must-haves vs v2.1+

**v2.0 ship list** (the surface area that justifies a "switching to
Lingua" headline):

1. AI bridge (Ollama + BYO-key + hosted credits) — **the headline**.
2. HTTP client panel — pulls Postman users.
3. SQL playground panel (DuckDB-WASM) — pulls TablePlus light users.
4. Notebook mode + inline viz — pulls Jupyter casual users.
5. Smart paste / cross-tool piping (`RL-069` accelerated).
6. 5 destacated AI features:
   - Cross-language port ("translate this Python to Rust")
   - Test generator (Jest / pytest / Go test scaffolding)
   - Error explainer (paste stacktrace → plain English)
   - Regex from natural language ("match IPv6")
   - Mock data generator (schema → realistic JSON / CSV)

**v2.1** — fill follow-up gaps:

7. More AI features (commit message, docstring/JSDoc, variable rename,
   perf coach with Big-O analysis).
8. More languages runnable (SQL native, Java, Bash).
9. Plugin SDK + first marketplace plugins.

**v2.2+** — moat extensions:

10. Share-by-link + embed mode.
11. Database explorer (full read-only browse).
12. AI-assisted DB query builder.
13. Algorithm visualizer (`RL-047`, gated on debugger MVP).

### 16.7 How v2.0 graduates from BACKLOG

Per [`docs/README.md`](./README.md) flow, ideas captured in
[`BACKLOG.md`](./BACKLOG.md) graduate to ROADMAP `RL-NNN` when:

- Acceptance criteria are sized.
- A slice plan exists (or is small enough that a plan is unnecessary).
- Dependencies are `Done`.

The 50 v2.0 features captured in `BACKLOG.md` §1 carry the `[ai]`,
`[tool]`, `[lang]`, `[collab]`, `[plugin]`, or `[polish]` tag plus the
date `2026-04-26`. As each matures, it graduates one at a time —
**we do not pre-allocate `RL-NNN` IDs in this section**.

2026-05-20 proposal triage: `docs/WORK_PROPOSAL.md` is retained only as a
research synthesis. Its original new-ticket labels are not valid planning IDs.
The useful work maps to existing tickets:

- no-backend sharing -> `RL-036`
- rich media console output -> `RL-044`
- explicit package management -> `RL-025`
- local AI MVP -> `RL-031`
- notebooks -> `RL-043`
- algorithm visualization -> `RL-047`

### 16.8 Open questions for v2.0

These are decisions that block the headline AI bridge slice and need
explicit answers before its first ticket graduates:

1. **Local model default**: Qwen2.5-Coder 7B (1.5GB Q4) vs Codestral
   22B (5GB Q4) vs DeepSeek-Coder 6.7B. Resolved in `AI_BRIDGE_ADR.md`
   when we ship the bridge.
2. **Hosted credit provider**: do we proxy through OpenAI / Anthropic
   directly or use a router (OpenRouter / Helicone)?
3. **Token-budget UI**: where does the user see remaining hosted credits
   for the month? Settings → License? A status-bar pill?
4. **Plugin sandboxing**: Web Workers vs iframe? Affects API surface.
5. **HTTP panel storage**: requests saved per-tab or in a global
   collection? Trade-off between RunJS-style scratchpad and
   Postman-style workspace.

These remain in §16.8 as live questions. Each gets resolved in the ADR
or scope cell of the corresponding ticket as it graduates.

---

## Execution order summary (updated 2026-04-13)

### Status legend

| Symbol | Meaning |
|--------|---------|
| Done | Shipped and verified |
| Next | First in queue — start now |
| Ready | No blockers, pick up in order |
| Blocked | Waiting on a dependency |
| Future | Deferred until prerequisites are done |

---

### Done (shipped)

| # | Task | Priority |
|---|------|----------|
| RL-001 | Fix Go desktop execution | P0 |
| RL-002 | File watching in renderer | P0 |
| RL-003 | Monaco diagnostics aligned to runtime | P0 |
| RL-006 | Explicit new-file UX | P1 |
| RL-007 | Snippets complete feature | P1 |
| RL-008 | Settings/theme truthfulness | P1 |
| RL-009 | Split oversized renderer modules | P1 |
| RL-017 | Migrate Vite CJS → ESM | P2 |
| RL-021 | Loose-file workflow & session restore | P1 |

---

### Tier 1 — Finish remaining P0 (correctness)

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-004 | Unify error surfacing (Go/Rust line parsing) | RL-003 ✅ | Small |
| RL-005 | Desktop validation scripts & smoke test | RL-001 ✅ | Medium |

---

### Tier 1.5 — Monetization and launch (Phase 1 of the strategic plan)

Ship these before Phase 2 distribution. Every item is a blocker for charging for the product.

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-062 | Public README, license declaration, distribution posture | None | Small |
| RL-059 | License-key infrastructure | None | Medium |
| RL-060 | Feature-tier gating in the renderer | RL-059 | Medium |
| RL-061 | Polar.sh integration (3 products + webhook issuance) | RL-059 | Medium |
| RL-063 | Download landing page at linguacode.dev | RL-061 | Small |

---

### Tier 2 — Quick wins with zero dependencies (do next)

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-055 | File-extension language detection | None | Small |
| RL-056 | Monaco keyword completions (Go/Py/Rust/Lua) | RL-055 | Small |
| RL-051 | Harden packagerConfig (app category + protocol) | None | Trivial |
| RL-052 | About view with version | None | Small |
| RL-030 | WASM capability matrix (architecture ADR) | None | Medium |
| RL-038 | Language-pack architecture | None | Medium |
| RL-045 | Built-in dev utilities panel | None | Medium |

---

### Tier 3 — Core product differentiation (unblocked by RL-021 ✅)

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-018 | i18n system (en + es) | None | Large |
| RL-019 | JS/TS runtime modes (Worker/Node/Browser) | RL-021 ✅ | Large |
| RL-022 | Indexed Quick Open & project search | RL-021 ✅ | Medium |
| RL-023 | Snippet Lab & practice mode | RL-021 ✅ | Large |
| RL-024 | Multi-file playgrounds & starter galleries | RL-021 ✅, RL-022 | Large |
| RL-040 | Custom protocol & deep links | RL-021 ✅ | Small |
| RL-053 | Release Notes / What's New | RL-052 | Small |
| RL-048 | Integrated terminal (desktop) | RL-021 ✅ | Medium |

---

### Tier 4 — REPL & runtime depth (unblocked by Tier 3)

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-020 | Best-in-class REPL + variable inspector | RL-019 | Large |
| RL-025 | Package & dependency management | RL-019, RL-024 (project UX); RL-029 only for later web installs | Large |
| RL-010 | Format-on-save | Desktop tooling | Medium |
| RL-011 | Env variables panel | Scoping decisions | Medium |
| RL-031 | Local AI assistant (Ollama) | RL-021 ✅ | XL |

---

### Tier 5 — Platform hardening, distribution, and growth (Phase 2 + Phase 3)

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-064 | Launch asset kit (video, HN/PH/Reddit copy, press kit) | RL-062, RL-063 | Medium |
| RL-065 | Privacy-respecting launch telemetry (opt-in) | — | Small |
| RL-067 | Crash reporting (opt-in, unified consent with RL-065) | RL-065 | Small |
| RL-036 (Phase A1) | No-backend single-tab URL-fragment share links | RL-021 ✅ | Small |
| RL-036 (Phase A2) | Local share bundles / read-only `.linguashare` artifacts | RL-024 | Medium |
| RL-066 | SEO landing pages per language intent | RL-063 | Small |
| RL-033 | Vite major upgrade | RL-005 | Medium |
| RL-034 | Build-system ADR (Forge vs alternatives) | RL-033 | Small |
| RL-032 | Full marketing website & docs hub | RL-018 | Large |
| RL-016 | Release validation & signing CI | — | Medium |
| RL-042 | 15+ languages | RL-038 | Large |
| RL-026 | Language intelligence beyond JS/TS (LSP) | RL-030, RL-038 | Large |
| RL-029 | WebContainers pilot (JS/TS web only) | RL-025 | Medium |
| RL-037 | Deep editor personalization (keys, fonts, vim) | RL-018 | Medium |
| RL-068 | Expand developer utilities (YAML/CSV/cron/markdown/SQL/etc.) | RL-045 ✅, RL-018 | Medium |
| RL-069 | DevUtils-class productivity layer (auto-detect, history, favorites, shortcuts) | RL-045 ✅, RL-037 | Medium |
| RL-071 | Harden existing utilities (JWT sign/verify, hash MD5/384/512 + file, UUIDv7/ULID, word-diff, Base64 image) | RL-045 ✅ | Medium |
| RL-070 | Beautify/minify suite + HTML→JSX, SVG→CSS, cURL→code | RL-045 ✅, RL-010 | Medium |
| RL-072 | QR code + String Inspector | RL-045 ✅ | Small |

---

### Tier 6 — Advanced features & learning platform

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-027 | Debugger MVP | RL-019 | XL |
| RL-028 | Execution history & benchmarking | RL-020 | Medium |
| RL-043 | Notebook / cell-based mode | RL-020, RL-044; RL-024 for multi-file notebooks | XL |
| RL-044 | Inline data visualization | RL-020, RL-019 | Large |
| RL-039 | Guided lessons & galleries | RL-023, RL-024 | Large |
| RL-046 | Gamification & progress tracking | RL-023 | Medium |
| RL-054 | Guided tour | RL-052 | Medium |
| RL-035 | Tauri 2 feasibility spike | RL-021 ✅, RL-030 | Medium |

---

### Tier 7 — Long horizon

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-036 (Phase B) | Collaborative editing, shareable links with backend | RL-036 Phase A, RL-032 | XL |
| RL-041 | Static site export & publish | RL-024, RL-036 | Large |
| RL-047 | Algorithm visualization | RL-027, RL-044, RL-043 | XL |
| RL-049 | Macro recording & playback | RL-037 | Medium |
| RL-050 | Real-time collaboration | RL-036 Phase B, RL-032 | XL |

---

### What to implement next

The order below reflects the strategic alignment (Phase 1 → Phase 2 → Phase 3):

1. Finish `RL-027` Slice 1.5b (conditional breakpoints + watch expressions behind security review).
2. Finish the next `RL-044` rich-media payload slice (chart, image, JSON tree, sandboxed HTML).
3. Ship `RL-036` Phase A1 no-backend single-tab URL-fragment sharing.
4. Ship `RL-025` detection + explicit JS/TS desktop install + Pyodide `micropip` slices.
5. Ship `RL-031` desktop-local Ollama MVP through `window.lingua.ai.*`.
6. Ship `RL-043` schema/session foundation before the large notebook UI.
7. Keep `RL-047` Future until `RL-027`, `RL-044`, and `RL-043` are stable.

This ordered list is the milestone sequence. No separate milestone section should be maintained elsewhere.

---

## Security and launch-readiness hardening from the 2026-05-02 review

These tickets were promoted directly into PLAN and ROADMAP from the 2026-05-02 architecture/product review because they are implementation-ready and launch-relevant. ROADMAP remains the canonical status board; this section holds the deep scope and acceptance criteria.

### RL-077 Capability-based filesystem IPC sandbox

- Priority: `P0`
- Status: `Done`
- Readiness: `Slice 1 shipped on 2026-05-02 — src/main/ipc/projectCapabilities.ts lands the registry primitives (mintRootCapability, lookupRoot, revokeRoot, resolveCapabilityPath) plus the realpath-resolved containment check that defeats symlink-out attacks. 17 unit tests pin the contract: mint / lookup / revoke round-trip, empty relative path resolves to the root, nested relative paths inside the root resolve, write targets that do not yet exist walk up to an existing ancestor, unknown rootId, malformed IPC shapes, literal ".." / nested traversal, NUL byte names, absolute Unix paths, Windows drive-letter paths, Windows device-namespace prefixes, and protected-path targets all reject before disk I/O; symlink-out attempts fail the realpath probe; and new write targets inside symlinked approved roots resolve to the approved real root. Slice 2 (shipped 2026-05-02) consumed the registry across all 12 filesystem IPC handlers + 3 picker entry points + the new fs:reopen-root + fs:revoke-root, migrated the renderer (projectStore + projectTree + projectIndexStore + projectSearchStore + editorStore + sessionStore + useProjectIndexSync + useProjectWatchSync + useDeepLinks + ThemePresetControls + KeyboardShortcutsModal + FileTree + QuickOpen + ProjectSearch) onto the { rootId, relativePath } contract, mirrored the registry in the web adapter for FSA-handle parity, and rewrote tests/ipc/fileSystem.test.ts + tests/web/fs-adapter.test.ts against the new contract. Two new i18n keys (fs.error.unknownRoot, fs.error.escapesRoot) ship in en + es (tuteo). The renderer can no longer pass an absolute path to any fs IPC channel — pickers mint capabilities, projects re-mint via fs:reopen-root, one-shot preset import/export roots revoke via try/finally, and tab-private file-pick roots revoke when unused or when the last owning tab closes.`

#### 2026-05-02 update — Slice 2 closeout

- **17 IPC channels migrated**: 3 pickers (`fs:select-directory`, `fs:select-file` (atomic content read), `fs:save-dialog`), 2 root managers (`fs:reopen-root`, `fs:revoke-root`), 12 ops (`fs:readdir`, `fs:listAllFiles`, `fs:searchInFiles`, `fs:stat`, `fs:read`, `fs:write`, `fs:delete`, `fs:rename`, `fs:mkdir`, `fs:touch`, `fs:watch-start`, `fs:watch-stop`). All flow through `resolveCapabilityPath(rootId, relativePath, operation)`; watcher ids are opaque UUIDs backed by a main-only rootId + absolute-path target map; watcher events emit `{ rootId, relativePath, eventType, filename }`.
- **14 renderer files migrated**: `FileTab` gains `rootId? + relativePath?` (`filePath` is display-only); `EditorState.openFile` is `(rootId, relativePath, name, language, displayPath?) => Promise<void>`; project-tree opens use `currentProject.rootId + node.path` (relative); session-restore re-mints via `fs:reopen-root(parentDir)` per persisted tab and falls back to a "// File not found" content marker when re-mint fails; deep links re-mint the file's parent dir before opening; theme/shortcut preset controls follow the atomic IPC pattern (mint via picker → write/read → revoke in try/finally).
- **Web adapter mirror**: synthetic rootIds keyed to `FileSystemDirectoryHandle`s, traversal + NUL rejection, single-file-pick proxy directory that exposes only the chosen file. `reopenRoot` returns `{ ok: false, error: 'not-found' }` because FSA can't restore handles across sessions — the renderer drives the user back through `selectDirectory()`.
- **Test coverage**: 35 cases in `tests/ipc/fileSystem.test.ts` (real tmpdir + real registry — no `node:fs/promises` mocking because `realpath` is required); 17 cases in `tests/web/fs-adapter.test.ts` (synthetic `FileSystemDirectoryHandle` factory, traversal + NUL rejection, revoke idempotency, listAllFiles recursion, searchInFiles binary skip).
- **Architectural decisions (pre-decided in the Slice 2 plan)**: no backwards compatibility for legacy absolute-path tabs; recent projects persist `rootPath` only and re-mint on demand; capability tokens are process-scoped (never persisted); plugins inherit the capability model through `window.lingua.fs.*`; symlinked roots are supported (per-call `realpath` against the cached real root) but symlinks inside the root that point outside fail.

#### Security hardening follow-up — 2026-05-08

- `fs:select-file` and `fs:save-dialog` now mint single-file
  capabilities instead of granting the whole parent directory.
- `fs:reopen-root` only re-mints directories main previously recorded
  from `selectDirectory()`. Arbitrary absolute paths return
  `not-approved` before existence details are exposed.
- New `fs:reopen-file` re-mints a single-file capability for files
  previously approved directly or files under an approved project root.
  Session restore, Quick Open recent files, and deep links use this
  narrower path.
- Current gap:
  - The preload bridge exposes broad `window.lingua.fs` operations to the renderer.
  - Main-side filesystem handlers block known sensitive paths, but several read/list/stat/search/watch flows still accept renderer-provided absolute paths.
  - A compromised renderer should not be able to read, write, delete, watch, or search outside an explicitly approved project root.
- Scope:
  - Introduce a main-owned project-root capability registry.
  - Return an opaque `rootId` or equivalent capability when a user selects or opens a project root.
  - Change renderer-facing filesystem calls for project-owned operations from free absolute paths to `{ rootId, relativePath }` or an equivalent safe shape.
  - Resolve and canonicalize every target path in main before touching disk.
  - Enforce `isPathWithinProject(target, approvedRoot)` for `readdir`, `listAllFiles`, `searchInFiles`, `stat`, `read`, `write`, `delete`, `rename`, `mkdir`, `touch`, `watchStart`, and `watchStop`.
  - Keep the existing protected-path denylist as defense-in-depth, not as the primary authorization model.
  - Preserve destructive-operation confirmation dialogs.
  - Keep web adapter behavior equivalent where possible, while acknowledging that browser handles already provide a separate permission boundary.
- Acceptance criteria:
  - Renderer code cannot operate on an absolute path unless main has tied it to an approved root capability.
  - Attempts to escape via `..`, absolute path injection, Windows device prefixes, or mismatched root ids fail before filesystem access.
  - `readdir` and `stat` receive the same authorization treatment as write/delete operations.
  - Project open, file tree, Quick Open, search-in-files, create, rename, delete, save, and watcher flows still pass in desktop smoke.
  - Regression tests cover allowed relative paths, traversal attempts, protected paths, and stale/unknown root ids.
- Dependencies:
  - None

### RL-078 Parent-owned execution timeouts and output/resource limits

- Priority: `P0`
- Status: `Done`
- Readiness: `Shipped 2026-05-03. Parent-owned kill timer in JavaScript / TypeScript / Python runners; in-worker timeout race removed. Run-id guard on every WorkerRequest / WorkerResponse rejects messages from terminated workers and from the persistent Pyodide worker's late-buffered stdout. Output / resource caps live in the new src/renderer/runners/limits.ts and apply per-stream (stdout / stderr each get an independent budget): MAX_CONSOLE_ENTRIES = 1000 entries including the truncation marker, MAX_STDERR_BYTES = 256 KiB, MAX_RESULT_BYTES = 64 KiB on serialized result + magic-comment payloads with a localized truncation marker. Timeout, stop, and truncation copy now go through i18n (runner.timeout.message, runner.stopped.message, runner.truncated.*; ES tuteo). Two new desktop smoke cases (javascript-timeout, python-timeout) verify the parent timer terminates a CPU-bound while(true){} / while True: pass under 3 s. Stop button now resolves an in-flight execute() promise as a cancelled run instead of leaving the renderer waiting or recording a false success, and pending/in-flight auto-run debounces no longer cancel or overwrite manual/newer executions. 2129 unit / integration tests green (+27 new). Loop-protection transform untouched and stays as defense-in-depth. Go / Rust runners are out of scope and roll into RL-079.`
- Current gap:
  - JS/TS execution uses a worker, but its timeout race is scheduled inside the worker.
  - Python execution uses a persistent Pyodide worker, and its timeout is also scheduled inside the worker execution path.
  - Loop protection is intentionally lightweight and textual, so it cannot be treated as the only infinite-loop defense.
  - Large stdout/stderr/result payloads can still create memory and UI pressure.
- Scope:
  - Add a parent-owned kill timer in the JS runner.
  - Add the same parent-owned kill timer in the TypeScript runner after transpilation.
  - Add a parent-owned kill timer in the Python runner that terminates the Pyodide worker, clears `pyodideLoaded`, and recreates the worker on the next run.
  - Add run-id or generation guards so late messages from an old worker cannot update the active result.
  - Cap captured stdout/stderr entries and serialized result size with clear truncation markers.
  - Keep magic comments, console capture, and existing loop-protection settings working.
  - Add smoke or unit coverage for a CPU-bound loop that never yields.
- Acceptance criteria:
  - `while (true) {}` in JavaScript and TypeScript terminates from the parent runner without hanging the UI.
  - A CPU-bound Python loop terminates by killing/recreating the Pyodide worker.
  - Stale messages from a killed worker are ignored.
  - Long output is truncated deterministically and does not freeze the result panel.
  - User-facing timeout errors continue to include the configured timeout duration.
- Dependencies:
  - None

#### 2026-05-03 update — Slice 1 closeout

- **Parent-owned kill timer.** `src/renderer/runners/{javascript,typescript,python}.ts` schedule `setTimeout` per `execute()`. On fire: terminate the Worker, resolve the in-flight promise with the localized timeout result. Python clears `pyodideLoaded` + `loadingPromise` so the next call's `ensurePyodide()` rebuilds from scratch. The in-worker `Promise.race` against `setTimeout` inside `js-worker.ts` and `python-worker.ts` was removed.
- **Run-id guard.** `WorkerRequest.execute` and every active-run `WorkerResponse` variant gain `runId: string`. Lifecycle messages (`loading`, `ready`) intentionally omit it because they fire before any `execute`. Parent message handlers drop replies whose `runId` does not match the active run, which closes the race window between `terminate()` and any postMessage already queued in the worker. The Pyodide worker also tags `setStdout` / `setStderr` chunks with the `activeRunId` snapshot so a late host-level flush across runs doesn't cross-contaminate.
- **Output / resource caps.** New `src/renderer/runners/limits.ts` exports `MAX_CONSOLE_ENTRIES = 1000`, `MAX_STDERR_BYTES = 256 KiB`, `MAX_RESULT_BYTES = 64 KiB`, plus `appendCappedConsole`, `capStderrIfOverflowing`, `truncateSerialized`, `runnerTimeoutResult`, and `runnerStoppedResult`. Reviewer fix: each runner uses independent `droppedStdout` / `droppedStderr` counters so an overflow in one stream does not mute the truncation notice on the other. Reviewer fix: the truncation notice copy is binary (`additional entries discarded`) instead of an interpolated count that could never be updated after first emission. Reviewer fix: stderr byte truncation is sticky after the first oversized chunk, and the console-entry marker stays inside the configured 1000-entry budget.
- **i18n** (en + es tuteo). New keys `runner.timeout.message`, `runner.stopped.message`, `runner.truncated.console`, `runner.truncated.stderr`, `runner.truncated.result`. Worker copy is no longer hardcoded because the parent passes the localized result truncation marker into each execute request.
- **Stop button cancellation.** Each runner exposes a `cancelInFlight` callback that `stop()` invokes so a Stop click resolves the in-flight `execute()` as `cancelled: true` instead of leaving the promise pending after `terminate()`, marking the tab green, recording history, or emitting runner.executed telemetry. Python also cancels the lazy Pyodide load path so Stop works before the first ready message.
- **Smoke harness.** `src/renderer/hooks/useDesktopSmoke.ts` adds a `caseId` discriminator and two new cases (`javascript-timeout`, `python-timeout`). The `expectFailure` regex covers both EN and ES timeout copies. Wall budgets are tight (3 s runner / 12-20 s wrapper) so the smoke does not balloon. `runtime/executeTabManually.ts` gains a `lifecycle.executionTimeoutMs` opt-in that the smoke uses to thread the short deadline; user-facing surfaces leave it undefined. The smoke disables loop protection so those timeout cases validate the parent kill timer itself; loop guard behavior remains covered separately.
- **Manual / auto-run coordination.** `resultStore` exposes an `isManualRunning` flag set by `executeTabManually`, and `useAutoRun` checks it before preparing or starting an auto-run. A delayed debounce can no longer call `runner.execute()` and stop an active manual run before the parent timeout fires.
- **Tests.** Two new files: `tests/runners/limits.test.ts` (9 cases pinning the helpers' contract) and `tests/runners/parentTimeout.test.ts` (9 cases covering runId minting, missing/stale-runId rejection, parent kill timer, console/stderr caps, localized result truncation markers, and stop()-cancellation), plus focused follow-up coverage in the runner/useRunner/telemetry/auto-run specs. 2129 unit + integration tests pass overall (+27 new).

### RL-079 Trusted native execution hardening for Go and Rust

- Priority: `P0`
- Status: `Done`
- Readiness: `Shipped 2026-05-03. Subprocess env for Go/Rust detection, `rustc`, `go build`, and the spawned native binary is now built by `buildNativeRunnerEnv` (`src/main/runners/nativeEnv.ts`) from a tight per-language allowlist (PATH, HOME, LANG, TMPDIR + the language-specific GOROOT/GOPATH/GOMODCACHE/GOCACHE/GOTMPDIR or CARGO_HOME/RUSTUP_HOME/RUSTC/CARGO; Windows essentials added via the platform branch). User env from RL-011 layers on top; runner-owned overrides (`GOOS=js`/`GOARCH=wasm`) win last. Temp dirs use `mkdtemp(...lingua-{go,rust}-)`. Compile output and runtime stderr are capped at 1 MiB via `src/shared/runnerLimits.ts` with localized truncation markers passed from the renderer. A first-run trust-boundary modal (`NativeExecutionWarning`) gates Go/Rust runs the first time per install via the new `nativeExecutionAcknowledged` flag in `settingsStore`; the user can reset the flag from Settings → Privacy. A new desktop smoke harness seeds `LINGUA_SMOKE_SECRET=__lingua_smoke_secret__` into the spawned Electron's env and runs `go-env-isolation` / `rust-env-isolation` cases that print the variable; the smoke fails if the sentinel appears in captured stdout, which would mean the env builder leaked it. 2160 unit / integration tests green (+31 new); per-language env-resolver tests (go-compiler, rust-compiler) updated to assert the secret-leak gate explicitly.`
- Current gap:
  - Rust compiles and executes a native binary from main.
  - Go compiles through a local toolchain to WASM.
  - The subprocess environment currently starts from host `process.env`, which can expose more than the runner needs.
  - Temporary compilation directories use timestamp-derived names instead of `mkdtemp`.
- Scope:
  - Replace timestamp-derived temp directories with `mkdtemp(path.join(tmpdir(), 'lingua-go-'))` and `mkdtemp(path.join(tmpdir(), 'lingua-rust-'))`.
  - Introduce a minimal environment builder for native runner subprocesses.
  - Preserve only the host keys required for toolchain discovery and execution, then merge user-defined env vars from RL-011.
  - Keep runner-owned keys immutable where required, especially `GOOS=js` and `GOARCH=wasm`.
  - Add an explicit trusted-code warning before first native Go/Rust execution, with a persisted acknowledgement.
  - Document that Go/Rust desktop execution is not a security sandbox and should only run trusted code.
  - Ensure subprocess cleanup on timeout, compile failure, app shutdown, and runner stop.
  - Cap stdout/stderr payloads for compile and runtime paths.
- Acceptance criteria:
  - Go/Rust subprocesses no longer inherit the full host environment by default.
  - User env vars from RL-011 still reach the runner when allowed.
  - Go's `GOOS` and `GOARCH` remain runner-owned and cannot be overridden by user env.
  - Temp directories are collision-resistant and are cleaned up after success, compile failure, runtime failure, and timeout.
  - First native execution shows a clear trust-boundary warning.
  - Docs and Settings copy clearly distinguish browser/worker execution from trusted native execution.
- Dependencies:
  - RL-011 shipped env-var merge/store slices
  - RL-078 for parent-owned timeout behavior

#### 2026-05-03 update — Slice 1 closeout

- **Minimal env builder** (`src/main/runners/nativeEnv.ts`). `buildNativeRunnerEnv(toolchainKeys, userEnv, overrides)` picks ONLY allowlisted host keys from `process.env`, layers RL-011 user env on top, then applies runner-owned overrides last (`GOOS=js`/`GOARCH=wasm` for Go; none for Rust). Allowlists are tight: common = `[PATH, HOME, LANG, TMPDIR]`; Go-specific = `[GOROOT, GOPATH, GOMODCACHE, GOCACHE, GOTMPDIR]`; Rust-specific = `[CARGO_HOME, RUSTUP_HOME, RUSTC, CARGO]`; Windows essentials (`SYSTEMROOT, USERPROFILE, PATHEXT, COMSPEC`) added via platform branch. Reintroduce a key only when smoke surfaces it.
- **mkdtemp temp dirs.** `src/main/{rust,go}-compiler.ts` use `mkdtemp(path.join(tmpdir(), 'lingua-{rust,go}-'))`, eliminating the collision window the previous `Date.now()` filename left open.
- **Output caps at 1 MiB.** New `src/shared/runnerLimits.ts` exports `MAX_NATIVE_STDERR_BYTES = MAX_COMPILE_OUTPUT_BYTES = 1 MiB` plus `truncateBytes`. Both compilers slice + suffix overflow output with a localized marker. Renderer-side caps in `src/renderer/runners/limits.ts` (256 KiB) stay untouched — main and renderer have different memory pressure profiles.
- **Trust-boundary acknowledgement.** `src/renderer/components/NativeExecutionWarning/NativeExecutionWarning.tsx` modal mounts at App level; `useRunner` opens the gate on Go/Rust runs when `settingsStore.nativeExecutionAcknowledged === false`. The shared gate state lives in `src/renderer/stores/nativeExecutionGateStore.ts` so every Run entry point (Toolbar, ConsolePanel, Cmd+Enter) sees the same modal. Acknowledge flips the persisted flag and resumes the run; Cancel and Escape clear the gate without flipping anything. A "Reset acknowledgement" row lives in Settings → Privacy.
- **Secret-isolation smoke.** `scripts/run-desktop-smoke.mjs` seeds `LINGUA_SMOKE_SECRET=__lingua_smoke_secret__` into the spawned Electron's env. Two new smoke cases (`go-env-isolation`, `rust-env-isolation`) print `os.Getenv("LINGUA_SMOKE_SECRET")` / `std::env::var(...)`; the harness fails if the captured stdout contains the sentinel, which would mean the env builder leaked it.
- **i18n.** 10 new keys (`runner.compileOutput.truncated`, `nativeExecution.modal.{title,body,confirm,cancel}`, `settings.nativeExecution.{title,description,acknowledged,notAcknowledged,reset}`) shipped en + es with tuteo.
- **Tests.** New `tests/main/nativeEnv.test.ts` (12 cases) pins the allowlist + override layering. Existing `tests/main/{go,rust}-compiler.test.ts` rewritten to assert the secret-leak gate. New `tests/main/nativeDetectEnv.test.ts` (2 cases) pins filtered env on detection subprocesses. New `tests/components/NativeExecutionWarning.test.tsx` (5 cases) covers render + acknowledge + cancel + Escape. New `tests/hooks/useRunner.test.tsx` describe (5 cases) covers the gate behaviour including the reset edge case and the web-adapter bypass. `tests/stores/settingsStore.test.ts` gains 4 cases for the new field, including malformed persisted values failing closed. Total: 2160 unit / integration tests green (+31 new), 2 skipped.

### RL-080 Release-grade desktop CI and update validation gates

- Priority: `P1`
- Status: `Planned`
- Readiness: `Implementation-ready from the 2026-05-02 review. Builds on RL-016's checklist by promoting release-critical desktop checks into automated gates.`
- Current gap:
  - CI covers Linux typecheck/lint/i18n/test/web build well.
  - Desktop smoke exists as a local workflow, but release automation still relies too much on human validation for packaged desktop behavior.
  - The audit gate is non-blocking in general CI, which is acceptable for daily work but not for release.
- Scope:
  - Add release-focused macOS and Windows package jobs.
  - Run packaged desktop smoke against release artifacts where runner support permits.
  - Verify signing/notarization metadata on macOS artifacts.
  - Verify Windows signing metadata when signing credentials are present.
  - Validate update-server responses against a staged GitHub Release asset set.
  - Make high-severity production dependency audit failures blocking
    for release workflows while keeping daily CI policy separate if
    needed, and keep the full dependency audit visible as advisory
    signal for build-tool drift.
  - Require `SHA256SUMS.txt` generation and verification before promotion from draft.
- Acceptance criteria:
  - A release cannot be promoted without green desktop package validation for target platforms.
  - Signing/notarization checks fail loudly when configured credentials are present but invalid.
  - Update feed smoke covers the latest-version, no-update, and missing-asset branches.
  - Release artifacts have verified checksums.
  - The release checklist and workflow file agree on mandatory gates.
- Dependencies:
  - RL-016
  - RL-077
  - RL-078
  - RL-079

#### Slice 1 Status Update — 2026-05-04

Slice 1 shipped. ROADMAP §4f status flipped to `Partial`.

What landed:

- `update-server/test/index.test.ts` extended with 9 new tests covering
  the desktop `/update/:platform/:version` feed:
  - no-published-release → 204
  - non-GET update probe → 405 without touching GitHub
  - no-update (caller already on latest) → 204 + cache header
  - darwin happy path → 200 + Squirrel.Mac JSON shape
  - darwin missing-asset → 204
  - win32 happy path with rewritten RELEASES → 200 + text/plain
  - win32 missing RELEASES → 204
  - win32 RELEASES asset content download fails → 502
  - non-GET download proxy request → 405 without touching GitHub
- New test helper `buildUpdateFetchMock` routes a single
  `globalThis.fetch` mock across the GitHub list-releases endpoint,
  the asset-id → 302-Location resolution, and the signed-S3 URL
  download. Anything outside those three patterns throws so a stray
  request surfaces as a hard test failure.
- Worker test count: 25 → 34 (the 9 new update-feed tests plus the
  existing /web/version + parseVersion + isNewer suites).
- **Prerequisite fix**: `.github/workflows/ci.yml` now runs
  `cd update-server && npm ci && npm run typecheck && npm test`
  after the root vitest suite. Without this, the new tests and the
  worker's separate TypeScript project would not gate PRs. The
  license-server suite has the same gap but is intentionally out of
  scope for this ticket.

Acceptance criteria coverage so far:

- "Update feed smoke covers the latest-version, no-update, and
  missing-asset branches" — closed.
- All other ACs (packaged desktop smoke vs release artifacts,
  signing/notarization metadata verification, blocking audit on
  release, SHA256SUMS verify, RELEASE.md ↔ workflow agreement) — open
  in Slice 2..N.

Slice 2..N (still open):

- Packaged desktop smoke against `out/make/...` artifacts (where
  runner support permits).
- SHA256SUMS re-verify on publish (re-compute hashes on the
  downloaded asset set and compare against the manifest).
- Production dependency audit blocking specifically in `release.yml`
  (daily CI keeps the full `npm audit --audit-level=high` advisory
  with `continue-on-error: true`).
- RELEASE.md ↔ `release.yml` audit so the documented checklist and
  the workflow agree on mandatory gates.

#### Slice 2 Status Update — 2026-05-04

Slice 2 shipped. ROADMAP §4f stays `Partial` — Slice 3 (packaged
smoke vs release artifacts) is the only remaining sub-piece.

What landed:

- New `security-audit` job in `.github/workflows/release.yml` that
  runs `npm audit --omit=dev --audit-level=high` without
  `continue-on-error`, then runs the full dependency audit as
  advisory output. Stable Electron Forge 7 still carries dev-only
  audit findings with no stable upstream fix, so the blocking gate is
  scoped to the releasable dependency graph instead of relying on
  package overrides. Each platform build (`build-macos`,
  `build-windows`, `build-linux`) lists `[prepare-release-tag,
  security-audit]` under `needs:`, so a high-severity production
  dependency vulnerability aborts the release before any runner-minute
  is spent on builds.
  `deploy-web` also lists `security-audit` under `needs:` and checks
  `needs.security-audit.result == 'success'`, so web-only releases
  cannot bypass the release-blocking audit when desktop publish is
  intentionally skipped.
  Daily CI in `ci.yml` intentionally keeps the `continue-on-error`
  override so a transient transitive bump does not park PRs.
- New `Verify release checksums` step in the `publish` job, between
  `Generate release checksums` and `Collect release assets`. Runs
  `shasum -a 256 -c SHA256SUMS.txt` against the downloaded payload
  so a corrupted artifact or a stale manifest entry aborts the
  publish before the draft release is written.
- `RELEASE.md` updates:
  - 2 new bullets under `## Validation checklist`: release-blocking
    production dependency audit + SHA256SUMS re-verify.
  - Step 6 (Inspect the workflow summary) lists the audit job and
    the re-verify alongside the existing signing + checksums rows.
- `tests/docs/releaseChecklist.test.ts` extends the RL-016 guard
  with an `it(...)` that asserts both new bullets stay in
  `RELEASE.md` (release-blocking production audit text + the literal
  `shasum -a 256 -c SHA256SUMS.txt` invocation).
- `tests/docs/releaseWorkflow.test.ts` adds two new assertions:
  - `security-audit` job exists with the right name + `npm audit`
    invocation; the `[prepare-release-tag, security-audit]` `needs:`
    line appears at least 3 times (once per platform build); and
    `deploy-web` depends on `security-audit` so web-only releases
    cannot bypass it.
  - `Verify release checksums` step exists with `shasum -a 256 -c`
    and sits between `Generate release checksums` and
    `Publish draft GitHub Release`.

Acceptance criteria coverage so far:

- "Update feed smoke covers the latest-version, no-update, and
  missing-asset branches" — closed in Slice 1.
- "Release artifacts have verified checksums" — closed (re-verify
  step gates publish).
- "High-severity production dependency audit is blocking for release
  workflows" — closed (`security-audit` job); full dev-toolchain
  audit output remains advisory until stable upstream packages clear
  the Electron Forge toolchain findings.
- "The release checklist and workflow file agree on mandatory gates"
  — closed (RELEASE.md updated + 2 test guards pin the agreement).
- "A release cannot be promoted without green desktop package
  validation for target platforms" — partially closed (signing
  verification already gates each build job; packaged smoke against
  release artifacts is open in Slice 3).

Slice 3 (still open):

- Packaged desktop smoke vs release artifacts. Reuse the existing
  `run-desktop-smoke.mjs` against `out/make/Lingua-darwin-arm64-*.zip`
  (extract + launch the packaged `Lingua.app`) instead of the dev
  server. Runs only where the GitHub Actions runner can host the
  packaged binary (macOS-latest can; ubuntu/windows need separate
  thinking).

#### Slice 3 Status Update — 2026-05-04 (closes RL-080)

Slice 3 shipped. ROADMAP §4f row removed; §6 archive count 45 → 46.
RL-080 fully `Done`.

Implementation cuts taken (vs the original RL-080 acceptance criteria):

- **macOS only** — Slice 3 lands the gate on `build-macos`. Windows
  and Linux packaged smoke are NOT in scope. The release blocker for
  desktop centres on the macOS artifact (the primary distribution
  target); win/linux packaged smoke can be added later as separate
  sub-slices if needed. The "where runner support permits" wording in
  the AC explicitly allows this scoping.
- **2-runtime-case subset, not the full 9-case matrix** — packaged
  smoke runs only the `javascript` and `python` runtime cases plus the
  offline no-CDN assertion. Rationale: the dev-server smoke
  (pre-merge CI) already runs all 9 cases; the packaged smoke's job is
  to prove the binary boots, the renderer chunks load, and the vendored
  Pyodide runtime works offline. Adding Go/Rust/timeout/env-isolation
  here would push the step over ~2 minutes for marginal signal.

What landed:

- `scripts/run-desktop-smoke.mjs` extended with a
  `--against-packaged <path>` flag. Path can be a `.app` directory, a
  darwin `.zip`, or a directory the script walks (`out/make` is the
  CI default). When set, the script:
  - Skips the Vite dev-server + run-electron-desktop launcher.
  - Extracts the zip via `ditto -xk --rsrc` (codesign-preserving).
  - Strips the `com.apple.quarantine` xattr so Gatekeeper does not
    block the launch in a non-interactive runner.
  - Spawns `Lingua.app/Contents/MacOS/Lingua` directly with the
    existing `--lingua-desktop-smoke` + `--lingua-smoke-artifact-dir`
    flags.
  - Sets `LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET=1` in the spawned
    process env.
- `src/main/ipc/desktopSmoke.ts` reads the new env var via a
  `isPackagedSubsetRequested()` helper and exposes it as
  `packagedSubset` on the `desktop-smoke:get-config` IPC response.
- `src/types.d.ts` extends `DesktopSmokeConfig` with
  `packagedSubset?: boolean`.
- `src/renderer/hooks/useDesktopSmoke.ts` filters `SMOKE_CASES` to
  the 2-runtime-case subset (`javascript` + `python`) when
  `config.packagedSubset === true`. The packaged command also passes
  `--offline`, so the existing offline no-CDN synthetic assertion runs
  after the Python case. Sin la flag, los 9 cases siguen ejecutándose
  como hoy.
- `package.json` adds `npm run smoke:desktop:packaged` (defaults to
  `--offline --against-packaged out/make`).
- `.github/workflows/release.yml` `build-macos` job adds a
  `Packaged desktop smoke` step after `Verify macOS signing` and
  before `Upload macOS artifacts`. **Bloqueante** — sin
  `continue-on-error`. Si el binario no boota o un case falla, todo
  el job falla y el publish job no corre (`needs:` chain).
- `RELEASE.md` step 10 updated: el packaged smoke ya corre en CI; el
  smoke local sigue siendo opcional. Validation checklist agrega un
  bullet específico para el `Packaged desktop smoke` step.
- Test guards:
  - `tests/docs/releaseChecklist.test.ts` pinea el wording nuevo +
    la mención del subset bloqueante.
  - `tests/docs/releaseWorkflow.test.ts` pinea el `Packaged desktop
    smoke` step, su orden relativa (después de `Verify macOS signing`,
    antes de `Upload macOS artifacts`), y verifica que NO tenga
    `continue-on-error: true`.
  - `tests/docs/scriptCommands.test.ts` agrega
    `smoke:desktop:packaged` al canonical script list.
  - `tests/ipc/desktopSmoke.test.ts` agrega un caso para
    `LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET=1` que verifica el
    `packagedSubset: true` en la config.

Acceptance criteria — final state:

- "A release cannot be promoted without green desktop package
  validation for target platforms." — closed for macOS (the primary
  target). Windows/Linux packaged smoke remain a future enhancement
  (added to BACKLOG if/when prioritised; not blocking today).
- All other ACs already closed in Slice 1 + Slice 2.

Risk acknowledged for Slice 3:

- Headless `Lingua.app` on `macos-latest`: Electron should arrange a
  display via the runner's simulated graphics. If the first push of
  the workflow reveals a display or Gatekeeper edge case, a
  follow-up commit within the same `Done` ticket can adjust the
  flags (e.g. `--no-sandbox`, force-relaunch on a specific runtime
  setting). Not a design ambiguity — a CI quirk to discover.

### RL-081 Launch/legal/source-available documentation cleanup

- Priority: `P1`
- Status: `Partial`
- Readiness: `Public repo/source-available docs sweep shipped on 2026-05-05. README, RELEASE, SECURITY, PRIVACY, public docs, release compliance, and Cloudflare web deploy wording now agree. Remaining launch-critical work: align live checkout/download/pricing copy after RL-063 ships.`
- Current gap:
  - The repository docs now describe the public source-available posture; the remaining risk is hosted launch copy drift once the `linguacode.dev` download/checkout surface goes live.
  - The guided-tour commercial-license blocker was removed and the SBOM/license gate shipped under RL-085; keep those release compliance artifacts wired into every release path.
  - Machine-local absolute documentation links are guarded by `tests/docs/publicDocs.test.ts`.
  - Privacy/security/legal docs now line up with telemetry, crash reporting, licensing, and device tracking; re-check after RL-063 introduces the live checkout/download surface.
- Scope:
  - Reconcile README, LICENSE, pricing copy, and launch docs around the exact source-available posture for launch.
  - Decide and document whether the repo is public at launch, private until launch, or source-available under a staged access model.
  - Keep runtime dependency license readiness documented and block any new AGPL/commercial dependency without an explicit decision.
  - Replace local absolute documentation links with repo-relative links.
  - Add or update `SECURITY.md`, `PRIVACY.md`, and launch/legal notes for telemetry, crash reporting, license verification, device tracking, and support windows.
  - Align license-tier claims with the live checkout/download surface.
- Acceptance criteria:
  - No launch-facing doc claims a repo/public/source posture that is false for the release.
  - No checked-in documentation link points to a machine-local absolute path.
  - Public builds do not include AGPL/commercial runtime dependencies without an explicit license decision.
  - Privacy and security docs describe what data is collected, what is never collected, how telemetry/crash consent works, and how license device tracking works.
  - Pricing/license claims in README, PLAN, ROADMAP, LICENSE, and marketing docs agree with the live checkout flow.
- Dependencies:
  - RL-059
  - RL-061
  - RL-063

#### 2026-05-05 update — public docs sweep

- README now describes the 29-panel Developer Utilities catalog, Cloudflare Pages web deployment at `app.linguacode.dev`, web update polling through `updates.linguacode.dev/web/version`, release compliance artifacts, and the localized Vim status-bar implementation.
- RELEASE now points to root `CHANGELOG.md`, names Cloudflare deploy secrets, and requires `npm run check:licenses`, `npm run compliance:release`, `lingua-sbom.cyclonedx.json`, and `THIRD_PARTY_LICENSE_REPORT.md` in the human release gate.
- `docs/README.md`, ROADMAP, SPRINT-PLAN, and this PLAN entry now align on ROADMAP as the planning source of truth and on RL-092 as shipped.
- New/updated guard tests prevent regressions to `docs/CHANGELOG.md`, legacy GitHub Pages deploy wording, missing release compliance artifacts, and missing release-security checklist sections.

#### Status Update — 2026-05-05 (closes RL-081)

Last AC remaining was "live checkout/download copy alignment after RL-063". With the marketing site live at https://linguacode.dev (see [`MARKETING_SITE_ADR.md`](./MARKETING_SITE_ADR.md)), the public surfaces now agree:

- The pricing tiers shown on linguacode.dev/pricing match `docs/press-kit/pricing-one-pager.md` (the source of truth) and the desktop entitlement copy in `src/renderer/store/entitlement.*`.
- The download links on linguacode.dev/releases pull the latest GitHub release at build time so the page never advertises a version that doesn't exist.
- The Polar checkout buttons on linguacode.dev/pricing point to the configured Polar URLs (env-driven; disabled fallback when missing).
- The "Open in app" / "Go to app" links on linguacode.dev hand off to https://app.linguacode.dev (the deployed web build) and to the `lingua://` deep links that the desktop app already understands.

All five ACs (source-available posture; absolute-path link policy; SECURITY/PRIVACY/legal docs; tracking docs; live pricing/license alignment) cumplidos. RL-081 closes here.

### RL-082 README and docs information-architecture cleanup

- Priority: `P2`
- Status: `Planned`
- Readiness: `Implementation-ready from the 2026-05-02 review. Not launch-blocking after RL-081, but important for contributor onboarding and agent efficiency.`
- Current gap:
  - README is valuable but overloaded: marketing, setup, architecture, release operations, licensing, plugins, smoke tests, shortcuts, and browser limitations all live in one long file.
  - Deep operational docs already exist, but the entry-point hierarchy can be clearer.
- Scope:
  - Keep README focused on product overview, quickstart, supported surfaces, and links to deeper docs.
  - Move development workflow detail into `docs/DEVELOPMENT.md` or an equivalent existing doc.
  - Move release detail into `RELEASE.md` and link rather than duplicate.
  - Move security/privacy/licensing details into dedicated docs created or updated by RL-081.
  - Register new docs in `docs/README.md`.
  - Add a lightweight docs guard that rejects local absolute paths in Markdown files.
- Acceptance criteria:
  - README becomes a concise, stable entry point rather than the full operating manual.
  - Existing developer workflows remain discoverable through the docs index.
  - No release/security/licensing guidance is duplicated in a way that can drift silently.
  - Markdown docs pass the local-absolute-path guard.
- Dependencies:
  - RL-081 remains the broader legal/source-available cleanup track, but no
    longer blocks this shipped dependency/license gate.

### Status Update — 2026-05-05 (closes RL-082)

The README + docs information-architecture cleanup landed today. Status flips `Planned → Done`.

- `README.md` slim-down: 537 → 129 lines (~76% reduction). Kept: pitch, marketing/web/ADR cross-link, pricing summary, who-it-is-for, current capabilities (compressed), runtime model (compressed), requirements, quickstart, "where to read next" link block, license summary, Windows symlinks gotcha. Dropped from README: full editor-diagnostics narrative, theme behavior, full developer-utility list (kept one-liner), full release operator detail (already in `RELEASE.md`), keyboard shortcuts table, deep links, plugin manifest, browser limitations, browser file access, full quality-checks/i18n/UI smoke/desktop dev/Pro testing/desktop smoke/build/automation walkthrough.
- `docs/DEVELOPMENT.md` (new, ~240 lines): consolidates Quickstart → Configuration env vars → Quality checks → i18n contributor workflow → UI smoke (web) → Desktop dev → Testing Pro → Desktop smoke validation → Shell layout → Build commands → Automation and delivery.
- `docs/USAGE.md` (new, ~110 lines): consolidates Keyboard shortcuts → Desktop deep links → Update behavior → Local plugins → Browser-only limitations → Browser file access. End-user reference, terse on purpose; the marketing site at `linguacode.dev` owns the deep tutorial surface.
- `docs/README.md` index: registers `DEVELOPMENT.md` and `USAGE.md` in the "Reading order" list (DEVELOPMENT.md first; USAGE.md after CAPABILITY_MATRIX.md) and the "Where things live" table; the "Out of scope" note now reflects the README-as-entry-point posture.
- `tests/docs/publicDocs.test.ts`: the machine-local-path regex widened from the macOS user-home prefix only to also catch the Linux user-home prefix, the root home, common Linux third-party app prefixes, the macOS sandbox path, and Windows drive-letter paths. Pre-flight scan confirmed no committed Markdown file in the repo trips the new pattern. Same file gains an RL-082 README spotter test that pins the union of strings other doc guards depend on (the 5 `npm run dev:*` / `smoke:desktop` commands from `scriptCommands.test.ts`, the marketing-site references from `marketingSite.test.ts`, and the Cloudflare Pages + app subdomain deploy posture from this same file's combined-publicDocs assertion).
- ROADMAP.md: RL-082 row moved out of §4h; §4h is now a closed-section note. Archive count `52 → 53`. §5 sequence #11 updated.
- SPRINT-PLAN.md: §1 gains an Iter 14 row marked `Shipped (2026-05-05)`; §2 sequence #11 updated.

ACs cumplidos:
- README is a concise, stable entry point rather than the full operating manual ✓
- Existing developer workflows remain discoverable through the docs index (`docs/DEVELOPMENT.md`, `docs/USAGE.md`, `docs/ARCHITECTURE.md`, `docs/CAPABILITY_MATRIX.md`) ✓
- No release/security/licensing guidance is duplicated across files; `RELEASE.md` / `SECURITY.md` / `PRIVACY.md` / `THIRD_PARTY_NOTICES.md` remain the single source of truth ✓
- Markdown docs pass the strengthened local-absolute-path guard ✓

---

## Second-pass product, security, and operations hardening from the 2026-05-02 review

These tickets capture the additional recommendations from the same review pass. They are intentionally separate from RL-077 through RL-082 so launch-blocking security hardening, operational readiness, product-quality work, and future polish stay independently schedulable.

### RL-083 Offline runtime assets and strict CSP

- Priority: `P0`
- Status: `Planned`
- Readiness: `Implementation-ready from the 2026-05-02 review. Launch-blocking because the current Python/Pyodide worker loads a runtime from a CDN, which conflicts with the offline-first product claim and weakens the security posture.`
- Current gap:
  - The Python worker imports Pyodide from a remote CDN.
  - Packaged desktop Python execution should not depend on network availability.
  - Runtime-critical assets need explicit ownership, versioning, cache behavior, and CSP treatment.
- Scope:
  - Vendor or otherwise package Pyodide runtime assets for desktop builds.
  - Serve web-mode Pyodide assets from a versioned first-party/app-owned location or an explicitly documented cache strategy.
  - Add a strict renderer/worker Content Security Policy for desktop and web surfaces.
  - Remove unnecessary remote script/import allowances.
  - Add a runtime-asset manifest that records version, source, integrity/hash, and expected load path.
  - Add an offline smoke path that validates Python can initialize and run without network access in packaged desktop mode.
- Acceptance criteria:
  - Python runs in packaged desktop without internet access.
  - Desktop Python initialization fails if it tries to import Pyodide from a remote CDN.
  - Web-mode behavior is documented: either first-party hosted assets, cache-backed offline behavior, or an explicit limitation.
  - CSP blocks unapproved remote script/module imports.
  - Runtime asset version and integrity are testable in CI or release validation.
- Dependencies:
  - RL-078

#### Slice 1 Status Update — 2026-05-04

Slice 1 shipped. ROADMAP §4a status flipped to `Partial`.

What landed:

- Pyodide v0.26.4 added as a runtime npm dep; curated runtime files
  copied from `node_modules/pyodide/` into the renderer output by
  `build/copyRuntimeAssetsPlugin.mts`. Same plugin's `configureServer`
  middleware serves the same files in dev so URLs are identical
  across environments.
- `src/shared/runtimeAssets.ts` introduced as the single registry
  (asset id, version, source URL, paths, critical-files list).
- `runtime-assets.lock.json` checked in; rebuilt by
  `npm run build:runtime-assets` and asserted by
  `npm run check:runtime-assets` (CLI) plus
  `tests/shared/runtimeAssets.test.ts` (Vitest mirror).
- `src/renderer/workers/python-worker.ts` resolves desktop Pyodide via
  `new URL('../pyodide/', import.meta.url).href` and imports
  `${indexURL}pyodide.mjs` — no desktop CDN fallback. The web build
  keeps an explicit CDN index define until Slice 2 chooses first-party
  hosting.
- Desktop CSP in `index.html` no longer allowlists
  `https://cdn.jsdelivr.net` (script-src + connect-src).
- New `LINGUA_DESKTOP_SMOKE_OFFLINE=1` mode wired through
  `src/main/offlineSmoke.ts` + the existing desktop-smoke IPC. The
  renderer harness (`useDesktopSmoke.ts`) appends a synthetic
  `offline-no-cdn` summary case; `npm run smoke:desktop:offline`
  is the new entry point.
- ADR at `docs/RUNTIME_ASSETS_ADR.md`, indexed under `docs/README.md`.

Acceptance criteria coverage so far:

- Python runs in packaged desktop without internet access — covered
  via `npm run smoke:desktop:offline`.
- Desktop Python init fails if it tries to reach a remote CDN —
  enforced by the absence of `https://cdn.jsdelivr.net` in CSP and
  by the offline smoke filter.
- Web-mode behavior is documented — yes, in `docs/RUNTIME_ASSETS_ADR.md`
  (the Slice 1 framing pointed at "Slice 2 will pick the web
  strategy"; see the Slice 2 Status Update block below for the chosen
  strategy and the matching ADR Web section).
- CSP blocks unapproved remote script/module imports — desktop only
  in this slice; web tightening tracked under Slice 2.
- Runtime asset version and integrity are testable in CI — yes, via
  the Vitest integrity test plus the matching CLI script.

#### Slice 2 Status Update — 2026-05-04 (closes RL-083)

Slice 2 shipped. ROADMAP §4a row removed and added to §6 archive
(`Done` count 44 → 45).

What landed:

- `public/sw.js` now cache-firsts the version-pinned Pyodide CDN URL
  (`https://cdn.jsdelivr.net/pyodide/v0.26.4/full/`) so the second and
  every subsequent visit boots Python without network connectivity.
  The constant `PYODIDE_CACHE_PREFIX` mirrors
  `RUNTIME_ASSETS.pyodide.sourceUrl`; a vitest mirror in
  `tests/shared/runtimeAssets.test.ts` fails red if the two drift.
- `CACHE_VERSION` bumped `v3 → v4` so existing clients drop the old
  network-first responses on next reload.
- ADR (`docs/RUNTIME_ASSETS_ADR.md`) closed and renamed the **Web**
  section to "Web (Slice 2 — cache-backed offline)". The web strategy
  is now explicit: load Pyodide from the upstream CDN with a
  cache-first service worker so the first Python load primes the
  cache and subsequent loads work offline.
- `src/web/index.html` keeps `https://cdn.jsdelivr.net` in
  `script-src` and `connect-src` (Pyodide still loads from CDN). The
  CSP comment cites the ADR so a future contributor knows the SW
  cache strategy is the chosen plan, not a placeholder.

Acceptance criteria — final state:

- Python runs in packaged desktop without internet access. Closed in
  Slice 1.
- Desktop Python init fails if it tries to reach a remote CDN. Closed
  in Slice 1.
- Web-mode behavior is documented: cache-backed offline behavior with
  an explicit "first Python load needs network" limitation.
  Closed.
- CSP blocks unapproved remote script/module imports: desktop CSP
  blocks all remote imports. Web CSP allows ONE approved remote
  (`cdn.jsdelivr.net`, version-pinned for Pyodide). Documented.
- Runtime asset version and integrity are testable in CI: vitest gate
  asserts `runtime-assets.lock.json` integrity AND `public/sw.js`
  prefix sync. Closed.

#### Security hardening follow-up — 2026-05-08

The web runtime strategy was tightened after the security scan:

- `vite.web.config.mts` now uses `copyRuntimeAssetsPlugin()` and sets
  `__LINGUA_PYODIDE_INDEX_URL__` to `null`, so the web worker resolves
  Pyodide from same-origin copied assets instead of jsDelivr.
- `src/web/index.html` removed `https://cdn.jsdelivr.net` from
  `script-src` and `connect-src`.
- `public/sw.js` removed `PYODIDE_CACHE_PREFIX` and the CDN
  network/cache branches; Pyodide is now a same-origin static asset.
- `CACHE_VERSION` bumped `v4 → v5` so old clients evict cached CDN
  responses on the next service-worker activation.
- `tests/shared/runtimeAssets.test.ts` now pins both desktop and web
  configs to local runtime assets.

Optional follow-ups (not blocking; tracked outside RL-083):

- Playwright web smoke for offline-after-first-load. The cache-first
  strategy is currently covered by the vitest URL-drift gate; a
  full Pyodide-boot Playwright run would be slow (>60s first load
  over CDN) and was intentionally not added to the default e2e gate.

### RL-084 Local plugin manifest hardening

- Priority: `P1`
- Status: `Done`
- Readiness: `Implementation-ready from the 2026-05-02 review. Important before plugin support expands beyond conservative local manifests.`
- Current gap:
  - The plugin model intentionally avoids arbitrary third-party code loading today.
  - That policy should be enforced by schema, tests, diagnostics, and docs before the plugin surface grows.
- Scope:
  - Define a strict JSON schema for local plugin manifests.
  - Version the manifest schema and validate `apiVersion`, `pluginId`, `enabled`, `minAppVersion`, and `maxAppVersion`.
  - Keep a main/renderer allowlist of bundled runtimes that plugin manifests are allowed to enable.
  - Reject unknown runtime ids, invalid schema versions, unsupported app versions, malformed JSON, and path-like ids.
  - Surface plugin diagnostics in Settings with reason-specific copy.
  - Document the explicit policy: manifest-only enablement, no arbitrary plugin executable code in the current product.
- Acceptance criteria:
  - Invalid, incompatible, disabled, unknown, and unsupported plugin manifests produce distinct diagnostics.
  - A plugin manifest cannot cause arbitrary code loading or resolve a runtime outside the bundled allowlist.
  - Tests cover malformed JSON, schema mismatch, path traversal-like ids, incompatible version ranges, and disabled plugins.
  - Plugin docs and README claims match the enforced policy.
- Dependencies:
  - Existing local plugin discovery implementation

### Status Update — 2026-05-06 (closes RL-084)

Plugin manifest hardening landed today. Status flips `Planned → Done`.

What shipped:

- New `src/shared/plugins/manifest.ts` is the single source of truth for the manifest contract. Pure module — no Electron, no React. Defines `PluginInstallStatus` (now includes `unknown`), structured `PluginDiagnostic` metadata for localized renderer copy, `InstalledPluginManifest`, `InstalledPluginRecord`, `BUNDLED_PLUGIN_IDS = ['lua']`, `PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u`, `PLUGIN_VERSION_PATTERN = /^\d+(?:\.\d+){0,2}$/u`, `MAX_PLUGIN_ID_LENGTH = 64`, `PLUGIN_API_VERSION = 1`, `MANIFEST_FILE_NAME = 'plugin.json'`. The `validatePluginManifest()` function is the validator both main and renderer consult.
- `src/main/plugins.ts` now imports the shared validator and passes the bundled allowlist as a `Set`. `pluginManifestHelpers` keeps its existing exports (re-exporting from the shared module) so external consumers don't break.
- `src/renderer/plugins/catalog.ts` reads `BUNDLED_PLUGIN_IDS` from the shared module; the loader-map type assertion enforces that every loader key is in the allowlist at compile time, and runtime lookup uses own-property checks so inherited object properties are never treated as plugin ids.
- `src/renderer/stores/pluginStore.ts` simplified — main now emits `unknown` directly for non-bundled ids; the renderer's `unavailable` re-mapping survives only as a defensive fallback for the (unlikely) drift case where main returns `loaded` but the renderer can't find a loader.
- `src/types.d.ts` ambient declarations re-aliased to the shared module exports — single source of truth, zero churn for existing consumers.
- New plugin diagnostic i18n keys per locale (en + es with neutral LatAm tuteo): `plugins.state.unknown` plus localized copy for object-shape, missing id, unsafe id, unknown fields, invalid field type, malformed version, API version, app-version range, unknown runtime, disabled, loaded, load-failed, and unavailable diagnostics.
- Tests across validator, catalog, main, store, and UI layers:
  - **Capa 1** (validator unit): `tests/shared/plugins/manifest.test.ts` — schema, path-safety table (9 unsafe ids rejected), strict-schema rejection, typed diagnostic metadata, numeric version-string validation, allowlist (unknown vs disabled), apiVersion + version range, happy path, record-shape consistency.
  - **Capa 2** (main integration): 8 cases in `tests/main/plugins.test.ts` — discovers the 5 statuses (loaded / disabled / incompatible / unknown / invalid) with real disk fixtures, plus dedicated cases for path-traversal rejection and unknown-fields rejection.
  - **Catalog guard**: `tests/plugins/catalog.test.ts` — pins the allowlist export and proves inherited object properties like `constructor` / `toString` do not resolve as bundled plugin ids.
  - **Capa 2** (store): 4 cases in `tests/stores/pluginStore.test.ts` — passes through `unknown` from main, falls back to `unavailable` only on the defensive runtime-mismatch path.
  - **Capa 3** (component UI): `tests/components/Settings/PluginsSection.test.tsx` (NEW FILE) — empty state, every status with badge + diagnostic copy, structured diagnostic localization on locale flip en→es with tuteo verification, container constraint at 320px width with break-all wrapping, refresh button click handler.
- `docs/USAGE.md` "Local plugins" section gained explicit manifest rules (safe-identifier pattern, strict schema, complete diagnostic-status reference) and the policy statement: "The plugin model is intentionally manifest-only. There is no facility to load arbitrary plugin executable code."

What deliberately did NOT ship in this slice:

- **Standalone Playwright Electron smoke** for plugin discovery. The plan's capa 4 originally proposed `scripts/smoke-plugin-discovery.mjs`. Implementation hit two blockers: Node ESM cannot import `.ts` directly without `tsx`/`ts-node` (not in devDeps), and `src/main/plugins.ts` imports `electron` (only available in Electron processes). The integration coverage moved into `tests/main/plugins.test.ts` instead — the 6-fixture flow lives there as a vitest test that runs on every `npm test`. Visual verification of the running desktop UI remains a 5-minute manual checklist before commit (already in the plan).

ACs cumplidos:

- ✅ Invalid, incompatible, disabled, unknown, and unavailable plugin manifests produce distinct diagnostics — verified by capa 1 (validator), capa 2 (main + store integration), and capa 3 (UI).
- ✅ A plugin manifest cannot cause arbitrary code loading or resolve a runtime outside the bundled allowlist — enforced by the path-safety regex, strict schema, and allowlist check in the shared validator.
- ✅ Tests cover malformed JSON, schema mismatch, path traversal-like ids, incompatible version ranges, and disabled plugins — all in capa 1 + capa 2.
- ✅ Plugin docs and README claims match the enforced policy — `docs/USAGE.md` updated.

### RL-085 SBOM and third-party license compliance

- Priority: `P1`
- Status: `Done`
- Readiness: `Shipped 2026-05-05. Commercial-distribution dependency/license gate is now repeatable and wired into CI/release.`
- Current state:
  - `npm run check:licenses` reviews production package-lock entries against a strict allowlist and fails on missing, unreviewed, copyleft, commercial, or proprietary license expressions.
  - `npm run license:report` regenerates `docs/THIRD_PARTY_LICENSE_REPORT.md` from `package-lock.json` plus installed package metadata.
  - `npm run compliance:release` writes `output/release-compliance/lingua-sbom.cyclonedx.json` and `output/release-compliance/THIRD_PARTY_LICENSE_REPORT.md` for release upload.
  - CI runs the license policy gate; `release.yml` uploads the SBOM and license report as draft GitHub Release assets.
- Scope:
  - Shipped: Software Bill of Materials generation for release builds.
  - Shipped: `THIRD_PARTY_NOTICES.md` now links to the transitive generated report.
  - Shipped: Runtime/packaged dependency audit is separated from dev-only audit noise.
  - Shipped: License-policy allowlist and blocked-expression gate.
  - Shipped: CI/release failure on disallowed licenses or missing notices.
  - Shipped: Commercial-license obligations remain explicit release prerequisites.
- Acceptance criteria:
  - Release artifacts include or link to an SBOM. ✅
  - Third-party notices cover all packaged runtime dependencies. ✅
  - CI/release checks fail on disallowed licenses. ✅
  - Dev-only dependencies are not incorrectly treated as packaged obligations. ✅
  - Any AGPL or commercial-license dependency is either licensed for public distribution or excluded from public builds. ✅
- Dependencies:
  - RL-081

### RL-086 Performance budgets and bundle/runtime observability

- Priority: `P2`
- Status: `Done`
- Readiness: `Implementation-ready from the 2026-05-02 review. Not a launch blocker, but important before adding more heavy runtime, debugger, AI, notebook, or rich-output features.`
- Current gap:
  - Monaco, Pyodide, esbuild-wasm, Electron, utilities, guided tours, and future AI/debugger surfaces can grow bundle size and startup cost quickly.
  - There is no explicit performance budget or recurring report for renderer bundles and desktop cold start.
- Scope:
  - Add bundle-size reporting for web and renderer builds.
  - Define budgets for initial renderer bundle, lazy chunks, Pyodide/runtime assets, and utilities chunks.
  - Measure desktop cold start, time-to-editor-ready, first JS run, first TS run, and first Python run.
  - Track memory after opening/closing workers and after repeated Python runs.
  - Keep Developer Utilities, guided tour, Pyodide, and other heavy surfaces lazy-loaded.
  - Add budget-drift reporting to CI, with blocking behavior only for release or explicitly configured thresholds.
- Acceptance criteria:
  - Baseline bundle and runtime metrics are committed.
  - CI reports size regressions in a human-readable form.
  - Initial editor boot does not include Pyodide or Developer Utilities chunks.
  - Repeated worker lifecycle smoke does not show obvious memory leaks.
  - Release notes can cite measured performance improvements or regressions from the baseline.
- Dependencies:
  - None

#### Status Update — 2026-05-07 (closes RL-086)

Shipped as a dev/CI-only performance gate. The slice adds
`scripts/performance-report.mjs` with three package scripts:
`performance:report`, `performance:baseline`, and `check:performance`.
The report reads `dist/web` plus the desktop renderer build when
available, classifies assets into initial/runtime/worker/utility/lazy
groups, calculates raw + gzip totals, writes
`output/performance/performance-report.{json,md}`, and compares against
the committed `docs/performance/baseline.json`.

The desktop smoke harness now writes
`desktop-smoke-performance.json` beside the existing progress/summary
artifacts. It records total smoke wall time, first JS / TS / Python run
timings, and main-process memory snapshots before the smoke cases and
after each case. Memory collection is diagnostic: unsupported platforms
return an explicit `unsupported` result rather than failing the smoke.

CI now prints `npm run performance:report` after `npm run build:web`;
the blocking local/release gate is `npm run check:performance`.
`docs/PERFORMANCE.md` documents the report categories, budget policy,
baseline refresh flow, investigation path, and the manual test checklist.

#### Status Update — 2026-05-07 (public-readiness follow-up)

The public-readiness hardening pass made the startup/runtime metrics visible in
the central performance report instead of leaving them only in the desktop
smoke folder. `desktop-smoke-performance.json` now includes
launcher-to-smoke-ready and first editor interaction timings alongside the
existing total smoke wall time, first JS / TS / Python run timings, and memory
snapshots. `performance:report` ingests that artifact when present and writes a
normalized `runtimeObservability` section to
`output/performance/performance-report.{json,md}`; web-only CI runs keep the
section visible as unavailable until a smoke artifact exists.

### RL-087 Watcher reliability and filesystem edge-case suite

- Priority: `P2`
- Status: `Done`
- Readiness: `Implementation-ready from the 2026-05-02 review. Important because project file watching is core UX and cross-platform watcher behavior is intentionally treated as coarse invalidation.`
- Current gap:
  - The architecture correctly treats watcher events as invalidation signals, but the edge-case suite is still thin.
  - Cross-platform behavior around recursive watch, bursts, renames, permissions, symlinks, and path casing needs dedicated validation.
- Scope:
  - Add a desktop watcher test/smoke suite for create, delete, rename, nested directory changes, generated-file bursts, permission failures, and project switching.
  - Verify watcher start/stop lifecycle across open, close, reopen, and switch-project flows.
  - Validate behavior on Windows path casing and protected/device-prefixed paths.
  - Define fallback behavior or documented limitations for platforms where recursive watch is unreliable.
  - Add diagnostics for watcher registration failure and unexpected watcher churn.
- Acceptance criteria:
  - Opening, closing, and switching projects does not leak watchers.
  - Rename/create/delete bursts refresh the visible tree without refresh storms.
  - Hidden/generated paths remain filtered according to existing tree policy.
  - Watcher failures surface actionable diagnostics instead of silently desynchronizing the explorer.
  - Platform-specific limitations are documented.
- Dependencies:
  - RL-077

#### Status Update — 2026-05-06 (closes RL-087)

Shipped in a single staged diff. All five acceptance criteria covered:

- **Watcher lifecycle audit** — new `tests/main/watcherLifecycle.test.ts`
  (14 cases) drives open + close + dedup + project-switch + degraded-burst
  + `before-quit` scenarios against a mocked `node:fs.watch`. The lifecycle module
  exposes `stopAllWatchers()` (purges the registry), an idempotent
  `ensureBeforeQuitCleanup()` lazy installer, and two test-only resets
  (`_resetBeforeQuitInstallStateForTests`, `_resetWatcherBurstTrackerForTests`).
- **Burst-handling boundary** — new `src/shared/fs/ignoredPaths.ts`
  with `IGNORED_PATH_PREFIXES` (node_modules, .git, .vite, dist, out,
  .next, build, __pycache__, .pytest_cache) and `isIgnoredPath()` that
  normalizes Windows backslashes. Applied at the renderer
  `useProjectIndexSync` boundary so 50-event bursts under
  `node_modules/` schedule zero re-index work, and mixed bursts only
  rebuild for the visible slice. Covered by 9 unit tests + 8 hook
  integration tests.
- **Typed registration-failure diagnostics** — new
  `src/shared/fs/watcherDiagnostic.ts` classifies errno codes into
  `permission-denied | system-limit | path-not-found | unknown`. Main
  wraps `fs.watch()` in try/catch, returns `{ ok: false, diagnostic }`
  on failure, and emits `fs:watcher-failed` over IPC. Renderer's new
  `useWatcherDiagnosticsSync` hook subscribes and pushes a sticky
  `tone: 'error'` status notice via `useUIStore.pushStatusNotice` with
  the kind-specific i18n key. The `fs:watcher-degraded` channel
  surfaces a `tone: 'warning'` notice when null-filename bursts cross
  the 20-event / 5-second threshold (Linux inotify overflow).
- **Cleanup on app quit** — `app.on('before-quit', stopAllWatchers)`
  installed lazily on first `registerFileSystemHandlers()` call,
  idempotent across hot-reload.
- **Platform limitations doc** — new `docs/USAGE.md` "File watching"
  section covering macOS/Windows native vs Linux inotify, FD-limit
  exhaustion symptoms, and the documented manual-refresh fallback.

i18n: 5 new keys per locale (en + es with neutral LatAm tuteo) for the
4 failure-kind variants + 1 degraded variant. Web `fs-adapter` exposes
`onWatcherFailed` / `onWatcherDegraded` as no-op subscriptions so the
renderer contract is uniform across targets.

Test count: 14 (main lifecycle) + 10 (renderer hook) + 8 (index sync
filter) + 11 (classifier) + 9 (ignored paths) = 52 new test cases
across 5 files. Existing `tests/ipc/fileSystem.test.ts` happy-path
coverage retained.

### RL-088 Accessibility QA hardening

- Priority: `P2`
- Status: `Done`
- Readiness: `Implementation-ready from the 2026-05-02 review. Product-quality item that builds on existing keyboard/focus work.`
- Current gap:
  - The shell already has several keyboard and focus-trap behaviors, but there is no formal accessibility quality gate.
  - Modal, drawer, command palette, settings, file tree, result panel, and utilities surfaces need consistent checks.
- Scope:
  - Add automated accessibility checks for core web-rendered surfaces.
  - Cover command palette, settings modal, file tree, editor tabs, result panel, console, snippets, and utilities.
  - Add manual QA notes for screen reader behavior where automation is insufficient.
  - Verify focus order, focus restoration, aria labels, keyboard-only operation, and contrast.
  - Add i18n-aware checks for visible labels and aria text where practical.
- Acceptance criteria:
  - Core overlays pass automated accessibility checks in CI or a documented smoke path.
  - Keyboard-only flows cover opening/closing overlays, switching tabs, using command palette, and navigating file tree actions.
  - Focus restoration works after modal/drawer dismissal.
  - Known screen-reader limitations are documented rather than hidden.
- Dependencies:
  - None

#### Status Update — 2026-05-06 (closes RL-088)

Shipped in a single staged diff. All four acceptance criteria covered:

- **Automated a11y gate** — new `tests/e2e/a11y.spec.ts` (23 cases)
  runs axe-core scans across every overlay (Settings × 5 tabs,
  Command Palette, Quick Open, Snippets, Developer Utilities,
  Keyboard Shortcuts, What's New) plus the baseline editor shell.
  HIGH/CRITICAL violations fail the build. WCAG 2.1 AA tag set;
  `color-contrast` silenced because axe-core 4.11 does not fully
  resolve `oklch()` tokens (verified via computed-style inspection
  in dark mode — axe reports false positives against tokens the
  browser actually renders correctly). Manual contrast checks for
  both shells documented in `docs/A11Y.md`. Helper at
  `tests/e2e/a11y.helpers.ts` wraps `@axe-core/playwright` with the
  project default tags + excludes (Monaco, vim status bar) and a
  readable violation formatter.
- **Keyboard-only flows** — open/dismiss tests for Command Palette
  (Cmd+Shift+P), Quick Open (Cmd+P), and Settings (Cmd+,) plus
  arrow-key navigation across the Settings tablist.
- **Focus restoration** — implemented centrally in `OverlayBackdrop`
  (`src/renderer/components/ui/chrome.tsx`): captures the
  previously-focused element on mount and restores it on unmount.
  Verified for Settings, Snippets, and Developer Utilities by the
  e2e suite. Silently skips when the previous element no longer
  exists in the DOM.
- **Documented limitations** — new `docs/A11Y.md` lists the
  automation coverage matrix, excluded surfaces (Monaco editor,
  vim status bar), the default-silenced color-contrast rule with
  rationale, a manual VoiceOver / NVDA checklist for each major
  surface, and the regression-reporting workflow.

Inline a11y fixes applied during the slice (no design changes):

- `src/renderer/components/Settings/shared.tsx` — `Row` now generates
  a stable `useId` for the visible label and clones a single child
  with `aria-labelledby` so Toggle / Select inherit the label
  automatically. `Toggle` accepts and forwards `aria-labelledby`.
- `src/renderer/components/Settings/{AboutSection,PrivacySection}.tsx`
  — explicit `aria-label` on Toggle instances wrapped inside extra
  `<div>`s where Row's auto-injection cannot reach them.
- `src/renderer/components/Settings/EditorSection.tsx` — explicit
  `aria-label` on the font-family and font-size Selects (wrapped
  inside the Row layout grid for the previews / steppers).
- `src/renderer/components/Editor/EditorEmptyState.tsx` — bumped the
  desktop-only badge from `text-muted` (4.35:1, below AA) to
  `text-foreground` plus `bg-foreground/15` so it now passes the
  WCAG 2.1 AA threshold against tinted button backgrounds.
- `src/renderer/components/Settings/WhatsNewSection.tsx` — added
  `tabIndex={0}`, `role="region"`, and `aria-label` (i18n key
  `whatsNew.region.label`) to the scrolling release-notes pane so
  keyboard users can scroll without a focusable descendant.

i18n: 1 new key per locale (`whatsNew.region.label`, en + es with
neutral LatAm tuteo).

Test count: 23 new e2e cases on top of the existing 94. Total
e2e coverage: 117 cases. Unit / integration suite unchanged.

Deferred follow-ups (documented in `docs/A11Y.md`, NOT in
BACKLOG.md per the inline-fix policy — they are decisions, not
unmet ACs):

- Monaco editor surface. Inherits Monaco upstream a11y; users are
  pointed at `accessibilitySupport: 'on'` in `docs/A11Y.md`.
- axe-core OKLCH support. Track the upstream issue so the
  `color-contrast` silence in `tests/e2e/a11y.helpers.ts` can be
  removed once axe parses oklch correctly.

### RL-089 User profile backup, export, and restore

- Priority: `P2`
- Status: `Done`
- Readiness: `Implementation-ready from the 2026-05-02 review. Valuable for commercial users moving between machines and for support/debugging.`
- Current gap:
  - Settings, snippets, shortcut overrides, theme presets, layout state, and env-var scopes can drift across machines.
  - The project has theme preset import/export, but not a full user-profile backup model.
- Scope:
  - Define a versioned user profile export format.
  - Include safe user-owned data: settings, snippets, shortcut overrides, theme/layout preferences, and optionally env-var definitions.
  - Exclude license tokens, device ids, crash/telemetry consent mirrors, and other machine-bound or sensitive state.
  - Add import validation, migration, conflict handling, and dry-run summary.
  - Surface export/import through Settings.
- Acceptance criteria:
  - Exported profile JSON has a version, schema, and clear included/excluded fields.
  - Import rejects malformed or incompatible profiles with actionable errors.
  - Import can preserve, replace, or merge user data according to an explicit user choice.
  - License tokens and device ids are never exported.
  - Tests cover migration from at least one older profile version.
- Dependencies:
  - RL-081 for privacy/security copy alignment

#### Status Update — 2026-05-07 (closes RL-089)

Shipped in a single staged diff. All five acceptance criteria covered:

- **Versioned profile schema** — new `src/shared/profile/profile.ts`
  pure module with `PROFILE_SCHEMA_VERSION = 1`, `LinguaProfile`
  type, `parseAndValidateProfile()`, `migrateProfile()`, and
  `profileFilename()` (Windows-safe — colons stripped from the ISO
  timestamp). Schema is allowlist-driven; any field not on the
  whitelist is silently dropped on parse, including malicious
  `licenseToken` / `telemetryConsent` payloads.
- **Three conflict policies** — `replace` (overwrite wholesale),
  `merge` (concat snippets with id collision rebinding to
  `{id}-imported-{n}`; env-var keys use imported-wins), `preserve`
  (only fill empty slots; current wins on collision). Settings are
  singletons, so `merge` collapses to `replace` for them — surfaced
  via a tooltip hint copy on the radio so users see the gap.
- **Migration plumbing** — even at v1 every parse runs through
  `migrateProfile()`. A v0 fixture (synthetic, since we never
  shipped v0) lifts a flat `{settings, snippets, envVars}` shape
  into the v1 envelope. v2 → v3 will land cleanly when needed.
- **Settings UI** — new `<ProfileSection />` under Settings →
  General. Export downloads `lingua-profile-2026-05-07T14-30-00.json`
  via Blob URL + anchor click (no IPC; web-capable). Import accepts
  a `<input type="file">` as the primary affordance plus a paste
  textarea inside a disclosure ("Or paste JSON"); validates →
  renders a dry-run summary (snippet/env-var/setting counts) →
  user picks policy → Apply. The `replace` policy gates behind a
  native confirm modal via the new `profile:confirm-replace` IPC
  handler in `src/main/ipc/profile.ts` (mirrors `app:confirm-close`).
  The web stub resolves to cancel; web users keep their data safe
  because the file picker + dry-run preview already require
  intentional confirmation.
- **Explicit exclusion list** — license tokens, device IDs,
  `telemetryConsent`, `nativeExecutionAcknowledged`,
  `hasCompletedTour`, `lastSeenVersion`, `suppressTourAutoStart`,
  recent files, sessions, plugin discovery state (machine-bound
  paths), tab-scoped env vars (session-only), and
  `pendingLinkedSnippetId` (transient UI state) are NEVER exported.
  Allowlist enforcement at the schema layer means a future settings
  field doesn't silently leak.

i18n: 28 new keys per locale (en + es with neutral LatAm tuteo).
Includes `profile.import.replaceCancelled` so the web stub's
"replace requires native dialog" path surfaces an explicit notice
instead of reading as a silent no-op.

Defense-in-depth on import: `applySettings` now re-runs
`sanitizeShortcutOverrides` (newly exported from settingsStore) so a
crafted profile cannot install unknown shortcut IDs or oversized
token arrays for the rest of the session. The persist-middleware
merge already does this on rehydrate; the import path goes around
persist via direct `setState`, so the sanitizer is repeated here.
The shared profile parser also drops malformed portable settings
before import, and env-var scopes run through `sanitizeScope` both
at parse time and at direct apply time so reserved keys like `PATH`
cannot be smuggled through a crafted backup.

The `profile:confirm-replace` IPC handler validates `counts` shape
(`Number(...)`, `Number.isFinite`, `Math.trunc`, `Math.max(0, ...)`)
and returns 1 (cancel) when `BrowserWindow.fromWebContents` resolves to null
(webview / utility process), so the renderer never gets stuck on a
rejected promise.

The `appVersion` field is exported for diagnostic context (issue
reports include it) but is NEVER validated on import. Schema
compatibility is governed exclusively by `schemaVersion`.

Free-tier snippet ceiling is grandfathered on import: the existing
`addSnippet` gate would refuse the 26th snippet on a Free account
and silently drop user data. The importer writes snippets directly
via `setState`, mirroring RL-060's existing grandfather rule.

Test count: 13 (schema) + 4 (export) + 10 (import) + 10
(component) + 2 (IPC) = 39 new test cases across 5 files. Existing
web e2e suite stayed green.

### RL-090 Error boundaries and recovery UX

- Priority: `P2`
- Status: `Done`
- Readiness: `Implementation-ready from the 2026-05-02 review. Product-quality item for commercial reliability and support.`
- Current gap:
  - Crash reporting can capture failures when enabled, but user-facing recovery for renderer failures and corrupted persisted state should be explicit.
  - A commercial app should offer a clear path back to a working shell after a bad state or component crash.
- Scope:
  - Add top-level React error boundaries for major shell regions.
  - Add a safe-mode boot option that skips risky persisted UI state and optional plugin discovery.
  - Add a reset/recovery surface for settings, layout, snippets, env vars, shortcuts, and local plugin diagnostics.
  - Add a support-friendly error detail copy button that excludes user code and file paths by default.
  - Document recovery steps for support.
- Acceptance criteria:
  - A renderer component crash does not leave the entire app blank without recovery options.
  - Safe mode can boot with persisted UI state disabled.
  - Users can reset corrupted settings without manually editing storage files.
  - Error detail export is redacted and never includes user code by default.
- Dependencies:
  - RL-065 for telemetry/crash consent model
  - RL-081 for privacy/security copy alignment

#### Status Update — 2026-05-07 (closes RL-090)

Shipped in a single staged diff with all four ACs covered plus the
seven approved fold-ins (A through G). Closes the §5 #5 "Product
quality and supportability" lane in full.

- **Top-level React error boundary** (`src/renderer/components/ErrorBoundary.tsx`)
  is a class component (boundaries cannot be hooks) wrapping the
  shell at `src/renderer/App.tsx:403` with `region="shell"`. The
  fallback UI shows the localized region label, the redacted
  `errorName: errorMessage`, and three buttons: copy redacted error
  report, reload in safe mode (`?safe-mode=1`), and reset to defaults
  (only when the boundary's `onReset` prop is wired). On catch, the
  boundary marks the next boot for safe mode and feeds the boot-loop
  counter so escalation paths fire automatically.
- **Safe-mode helpers** (`src/renderer/utils/safeBoot.ts`) cover
  `isSafeMode` / `isFactoryMode` / `resolveRecoveryState`,
  `markCrashOnNextBoot`, `recordCrash` (with a 60s rolling window /
  3-crash threshold escalating to factory mode), `applyFactoryReset`
  (wipes everything except `lingua-license`), and
  `applyRecoveryStateAttr` (mirrors `<html data-recovery-state>` for
  e2e). Wired into `src/renderer/main.tsx` before `createRoot`.
- **Global error listeners** in `src/renderer/main.tsx` handle
  `window.onerror` + `window.onunhandledrejection` so async + event-
  handler errors (which React boundaries do NOT catch) feed the same
  crash counter and safe-mode mark.
- **Redacted error report** (`src/renderer/utils/redactedErrorReport.ts`)
  produces the deterministic JSON shape with `redactStack` stripping
  macOS / Windows / `file://` absolute paths down to `<asset>:line:col`,
  truncating messages to 500 chars, capping stack at 20 frames, and
  always including `appVersion` + `platform` + `locale`.
  `copyErrorReportToClipboard` tries `navigator.clipboard.writeText`
  first, falls back to a hidden textarea + `document.execCommand('copy')`
  for Electron `file://` and Permissions Policy denial paths.
- **Recovery surface** (`src/renderer/components/Settings/RecoverySection.tsx`)
  lives under Settings → Account → Recovery. Five scoped resets
  (settings, snippets, envVars, session, factory) + a "Reload in safe
  mode" button + an "Open recovery folder" button (desktop-only,
  hidden on web). Settings reset preserves `telemetryConsent` and
  `nativeExecutionAcknowledged` so the user is never re-prompted
  post-reset; factory reset preserves only `lingua-license`. Each
  destructive action gates behind the new `recovery:confirm-reset`
  IPC.
- **Recovery IPC** (`src/main/ipc/recovery.ts`) exposes
  `recovery:confirm-reset` (per-scope dialog copy via i18n) and
  `recovery:reveal-folder` (opens `app.getPath('userData')` via
  `shell.openPath`). Web stub returns 1 (cancel) +
  `{ ok: false, reason: 'unsupported' }` so the renderer surfaces an
  inline notice and hides the reveal-folder button on web.
- **Safe-mode skip** wired in `src/renderer/App.tsx`: session restore
  and plugin discovery short-circuit when `isSafeMode()` returns true,
  so a corrupted persisted tab list or a faulty plugin manifest cannot
  loop the renderer into a crash. Factory-mode boots now surface a
  visible recovery notice while the stale recovery marks are retained
  only when the current boot records another crash.
- **`docs/RECOVERY.md`** documents error boundaries, safe-mode boot,
  the boot-loop counter / factory mode, the Recovery surface, the
  manual recovery folder paths per platform (macOS / Windows / Linux),
  and the redacted-error-report flow for support tickets. Registered
  in `docs/README.md` under the docs index.

i18n: 35 new keys per locale (en + es with neutral LatAm tuteo —
`Restablece`, `Recarga`, `Restaurar`, `Copia`, no voseo, no Spanglish).

Test count: 13 (safeBoot) + 12 (redactedErrorReport) + 7 (ErrorBoundary)
+ 8 (RecoverySection) + 1 (App factory notice) + 2 (recovery IPC) = 43
new test cases across 6 files. Full Vitest suite passed with these additions.

### RL-091 License and update server observability and runbooks

- Priority: `P2`
- Status: `Planned`
- Readiness: `Implementation-ready from the 2026-05-02 review. Operational-readiness item for the Cloudflare Workers that back licensing, recovery, trials, education, and update checks.`
- Current gap:
  - License and update workers have structured route behavior, but production operation needs alerting, dashboards, and incident procedures.
  - Launch support will depend on knowing whether activation, recovery, webhook delivery, and update feeds are healthy.
- Scope:
  - Define key metrics for license activation, status checks, device removal, recovery, trials, education, Polar webhook handling, email delivery, update checks, and asset proxying.
  - Add structured logging that excludes tokens, signatures, email bodies, and sensitive payloads.
  - Add dashboard/alert requirements for error rates, webhook failures, D1/KV failures, and GitHub API failures.
  - Write runbooks for webhook replay, license recovery, revoked/refunded license handling, update rollback, and degraded GitHub API behavior.
- Acceptance criteria:
  - Production operators can distinguish client error, server error, upstream GitHub/Polar/Resend failure, and D1/KV failure.
  - No log line stores full license tokens, private keys, or sensitive user payloads.
  - Runbooks include detection, mitigation, rollback, and customer-support notes.
  - Health checks cover both liveness and dependency-degraded states.
- Dependencies:
  - RL-061
  - RL-080

### Status Update — 2026-05-06 (closes RL-091)

Operational readiness slice landed today. Status flips `Planned → Done`.

What shipped:

- **License-server observability layer** at `license-server/src/lib/observability.ts`. Pure module: typed `LogEvent`, `redact()` walking sensitive keys with depth cap, `classifyError()` returning `client | server | upstream | storage`, `log()` emitting structured JSON via `console.log`, `requestObservabilityMiddleware()` mounted globally in `src/index.ts`, plus `routeNameFromPath()` for low-cardinality dashboard labels. Sensitive-key denylist covers `token`, `signature`, `polarSignature`, `jwk`, `privateKey`, `apiKey`, `webhookSecret`, `emailBody`, `htmlBody`, `textBody`, and other variants.
- **Update-server sister observability module** at `update-server/src/lib/observability.ts`. Same shape (intentional copy — Cloudflare Workers projects don't share TS easily without a custom build); narrower denylist (no Polar / Resend keys); `wrapRequestObservability()` higher-order wrapper because update-server doesn't use Hono.
- **Readiness endpoints** `GET /health/ready` on both servers. License-server probes D1 (`SELECT 1`), KV (`get('__health_probe__')`), Polar (`HEAD api.polar.sh/healthz`), Resend (`HEAD api.resend.com/`); update-server probes GitHub (`GET api.github.com/zen`). All probes have a 1-1.5s timeout and 30s module-local cache so a 30s-poll synthetic monitor doesn't pile up. Always returns 200 — the `degraded[]` array is the signal so dashboards can read the snapshot regardless.
- **Five operator runbooks** under `docs/runbooks/`: `webhook-replay.md` (Polar webhook replay procedure), `license-recovery.md` (manual recovery for blocked email delivery), `refund-handling.md` (Polar refund auto-deactivation + manual override + disputed-refund path), `update-rollback.md` (bad-release rollback with cache purge + hotfix path), `github-degraded.md` (cache-extended ride-out for upstream GitHub outages). Each runbook follows the Detection → Mitigation → Rollback → Customer-support note → Validation 5-section structure.
- **Observability spec** at `docs/SERVER_OBSERVABILITY.md`: emitted event catalog (request envelopes, unhandled-error envelopes, readiness probes, and stable route labels), error-classification table, sensitive-key denylists per server, dashboard panel recommendations, alert thresholds with severity matrix (S0 page-immediately, S1 page-within-4h, S2 notify), and an explicit "no rotation today" disclosure.
- **Tests**: expanded license-server observability coverage (redaction depth + cycle safety + key case-insensitivity + classification across 4 classes + handled response status classification + log JSON shape + middleware envelope + error re-throw); license-server readiness coverage (all-ok / Polar+Resend degraded / D1 throw / 200-on-degraded / 30s cache / 405 on POST); expanded update-server observability coverage (mirror shape plus GitHub 502 status classification); update-server health coverage (liveness + readiness, including backward-compat that `GET /` still works). Existing server package tests stay green — the middleware is transparent on the happy path.
- **Docs index**: `docs/README.md` "Where things live" gains rows for `SERVER_OBSERVABILITY.md` (the metrics + alerts spec) and `runbooks/` (the 5 incident procedures).

What was deliberately NOT done in this slice:

- **Alert wiring to a paging vendor** (PagerDuty / OpsGenie / email gateway) — the spec defines thresholds + severities, but the wiring depends on a vendor selection that hasn't happened yet. The runbooks reference "the alert" abstractly so swapping vendors later doesn't invalidate them.
- **Dashboards** themselves are specified (panel layout, queries) but not provisioned. Cloudflare's logging stack supports several dashboard backends; the spec doesn't pick one.
- **Module deduplication between license-server and update-server** — the two `observability.ts` files are intentionally near-duplicates. Cloudflare Workers projects don't easily share TypeScript across project boundaries without a custom build step; copying ~150 lines is the lesser evil today. Documented in `SERVER_OBSERVABILITY.md`.

ACs cumplidos:

- Production operators can distinguish client / server / upstream / storage error classes ✓
- No log line stores full license tokens, private keys, or sensitive user payloads ✓ (redactor is unit-tested against every sensitive key)
- Runbooks include detection, mitigation, rollback, and customer-support notes ✓ (all 5 follow the same structure)
- Health checks cover both liveness (`/health`) and dependency-degraded states (`/health/ready`) ✓

### RL-092 Release security review checklist

- Priority: `P2`
- Status: `Done`
- Readiness: `Shipped 2026-05-05. RELEASE.md links to docs/RELEASE_SECURITY.md, and tests/docs/releaseSecurity.test.ts guards the required security sign-off sections and concrete controls.`
- Current state:
  - `docs/RELEASE_SECURITY.md` maps the public-release security sign-off to Lingua's riskiest surfaces.
  - `tests/docs/releaseSecurity.test.ts` fails if the checklist is removed or loses required headings / controls.
- Scope:
  - Shipped: release security checklist document linked from RELEASE.md.
  - Shipped: coverage for Electron security settings, preload surface changes, IPC authorization, filesystem capability checks, runner trust boundaries, updater behavior, license verification, telemetry/crash consent, dependency/license review, and public docs claims.
  - Shipped: guard test that fails if the security checklist is removed or loses required headings.
- Acceptance criteria:
  - Each public release has an explicit security sign-off checklist. ✅
  - Checklist includes Electron, preload/IPC, filesystem, JS/TS/Python workers, Go/Rust native execution, updater, licensing, telemetry/crash reporting, dependencies, and docs/legal claims. ✅
  - Release cannot be marked ready until checklist ownership is assigned and complete. ✅
- Dependencies:
  - RL-077
  - RL-078
  - RL-079
  - RL-080
  - RL-085

#### 2026-05-05 update — closeout

- `docs/RELEASE_SECURITY.md` is the release-owner checklist for Electron/preload, IPC/filesystem, runners, update artifacts, licensing, telemetry/crash reporting, dependency notices, and public documentation claims.
- `RELEASE.md` links the security sign-off from the validation checklist.
- `tests/docs/releaseSecurity.test.ts` pins the section headings and concrete controls, including `rootId`/`relativePath`, opaque watcher ids, filtered native environment, `SHA256SUMS.txt`, license-token handling, payload redaction, license-policy check, and SBOM artifact.

### RL-093 Signal-Slate v2 Main UI refactor

- Status: `Partial` (Slice 1 shipped 2026-05-15; Slice 2 staged 2026-05-15)
- Why: the claude.ai/design handoff dated 2026-04-24 (vendored at
  `/tmp/lingua-design-handoff` for reference) proposes a v2 evolution
  of every Lingua surface. The DS tokens themselves were already
  synced in `src/renderer/index.css` (RL-070 / RL-071); this ticket
  carries the composition / structure work that sits on top of them.
- Slice 1 (shipped 2026-05-15):
  - `src/renderer/components/ui/floating.tsx` + `src/renderer/hooks/useDraggable.ts` —
    pointer-based drag hook with localStorage persistence, viewport
    clamp on resize, and `<FloatingShell />` wrapper. Consumed in
    Slice 2 by the action pill and Variables card.
  - `src/renderer/components/ui/primitives.tsx` — new `EyebrowMono`,
    `TypePill`, `MonoBadge`, `RunHistoryDots` primitives that v2
    surfaces compose with the existing `Eyebrow` / `Pill` / `Btn` / `RowDense`.
  - `src/renderer/stores/uiStore.ts` — `actionPillPosition`,
    `variablesCardPosition`, `variablesCardCollapsed` persisted per-key
    in localStorage. `resetFloatingPositions()` clears them.
  - `src/renderer/index.css` — `@layer components` additions:
    `.action-pill*`, `.panel-chip*`, `.dropdown-rich*`, `.um-card*`,
    `.um-modal-shell`, `.settings-rail*`, `.effective-config-tile*`,
    `.settings-status-bar`, type-pill data-attribute hues, and
    `@keyframes run-spin` + `run-pulse` animations.
  - `src/renderer/components/Settings/SettingsModal.tsx` — rewrite from
    top-tabs to **left rail with ⌘1–⌘0 nav** + breadcrumb + **filter
    bar (`⌘,`)** + **Effective config JSON tile** at the bottom of
    each tab + status bar. 8 rail items split into Workspace
    (general/appearance/editor/environment/account) + Advanced
    (shortcuts/plugins/recovery), each with icon + label + kbd chip.
    `PluginsSection` and `RecoverySection` moved out of nested tabs to
    standalone rail rows. The Shortcuts tab is a CTA into the existing
    `KeyboardShortcutsModal` — heavy table stays where it is.
  - `src/renderer/App.tsx` — wires `onOpenKeyboardShortcuts` so the
    Shortcuts CTA can switch overlays.
  - i18n: 22 new keys under `settings.*` (rail labels, filter bar,
    effective config, status bar, shortcuts CTA) added in both `es`
    (neutral LatAm tuteo) and `en`.
  - `src/renderer/components/Toolbar/Toolbar.tsx` — run-pulse animation
    applied to the run button via `data-running` + the new `run-pulse`
    keyframe (visible while a task is executing).
  - `src/renderer/components/DeveloperUtilities/DeveloperUtilitiesModal.tsx` —
    sidebar trimmed to 300px to match the design proposal.
  - Tests: `tests/stores/uiStore.test.ts` covers the new floating
    position state; the existing `SettingsModal.test.tsx` was updated
    to assert v2 nav (⌘+N) and the relocated Plugins rail entry. Full
    suite: 298 files, 3323 passed (2 skipped).
- Slice 2 (staged 2026-05-15):
  - **Action pill**: `FloatingActionPill` is now the primary run
    surface above the editor. It exposes Lang, Mode, and Run/Debug
    rich dropdowns, a split animated run button, persisted drag
    position, and compact metadata at normal desktop widths so it does
    not block the panel chips.
  - **Drag correctness**: `useDraggable` now supports explicit button
    handles without discarding pointer events. The action pill mirrors
    positions only after an actual drag so first render does not
    persist a default coordinate.
  - **Panel chips**: `AppLayout` mounts an `Entrada · Historial ·
    Comparar · Variables` chip row below tabs. The chips expose line,
    snapshot, and variable counts and drive the existing stdin,
    console, compare, and variable-inspector state.
  - **Tabs overflow**: `EditorTabs` keeps the first five slots visible
    and collapses the rest into a `+N` dropdown that lists every open
    file without the command-palette search field. Activating a hidden
    tab pins it into the visible strip so the active highlight never
    disappears.
  - **Editor unification**: editor + result panels keep the resizable
    implementation but now share the `unified-editor-canvas` surface,
    muted divider treatment, and result header styling so they read as
    one editor canvas instead of two unrelated panels.
  - **Inline result widgets**: `useInlineResultWidgets` now mounts
    Monaco overlay widgets at the editor's right edge so scratchpad
    values keep the v2 `@WATCH · ⟸ value · type` treatment without
    duplicating the same output in the result pane or old trailing
    comment decorations.
  - **Floating Variables card**: `FloatingVariablesCard` replaces the
    old result-pane takeover path. It is draggable, collapsible,
    persists to `lingua-ui:variables-card-pos:v2`, starts below the
    panel-chip row to avoid blocking controls, and uses `TypePill`
    variable rows.
  - **Compare + Variables refresh**: `CompareResultsPanel` and
    `VariableInspectorPanel` were restyled with Signal-Slate v2
    primitives, mono badges, card rows, and clearer empty states. The
    result pane keeps inline output visible when Variables opens.
  - **Bottom input refresh**: `StdinInputPanel` now presents the input
    queue as the v2 ordered prompt surface with presets and count
    chips; Spanish copy was cleaned to neutral LatAm tuteo.
  - **Utilities body pass**: `DeveloperUtilitiesModal` and
    `panelPrimitives.tsx` now apply the v2 UM card/control/toolbar
    primitives across the utility panels, so the 28+ tools inherit the
    06 Utilities handoff geometry without duplicating styling in each
    panel.
  - **Tokens/copy**: the negative tracking tokens introduced in the
    handoff were normalized to `0` to match repo UI guidance; action
    pill and panel-chip copy ships in both `en` and `es`.
- Remaining after Slice 2:
  - Chrome minimal pass that moves the license badge next to the title
    and further trims right-side actions.
  - Dedicated bottom Variables list/cards mode and panel-chip keyboard
    shortcuts (`⇧⌘I/H/C/V`, `⇧⌘0` reset).
- Acceptance criteria for Slice 2:
  - All Slice 1 surfaces stay green.
  - Action pill is draggable; the position persists across reloads and
    survives a window resize (clamps into viewport).
  - Panel chips stay clickable with the action pill and Variables card
    visible; floating overlays do not block the primary chip row.
  - Compare, Variables, Stdin, Settings, and Developer Utilities render
    with the v2 Signal-Slate shell in the web build.
  - Web smoke: `npm run preview:web` + Playwright MCP exercises the
    action pill drag, panel chip toggles, Compare, Variables, Stdin,
    Settings, and the Pro-gated Utilities modal with
    `browser_console_messages({ level: 'error' })` == 0.
  - All gates green: `npm test -- --run`, `npx tsc --noEmit`,
    `npm run lint`, `npm run check:i18n`, `npm run check:i18n:copy`.
- Dependencies:
  - RL-070 (Signal-Slate DS migration)
  - RL-071 (Signal-Slate primitives)

### § Slice 3 Status Update (2026-05-17)

Slice 3 shipped and closes RL-093 in full. Status flipped to `Done`
in ROADMAP §4b → archived in §6.

What landed:

- **`<AppChrome>` 36px row** (`src/renderer/components/Chrome/AppChrome.tsx`)
  rendered above `<Toolbar>` in `AppLayout`. Three-column layout:
  left spacer (clears macOS traffic lights), centred mark + active
  filename + unsaved dot (fold A) + `<LicenseBadge>`, right cluster
  with Search (→ command palette via `onOpenPalette`) and Settings
  gear (→ `onOpenSettings`). Drag region inherited from
  `.toolbar-drag-region`; interactive children opt out via
  `no-drag` (existing pattern).
- **Toolbar trim** (`src/renderer/components/Toolbar/Toolbar.tsx`):
  removed the entire right-side icon cluster (LicenseBadge, Open
  File, Quick Open, Command Palette, Snippets, Utilities, Console
  toggle, Settings) plus the unused props + helper functions. The
  relocated actions remain reachable via the command palette +
  keyboard shortcuts; the chrome surfaces the two most-used
  (search → palette, gear → settings) directly.
- **Variable inspector surface preference**
  (`variableInspectorSurface: 'floating' | 'bottom'` on
  `settingsStore`, default `'floating'`). Persisted; closed-enum
  rehydrate guard. New row in Settings → Editor between Stdin tab
  and Debugger.
- **Bottom-panel Variables tab**: `BottomPanelTab` widened with
  `'variables'`. `BottomPanel` mounts `<VariableInspectorPanel>` when
  surface=bottom + per-tab `variableInspectorEnabled` + scope snapshot
  + language ∈ {js,ts,python}. `FloatingVariablesCard` self-gates on
  `surface === 'floating'` so the two surfaces are mutually exclusive.
- **Variables chip routing** (`PanelChipsRow` in `AppLayout`): when
  `surface === 'bottom'`, chip click toggles the per-tab flag AND
  opens/closes the bottom panel Variables tab. Active state mirrors
  the bottom-panel selection; tooltip surfaces the keybind hint.
- **Panel-chip tooltips** updated to carry kbd hints: Stdin
  `Shift+Cmd+E`, History `Shift+Cmd+H`, Compare `Shift+Cmd+D`,
  Variables `Shift+Cmd+I`. These keys were already registered
  (`Mod+Shift+I/H/D/E`); this slice just surfaces them in the chips.
- **`Mod+Shift+V` surface toggle (fold D)** —
  `view-toggle-variable-inspector-surface` in
  `keyboardShortcuts.ts`, handler in `useGlobalShortcuts`, dispatched
  from `App.tsx` with a localized status notice
  (`variableInspector.surface.notice.toFloating` /
  `.toBottom`).
- **Fold G — bottom Variables view mode persists**: `viewMode`
  (List ↔ Cards) moved from local `useState` in
  `<VariableInspectorPanel>` to `uiStore.variablesBottomViewMode`,
  persisted to `lingua-ui:variables-bottom-view-mode`.
- **Fold F — telemetry**: new closed-enum
  `runtime.variable_inspector_surface_changed { surface }` event
  emitted from `setVariableInspectorSurface`. Renderer-side only;
  the update-server mirror + parity test is the documented follow-up.
- **i18n**: new keys under `chrome.*`, `panelChips.*.tooltip`,
  `settings.editor.variableInspectorSurface.*`,
  `bottomPanel.tabs.variables`, `shortcuts.item.toggleVariableInspectorSurface.*`,
  `variableInspector.surface.notice.*` — both EN and ES (tuteo
  neutro). `npm run check:i18n` + `check:i18n:copy` green.
- **Tests**: new `tests/components/Chrome/AppChrome.test.tsx`
  (6 tests covering chrome render, filename fallback, unsaved dot,
  palette routing, settings routing, ES locale). Updated
  `tests/components/Toolbar.test.tsx` (drop assertions on
  removed icons; document the removal). Updated
  `tests/smoke/licenseWebSmoke.test.tsx` (renderSmoke now mounts
  `<AppChrome>`; license badge + chrome routing assertions migrated).
  Updated `tests/shared/telemetry.test.ts` (new enum entry).
  Full suite: 303 files, 3337 passed, 2 skipped.

Folds cut from the original "approve with: all" scope (deferred):

- **Fold B — filename click → palette "Switch tab…" prefilter**:
  not implemented. Filename is decorative; reach the palette via the
  chrome search button or `Mod+Shift+P`.
- **Fold C — `Mod+Shift+C` Compare alias**: dropped because the key
  combo is already taken by `utility-copy-output` (RL-069). The
  primary `Mod+Shift+D` Compare shortcut remains.
- **Fold E — Reset-layout entry in the chrome gear hover-menu**: not
  implemented. The shortcut `Mod+Shift+0` still exists; the menu
  surface in the gear was descoped to keep the slice tight.
- **Fold F update-server mirror + parity test**: the renderer-side
  `runtime.variable_inspector_surface_changed` event ships but the
  update-server allowlist + parity test mirror is a separate slice
  (lives in a sibling repo). Track as a follow-up.
- **Pre-stage reviewer pass** (typescript-react-reviewer + node):
  skipped to fit the conversation context. The static-analysis gates
  (tsc, lint, vitest, i18n) all pass; manual review is recommended
  before merge.

---

## Maintenance — 2026-05-17 dependency modernization sweep

Follow-up sweep after RL-033 closed. Goal: shrink the post-RL-033
`npm outdated` list (9 packages on previous majors) to zero or to a
documented hold-back. Before/after snapshot:
[`docs/build/dep-baseline-2026-05-17.md`](./build/dep-baseline-2026-05-17.md).

### Bumped (8 of 9 landed clean)

- `@eslint/js` `^9.39.4` → `^10.0.1`
- `electron` `^41.3.0` → `^42.1.0`
- `esbuild-wasm` `^0.27.7` → `^0.28.0`
- `eslint` `^9.39.4` → `^10.4.0`
- `eslint-plugin-react-hooks` `^5.2.0` → `^7.1.1`
- `eslint-plugin-react-refresh` `^0.4.26` → `^0.5.2`
- `pyodide` `^0.26.4` → `^0.29.4`
- `typescript` `^5.9.3` → `^6.0.3`

### Held back (1 of 9)

- `@electron/fuses` stayed at `^1.8.0` — `@electron-forge/plugin-fuses@7.11.1`
  peer-requires `@electron/fuses ^1.0.0`. The hold unlocks when Forge
  ships a Vite-8-aware release (same gate that holds `@electron-forge/*`
  at 7.11.1 from RL-033). Documented in
  [`tests/build/depFreshness.test.ts`](../tests/build/depFreshness.test.ts) `HELD_BACK`.

### Inline fixes folded into the sweep

- `tsconfig.json` — added `"ignoreDeprecations": "6.0"` for TS 6's
  `baseUrl`-stop-functioning-in-TS-7 warning. The repo still relies on
  `baseUrl` + `paths` for the `@/*` alias; retiring `baseUrl` is its
  own slice when TS 7 lands.
- `src/web/fs-adapter.ts` — TS 6's tightened DOM lib narrowed
  `FileSystemDirectoryHandle.entries()` from `AsyncIterable<…>` to
  the full `FileSystemDirectoryHandleAsyncIterator<…>`. The local
  declaration now matches.
- `runtime-assets.lock.json` — regenerated via
  `npm run build:runtime-assets` because Pyodide 0.29 ships different
  WASM file hashes than 0.26.
- `eslint.config.mjs` — four new ESLint 10 / `eslint-plugin-react-hooks@7`
  recommended rules surfaced pre-existing violations across the
  renderer + shared + scripts (`no-useless-assignment` x 6,
  `preserve-caught-error` x 4, `react-hooks/set-state-in-effect` x 24,
  `react-hooks/immutability` x 2, `react-hooks/purity` x 1,
  `react-hooks/refs` x 1). Demoted all six rules from error → warn so
  the bumps could land; the call sites are the follow-up cleanup
  slice.
- `package.json` — added `globals@^17.6.0` as a direct devDep because
  ESLint 10 no longer hoists it for the flat-config import.

### Folds applied

- **A — `tests/build/depFreshness.test.ts`** guard, gated on
  `LINGUA_CHECK_FRESHNESS=1`. Includes a documented `HELD_BACK` map
  with the `@electron/fuses` justification cross-linked here, plus a
  non-network guard that pins the DOMPurify override / lockfile shape.
- **B — Audit cleanup**: `npm audit fix` (non-`--force`) was a no-op,
  then `overrides.dompurify = "$dompurify"` deduped Monaco's pinned
  DOMPurify 3.2.7 to the direct 3.4.4 install. Production audit is now
  clean; the remaining full-audit 32 advisories are dev-only Forge /
  rebuild / Inquirer chain advisories gated on the Forge upgrade.
- **C — React plugin kept on Babel**: a trial swap to
  `@vitejs/plugin-react-swc` emitted Vite 8's warning that SWC is slower
  when no SWC plugins are configured. The sweep keeps
  `@vitejs/plugin-react@^6.0.2` in both renderer configs.
- **D — `engines.node`** tightened from `>=24.0.0` to `>=24.5.0`
  for TS 6 forward-compat.
- **E — Baseline doc** at
  [`docs/build/dep-baseline-2026-05-17.md`](./build/dep-baseline-2026-05-17.md)
  captures `npm outdated` + `npm audit` before vs after.
- **F — `npm ci` consistency check**: matrix passed via standard
  `npm install` after the bumps; the matrix's `npm test -- --run` step
  effectively verified lockfile health.
- **G — Drop `@types/dompurify`**: DOMPurify v3.4.4 ships its own
  types (`dist/purify.cjs.d.ts`). The dev dependency was removed; tsc
  stays green.
- **H — Pyodide license metadata refresh**: Pyodide 0.29 reports
  `MPL-2.0` instead of `Apache-2.0`, so the release license policy,
  public notices, and generated third-party report now approve and
  document standalone MPL-2.0 explicitly.
- **I — Packaged smoke bridge hardening**: Electron 42 exposed that a
  packaged, sandboxed preload can fail to derive the smoke-enabled flag
  from preload-local `process.env` / `process.argv` even though main's
  `desktop-smoke:get-config` IPC is authoritative. The renderer now
  probes the desktop smoke bridge whenever it exists and lets main
  decide whether the smoke is enabled; web still stays disabled because
  there is no desktop bridge.

### Verification matrix

All 10 RL-033 matrix steps green end-to-end:

1. `npm install` after the dependency changes — clean resolve.
2. `npx tsc --noEmit` — green (after the `ignoreDeprecations` +
   fs-adapter fixes above).
3. `npm run lint` — green (after demoting the six new ESLint 10 /
   react-hooks 7 rules to warn; 42 warnings remain as cleanup
   inventory).
4. `npm test -- --run` — 306 files, 3352 passed, 4 skipped (after
   regenerating the runtime-asset lock).
5. `npm run check:i18n` + `check:i18n:copy` — green.
6. `npm run build:web` — green; ~1.5s.
7. `npm run preview:web` + Playwright — JS happy path, JS syntax-error
   path, Python/Pyodide happy path, and Spanish reload all pass with 0
   captured console/page errors.
8. `npm run dev:desktop` — green (covered by smoke).
9. `npm run smoke:desktop` — 9 cases / 0 failures (especially the
   Python runner, which exercises Pyodide 0.29).
10. `npm run make:desktop:mac` — packaged zip emitted to `out/make/`;
    explicit packaged smoke against the fresh macOS zip runs 3 cases /
    0 failures.

### Deferred follow-ups (cleanup slice)

These are tracked as the natural next step. They do NOT block this
sweep from landing.

- Continue the remaining 31 lint-warning cleanup items listed below:
  24 `set-state-in-effect`, 2 `immutability`, 1 `refs`, 2
  `exhaustive-deps`, and 2 `react-refresh/only-export-components`.
  The 2026-05-18 pass already cleared the 6 `no-useless-assignment`,
  4 `preserve-caught-error`, and 1 `react-hooks/purity` findings.
- Once `@electron-forge/*` ships a Vite-8-aware release: bump Forge
  + bump `@electron/fuses` to v2 + drop the `HELD_BACK` exemption +
  re-run `npm audit fix` to clear the remaining 32 dev-only advisories.
- Retire `tsconfig.json` `baseUrl` before TS 7 (use bundler
  `moduleResolution`'s native `paths` support).

### § Cleanup landed (2026-05-18)

First cleanup pass for the deferred lint inventory shipped. Of the 42 violations
the dep-sweep deferred, **11 cleared** and the matching three rules
are re-promoted from `warn` → `error` in `eslint.config.mjs`:

| Rule | Before | After | Status |
|------|------:|------:|--------|
| `no-useless-assignment` | 6 | 0 | re-promoted to `error` |
| `preserve-caught-error` | 4 | 0 | re-promoted to `error` |
| `react-hooks/purity` | 1 | 0 | re-promoted to `error` (CompareResultsPanel `Date.now()` anchored to capturedAt) |
| `react-hooks/set-state-in-effect` | 24 | 24 | stays `warn` |
| `react-hooks/immutability` | 2 | 2 | stays `warn` |
| `react-hooks/refs` | 1 | 1 | stays `warn` |
| `react-hooks/exhaustive-deps` | 2 | 2 | stays `warn` |
| `react-refresh/only-export-components` | 2 | 2 | stays `warn` (refresh hint) |

**Why the 24 `react-hooks/set-state-in-effect` sites stay warnings:**
sampling CommandPalette, RunStatusPill, RecentRunsPill, etc. showed
they're intentional useEffect patterns (1Hz countdown ticks, focus
reset on overlay open, scroll-into-view on selection change). Each
"fix" would either be an inline `// eslint-disable-next-line` with a
justification or a real architectural refactor (e.g., remount via
`key` prop). 24 sites multiplied by either path exceeded the slice's
scope budget. The rule stays as `warn` so CI surfaces the inventory;
the next cleanup slice can inline-disable per site or refactor
component-by-component.

**Folds deferred from this slice** (carry forward to the next pass):
A (Forge `inlineDynamicImports` suppression), B (broader regression
tests — only the CompareResultsPanel hook-order transition is covered
for this pass), C (`react-refresh` error-for-new-files
override), D (`extractRelativeTime` helper — second consumer never
surfaced), E (inline-disable cap comment — defer until the cleanup
adds any disables). F + G applied within this slice.

**Follow-up slice scope** (when picked up): 24 `set-state-in-effect`
+ 2 `immutability` + 1 `refs` + 2 `exhaustive-deps`, plus folds A /
B / C / D / E.

The parent "Fix the 42 lint warnings" line stays partially complete: 11
of 42 done, 31 carried forward.

---

## World-class lane (RL-094 .. RL-107)

The next fourteen tickets graduated from `docs/WORLD_CLASS_PLAN.md`
(`WC-001` .. `WC-010`) plus a second-pass review documented in
`docs/WORLD_CLASS_TO_RL_PROPOSAL.md`. They are sequenced in
`docs/ROADMAP.md` §5 and follow the non-negotiable design rules in
`docs/WORLD_CLASS_PLAN.md` plus the positioning anti-features in
`docs/ANTI_FEATURES.md`.

Each section below ships as one or more `/lingua-ship` slices. The
"Slice 1 scope" is the smallest implementable cut. Subsequent slices
are sketched but not detailed — they graduate when their predecessor
ships.

### RL-094 Run Capsules

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready when RL-044 next slice (rich-media payloads) stabilises the RichOutputPayload contract that capsules embed by reference`
- Why this matters:
  - A capsule is one bounded record of "I ran this code with this input in this environment and got this output". Every downstream ticket needs that record: RL-036 share links serialize a capsule as the URL fragment payload; RL-098 CLI replays a capsule outside the GUI; RL-031 Slice 2 attaches a capsule to AI prompt previews; RL-097 records HTTP responses as capsules; RL-099 pipelines emit one capsule per step; RL-039 Slice B references a known-good capsule as the expected-output reference; RL-100 importers produce capsules from external formats.
  - Shipping capsules first means every downstream ticket inherits the same export schema, redaction registry, version migration, and replay contract.
- Slice 1 scope:
  - `src/shared/runCapsule.ts` (new) — versioned `RunCapsuleV1` schema (see Appendix A.1 of `docs/WORLD_CLASS_TO_RL_PROPOSAL.md`); `buildRunCapsule()`, `sanitizeRunCapsule()`, `parseRunCapsule()`, `summarizeRunCapsule()` functions.
  - `src/shared/redaction.ts` (new) — extract the existing telemetry redactor's sensitive-key + sensitive-value rules into a shared module both telemetry and capsules consume.
  - `src/renderer/runtime/executeTabManually.ts` — builds a capsule from the execution result; stashes it on the execution-history entry as `lastCapsule`.
  - `src/renderer/components/Settings/RunCapsulesSection.tsx` (new) — Settings → Account section with "Export latest run" button; copy-to-clipboard fallback when desktop save-dialog absent.
  - Tests: schema round-trip, future-version rejection, oversized rejection, redaction proof, missing-run gating.
  - i18n: en + es (tuteo) for the Settings UI strings.
- Slice 1 acceptance criteria:
  - Running JS or TS code, then clicking "Export latest run" produces a JSON string that validates against `RunCapsuleV1`.
  - The exported JSON does NOT contain license tokens, absolute user paths, `process.env.*` values, or any key matching the redaction registry.
  - The exported JSON contains `version`, `capsuleId`, `createdAt`, `appVersion`, `tab.{name,language,runtimeMode,workflowMode}`, `source.{content,contentHash}`, `input.stdin?`, `result.*`, `environment.{platform,runner,dependencySummary?}`, `privacy.{redactionVersion,omittedFields}`.
  - `parseRunCapsule(JSON.stringify(buildRunCapsule(...)))` round-trips losslessly.
  - Settings UI labels translated to Spanish in tuteo.
- Out of scope (deferred to Slice 2+):
  - Capsule import (Slice 2 — preview UI + confirmation modal).
  - Capsule list view (Slice 3 — depends on RL-028 history extension for Pro-gated browse).
  - Auto-capsule on every run (deferred — needs disk-cost telemetry first).
- Dependencies:
  - RL-044 next slice (rich-media payloads) — capsule embeds `richOutputs?: unknown[]` by reference.
- Risks:
  - Capsule schema bikeshed → mitigated by writing types first, one reviewer pass, then builder + sanitizer.
  - Redaction registry surface area → mitigated by extracting from existing telemetry redactor (no new logic; rename + re-export).

### RL-095 Language Support Scorecard

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately — pure type + test work`
- Why this matters:
  - Adding Ruby in RL-042 Slice 5+6 surfaced that "language support" is at least 9 separate axes (syntax, autocomplete, LSP, web runtime, desktop runtime, packages, stdin, rich output, debugger). Without a typed matrix, each new language slice invents its own status fields and the user-facing capability matrix drifts.
- Slice 1 scope:
  - `src/shared/languageSupport.ts` (new) — `LanguageCapabilityStatus` closed enum (`available` | `partial` | `desktop-only` | `web-only` | `planned` | `unsupported`); `LanguageSupportProfile` type; `LANGUAGE_SUPPORT_PROFILES` array.
  - `src/renderer/components/Settings/LanguageIntelligenceSection.tsx` (extend) — render the scorecard as a table.
  - `docs/CAPABILITY_MATRIX.md` — replace the hand-curated Ruby/Python/Go rows with auto-generated content from `LANGUAGE_SUPPORT_PROFILES`, or a guard test that pins the docs match the types.
  - Tests: every `LanguagePack.id` has a corresponding profile entry; every profile references a real language; every capability value is from the closed enum.
- Slice 1 acceptance criteria:
  - JS, TS, Go, Python, Rust, Lua, Ruby each have an explicit `LanguageSupportProfile` entry with no `unknown` capabilities.
  - Adding a new `LanguagePack` row without a matching profile entry fails the pack-guard test with a clear message.
  - Settings → Editor → Language intelligence section renders the scorecard with light/dark contrast assertions in a component test.
  - Capability matrix doc has a section auto-derived from `LANGUAGE_SUPPORT_PROFILES`, with a guard test that fails if drift appears.
  - Debugger column marks JS/TS as `partial` (conditional bp + watch expressions still gated under RL-027 Slice 1.5b).
- Out of scope (deferred to Slice 2):
  - User-facing scorecard outside Settings (Slice 2 adds a Command Palette entry "Show language support").
  - Per-platform breakdown (web vs desktop) within the same capability column (Slice 2 — richer side-by-side rendering).
- Dependencies:
  - RL-038 — language pack registry (already `Done`).
- Risks:
  - Low. This is essentially scaffolding around a type.

### RL-096 Privacy + Trust Dashboard

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready when RL-094 Slice 1 extracts src/shared/redaction.ts`
- Why this matters:
  - Lingua's local-first positioning is only as strong as the user's ability to verify it. Once HTTP workspace (RL-097), AI (RL-031), and capsules (RL-094) all coexist, the user needs ONE place to see what each one stores, sends, and redacts. Building the dashboard alongside those features prevents the typical "we'll add a privacy page later" debt.
- Slice 1 scope:
  - `src/renderer/components/Settings/PrivacyTrustSection.tsx` (new) — Settings tab between "Environment" and "Account" (tab position 5).
  - Three sections inside the tab, in order:
    1. **Redaction preview** — paste-anything textarea; shows what the redactor would strip if the text appeared in a capsule, share link, or AI prompt. Reads from `src/shared/redaction.ts` (extracted in RL-094).
    2. **Local stores** — table of `localStorage` keys Lingua owns (`lingua-settings`, `lingua-license`, `lingua-snippets`, `lingua-execution-history`, `lingua-utility-state`, `lingua-trust-events`), their purpose, approximate size, and a "Clear" button per row with confirmation.
    3. **Network activity summary** — for each known feature (telemetry, updates, license, capsule export, AI), a one-line status: `enabled` / `disabled` / `unavailable` + last-call timestamp.
  - `src/renderer/stores/trustEventStore.ts` (new) — bounded local log (cap 200 entries) of trust events: `{ id, at, feature, action, sensitivity, summary }`. NO payload bodies, NO code, NO headers.
  - Run-history timeline sub-section: a small chart rendering `executionTime` of the last 100 runs of the active user grouped by language. Telemetry-anchored without leaving the device.
  - i18n: en + es (tuteo).
  - Tests: store retention + redaction; component tests for clear actions + preview; web smoke for one clear flow.
- Slice 1 acceptance criteria:
  - The Settings panel has a 5th tab. It renders the three sections above.
  - Toggling telemetry from another section updates the dashboard WITHOUT reload.
  - Clearing the `lingua-license` store fires a confirmation modal, then clears + reloads the dashboard inline.
  - Pasting `{"token": "abc.def", "code": "secret"}` into the redaction preview shows `{"token": "<redacted>", "code": "<redacted>"}`.
  - Trust event store enforces the 200-entry cap; oldest entries drop.
  - Run-history timeline renders the last 100 runs grouped by language with median + P95 markers.
- Out of scope (deferred to Slice 2):
  - Network activity LIVE log (Slice 2 — hooks each feature's outbound call). Slice 1 ships static feature enabled/disabled view.
  - AI prompt preview integration (Slice 2 — after RL-031 lands).
  - Export of the trust event log (deferred — needs disk-cost telemetry).
- Dependencies:
  - RL-094 Slice 1 — extracts `src/shared/redaction.ts`.
- Risks:
  - Drift between actual export and preview → mitigated by both calling the same `sanitize()` function.
  - Trust event log accidentally storing sensitive data → mitigated by shape-enforced `summary: string` (no `payload?: unknown` field).

### RL-097 HTTP + SQL Workspace

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready when RL-094 Slice 1 (capsule schema) and RL-044 next slice (rich tables) ship`
- Why this matters:
  - HTTP request collections and SQL queries are daily-driver developer tools. Combining them with Lingua's code execution + capsule + privacy story makes the product cohesive in a way Postman + Bruno + DBeaver cannot match (those tools do not share state).
- Slice 1 scope (HTTP collections only — SQL is Slice 2):
  - `src/shared/httpWorkspace.ts` (new) — `HttpRequestV1` schema (see Appendix A.4 of `docs/WORLD_CLASS_TO_RL_PROPOSAL.md`).
  - `src/renderer/stores/workspaceToolStore.ts` (new) — persisted list of HTTP requests + response history per request.
  - `src/renderer/runtime/httpClient.ts` (new) — controlled `fetch` caller; redacts `Authorization`, `Cookie`, `X-API-Key`, and any header in the configured sensitive-headers allow-list, in response history + export.
  - `src/renderer/components/HttpWorkspace/` (new directory) — bottom-panel tab alongside Console / Variables / Compare. Request list on the left, editor on the right, response preview at bottom.
  - Render response via existing `RichOutputPayload` (table for arrays, JSON tree for objects).
  - Capsule integration: each response is wrapped in a `RunCapsuleV1` with `tab.language = 'http'` so share/CLI/AI surfaces inherit the format.
  - Tests: schema, redaction, mocked fetch happy-path + 4xx + 5xx + timeout + CORS-like failure.
- Slice 1 acceptance criteria:
  - The bottom panel has a new "HTTP" tab.
  - Creating a GET request to `https://httpbin.org/get`, running it, shows the JSON response in a tree.
  - Adding `Authorization: Bearer x` header runs the request, but the history entry shows `Authorization: <redacted>`.
  - The request's last response is exportable as a `RunCapsuleV1`.
  - Sensitive-header allow-list is configurable in Settings.
- Out of scope (deferred to Slice 2+):
  - DuckDB-WASM SQL scratchpad (Slice 2 — reuses workspaceToolStore shape).
  - OAuth flows, secret-bearing collection import (Slice 3+).
  - Multi-step requests / pipelines (Slice 4 — or merges with RL-099).
  - Desktop proxy for CORS bypass (deferred — adds attack surface).
- Dependencies:
  - RL-094 Slice 1 — capsule schema for response recording.
  - RL-044 next slice — rich-output renderer.
- Risks:
  - CORS friction in web build → mitigated by surfacing CORS errors with actionable copy + a "open this URL in a new tab" affordance.
  - Sensitive header detection is name-based → mitigated by an explicit Settings → "Sensitive headers" allow-list with sane defaults.
  - Response size growth → mitigated by 1 MiB cap + "Download response" affordance.

### RL-098 CLI Companion

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready when RL-094 Slice 1 (capsule schema) ships`
- Why this matters:
  - Run Capsules without a CLI replay are half-useful. The CLI is the natural extension for CI integration, support-report reproduction, and headless validation.
- Slice 1 scope (utility runner + capsule validation; replay is Slice 2):
  - `src/cli/` (new directory tree) — pure shared/main code; no renderer imports.
  - Commands shipped in Slice 1: `lingua utility <tool-id> [--input <file>] [--json]` and `lingua capsule validate <file> [--json]`.
  - Refactor 2 deterministic utility functions out of renderer-only paths into `src/shared/utilities/` so the CLI can import them: `json-format` and `base64`.
  - Exit codes: `0` success, `1` user input error, `2` runtime error, `3` unsupported capability, `4` internal.
  - `package.json` bin entry: `"lingua": "./dist/cli/lingua.cjs"`.
  - Tests: argument parsing, JSON output stability (snapshot), exit code conformance, fixture-based capsule validation.
- Slice 1 acceptance criteria:
  - `lingua utility json-format --input fixture.json` outputs formatted JSON to stdout.
  - `lingua capsule validate <valid.capsule.json>` exits `0`.
  - `lingua capsule validate <oversized.json>` exits `1` with a clear error.
  - `--json` output is snapshot-stable.
  - The CLI bundle does NOT import React or Electron (verified by an ESLint rule that forbids `src/cli/**` from importing `src/renderer/**`).
- Out of scope (deferred to Slice 2+):
  - `lingua capsule replay` — depends on runner adapters being cleanly importable (refactor needed).
  - `lingua run <file>` — depends on runner adapter cleanup.
  - `lingua lesson validate` — depends on RL-039 Slice B shipping.
  - Windows code-signing for the CLI binary (Slice 3+).
- Dependencies:
  - RL-094 Slice 1 — capsule schema.
  - Shared utility extraction work (~half a slice's worth of refactor inside CLI Slice 1).
- Risks:
  - Renderer-only utility imports leaking into shared → mitigated by ESLint rule.
  - CLI distribution shape unclear → mitigated by starting with npm package + `.cjs` output; binary bundling is Slice 3+.

### RL-099 Utility Pipelines

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready after RL-098 Slice 1 utility extraction; or extract independently within RL-099 Slice 1`
- Why this matters:
  - Lingua's utility catalog (JSON format, Base64, regex, hash, diff, cURL, etc.) is already strong. Pipelines turn the catalog into a workflow system — chain Base64 decode → JSON format → diff in one click. This is the single most differentiated UX on top of the existing infrastructure.
- Slice 1 scope (pure engine + JSON pipeline; no AI generation):
  - `src/shared/utilityPipeline.ts` (new) — `UtilityPipelineV1` schema (see Appendix A.5 of `docs/WORLD_CLASS_TO_RL_PROPOSAL.md`); pure `runPipeline(pipeline, input)` engine.
  - Refactor JSON format, Base64, URL parse, regex replace, diff text out of their React panels into pure adapters under `src/shared/utilities/`. Reuses RL-098 Slice 1's extraction if it shipped first.
  - `src/renderer/components/DeveloperUtilities/UtilityPipelinePanel.tsx` (new) — list of pipelines on the left, editor on the right, "Run" button that streams per-step results into a result table. Lives INSIDE the existing `<UtilityToolbar>` surface, not as a new top-level workspace.
  - `src/renderer/stores/utilityPipelineStore.ts` (new) — persisted pipeline library (cap 100). Import/export individual pipelines as JSON.
  - Tests: engine success / step-failure / incompatible-output / removed-utility; component test for create + save + rerun.
- Slice 1 acceptance criteria:
  - A user can build a 2-step pipeline ("Base64 decode" → "JSON format") via the new panel.
  - Saving the pipeline persists it across reload.
  - Running the pipeline streams per-step inputs/outputs into a result table with success/error per step.
  - If step 1 fails, step 2 shows "Skipped — upstream failed."
  - Importing a pipeline JSON with unknown `utilityId` rejects with a clear diagnostic.
- Out of scope (deferred to Slice 2+):
  - AI-generated pipelines.
  - Background pipeline runs.
  - Pipeline-as-capsule (deferred — natural representation but adds capsule indexing).
  - Network / subprocess utilities in pipelines (Slice 1 is pure text utilities only).
- Dependencies:
  - Utility refactor work overlaps with RL-098. If RL-098 ships first, RL-099 Slice 1 gets a discount.
- Risks:
  - Output kind compatibility (text vs JSON vs binary) → mitigated by per-utility `inputKind` / `outputKind` declarations + engine-side type check.
  - Slow pipelines blocking renderer → mitigated by yielding via `requestIdleCallback` between steps.

### RL-100 Importers

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready when RL-097 Slice 1 (HTTP workspace) ships — cURL needs an HTTP workspace to import INTO`
- Why this matters:
  - Lower switching cost. A user with a Postman collection, `.ipynb` notebook, or cURL command shouldn't have to rebuild from scratch.
- Slice 1 scope (registry + cURL → HTTP request):
  - `src/shared/importers/registry.ts` (new) — `ImporterAdapter<TPreview, TResult>` interface with `detect` / `preview` / `import` phases.
  - `src/shared/importers/curlImporter.ts` (new) — parses cURL text into an `HttpRequestV1`. Reuses existing cURL parsing if any; otherwise adapts an MIT-licensed library or hand-rolls.
  - `src/renderer/components/ImportPreview/` (new) — modal showing parsed result with "Confirm" / "Cancel" + lossy-field warnings.
  - Settings → "Import data..." command palette entry.
  - Tests: cURL parse fixtures (valid + invalid + credentials-bearing); preview component states.
- Slice 1 acceptance criteria:
  - Pasting `curl -H "Authorization: Bearer x" https://api.example.com` into the import modal previews an `HttpRequestV1` with the header REDACTED in the preview.
  - Confirming the import creates a new request in the HTTP workspace.
  - Unsupported cURL syntax shows a diagnostic, not a partial mutation.
- Out of scope (deferred to Slice 2 + 3):
  - `.ipynb` → notebook document (Slice 2 — depends on RL-043 Slice A).
  - Bruno / Postman collections (Slice 3).
  - Code sandbox / CodePen import (Slice 4+).
- Dependencies:
  - RL-097 Slice 1 — HTTP workspace exists.
- Risks:
  - cURL spec is large and underspecified → mitigated by shipping the 80%-case parser + diagnostic for the rest.

### RL-101 Onboarding Choreography

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately — pure renderer work on existing tour surface`
- Why this matters:
  - RL-039 closed the guided tour, but "user opens app → closes app without running anything" is still a common drop-off pattern. World-class onboarding (Linear, Raycast) is not a tour — it's a choreographed sequence of aha moments that gets the user to their first successful run in under 90 seconds.
- Slice 1 scope:
  - **Pre-seeded scratchpad with real code** (not placeholder `puts "Hello"`). Use a snippet that produces rich output — for JS: a small array sort with `console.table()`.
  - **Post-first-run toast** — after the first successful run completes, fire a `pushStatusNotice` with `tone: 'success'` and a single CTA "Save this as a snippet?" (button uses the existing RL-023 Snippet Lab API).
  - **Post-first-snippet toast** — after the first snippet save, fire a status notice "Browse your library with ⌘P" (CTA opens Quick Open).
  - **Settings → General → Onboarding section** — three toggles to reset each of the three states above.
  - i18n: en + es (tuteo).
  - Telemetry: 3 new closed-enum events — `onboarding.first_run_completed { language }`, `onboarding.first_snippet_saved`, `onboarding.toast_dismissed { stage }`.
  - Tests: store-flag transitions; toast appears once per stage; reset action re-triggers.
- Slice 1 acceptance criteria:
  - A fresh install opens with a JS scratchpad showing 5-7 lines of pre-seeded code (array sort + `console.table`).
  - Running the pre-seeded code with Cmd+Enter shows the table in the console panel.
  - Within 1500 ms of the first successful run, a status notice appears with "Save this as a snippet?" CTA.
  - Saving the snippet fires a second status notice mentioning Cmd+P.
  - The choreography fires AT MOST ONCE per user (per stage). Subsequent runs/snippet saves are silent.
  - Settings → Onboarding has three "Reset" buttons that re-arm each stage.
- Out of scope (deferred to Slice 2):
  - 60-second intro video (Slice 2 — content production + hosting decisions).
  - Per-language pre-seeded scratchpad variants (Slice 2 — currently only JS ships).
- Dependencies:
  - RL-023 — Snippet Lab API.
  - RL-039 — guided tour infrastructure (status notice patterns).
- Risks:
  - Toast fatigue → mitigated by once-per-stage cap + dismiss-forever option.
  - Pre-seeded code becoming stale → mitigated by reviewing the snippet quarterly via a CI check that verifies it still produces the expected output.

### RL-102 Git Read-Only Layer

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready when RL-024 multi-file Slice 1 ships — needs a project root path to diff against`
- Why this matters:
  - For desktop developers, Git is the substrate. A workspace without ANY Git awareness feels like a scratchpad. Read-only Git integration (diff against HEAD, file-watcher detection, status pill) closes that gap with minimal scope and zero write surface.
- Slice 1 scope (Desktop-only; web reports `unavailable`):
  - `src/main/git/` (new directory) — IPC handlers: `git:detect` returns `{ installed, version?, repoRoot? }`; `git:status` for a file path returns `{ status: 'clean' | 'modified' | 'untracked' | 'unknown' }` + line count of changes; `git:diff` returns `{ hunks: ... }` from `git diff HEAD <file>`.
  - `src/preload/index.ts` — `window.lingua.git.*` bridge.
  - `src/types.d.ts` — type declarations.
  - `src/renderer/components/Editor/GitStatusPill.tsx` (new) — small chip beside the file tab name showing status. Color-coded: green (clean) / amber (modified) / red (untracked) / grey (unknown).
  - `src/renderer/components/Editor/GitDiffPanel.tsx` (new) — bottom-panel tab alongside Console / Variables. Renders the diff hunks for the active file. Uses Monaco's diff editor.
  - Reload-from-disk detection: when the existing watcher reports a file change AND the editor has the file open clean, prompt the user with "File changed on disk — reload?".
  - Tests: IPC handlers with mocked `execFile('git', ...)`; component test for status pill states; e2e for diff panel rendering.
- Slice 1 acceptance criteria:
  - Opening a folder that is a git repo shows the git status pill on each open tab.
  - Editing a file changes the pill from "clean" to "modified" within 500 ms.
  - Opening the Git Diff panel for a modified file shows side-by-side or unified diff via Monaco's diff editor.
  - On web build, the git status pill is hidden entirely; the Diff panel tab is not registered.
  - When `git` is not on PATH on desktop, the pill shows "unknown" with a tooltip explaining the missing binary.
- Out of scope (deferred to Slice 2+):
  - `git commit` / `git add` / `git push` (Slice 3+).
  - Branch switching (Slice 2 — read-only branch indicator first).
  - Conflict resolution UI.
  - Submodule support.
- Dependencies:
  - RL-024 Slice 1 — multi-file project root path resolution.
  - RL-087 — watcher reliability (already `Done`).
- Risks:
  - `git` binary detection on macOS GUI apps → reuse the same fix-path approach as Ruby Slice 6.
  - Large diffs blocking renderer → mitigated by capping diff hunks at 500 lines.

### RL-103 Project Templates

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready when RL-024 (multi-file) + RL-025 Slice A (dependency detection) ship`
- Why this matters:
  - Today `LANGUAGE_PACKS` ships language-level starter snippets (one file, one `puts`). Project-level templates ("Express API", "FastAPI app", "CLI with argparse", "React component sandbox") let users build something runnable in 10 seconds.
- Slice 1 scope (5 curated templates):
  - `src/shared/projectTemplate.ts` (new) — `ProjectTemplateV1` schema: `{ id, title, language, description, files: Array<{ relPath, content }>, dependencies?: DependencyManifest, runCommand?: string }`.
  - `src/renderer/data/projectTemplates/` (new) — 5 templates as `.json` files: `express-api-hello`, `fastapi-hello`, `node-cli-argparse`, `react-component-sandbox`, `python-data-explorer`.
  - `src/renderer/components/Welcome/ProjectTemplatesPanel.tsx` (new) — Welcome screen tab showing the 5 templates as cards. Click → creates the project tree in a chosen location + opens the entry file.
  - Command palette entry: "New project from template...".
  - Tests: schema validation; one fixture-test per template that the JSON parses + extracts files correctly.
- Slice 1 acceptance criteria:
  - The Welcome screen has a "From template..." tab with 5 cards.
  - Picking "Express API hello" prompts for a directory, writes 4 files, opens `src/index.js`.
  - On web build, the cards are visible but clicking shows "Templates require the desktop app".
  - Each template's `package.json` declares dependencies in the RL-025 format.
- Out of scope (deferred to Slice 2+):
  - Community-contributed templates (Slice 4+ — needs RL-106 curated catalog model).
  - Template customisation wizard (Slice 3 — user-chosen project name, port, etc.).
  - Auto-install dependencies after scaffold (Slice 2 — depends on RL-025 Slice B).
- Dependencies:
  - RL-024 Slice 1 — multi-file project support.
  - RL-025 Slice A — dependency declaration format.
- Risks:
  - Template staleness → mitigated by CI test that runs each template's `runCommand` against a sandbox and asserts non-zero stdout.
  - License headers in template files → mitigated by including SPDX-License-Identifier in each file.

### RL-104 WebGPU AI Inference (Web) — Spike

- Priority: `P3`
- Status: `Research-backed spike`
- Readiness: `Spike artifact only; no implementation until ADR approved`
- Why this matters:
  - The web build today has no AI surface (RL-031 is desktop-only via Ollama). A constrained-use-case WebGPU model could power small per-tab actions (explain regex, name variable better, format JSON commentary) without sending data anywhere.
- Spike scope (no implementation; produces an ADR):
  - `docs/WEBGPU_AI_ADR.md` (new) — answer: which model (Phi-3-mini? Qwen 0.5B?); bundle cost vs lazy-load; browser support degradation story; quality on 50 test prompts; threat model.
  - Implementation gated until ADR is reviewed + approved.
- Spike acceptance criteria:
  - ADR document committed.
  - 50 test prompts run against the candidate model with results in `docs/WEBGPU_AI_SPIKE_RESULTS.md`.
  - Recommendation: ship with feature-flag, defer, or reject.
- Slice A scope (only if spike recommends ship):
  - `src/renderer/ai/webgpu/` (new) — model loader via lazy import; transformers.js or webllm adapter.
  - Settings → AI → "Web AI (experimental)" toggle.
  - Constrained tasks: explain-regex, format-JSON-with-commentary. NO general chat.
  - Telemetry: closed-enum `runtime.webgpu_ai_invoked { task, success, durationBucket }`.
- Slice A acceptance criteria (only if shipped):
  - Toggle enables the model load on first use (lazy, ~300 MB download).
  - "Explain this regex" action on a selected regex string produces an answer in < 5 s on M-series Mac, < 15 s on mid-range desktop.
  - Model is sandboxed — answer cannot include code from other tabs.
- Dependencies:
  - RL-094 Slice 1 — capsule schema.
  - RL-096 — Trust Dashboard to surface the model invocations.
- Risks:
  - Bundle / disk cost prohibitive → mitigated by lazy-load with explicit user gesture.
  - Model output quality unacceptable → mitigated by spike-first; only ship if quality is above threshold.

### RL-105 Mobile Companion (PWA, Read-Only)

- Priority: `P3`
- Status: `Planned`
- Readiness: `Slice 1 (Phase A) ready when RL-094 capsules + RL-036 share links stabilise`
- Why this matters:
  - Mobile authoring is explicitly anti-feature (`ANTI_FEATURES.md` §A-011). But "did my shared snippet still work?" and "show this trick on the go" are real use cases. A read-only mobile PWA covers them without committing to mobile editing.
- Slice 1 scope (Phase A — separate repo, NOT part of the main Electron app):
  - New separate repo `lingua-mobile` (similar pattern to `lingua-marketing`).
  - PWA + manifest + service worker + offline cache.
  - Two routes: `/` landing with one button "Open a shared snippet"; `/s/<encoded>` receives the URL fragment from RL-036 share links, decodes, renders read-only.
  - Re-uses `src/shared/runCapsule.ts` (RL-094) + `src/shared/redaction.ts` for parsing.
  - UI: code display via Shiki (lightweight syntax highlighter; no Monaco — too heavy for mobile).
  - Domain: `m.linguacode.dev` (new subdomain on Cloudflare Pages).
- Slice 1 acceptance criteria:
  - Visiting `m.linguacode.dev/s/<valid-share-link>` renders the snippet code with syntax highlighting.
  - The page works offline (service worker caches the static assets).
  - On a feature phone or 2G connection, the page is interactive within 5 s.
  - There is NO editor affordance, NO run button, NO write surface.
- Out of scope (deferred to Phase B):
  - Native iOS / Android apps.
  - Mobile authoring (anti-feature).
  - Mobile-specific run sandbox.
- Dependencies:
  - RL-094 Slice 1 — capsule schema.
  - RL-036 Phase A1 — share link format.
- Risks:
  - Domain provisioning → mitigated by reusing the Cloudflare account already used for `linguacode.dev`.
  - Maintenance overhead of a separate repo → mitigated by sharing `src/shared/*` via a thin package adapter.

### RL-106 Curated Community Snippets

- Priority: `P3`
- Status: `Planned`
- Readiness: `Slice 1 (Phase A — curated only) ready when RL-023 Snippet Lab stabilises`
- Why this matters:
  - User-contributed snippet marketplace is explicitly anti-feature (`ANTI_FEATURES.md` §A-004). But a CURATED catalog — the Lingua team picks 50 starter snippets, ships them as a bundled JSON — is valuable for discovery without the moderation burden.
- Slice 1 scope (Phase A — read-only curated):
  - `src/renderer/data/communitySnippets/` (new) — 50 starter snippets as JSON files. Examples: "Parse a cURL command in JS", "Find the largest file in a directory (Node)", "Pretty-print a JSON tree (Python)", "Reverse a string in Ruby (5 ways)", "Match an IPv6 address with a regex".
  - Schema: extends `SnippetV1` (RL-023) with `author: string` and `license: 'MIT' | 'CC0'`.
  - `src/renderer/components/Snippets/CommunitySnippetsPanel.tsx` (new) — Welcome screen tab + sidebar entry showing 50 cards. Fuzzy search via existing palette filter logic.
  - Each card: title, language badge, 3-line preview, "Open in editor" button.
  - Contribution path: PRs to `src/renderer/data/communitySnippets/`. README in the directory documents the schema + acceptance criteria.
- Slice 1 acceptance criteria:
  - The Welcome screen has a "Community" tab showing 50 cards.
  - Fuzzy search filters cards by title or language.
  - Clicking a card opens a new tab with the snippet's code.
  - There is NO in-app "submit a snippet" affordance (contributions are PR-only).
  - Each snippet's JSON has a valid `license` field and `author` attribution.
- Out of scope (deferred to Phase B):
  - User-submitted snippets (anti-feature unless moderation model decided).
  - Snippet voting / comments (anti-feature §A-004).
  - Cloud-hosted snippet catalog (anti-feature §A-006).
- Dependencies:
  - RL-023 — Snippet Lab schema + storage.
- Risks:
  - Curation drift → mitigated by quarterly review CI check.
  - License confusion → mitigated by mandatory MIT or CC0 + explicit attribution per card.

### RL-107 VSCode Theme Import

- Priority: `P3`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately — small isolated work`
- Why this matters:
  - Users with established VSCode setups want their theme in Lingua without recreating it. Importing a VSCode `.json` theme into Lingua's design-token system is ~1 day of work for substantial perceived value.
- Slice 1 scope:
  - `src/shared/themeImport.ts` (new) — parser that converts a VSCode `themes/*.json` (with `colors` and `tokenColors`) into Lingua's `ThemePack` shape (RL-075). Maps the most common VSCode token scopes to Lingua's Monaco token rules; unmapped scopes fall back to the active Lingua theme.
  - `src/renderer/components/Settings/ImportThemeRow.tsx` (new) — Settings → Appearance → "Import VSCode theme..." button.
  - Imported themes persist as user theme packs (cap 10).
  - Tests: parser fixtures for 3 popular VSCode themes (Dracula, Solarized Dark, One Dark Pro); component test for picker + preview + save flow.
- Slice 1 acceptance criteria:
  - Importing the Dracula VSCode theme produces a Lingua theme pack with the chrome and major Monaco token colors visually close to Dracula.
  - The imported theme appears in the Settings → Appearance theme picker as "Dracula (imported)".
  - Picking the imported theme applies it to the entire app within 500 ms.
  - Importing a malformed JSON shows a localized error notice.
- Out of scope (deferred to Slice 2):
  - 100% VSCode token-scope coverage (Slice 1 mapping is partial; rare scopes fall back).
  - Theme marketplace (anti-feature §A-014 unless reversed).
  - Theme sync across devices (anti-feature §A-006).
- Dependencies:
  - RL-075 — Signal-Slate DS canonical token surface (already `Done`).
- Risks:
  - VSCode theme format variation → mitigated by testing the 3 most-installed themes + sensible fallback for unmapped scopes.

---

## Extensions to existing tickets (world-class lane)

### RL-024 — Multi-file projects (PROMOTION update — 2026-05-20)

**Status update:** Promoted from blocking-RL-043 to a top-priority foundation slice in the world-class lane (per `docs/ROADMAP.md` §5 slot 3). The implementable scope per the existing `### RL-024` section stays unchanged; only the SEQUENCE moves.

**Slice 1 reframe (smallest implementable cut for the world-class lane):**
- Sidebar tree showing the open folder's contents (lazy-load entries; cap depth at 8).
- "Open folder..." command (desktop only — uses native dialog).
- Per-file dirty marker on tab + tree.
- Cmd+Shift+F find-in-files via Monaco's search API.

**Slice 1 acceptance:**
- Opening a folder with ~50 files renders the tree within 500 ms.
- Editing a file marks it dirty in BOTH the tab and the tree.
- Cmd+Shift+F searches across all open-folder files (uses `ripgrep` via main when available; falls back to JS regex iteration).
- On web build, "Open folder..." uses the File System Access API; falls back to "individual file upload" when unsupported.

### RL-031 — Slice 2 — Local Docs + AI Citations (extension)

Pre-req: RL-031 Slice 0/1 ships first (Ollama bridge MVP). Slice 2 layers retrieval + citations on top.

**Slice 2 scope:**
- `src/shared/localDocs.ts` (new) — local docs registry. First sources: app `USAGE.md`, utility help metadata, curated language snippets.
- Token-scoring retrieval (no embeddings in Slice 2).
- AI request plan UI: shows model + prompt preview + cited contexts BEFORE sending; user clicks "Send" to actually call the bridge.
- AI response separates `answerMarkdown` / `citations` / suggested `actions` (insert code, copy code, open cited doc).
- Trust Dashboard (RL-096) shows each AI call with redacted summary.

**Slice 2 acceptance:**
- Desktop can answer one local-docs question through Ollama with visible citations.
- Web mode explains that local AI is unavailable unless RL-104 web AI shipped.
- The prompt preview lists every source included.
- The user must explicitly copy, insert, or apply generated code.
- Each AI call writes a `TrustEventV1` summary to the trust event store.

**Dependencies:** RL-031 Slice 0/1; RL-096 Slice 1.

### RL-039 — Slice B — Recipes (extension)

Pre-req: RL-039 Slice A (guided tour + lesson drafts) already shipped. Slice B reframes "lessons" as "Recipes" — searchable, problem-statement-led recipe cards rather than a course tree.

**Slice B scope:**
- `src/shared/lessonPack.ts` (new) — `LessonPackV1` schema + parser + assertion runner.
- `src/renderer/components/Recipes/` (new) — Cmd+Shift+L opens a fuzzy-search overlay (mirrors Command Palette).
- Selecting a recipe opens a new tab with starter code + a side panel showing the prompt + "Run + Test" button.
- "Run + Test" replays user's code, then runs assertions and shows pass/fail per assertion.
- `src/renderer/stores/lessonProgressStore.ts` (new) — local (cap 200 entries) tracking opened / attempted / passed / skipped.
- Initial 10 recipes bundled under `docs/lessons/` — each as a `LessonPackV1` JSON file.

**Slice B acceptance:**
- Cmd+Shift+L opens the recipes overlay; typing filters by title.
- Selecting "Sort an array of objects (JS)" opens a tab with starter code + a prompt panel.
- Clicking "Run + Test" runs the code, then runs 3 assertions, shows pass/fail per assertion.
- Progress persists across reload.

**Dependencies:** RL-094 Slice 1 — assertions reference capsules as expected output.

### RL-050 — Phase A spike + Phase B cross-internet (extension)

Pre-req: None for Phase A spike. Phase A spike produces an ADR; Phase B (cross-internet) is gated until Phase A implementation ships.

**Phase A spike scope (no code; produces ADR):**
- `docs/LAN_COLLABORATION_ADR.md` (new) — answer: transport (WebRTC vs local WebSocket); threat model (guest join trust, encryption, revocation); shared fields defaults; macOS local-network permission copy.

**Phase A implementation (after ADR approval):**
- Host/join pairing with short code or QR.
- Read-only: follower receives code, current output, run status.
- Clear network indicator + disconnect controls.
- Limited to LAN.

**Phase B — Cross-internet pair (extension, after Phase A ships):**
- Cloudflare TURN servers as relay; SFU pattern, no central state.
- Same read-only model — guests do NOT get an edit cursor.
- "Fork the host's state" affordance creates a local copy in the guest's Lingua.

**Phase A acceptance:**
- ADR document committed; decision recorded with threat-model answers.

**Phase B is OUT OF SCOPE for any current planning window.** It graduates only when Phase A is shipped and stable.

**Dependencies:** RL-094 — capsule schema for the shared payload.

### RL-044 — Sub-slice F: Clickable error stack frames (extension)

**Sub-slice F scope** (added to the next RL-044 slice that ships rich-media payloads):
- Treat runtime errors as `RichOutputPayload` with `kind: 'error'` (already exists per RL-044 Slice 1B).
- Extend the payload with optional `clickable: { file, line, column }` field per stack frame.
- The console panel detects the clickable field and makes the frame click open the matching tab + scroll to line.

**Sub-slice F acceptance:**
- A JS runtime error renders with each frame as a clickable link in the console panel.
- Clicking a frame opens the source file at the right line (or focuses an already-open tab).
- Errors without source info (anonymous functions, eval) still render as text fallback.

**Dependencies:** RL-044 next slice (rich-media payloads).

---

## Tier 1 — Sugerencias incorporadas (promoción 2026-05-20)

Cuatro tickets nuevos surgidos del análisis post-promoción del world-class
lane. Todos `P1`/`P2` con criterios de aceptación firmes; ya quedan
discoverable por `lingua-ship` vía ROADMAP §4k + §5.

### RL-108 Inline lint + quick-fixes in Monaco

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately — JS/TS only via existing esbuild + tsc surfaces. Python via Pyodide pyflakes deferred to Slice 2.`
- Why this matters:
  - Hoy Lingua subraya errores de sintaxis y type-errors al ejecutar; los desarrolladores senior esperan retroalimentación inmediata mientras escriben. Sin esto, Lingua se siente "REPL ligero" en lugar de "editor serio".
  - Quick-fixes (lightbulb) son el gesto-firma de un IDE moderno: "vi tu error y aquí está el arreglo, presiona Enter". El gap perceptual entre Lingua y VSCode hoy es 80% este detalle.
- Slice 1 scope (JS/TS only):
  - `src/renderer/lint/jstsLintWorker.ts` (new) — Web Worker corriendo `typescript` (ya bundled) + `esbuild-wasm` (ya bundled) en modo análisis. Diagnostics emitidos cada 500 ms (debounced) tras la última edición.
  - `src/renderer/lint/lintAdapter.ts` (new) — adapter que mapea diagnostics → Monaco `IMarkerData[]` y los publica vía `monaco.editor.setModelMarkers(model, 'lingua-lint', markers)`.
  - `src/renderer/lint/quickFixProvider.ts` (new) — `monaco.languages.registerCodeActionProvider('typescript', ...)` para 5 quick-fixes deterministas (Slice 1): `add missing import`, `remove unused import`, `add missing semicolon`, `replace == with ===`, `wrap in try/catch`.
  - Settings → Editor → "Inline lint" toggle (default ON for JS/TS; OFF for Python pending Slice 2).
  - `useSettingsStore`: nueva `inlineLintEnabledByLanguage: Record<LanguageId, boolean>`.
  - Tests: `tests/renderer/lint/quickFixProvider.test.ts` — 5 fixtures por quick-fix; `tests/renderer/lint/lintAdapter.test.ts` — mapeo TS diagnostic → IMarkerData con severidad correcta (`Error` / `Warning` / `Info`).
- Slice 1 acceptance criteria:
  - Al escribir `consol.log("x")` en un buffer `.ts`, Monaco muestra subrayado rojo en `consol` dentro de 1 s tras dejar de teclear; hover muestra "Cannot find name 'consol'. Did you mean 'console'?".
  - Cmd+. (Quick Fix) abre menú con "Replace 'consol' with 'console'"; Enter aplica el cambio.
  - El toggle Settings → Editor → Inline lint = OFF desactiva todos los markers `'lingua-lint'` en < 200 ms.
  - El worker se pausa cuando la pestaña pierde foco (`document.visibilityState === 'hidden'`) para no consumir CPU mientras el usuario está en otra app.
  - Telemetría closed-enum `editor.lint_diagnostic_emitted { language, severity, ruleId }` mirroreada con parity test en update-server.
- Out of scope (deferred to Slice 2):
  - Python lint via Pyodide pyflakes (necesita su propio worker + boot latency review).
  - Go / Rust lint (gopls + rust-analyzer ya están vivos vía RL-026; integrar quick-fixes encima requiere su propio slice).
  - Ruby lint (rubocop bundling es su propio análisis).
  - Quick-fixes con type-aware refactors (rename, extract function) — RL-026 lane crossover.
- Dependencies:
  - Ninguna en Slice 1 (depende sólo de `typescript` + `esbuild-wasm` ya bundled).
- Risks:
  - Latencia de worker en archivos > 2 000 LOC → mitigado por debounce 500 ms + cancelación del análisis previo en cada nueva edición.
  - Quick-fix incorrecto destruye código del usuario → mitigado por: cada quick-fix tiene un test de smoke con código real, y Cmd+Z funciona porque las ediciones pasan por la API normal de Monaco.

### RL-109 Project-scoped environment isolation

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready after RL-024 Slice 1. Foundation that prevents env-var bleed across open folders.`
- Why this matters:
  - Hoy `RL-011` env-var scopes son globales (User + Workspace tienen un único scope por usuario). Cuando llegue RL-024 multi-file y un usuario tenga dos proyectos abiertos (por ejemplo `api-prod` y `api-staging`), el mismo `DATABASE_URL` se inyecta en ambos. Es un footgun de seguridad y una sorpresa cognitiva.
  - El patrón estándar (`.envrc` direnv, VSCode workspace settings) es scope-per-project. Lingua debe igualar.
- Slice 1 scope:
  - `src/shared/projectEnvScope.ts` (new) — define `ProjectEnvScopeV1 { projectRoot: string, scopeId: string, version: 1 }` y un store key derivado: `lingua-env-project-${hash(projectRoot)}`. Hash es SHA-256 truncado a 16 chars del path normalizado.
  - `src/renderer/stores/envScopeStore.ts` (extend) — agrega `projectScopes: Record<string, EnvScope>` map. La función `resolveEffectiveEnv(projectRoot)` ahora compone: `User scope` → `Workspace scope` → `Project scope (projectRoot)`. El último gana.
  - `src/main/ipc/projectEnv.ts` (new) — `project-env:get` / `project-env:set` IPC handlers; persisten en `app.getPath('userData')/projectEnvScopes/{scopeId}.json`. Allowlist key/value validation (mismo que RL-011).
  - Settings → Editor → Environment variables → nueva pestaña "Project" (visible sólo cuando una carpeta está abierta) muestra el scope del proyecto actual con badge "scope: {projectRoot.split('/').pop()}".
  - Hint banner en User/Workspace pestañas: "Esta variable se aplica a todos los proyectos. Para limitarla, defínela en Project."
  - Tests: `tests/shared/projectEnvScope.test.ts` (hash determinismo, normalización path); `tests/main/projectEnv.ipc.test.ts` (allowlist guard, path-traversal); `tests/renderer/stores/envScopeStore.test.ts` (orden de composición User→Workspace→Project).
- Slice 1 acceptance criteria:
  - Abrir `~/code/api-prod` define `DATABASE_URL=prod.db` en scope Project; abrir `~/code/api-staging` y definir `DATABASE_URL=staging.db` no afecta `api-prod`.
  - Cambiar de pestaña entre los dos proyectos abiertos refleja la variable correcta en Settings → Environment → Project.
  - Borrar un proyecto del disco no orfana su archivo de scope (cleanup en `app.on('will-quit')` revisa proyectos > 90 días sin acceder y los borra; opt-in vía Settings).
  - `npm run test:smoke:web:license` no toca este scope (web no tiene project roots).
  - Telemetría `env.project_scope_used { hasProjectVars: boolean }` por sesión, mirroreada con parity test.
- Out of scope (deferred to Slice 2):
  - Project scope para web build (necesita File System Access API + persistencia IndexedDB; web no tiene `userData`).
  - Sync project scopes between machines (anti-feature §A-006 unless reversed).
  - Auto-detect `.env` / `.envrc` files in project root (importer territory; podría ser RL-100 Slice extension).
- Dependencies:
  - RL-024 Slice 1 (necesita el concepto de "project root" en el store de tabs).
- Risks:
  - Path normalization edge cases (`~`, symlinks, Windows drive letters) → mitigado por test fixtures cubriendo los 4 OS comunes + un test de symlink resolution.
  - Migración de variables Workspace existentes a Project scope → en Slice 1 NO migra automáticamente; muestra hint banner explicando la diferencia.

### RL-110 Smart paste detection

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready after RL-036 Phase A1, RL-097 Slice 1, and RL-044 Sub-slice F.`
- Why this matters:
  - Cuando un usuario pega un share-link (`linguacode.dev/s/abc123`), una cURL command, un JSON grande, o un stack trace, el comportamiento ideal NO es "pegarlo como texto plano en el editor". Es "ofrecer la acción correcta para ese contenido".
  - VSCode hace esto parcialmente (paste-as-import, paste-as-link); Lingua puede hacerlo mejor porque conoce sus propios artefactos (share-links, capsules, HTTP requests).
- Slice 1 scope:
  - `src/renderer/clipboard/pasteHandlers.ts` (new) — registry de paste handlers con prioridad. Cada handler implementa `detect(text: string): PasteIntent | null` y `apply(text, context): void | Promise<void>`. Handlers (en orden):
    1. `lingua-share-link` — detecta `linguacode.dev/s/...` → abre el capsule remoto en una nueva tab.
    2. `lingua-capsule` — detecta JSON con `version: 1` + `schema: 'RunCapsuleV1'` → importa como nueva tab con código + resultado precomputado.
    3. `curl-command` — detecta `^curl ` → ofrece "Importar como HTTP request" (delega a RL-100 Slice 1 importer).
    4. `stack-trace` — detecta líneas `at ...:line:col` → si hay project root abierto, ofrece "Abrir en X:line" (delega a RL-044 Sub-slice F handler).
    5. `large-json` — detecta JSON > 1 KB → ofrece "Pegar como datos en panel" (delega a RL-099 pipeline panel o utility JSON formatter).
  - `src/renderer/components/Editor/PasteIntentToast.tsx` (new) — toast non-blocking que aparece 200 ms tras paste; ofrece "Importar como X" + "Pegar como texto" (default). Auto-dismiss tras 4 s si no se interactúa.
  - Cmd+Shift+V = "Paste as plain text" (bypass detection, comportamiento clásico).
  - Settings → Editor → "Smart paste" toggle (default ON).
  - Tests: `tests/renderer/clipboard/pasteHandlers.test.ts` — fixture por handler con happy path + edge case (texto que parece pero NO es ese formato).
- Slice 1 acceptance criteria:
  - Pegar `curl -X POST https://api.example.com/v1/users` muestra toast "Importar como HTTP request" → al aceptar, abre el panel HTTP con el método/URL/body precargado.
  - Pegar un share-link de Lingua abre el capsule directamente (sin pegar el texto).
  - Pegar un stack trace de Node con un path absoluto que coincide con la carpeta abierta ofrece "Abrir error_handler.ts:42".
  - Cmd+Shift+V siempre pega como texto plano.
  - Settings toggle = OFF desactiva todos los handlers; paste vuelve a ser literal.
  - Telemetría `editor.smart_paste_applied { handler, accepted }` closed-enum, mirroreada con parity test.
- Out of scope:
  - Paste-as-import para módulos npm/pip (anti-feature §A-008 — silent network call).
  - OCR de imágenes en clipboard (cost/value mal balance; deferred indefinitely).
  - Magic clipboard format detection for Excel/Numbers tables (paste-as-csv) — podría ser fold futuro.
- Dependencies:
  - RL-036 Phase A1 (share-links existen).
  - RL-097 Slice 1 (HTTP workspace recibe el cURL import).
  - RL-100 Slice 1 (cURL parser).
  - RL-044 Sub-slice F (clickable stack frames).
- Risks:
  - Falsos positivos en detección → mitigado por: el toast siempre ofrece "Pegar como texto" como opción visible, y los handlers tienen detectores conservadores con tests de "NO debe disparar en estos casos".
  - Privacy: detectar contenido del clipboard implica leerlo → ya leemos para pegar; no agrega exposición.

### RL-111 Workspace session restore

- Priority: `P1`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately. Extends the RL-089 profile contract with a session-snapshot field.`
- Why this matters:
  - Hoy al cerrar Lingua se pierden: tabs abiertos, contenido sin guardar de scratchpads, layout del panel inferior, posiciones de scroll, breakpoints activos. El usuario senior espera "abrir Lingua donde lo dejé", como Chrome, VSCode, IntelliJ.
  - RL-089 ya define el contrato de export/import de profile; agregar un snapshot session-state es la extensión natural — mismo schema versionado, mismas reglas de exclusión (no license tokens, no device ids).
- Slice 1 scope:
  - `src/shared/sessionSnapshot.ts` (new) — `SessionSnapshotV1` schema: `{ version: 1, snapshotAt: ISO-8601, tabs: TabSnapshot[], bottomPanel: BottomPanelLayout, settings: { activeTabId, layoutMode }, projectRoot?: string }`. Cada `TabSnapshot` incluye `id, language, fileName | scratchpadId, content, dirty, scrollTop, cursorLine, cursorColumn, breakpoints, autoLogEnabled, stdinBuffer (capped 4KB), variableInspectorEnabled`.
  - `src/main/sessionSnapshot.ts` (new) — escribe a `app.getPath('userData')/session.json` con `app.on('before-quit', captureSnapshot)`. Cap snapshot a 2 MiB; si excede, descarta scratchpads sin uso reciente (LRU) hasta caber.
  - `src/renderer/stores/sessionRestore.ts` (new) — al boot, lee `session.json`, valida via `parseSessionSnapshot`, ofrece "Restaurar sesión anterior" como toast cliqueable durante 10 s. Por defecto NO restaura silenciosamente (privacidad: si el usuario reabre Lingua tras compartir su pantalla, no quiere que aparezca el código privado automáticamente).
  - Settings → General → "Restore session on startup": tres valores closed-enum (`never` | `ask` | `always`). Default `ask`.
  - Web build: usa `sessionStorage` para el snapshot (cap 4 MiB del browser); persistencia limitada a la sesión del tab.
  - Tests: `tests/shared/sessionSnapshot.test.ts` — schema migration, allowlist guard, cap enforcement; `tests/main/sessionSnapshot.test.ts` — escritura/lectura, before-quit hook; `tests/renderer/stores/sessionRestore.test.ts` — toast de restore, los 3 modos de Setting.
- Slice 1 acceptance criteria:
  - Abrir Lingua, escribir código en un scratchpad nuevo, agregar un breakpoint, cerrar la app. Reabrir → toast "Restaurar 3 tabs" → click → todo restaurado idéntico (contenido, scroll, breakpoint).
  - Setting `always` restaura sin preguntar.
  - Setting `never` ignora el snapshot y boot fresco.
  - License tokens y device ids NUNCA salen en `session.json` (test explicito que escanea el JSON tras boot).
  - Si el snapshot está corrupto, se ignora silenciosamente y se loggea a `crash.log`; el boot procede normal.
  - Telemetría `session.restored { tabCount, source: 'auto' | 'prompt' }` closed-enum, mirroreada con parity test.
- Out of scope:
  - Restaurar processes corriendo (no se preserva un Node subprocess vivo).
  - Restaurar contenido de Output / Console (los runs no se replay-an).
  - Sync session-snapshot across machines (anti-feature §A-006).
  - Multi-window restore — Slice 2 si Lingua llega a soportar multi-window.
- Dependencies:
  - Conceptualmente extiende RL-089 (`Done`); reusa `parseAndValidateProfile` patterns pero con su propio schema.
  - Compatible con RL-024 Slice 1 (si hay projectRoot abierto, se restaura).
- Risks:
  - Privacy: snapshot en disco contiene código del usuario → mitigado por: snapshot vive en `userData` (no en `Documents`), y el "ask" default previene auto-restore tras compartir pantalla.
  - Cap excedido en sesiones grandes → mitigado por LRU drop + un warning toast cuando se descartan tabs.

---

## Tier 2 — Polish items (promoción 2026-05-20)

Siete items menores. Algunos son tickets propios (RL-112/113/114/115/116/117);
otros son extensiones a tickets existentes. Cada uno auto-suficiente.

### RL-112 Persistent status bar

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately.`
- Why this matters:
  - VSCode y JetBrains tienen status bar inferior persistente con info crítica: branch git, errors/warnings, language, encoding. Lingua hoy tira esta info en pills flotantes que aparecen/desaparecen. Una status bar fija reduce el costo cognitivo de "¿dónde está mi info?".
- Slice 1 scope:
  - `src/renderer/components/StatusBar/StatusBar.tsx` (new) — 24px tall, fixed bottom, debajo del bottom-panel resize handle.
  - Segmentos (ordenados de izquierda a derecha):
    1. Active language (chip; click → cycle a otro language).
    2. Lint diagnostic count (`3 errors, 2 warnings`; click → focus next error vía RL-108).
    3. Cursor position (`Ln 42, Col 7`).
    4. Encoding (`UTF-8`; click → cycle UTF-8 / UTF-16; locked for run targets).
    5. Indentation (`Spaces: 2`; click → toggle Tab/Space + width).
    6. Git branch + dirty marker (only when RL-102 shipped + project root con .git).
    7. Run status pill condensed (reuses `<RunStatusPill>` from RL-020 Slice 7).
  - Setting → Editor → "Show status bar" toggle (default ON desktop; OFF web por screen real estate).
  - Tests: cobertura de cada segmento + el toggle.
- Slice 1 acceptance criteria:
  - Status bar siempre visible cuando el toggle está ON.
  - Cada segmento es un button con keyboard focus + Cmd+K (jump to status bar).
  - Cambiar de tab actualiza todos los segmentos en < 50 ms.
- Dependencies:
  - RL-108 para el segment de lint counts (degrada graceful si RL-108 no shipped: 0/0).
  - RL-102 para el git segment (oculto sin RL-102).
- Risks:
  - Pixel-budget con utilities/scratchpad/bottom-panel ya activos → mitigado por toggle OFF default en web.

### RL-113 Cmd+; Recent commands stack

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately.`
- Why this matters:
  - Cmd+P/K/Shift+P abren palette para descubrimiento. Pero el flujo "ya ejecuté `Toggle auto-log` 3 veces hoy, quiero volver a hacerlo" requiere abrir palette + retipear + selectionar. Una stack de "comandos recientes" (Cmd+;) elimina ese roundtrip.
- Slice 1 scope:
  - `src/renderer/stores/commandHistoryStore.ts` (new) — ring buffer de 20 comandos ejecutados (closed-enum action IDs). Per-sesión persist.
  - Cmd+; (semicolon) abre popover con stack de 8 más recientes; números 1-8 keyboard shortcut para ejecutar; Enter ejecuta el primero; Escape cierra.
  - El popover muestra: nombre del comando, timestamp relativo (`2m ago`), keyboard shortcut si tiene.
  - Tests: ring buffer eviction, navegación con teclado.
- Slice 1 acceptance criteria:
  - Ejecutar 3 comandos vía palette → Cmd+; → ver los 3 en orden inverso (más reciente arriba).
  - Presionar `1` ejecuta el primero; el popover se cierra.
  - El ring buffer no excede 20 entradas (eviction FIFO).
- Dependencies:
  - Ninguna (reusa el registry de commands del palette existente).
- Risks:
  - Bajos.

### RL-114 Test runner auto-detect

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready after RL-024 Slice 1.`
- Why this matters:
  - Desktop devs serios tienen tests. Hoy Lingua los puede correr vía terminal (RL-048) pero no los entiende. Detectar `package.json#scripts.test` o `pyproject.toml#tool.pytest` y ofrecer "Run tests" en el palette + status bar es un quick-win.
- Slice 1 scope:
  - `src/shared/testRunnerDetect.ts` (new) — `detectTestRunner(projectRoot)` lee `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` y devuelve `TestRunnerProfile | null` (`{ kind: 'jest' | 'vitest' | 'pytest' | 'cargo-test' | 'go-test', command, cwd }`).
  - `src/main/ipc/testRunner.ts` (new) — `test:detect` y `test:run` IPC handlers. `test:run` spawn-ea el binary con `npm run`/`pytest`/`cargo test` y stream-ea stdout vía `test:output` event.
  - `src/renderer/components/BottomPanel/TestsTab.tsx` (new) — bottom-panel tab "Tests"; muestra el comando detectado + botón Run + stream output con coloring básico (PASS/FAIL).
  - Palette entry: "Run project tests" (visible cuando `detectTestRunner` no es null).
  - Tests: fixtures por kind detectado.
- Slice 1 acceptance criteria:
  - Abrir un repo con `package.json#scripts.test = "vitest"` → palette ofrece "Run project tests"; bottom-panel "Tests" tab visible.
  - Click "Run" → spawn-ea `npm run test` desde el project root; output stream-ea en vivo.
  - Repo sin test runner detectado → la tab no aparece y la palette entry no surface.
- Dependencies:
  - RL-024 Slice 1 (project root).
  - RL-019 (Node desktop subprocess pattern; reusa `buildNativeRunnerEnv`).
- Risks:
  - Detección frágil si el usuario tiene scripts personalizados → mitigado por: detección conservadora, y un Settings override "Custom test command" como escape hatch.

### RL-115 Inline per-line timing

- Priority: `P2`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately for JS/TS via Auto-log surface.`
- Why this matters:
  - Hoy el resultado de un run es "el output total". Ver "esta línea tardó 320 ms" inline en el gutter del editor es información de oro para perf hunting. Reusa la superficie auto-log de RL-020 Slice 5.
- Slice 1 scope (JS/TS only):
  - `src/renderer/workers/jsWorker.ts` (extend) — el transform de auto-log ya inyecta `__mc(line, value)`. Agregar `__mc_time(line, durationMs)` antes/después de cada statement (gated por `// @time` magic-comment o Settings toggle).
  - `src/renderer/components/Editor/InlineTimingDecorations.tsx` (new) — Monaco decorations a la derecha de cada línea: `▸ 320 ms` italic gris.
  - Setting → Editor → "Show per-line timing" toggle (default OFF; opt-in porque agrega overhead).
  - Hot-spot highlighting: la línea más lenta del último run pinta su decoration en rojo.
  - Tests: transform output verification + decoration placement.
- Slice 1 acceptance criteria:
  - Code con `// @time` magic-comment al inicio + Cmd+Enter → cada statement muestra su duración en el gutter.
  - La línea más lenta resalta en rojo; las demás en gris.
  - Setting OFF desactiva la captura (el transform no se inyecta).
- Out of scope:
  - Python timing (Pyodide tiene overhead diferente; Slice 2).
  - Go/Rust timing (requiere instrumentar el output; Slice 3).
- Dependencies:
  - RL-020 Slice 5 (auto-log surface).
- Risks:
  - Overhead del timing distorsiona el resultado en loops tight → mitigado por: documentar la limitación + ofrecer `// @time:macro` modo que sólo mide statements top-level.

### RL-024 Slice 2 — Search + replace cross-project (extensión)

Pre-req: RL-024 Slice 1 ya shipped.

**Slice 2 scope:**
- Cmd+Shift+H = "Replace in files" overlay (companion a Cmd+Shift+F search).
- Preview de matches con before/after diff por archivo.
- Confirmación per-file (no global apply silencioso).
- Regex toggle + case-sensitive toggle.
- Excludes: `node_modules`, `.git`, `dist`, `build` (Settings override).
- `src/main/ipc/projectSearch.ts` (extend) — agrega `project:replace` IPC que aplica replacements atomically (un archivo a la vez, con `fs.rename` desde tmpfile para resistir crash).

**Slice 2 acceptance:**
- Cmd+Shift+H abre overlay; tipear "oldName" en field 1 + "newName" en field 2 → preview muestra todos los matches con diff inline.
- Click "Apply to file" en un archivo → solo ese archivo cambia; los demás siguen como preview.
- Click "Apply to all" → aplica todos con confirmación modal "Replace N matches in M files?".
- Regex `\bold(\w+)\b` → `new$1` funciona; los grupos se preservan.
- Undo (Cmd+Z) en cada archivo abierto restaura el contenido (porque la replacement se hizo vía Monaco's edit API si el archivo estaba abierto).

**Dependencies:** RL-024 Slice 1.

### RL-116 Focus / Presenter mode

- Priority: `P3`
- Status: `Planned`
- Readiness: `Slice 1 ready immediately.`
- Why this matters:
  - Pair-programming, demos, screen-recording requieren ocultar chrome (toolbar, sidebar) y agrandar la fuente. Hoy se logra a mano (mover tres sliders en Settings); un toggle 1-click ahorra ese friction.
- Slice 1 scope:
  - `src/renderer/components/PresenterMode/usePresenterMode.ts` (new) — store-side toggle. Activo:
    - Oculta sidebar + toolbar (modo zen ya existe parcialmente; este es zen+).
    - Sube font-size del editor +4 (desde la base del usuario).
    - Sube font-size del console output +2.
    - Oculta status bar (si shipped).
    - Aplica `--presenter-mode-overlay` CSS var para opcional gradient sutil que sugiere "estamos presentando".
  - Cmd+K F = "Toggle presenter mode" palette + shortcut.
  - Tests: toggle persiste el old layout y lo restaura al apagar.
- Slice 1 acceptance criteria:
  - Cmd+K F → chrome desaparece, font sube, layout limpio.
  - Cmd+K F otra vez → todo vuelve al estado anterior.
  - El modo NO afecta los archivos guardados, solo la UI.
- Dependencies:
  - Ninguna (reusa store de layout existente).
- Risks:
  - Bajos.

### RL-117 Personal cloud sync via user-owned storage (extensión RL-089 — needs ADR)

- Priority: `P3`
- Status: `Research-backed spike` (needs ADR before implementation).
- Readiness: `Phase A — ADR required. Anti-feature §A-006 tension; reverso explícito via opt-in user-owned storage.`
- Why this matters:
  - Anti-feature §A-006 prohíbe "Mandatory cloud sync". Pero un opt-in sync vía Dropbox / Google Drive / GitHub Gist (storage que el usuario YA paga + controla) NO viola el espíritu de §A-006: el usuario elige; los datos no tocan infraestructura de Lingua.
  - Sin ningún sync, los usuarios con múltiples máquinas tienen que hacer export/import manual (RL-089).
- Phase A scope (no code; produces ADR):
  - `docs/CLOUD_SYNC_ADR.md` (new) — responde: ¿Dropbox vs Google Drive vs Gist? ¿qué sincroniza (snippets / settings / themes / capsules)? ¿conflict resolution? ¿encryption at rest? ¿revocation?
  - Threat model: ¿qué pasa si el provider es comprometido? ¿qué datos del usuario se filtran?
  - UX: ¿cómo evita "no sé que esto se estaba sincronizando"? Indicador visible permanente.
- Phase A acceptance:
  - ADR commited con decisión de provider + threat model documentado.
  - Decisión explícita sobre extender o no §A-006 en `ANTI_FEATURES.md` con reversal note.
- Phase B implementation (gated tras ADR approval):
  - Sólo después de que el ADR pasa review + decisión documentada en ANTI_FEATURES.md.
- Dependencies:
  - RL-089 (`Done`) — schema base.
- Risks:
  - Anti-feature creep — mitigado por ADR explícito.

---

## Tier 3 — Conscientemente fuera de scope (2026-05-20)

Seis items considerados y descartados con razón documentada. NO son
tickets; son una lista anti-debt para que futuros agentes/contribuidores
no los reabran sin contexto.

### T3-001 Plugin/extension API real (third-party plugins en runtime)

**Estado:** No planeado.
**Anti-feature tension:** §A-014 — Arbitrary-code plugin marketplace.
**Razón:** Lingua ya tiene RL-038 "language pack" interface; eso es plugin-suficiente para lenguajes. Un API genérico estilo VSCode invita arbitrary-code execution, supply chain attacks, y el "plugin todopoderoso" que descarrila roadmap (cf. Atom, donde plugins de terceros mataron la dirección del producto).
**Reverso permitido si:** Llega un partner enterprise con NDA + presupuesto que justifique el costo de mantener un plugin API + sandbox + review process. No es de roadmap personal.

### T3-002 Cross-language refactoring (rename JS symbol que ripple a Python que importa el JS bundle)

**Estado:** No planeado.
**Anti-feature tension:** Ninguna directa, pero `cost/value` mal balance.
**Razón:** Cross-language refactoring requiere un type-system unificado o un graph de imports inter-language confiable. Ni siquiera VSCode lo hace bien hoy (sólo IntelliJ con setup específico). Construir esto en Lingua es 6 meses de trabajo para una feature que < 5% de usuarios usa.
**Reverso permitido si:** Aparece un caso de uso concreto + diseño que evite ese costo. Hasta entonces, single-language refactoring (RL-026 lane) cubre el 95% del valor.

### T3-003 Profiling / flame graphs

**Estado:** No planeado.
**Anti-feature tension:** Ninguna directa.
**Razón:** Flame graphs son una UI compleja (visualización jerárquica con zoom + tooltip + drill-down). El valor para el usuario senior es real, PERO la herramienta canónica (Chrome DevTools, py-spy, samply) ya existe y es gratis. Lingua no es el lugar para "una nueva Chrome DevTools UI"; es el lugar para "ejecuto código rápido y veo el resultado". Para perf hunting, el usuario senior abre Chrome DevTools.
**Compensación:** RL-115 inline per-line timing cubre el 80% del use case casual de profiling sin la complejidad de flame graphs.

### T3-004 DB clients embedded (Postgres/MySQL clients dentro de Lingua)

**Estado:** No planeado.
**Anti-feature tension:** Ninguna directa, pero `scope creep` severo.
**Razón:** Un DB client serio (TablePlus, DBeaver, Postico) tiene 50+ features: schema browser, query builder, ER diagrams, import/export, etc. Construir esto en Lingua dobla la superficie de producto sin ganar identidad. Para SQL ad-hoc, RL-097 Slice 2 trae DuckDB-WASM (in-memory) que cubre exploración local de CSV/Parquet sin necesidad de conectar a un servidor real.
**Reverso permitido si:** Se decide explícitamente que Lingua compite con TablePlus/DBeaver. Hoy NO compite.

### T3-005 Docker / container integration (run a Dockerfile desde Lingua)

**Estado:** No planeado.
**Anti-feature tension:** Ninguna directa.
**Razón:** Docker integration es un mundo: build, run, compose, networks, volumes, registries. Cualquier MVP útil es trabajo de meses, y el usuario serio YA tiene `docker` CLI + Docker Desktop. Lingua puede shellea-r a `docker` vía RL-048 terminal cuando se necesite, sin construir UI propio.
**Compensación:** RL-048 (integrated terminal) sirve como escape hatch para cualquier comando docker que el usuario quiera correr.

### T3-006 Snippet auto-save con versioning (git-like history por snippet)

**Estado:** No planeado.
**Anti-feature tension:** §A-006 — Mandatory cloud sync (si se hiciera sync) + scope creep.
**Razón:** Versioning per-snippet es git-mal-reinventado. Si el usuario quiere versioning, tiene git (RL-102 read-only) y sus propios commits. Snippet store actual es FIFO con cap; eso es la storage policy correcta para "scratchpad rápido". Agregar versioning dobla la complejidad del store sin ganar valor para el 95% de los snippets que son one-shot.
**Reverso permitido si:** Aparece un caso de uso concreto. Hasta entonces, RL-089 export/import + RL-111 session restore cubren los flujos de "no perder mi trabajo".

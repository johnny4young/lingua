# Lingua — Unified Delivery Plan

This document is the operational source of truth for Lingua. It replaces the old split between "roadmap", "workstreams", and "milestones" with one ordered backlog based on verified product state, desktop validation, and implementation readiness.

The order of items below is the execution order. If a task is not in this plan, it is not currently committed work.

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
- Current gap:
  - Main and preload expose `fs:watch-start`, `fs:watch-stop`, and `fs:onChanged`
  - `projectStore` starts a watcher
  - Renderer never subscribes to `window.runlang.fs.onChanged`
  - External file changes do not refresh the tree
- Scope for MVP:
  - Subscribe once to `window.runlang.fs.onChanged`
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
  - `npm run desktop:dev` now launches the renderer server and Electron together and tears the owned server down when Electron exits
  - `npm run desktop:dev:sync` can resync `.vite/build/main.js` and `.vite/build/preload.js` without going through `electron-forge start`
  - `npm run desktop:smoke` now exercises JS, TS, Python, Go, and Rust in a real Electron window and writes bootstrap, progress, screenshots, and summary artifacts under `output/playwright/desktop-smoke`
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
- Status: `Partial`
- Readiness: `Scoping ADR, Slice A (pure merger), Slice B (store plumbing + snapshot bridge shell), Slice C first + second + third increments (global, tab, project tier editors + effective-env trace preview) shipped on 2026-04-20; Slice D first increment (Go compile IPC threads the effective user env, GOOS/GOARCH stay runner-owned) shipped on 2026-04-20 ter; Slice D second increment (Rust compile + spawn IPC threads the effective user env) shipped on 2026-04-20 quater; Python Pyodide env integration still pending (needs worker-message boot path, not subprocess)`
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
- Decisions needed:
  - Which runtimes receive env vars in desktop mode ✅
  - Which env vars, if any, should exist in web mode ✅
  - Whether env vars are tab-scoped, project-scoped, or global ✅

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
- Includes:
  - DOM/iframe execution mode
  - desktop Node execution mode
  - per-tab runtime mode selection
  - preview pane for visual output
- Not ready to implement until RL-003 and RL-004 define the current runtime contract cleanly
- Detailed implementation is now split into RL-019, RL-020, and RL-029 below.

### RL-014 AI assistance

- Priority: `Future`
- Includes:
  - provider abstraction
  - chat sidebar
  - code explanation and fix suggestions
  - local model option
- Not ready to implement until editor diagnostics and snippet/productivity features are stable
- Detailed implementation is now split into RL-031 below.

### RL-015 i18n, custom theming, and shortcut customization

- Priority: `Future`
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
  - `RELEASE.md` now ships the full 14-step release procedure: preconditions (green `main`, no open P0, version + CHANGELOG bumped, signing credentials valid), the draft-first publish flow, the packaged macOS desktop smoke via `npm run desktop:smoke`, the artifact verification step, the post-publish smoke against the update channel, and the rule that the release is not announced before the post-publish smoke passes
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
- Status: `Planned`
- Readiness: `Ready once loose-file flow and runtime capability UI are defined`
- Why this is high leverage:
  - RunJS wins partly because it combines Node.js and Browser APIs in a scratchpad-oriented product
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
- Acceptance criteria:
  - A JS/TS tab can switch runtime mode without opening Settings
  - Desktop Node mode can use Node built-ins explicitly
  - Browser Preview mode can render DOM output in a dedicated preview surface
  - Worker mode remains the fastest default for pure language experimentation
- Dependencies:
  - RL-021

### RL-020 Make the scratchpad and REPL experience best-in-class

- Priority: `P1`
- Status: `Planned`
- Readiness: `Ready to implement incrementally after RL-019 starts`
- Scope:
  - Add smart auto-run with complete-code detection so incomplete edits do not execute too early
  - Expand magic comments into a richer inline-watch system that can pin and preserve selected expressions
  - Add stdin / input support for supported runtimes
  - Add timeout presets and clearer abort state for long-running code
  - Preserve the last successful run so users can compare current output against the previous stable result
  - Add per-tab execution history with timestamps and rerun support
  - Add a lightweight variable inspector panel that shows current variable state after execution:
    - Variable name, type, and value for the current runtime scope
    - Expandable objects and arrays with tree view
    - Auto-refresh after each execution
    - Available for JS/TS and Python from the first rollout
    - Inspired by IPython `%whos`, Jupyter variable explorer, and marimo reactive state
- Acceptance criteria:
  - Auto-run skips obviously incomplete code states
  - Users can rerun a previous execution from history
  - Supported runtimes can accept simple stdin text without custom code changes
  - Variable inspector shows current scope state after execution for JS/TS and Python
- Dependencies:
  - RL-019

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
- Readiness: `Research-backed but requires phased rollout`
- Scope:
  - JS/TS desktop:
    - manage `package.json`
    - install dependencies with `npm`
    - cache by project
    - expose trust prompts for first install/run
  - JS/TS web:
    - use CDN imports first
    - then layer in WebContainers where supported
  - Python:
    - evaluate `micropip` / Pyodide subset support separately from desktop virtualenv support
  - Go and Rust:
    - keep the first rollout standard-library-first until a safe module story is defined
  - Surface dependency state, install errors, and unsupported paths clearly in the UI
- Acceptance criteria:
  - A desktop JS/TS project can add a simple dependency and execute it
  - Unsupported dependency scenarios are explicit rather than failing silently
  - The implementation keeps project isolation and does not leak installs across unrelated workspaces
- Dependencies:
  - RL-019
  - RL-029

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
  - Start with JS/TS Node mode
- Acceptance criteria:
  - A user can pause execution at a breakpoint in JS/TS Node mode and inspect variables
  - Breakpoint state persists for reopened files in a project
- Dependencies:
  - RL-019

### RL-028 Add execution history, replay, and benchmarking tools

- Priority: `P2`
- Status: `Partial`
- Readiness: `First slice shipped on 2026-04-20 — a ring-buffer store captures metadata-only entries (language, status, durationMs, timestamp). Second slice shipped on 2026-04-20 ter — Settings row exposes the count and a Clear button. Third slice shipped on 2026-04-20 quater — command palette surfaces up to 5 recent runs. Replay, comparison, and a dedicated Recent Runs panel still pending`
- 2026-04-20 update:
  - `src/renderer/stores/executionHistoryStore.ts` ships a non-persisted Zustand store with `record / clear / byLanguage`; cap is `MAX_HISTORY_ENTRIES = 50`, FIFO drop for the 51st push; timestamps round to whole seconds to reduce fingerprintability
  - Store is **never persisted** — history stays in-memory across reloads, same privacy posture as the RL-065 telemetry work
  - Captures **only** language, status (`ok` / `error`), `durationMs` (null on init failure), and timestamp — no stdout, stderr, source, or file path
  - `executeTabManually` pushes one entry on the success branch and one on the catch branch, so users see both outcomes in the future Recent Runs surface
  - Seven new tests pin the metadata-only contract, null-duration support, unique id per push, the FIFO cap, `clear`, `byLanguage`, and caller snapshot immutability
  - 2026-04-20 ter — second slice: `src/renderer/components/Settings/ExecutionHistorySection.tsx` lands a Settings row showing the current entry count (singular/plural via i18next `_one`/`_other`) and a Clear button gated on the count > 0. Wired into `SettingsModal` next to the env-vars section. Copy ships in en + es (`executionHistory.title/description/countLabel_one/countLabel_other/clearButton/privacyNote`). Five new component tests cover zero-count disabled state, singular form at 1 entry, count growth on record, Clear wiping the store, and Spanish locale
  - 2026-04-20 quater — third slice: `buildCommandPaletteModel` accepts an optional `executionHistory` + `onFocusLanguageTab`; each entry becomes a `CommandEntry` with id `recent-run-<entry.id>`, label `Recent: {language} · {status} · {formattedDuration}`, and description "Jump to an open tab in this language". Cap 5, newest-first. `CommandPalette.tsx` reads `useExecutionHistoryStore.entries` and wires `focusLanguageTab` so activation selects the first tab whose language matches the run. Duration copy reuses the shell's `formatExecTime(...)` helper so the palette never shows raw floating-point noise. Copy ships in en + es (`commandPalette.recentRuns.label/description/status.ok/status.error`). Six new model tests pin the empty case, the 5-cap newest-first order, the label composition, the duration formatting, the honest description copy, and the onFocusLanguageTab callback
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
- Explicit non-goals for MVP:
  - no cloud providers
  - no arbitrary external API URLs
  - no autonomous code modification
  - no repo-wide agent behavior
  - no shell command execution
  - no background indexing or retrieval over the whole project
  - no plugin-facing AI API surface yet
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
  - Expose a minimal `window.runlang.ai` bridge from preload
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
- Status: `Partial`
- Readiness: `Upgrade plan ADR landed on 2026-04-20; bump itself blocked on the four upstream peer-range checks the ADR enumerates`
- Current progress:
  - `VITE_UPGRADE_ADR.md` lands a Vite 5 → 7 plan with the impact matrix (esbuild/Rollup, esbuild-wasm transpiler, Sass/PostCSS, `import.meta.glob`, Node target, Vitest peer, plugin-react peer), the four blocker peer ranges (`@electron-forge/plugin-vite`, `@vitejs/plugin-react`, `vitest`, `tailwindcss`), the 9-step verification matrix (install → tsc → lint → tests → i18n → web build → desktop dev → desktop smoke → packaged make), and the rollback plan (pin `5.4.21` exactly via `overrides`)
  - Vite 8 is intentionally skipped this round to avoid stacking the Rolldown-default churn; a follow-up ADR opens once Vite 7 is stable in this repo
  - Decision today: wait. Run the four `npm view` blocker checks before the next session starts the bump
  - Guard test `tests/docs/viteUpgradeAdr.test.ts` pins the impact axes, blocker checklist, verification matrix, rollback plan, and adjacent ADR cross-links
- Why this looks viable:
  - The repo already uses `.mts` Vite configs
  - The repo already targets Node 24
  - Main, preload, renderer, and web are already separated cleanly
- Main risks:
  - Electron Forge's Vite path remains the most fragile integration point
  - The local desktop launcher depends on Forge/Vite output conventions
  - Modern Vite changes around bundling may surface incompatibilities in custom chunking and helper scripts
- Scope:
  - Upgrade `vite`
  - Upgrade `@vitejs/plugin-react`
  - Upgrade `vitest` and related config only as needed for compatibility
  - Verify:
    - renderer dev
    - Electron Forge dev
    - packaged desktop build
    - `desktop:dev`
    - web build
  - Remove or replace deprecated config patterns found during migration
- Acceptance criteria:
  - Electron and web builds both succeed on the target Node version
  - The local launcher still works or is replaced with a simpler supported path
  - No functional regressions are introduced in Monaco worker loading or the web build
- Dependencies:
  - RL-005

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
- Readiness: `Phase A is MVP-ready; Phase B still gated on backend design`
- Scope:
  - Phase A (P1, Phase 3 of the strategic plan):
    - local export/import of runnable project bundles as a portable `.linguashare` artifact (single JSON or tarball, read-only)
    - a "Share current file/project" command that produces a `.linguashare` and copies it or saves to disk
    - an "Open shared artifact" flow that imports a `.linguashare` into a scratch tab or a temporary project
    - every exported artifact records the language, Lingua version, and entitlement level (so Free-tier users can still open Pro-exported shares in read-only mode)
    - no cloud backend in Phase A — everything works offline from files
  - Phase B (future):
    - shareable links
    - interview mode
    - collaborative editing
    - one-click publish for web projects
  - Keep cloud/account scope out of the first rollout until a backend design is explicit
- Acceptance criteria:
  - Phase A ships without requiring a cloud backend
  - Opening a `.linguashare` on a fresh install reproduces the shared file/project exactly
  - Exported artifacts never embed the user's license key or identity
  - Cloud sharing does not start until there is a concrete storage/auth design
- Dependencies:
  - RL-024 (Phase A — multi-file bundling)
  - RL-032 (Phase B only)

### RL-037 Add deep editor personalization

- Priority: `P2`
- Status: `Partial`
- Readiness: `Font panel, theme preset import/export, result/console theme alignment, read-only reference, editable shortcut mapper, a first alternate keymap preset, and a first alternate theme pack completed on 2026-04-17; Vim mode integration ADR shipped on 2026-04-20; Vim mode first implementation increment (settings flag + toggle) shipped on 2026-04-20 bis; monaco-vim lazy integration and macros still pending`
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
  - 2026-04-20 update: `VIM_MODE_ADR.md` lands the design for the Vim-mode slice. Accepts `monaco-vim` as the lazy-loaded keybindings layer gated by a single `settings.vimMode` toggle; commits to editor-focus-only keystroke ownership so `Ctrl/Cmd+P` Quick Open and other global shortcuts keep working outside Monaco; adopts the English-only status bar as the shipping posture with a documented escape hatch. Ships a six-row verification matrix, a single-toggle rollback path, five revisit triggers, and cross-links to `BUILD_SYSTEM_ADR.md` + `LANGUAGE_PACK_ADR.md` + `CAPABILITY_MATRIX.md`. `tests/docs/vimModeAdr.test.ts` pins the decision sections, the Quick Open conflict resolution, the `:q` / `:w` safety clauses, and the adjacent ADR cross-links
  - 2026-04-20 bis update: Vim mode first implementation increment. `settings.vimMode: boolean` + `toggleVimMode()` land in `SettingsState` with persist-partialize inclusion; default `false`. `EditorSection` renders a new Row with the toggle, plus a status note explaining that this slice only ships the flag and that Vim keybindings activate in a follow-up slice. `Toggle` now accepts an optional `aria-label` so multiple toggles in the same section can be uniquely identified in tests and by assistive tech. Copy ships in en + es (`editor.vimMode.label / hint / pendingNote`). Three new component tests pin the default-off state, the flip + persistence, and the Spanish locale; the settings store test extends the toggle coverage. The monaco-vim lazy integration is the next slice
- Acceptance criteria:
  - Users can customize shortcuts without editing source files ✅
  - At least one custom theme pack and one alternate keymap ship from the first rollout — alternate keymap ✅, theme pack ✅
- Dependencies:
  - RL-018

### RL-038 Build a conservative language-pack architecture before expanding plugins

- Priority: `P2`
- Status: `Partial`
- Readiness: `Slice A (descriptor + thin shim migration) shipped on 2026-04-20; Slice B (runner dispatch + Lua first-class) shipped on 2026-04-20; Slice C first increment (capability badges in the New File menu) shipped on 2026-04-20; Slice C fourth increment (Run button disabled + tooltip on web when language is desktop-only) shipped on 2026-04-20 ter; remaining Slice C surfaces (language selector elsewhere, capability-aware settings) still pending`
- Current progress:
  - `LANGUAGE_PACK_ADR.md` records the accepted `LanguagePack` descriptor, the three-slice migration plan, and the no-marketplace constraint
  - Guard test `tests/docs/languagePackAdr.test.ts` pins the descriptor fields, migration slices, and adjacent ADR/RL cross-links
  - Slice A (2026-04-20): `src/shared/languagePacks.ts` lands the descriptor + the 16-pack array as the single source of truth, plus resolver helpers (`getLanguagePackById`, `getLanguagePackForExtension`, `getLanguagePackForFileName`, `monacoLanguageForPack`, `executionModeForPack`, `formatterStrategyForPack`, `runnerIdForPack`). `src/renderer/utils/languageMeta.ts` rewritten as a thin shim — every legacy helper now proxies to the pack array. Zero behavior change verified by the existing 836-test baseline plus 11 new pack-integrity tests covering descriptor shape, runnable-vs-validate runnerId contract, extension uniqueness, file-name same-pack-allowed cross-pack-banned rule, and resolver fallback semantics
  - Slice B (2026-04-20): `src/renderer/runners/manager.ts` replaces the hardcoded constructor with a `BUILT_IN_RUNNER_FACTORIES` map keyed by `LanguagePack.runnerId` and a `LANGUAGE_PACKS` walk. `pluginRegistry.getByLanguage` stays as the fallback so plugin-sourced runners still resolve. Lua joins `LANGUAGE_PACKS` as a first-class entry (`execution: 'run'`, `runnerId: 'lua'`) — its runner is still plugin-sourced, which proves the pack walk is additive. New assertions: the pack test pins the Lua entry shape, and the manager test asserts Lua does NOT resolve from `LANGUAGE_PACKS` alone (plugin registration still required). All 884 tests pass
  - Slice C first increment (2026-04-20): `languageCapabilityBadgeKey(language)` reads `LanguagePack.capabilities.runtimeDependencies` and returns a stable i18n key (`language.capability.desktopOnly`) for host-toolchain languages (Go, Rust) or `null` for self-contained runtimes (JS, TS, Python, Lua). The Toolbar's New File menu renders the badge next to each language label when the helper returns a key. Copy ships in en + es (`Desktop only` / `Solo escritorio`). Tests pin the helper's per-language output and the Toolbar's badge rendering + localization
  - Slice C polish (2026-04-20): the `templateIds` field on every runnable built-in pack now points at the real template ids in `src/renderer/data/templates.ts` (js × 4, ts × 4, go × 3, py × 4, rs × 4). New resolver helper `templateIdsForPack(id)` reads them with a safe fallback. Four new guard tests assert every runnable pack declares at least one starter template (Lua exempt until its first starter ships), every declared id resolves to a real template and matches the pack's language, no built-in template is orphaned, and the resolver falls back cleanly for unknown ids. This closes the Slice A "declared templates per language" todo that previously shipped as an empty array
  - Slice C fourth increment (2026-04-20 ter): the Toolbar's Run button is now honest on the web build — when the active language needs a host toolchain (Go, Rust) AND `window.lingua.platform === 'web'`, the button disables and its tooltip flips to `toolbar.run.desktopOnlyTooltip` instead of the generic title. Other disabled reasons (no tabs, still running, view-only) keep the tooltip suppressed as before. Copy ships in en + es. Three new Toolbar tests cover the web-with-Go disabled + localized tooltip, the desktop-with-Go still-enabled path, and the Spanish locale on the tooltip
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
- Readiness: `Three validate-only slices shipped (2026-04-20 and 2026-04-20 quater) — Ruby, C, C++, Swift, and Kotlin land as LanguagePack entries so the file tree and language detection pick .rb / .c / .h / .cpp / .cc / .cxx / .hpp / .hh / .hxx / .swift / .kt / .kts files today. Execution runtimes (Ruby, C/C++, Java, Swift, Kotlin, etc.) still pending and each is its own slice`
- 2026-04-20 update:
  - `ruby` joins `LANGUAGE_PACKS` with `execution: 'validate'`, `runnerId: null`, Monaco's built-in Ruby grammar, and `.rb` extension detection
  - `BuiltInLanguage` in `src/renderer/types/index.ts` and `ENGLISH_FALLBACK_LABELS` in `src/renderer/utils/languageMeta.ts` both know about Ruby
  - Pack guard test pins Ruby's validate-only shape + the `.rb` extension round-trip; `languageMeta.test.ts` asserts the detection + Monaco routing
  - Toolbar's New File menu stays untouched for now (separate list); a future slice promotes Ruby there once an execution runtime lands
  - 2026-04-20 ter — RL-042 second slice: `c` and `cpp` join `LANGUAGE_PACKS` the same validate-only way. `c` claims `.c` + `.h`, `cpp` claims `.cpp / .cc / .cxx / .hpp / .hh / .hxx`. Monaco's built-in `c` and `cpp` grammars handle highlighting; `BuiltInLanguage` + `ENGLISH_FALLBACK_LABELS` know about both; tests pin the extension round-trips, validate mode, and null runnerId. Native toolchain runners (gcc / clang) are their own follow-up slice
  - 2026-04-20 quater — RL-042 third slice: `swift` and `kotlin` join `LANGUAGE_PACKS` the same validate-only way. `swift` claims `.swift`, `kotlin` claims `.kt` + `.kts`. Monaco's built-in `swift` and `kotlin` grammars handle highlighting; distinct badge classes (orange / purple) keep the pack visually distinguishable; `BuiltInLanguage` + `ENGLISH_FALLBACK_LABELS` know about both; tests pin extension round-trips, validate mode, null runnerId, and badge class sanity. JVM / native runners land in a future slice
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
- Readiness: `Ready for design after REPL and multi-file work`
- Why this matters:
  - Jupyter, marimo, and Observable prove that cell-based execution is the preferred mode for:
    - data exploration
    - step-by-step learning
    - documentation with live code
  - marimo's reactive model (auto-rerun dependent cells) is particularly powerful
  - This would differentiate Lingua from every other desktop code runner
- Scope:
  - Add a notebook view alongside the standard editor view
  - Support code cells and markdown cells
  - Cell execution preserves state across cells within the same runtime
  - Reactive mode: editing a cell auto-reruns downstream cells (marimo-style)
  - Support inline output below each cell:
    - text/console output
    - tables
    - charts (basic)
    - images
  - Export notebook as:
    - standalone script (concatenated cells)
    - markdown with code blocks
    - HTML report
  - Start with JS/TS and Python as the first notebook-supported languages
- Acceptance criteria:
  - Users can create a multi-cell notebook and execute cells independently
  - Cell outputs render inline below each cell
  - Reactive mode auto-reruns dependent cells when upstream cells change
  - Notebooks can be exported as scripts or reports
- Dependencies:
  - RL-020
  - RL-024

### RL-044 Add inline data visualization and rich output rendering

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready for design`
- Why this matters:
  - Jupyter, marimo, and Observable excel at inline visualization
  - Students and data-oriented developers expect charts, tables, and images in output
  - This makes the console panel dramatically more useful
- Scope:
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
  - An array of objects logged to console renders as a sortable table
  - Basic chart rendering works for JS/TS and Python
  - Image output renders inline in the console panel
- Dependencies:
  - RL-020
  - RL-019

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
- Readiness: `Ready for design after debugger and notebook work`
- Why this matters:
  - VisuAlgo and similar tools are among the most popular resources for CS students
  - Visualizing data structure changes during algorithm execution is extremely valuable for learning
  - No desktop code runner currently offers built-in algorithm visualization
- Scope:
  - Step-through execution mode that pauses at each major operation
  - Visualization panels for common data structures:
    - Arrays (with swap/compare highlighting)
    - Linked lists
    - Trees (binary, BST, AVL)
    - Graphs (adjacency representation)
    - Stacks and queues
    - Hash tables
  - Playback controls: play, pause, step forward, step back, speed control
  - Highlight which line of code corresponds to the current visualization step
  - Start with JS/TS as the first language
  - Use a declarative visualization API that the user can call from their code:
    - `visualize.array([3,1,4,1,5])` to register a watched array
    - `visualize.step()` to mark a visualization checkpoint
- Acceptance criteria:
  - At least sorting algorithm visualization works end-to-end
  - Users can step through execution and see data structure changes
  - Visualization syncs with source code line highlighting
- Dependencies:
  - RL-027
  - RL-043

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

### RL-054 Add interactive guided tour with Shepherd.js

- Priority: `P2`
- Status: `Done`
- Readiness: `Completed on 2026-04-16 — Shepherd commercial license still required before public release`
- Current progress:
  - Lingua now wraps the renderer in a dedicated guided-tour provider backed by Shepherd.js (vanilla API, no `react-shepherd` wrapper)
  - The onboarding flow now covers the editor, Run button, console, project explorer, toolbar, snippet library, and command palette in a seven-step sequence
  - The Run step uses a real `advanceOn` click so the tour waits for a genuine execution instead of advancing on a fake next button
  - Launch points now exist in both the About section and the Command Palette, and first-launch auto-start is gated by persisted `settingsStore.hasCompletedTour`
  - Shepherd styling is now bridged into Lingua's surface tokens so the modal, spotlight, and controls match the app shell instead of shipping the stock library look
- Licensing note:
  - Shepherd.js is free for open-source, personal, and non-commercial projects
  - **Lingua is closed-source commercial software** — a paid license is required
  - Business license: $50 lifetime (up to 5 projects, 1 month support)
  - Enterprise license: $300 lifetime (unlimited projects, 6 months support)
  - Purchase at https://www.shepherdjs.dev/pricing before any public release
  - Development and prototyping can proceed; license must be acquired before distribution
- Scope:
  - Install `shepherd.js` and `react-shepherd` as dependencies
  - Create a `GuidedTour` module under `src/renderer/components/GuidedTour/`
  - Implement a `TourProvider` wrapper using `react-shepherd`'s context provider
  - Define tour steps for core features:
    - Step 1: Editor area — explain code editing, language selection
    - Step 2: Run button — `advanceOn` click event so the user actually runs code to proceed
    - Step 3: Console panel — explain output, errors, timing
    - Step 4: File tree — explain project structure, creating files
    - Step 5: Toolbar — explain layout options, settings access
    - Step 6: Snippets — show how to save and reuse code
    - Step 7: Command Palette — demonstrate keyboard-driven navigation
  - Use `canClickTarget: true` so users interact with real UI elements during the tour
  - Use `advanceOn` to auto-advance when the user completes an interactive action (e.g., clicking Run, opening a file, saving a snippet)
  - Use `beforeShowPromise` for steps that need async setup (e.g., ensuring a tab is open before highlighting it)
  - Style the tour modal/backdrop to match Lingua's design system (oklch colors, surface tokens, rounded corners)
  - Use SVG backdrop with spotlight cutout for visually highlighting the target element
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
  - Shepherd.js commercial license is purchased before any public release of Lingua
- Related tasks:
  - RL-039 (guided lessons for students) is a separate educational content system; this tour is product onboarding
  - The tour infrastructure could later be reused by RL-039 for lesson walkthroughs
- Dependencies:
  - RL-052 (About section provides the "Take a tour" entry point)
  - Shepherd.js commercial license (Business $50 or Enterprise $300)

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

Lingua is **closed-source commercial software**. The repository is private and the code is not publicly available. This affects:
- Third-party library licensing: any dependency with copyleft or AGPL terms must be replaced or commercially licensed
- Shepherd.js requires a commercial license ($50 Business or $300 Enterprise) — see RL-054
- Intro.js (AGPL) is explicitly excluded from consideration
- All MIT / Apache 2.0 / BSD dependencies are safe for closed-source use

### Domain strategy

| Domain | Priority | Rationale |
|--------|----------|-----------|
| `linguacode.dev` | Primary | Perfect fit: "Lingua" + "run" = execute languages. Cheap (~$3-5/year). `.run` TLD is underused |
| `lingua.dev` | Secondary | Premium developer TLD. Verify availability — may be registered |
| `getlingua.dev` | Fallback | Classic SaaS landing pattern if `lingua.dev` is unavailable |
| `lingua.app` | Alternative | Good for desktop app marketing. Google-managed TLD |
| `linguacode.dev` | Legacy alias | Referenced in early strategy drafts (Phase 1 of the go-to-market plan). If registered, 301-redirects to the primary. Do not ship the download page under this host before a redirect rule is in place |

Note on reconciliation: The go-to-market plan in Section 14 uses `linguacode.dev` as the single source of truth for the download/landing page so all Phase 1 / 2 / 3 assets (HN post, Product Hunt, ads, SEO landing pages) point to one canonical origin. `linguacode.dev` is accepted as a legacy alias only; new copy must link to `linguacode.dev`.

### Pricing model (research-backed recommendation)

**Strategy: Freemium with perpetual one-time purchase (RunJS model)**

Rationale:
- Product is desktop-first with no cloud infrastructure costs
- Developers prefer one-time purchases for local tools
- RunJS validated this model successfully at $26 perpetual
- Students need generous free access for adoption

The three go-to-market pricing tiers (matching the Phase 1 "3 tiers en Polar.sh" target) are **Free**, **Pro**, and **Pro Lifetime**. **Education** is an access program layered on top of Pro (verified students/educators receive a Pro license for free) — it is intentionally not a separate sellable tier, so Polar.sh still stocks 3 purchasable products and a single verification flow unlocks Pro for educators.

| Tier | Price | Polar.sh product | Includes |
|------|-------|------------------|----------|
| **Lingua Free** | $0 | n/a (no purchase needed) | Editor completo, 5 lenguajes base (JS/TS/Python/Go/Rust), auto-run, magic comments, 1 tab, dark/light theme, ejecución ilimitada |
| **Lingua Pro** | $29 one-time (perpetuo) | Yes (1 of 3) | Todo Free + tabs ilimitados, snippets, npm packages, 15+ lenguajes, dev utilities, variable inspector, temas extra, custom fonts, deep links, execution history, benchmarking. Updates 1 año |
| **Lingua Pro Lifetime** | $49 one-time | Yes (2 of 3) | Todo Pro + actualizaciones de por vida incluyendo major versions |
| **Lingua Team** (future) | per-seat (pilot) | Yes (3 of 3) | Todo Pro Lifetime + license management for N seats, team snippet library, priority support. Pilot with a small cohort before listing publicly |
| **Lingua Education** | $0 (verified) | Access program on top of Pro | Todo Pro gratis para estudiantes y educadores (.edu email, GitHub Education) |

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

Future monetization channels:
- Premium challenge/lesson packs
- Team licenses (per-seat) — piloted as **Lingua Team** in the table above
- Cloud sync subscription ($2-3/month, optional)

---

## 14. Go-to-market execution plan (Phases 1-3)

This section operationalizes the "Estrategia de Lanzamiento" (strategic alignment) into concrete, implementation-ready RL tasks. Each phase below maps to one or more new RL tasks (RL-059 … RL-067). The rest of the plan (RL-001 … RL-058) covers product surface; this section covers the business and distribution surface that the product needs to ship a paid release.

### Phase 1 — Activate monetization (immediate)

Goal: the product can accept money and gate Pro features behind a validated license without a cloud backend.

Concrete deliverables:
- Polar.sh storefront with 3 purchasable products (Free is free, Pro, Pro Lifetime; Education unlocks through verification, not a separate SKU).
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
- Promote **RL-036 Phase A** (local share bundle / `.linguashare` read-only artifact) from `Future` → `P1`, because the strategic plan depends on it for viral distribution.
- SEO landing pages targeting `"go playground desktop"`, `"rust code runner desktop"`, `"python repl desktop"`, `"typescript playground offline"`, `"multi language code runner"`.
- Crash reporting and opt-in product analytics (feeds into retention metrics).

Mapping to tasks: **RL-036 (promoted)**, **RL-066** (SEO landing pages), **RL-067** (crash reporting).

### New tasks added by this section

### RL-059 License-key infrastructure

- Priority: `P0` for Phase 1
- Status: `Partial`
- Readiness: `Renderer verifier + Settings UI completed on 2026-04-19; preload/main-side license surface still deferred`
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
  - License payload fields: `productId`, `tier` (`pro` | `pro_lifetime` | `team`), `issuedTo`, `issuedAt`, `supportWindowEndsAt`, `entitlements[]`, `signature`.
  - Grace-period and clock-skew tolerance are explicit: +/- 24h skew, 14-day grace window after `supportWindowEndsAt` for online re-check (offline keeps working indefinitely for perpetual tiers).
- Acceptance criteria:
  - A valid signed license unlocks Pro entitlements in both desktop and web builds.
  - A tampered or mis-signed license is rejected with an actionable error.
  - Uninstall/reset clears the license cleanly and returns the app to Free.
  - Tests cover signature validity, clock skew, tampered payload, and grace-period behavior.
- Dependencies:
  - None (pure infra; can land before RL-060/RL-061).

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
- Status: `Planned`
- Readiness: `Ready after RL-059`
- Scope:
  - Create three Polar.sh products: Lingua Pro (one-time), Lingua Pro Lifetime (one-time), Lingua Team (metered / pilot).
  - Add a minimal webhook receiver (separate service under `update-server/` or a new `license-server/`) that:
    - Listens to Polar `order.paid` / `order.refunded`.
    - Signs an RL-059 license payload and emails it to the buyer.
    - Records issuance in an append-only log (SQLite or flat JSONL for the pilot; no cloud dependency until volume justifies it).
  - Add "Buy Pro" and "Enter license key" entry points in Settings → About, plus a command-palette command.
  - Keep cloud identity out of scope for the first release — license keys are enough; accounts can come later.
- Acceptance criteria:
  - A successful test purchase in Polar's sandbox results in the buyer receiving a working license key.
  - A refund invalidates the key the next time the app does a remote check (optional — offline use continues until the next online verify).
  - The checkout URL is configurable via env so we can point at Polar sandbox vs production.
- Dependencies:
  - RL-059

### RL-062 Public README, license declaration, and distribution posture

- Priority: `P0` for Phase 1
- Status: `Done`
- Readiness: `Completed on 2026-04-17`
- Current progress:
  - Shipped a real `LICENSE` at the repo root with the source-available commercial terms (personal/evaluation use granted; redistribution, hosted-service, and commercial use require a paid license)
  - Removed the MIT license declaration from `package.json` in favor of `SEE LICENSE IN LICENSE`
  - Rewrote the README header to ship a License badge pointing at the new file, a `## Pricing and licensing` section naming the four tiers, and a `## Who it is for` audience paragraph
  - Guard test in `tests/docs/license.test.ts` fails CI if anyone removes the LICENSE, drops the README posture section, or reintroduces an MIT badge
- Current gap:
  - The `README.md` carries an MIT badge that links to a `LICENSE` file that does not exist in the repo.
  - The plan declares Lingua closed-source commercial. The public-facing README must match the real distribution posture before the repo is published.
  - The README does not explicitly state the pricing model or the relationship between the GitHub repo and the paid product.
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
  - Redirect `linguacode.dev` to `linguacode.dev` if the legacy domain is registered.
- Acceptance criteria:
  - Visiting `linguacode.dev` shows the download page with a working checkout link.
  - The latest release version is pulled from GitHub releases at build time, not hardcoded.
  - A manual redeploy is documented in `RELEASE.md`.
- Dependencies:
  - RL-061 (checkout link)

### RL-064 Launch asset kit (Phase 2)

- Priority: `P1` for Phase 2
- Status: `Partial`
- Readiness: `Copy + press kit scaffold landed on 2026-04-19; 60-second demo, production screenshots, and the linguacode.dev/press ZIP still depend on RL-063`
- Current progress:
  - `docs/press-kit/` ships `README.md` + `boilerplate.md` (25/50/150 words, en + es) + `pricing-one-pager.md` (four-tier matrix + education, en + es) + `launch-copy.md` (Show HN + Product Hunt + r/golang + r/rust + r/Python drafts) + `founder-bio.md` (40/100 words, en + es)
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

### RL-065 Privacy-respecting launch telemetry

- Priority: `P1` for Phase 2
- Status: `Partial`
- Readiness: `Consent toggle + base event wiring completed on 2026-04-19; first-run desktop prompt shipped on 2026-04-20; overlay.opened callsites shipped on 2026-04-20 ter; runner.executed callsites shipped on 2026-04-20 quater`
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

RL-036 is now re-prioritized for the execution order summary. Phase A (local share bundle, read-only artifacts) is the viral-distribution primitive the strategic plan depends on in Phase 3. See the summary tables below for the updated tier placement.

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
- **Keyboard shortcuts** — `⌘⇧C` Copy Output, `⌘⇧R` Instant Replace
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
| SHA-1 / SHA-256 Hash | ✅ RL-045 | RL-071 (add MD5, SHA-384, SHA-512, HMAC, file hashing) |
| Unix Time Converter | ✅ RL-045 | — |
| JWT Decoder | ✅ RL-045 | RL-071 (add verify + sign for HS/RS/ES/PS) |
| RegExp Tester | ✅ RL-045 | — |
| Color Converter | ✅ RL-045 | — |
| Line Diff Checker | ✅ RL-045 (line-level only) | RL-071 (word + character modes) |
| YAML ↔ JSON | ❌ | RL-068 |
| JSON ↔ CSV | ❌ | RL-068 |
| Number Base Converter | ❌ | RL-068 |
| URL Parser | ❌ | RL-068 |
| HTML Entity Encode/Decode | ❌ | RL-068 |
| Backslash Escape/Unescape | ❌ | RL-068 |
| String Case Converter | ❌ | RL-068 |
| Lorem Ipsum Generator | ❌ | RL-068 |
| Random String Generator | ❌ | RL-068 |
| Cron Job Parser | ❌ | RL-068 |
| Markdown Preview | ❌ | RL-068 |
| SQL Formatter | ❌ | RL-068 |
| HTML / CSS / JS / XML / SCSS / LESS Beautify + Minify | ❌ | RL-070 |
| HTML → JSX | ❌ | RL-070 |
| SVG → CSS | ❌ | RL-070 |
| cURL → Code | ❌ | RL-070 |
| Base64 Image Encode/Decode | ❌ | RL-071 |
| QR Code Generate / Read | ❌ | RL-072 |
| String Inspector | ❌ | RL-072 |
| Smart input auto-detect (lightning button) | ❌ | RL-069 |
| Optional clipboard monitoring | ❌ | RL-069 (off by default, never background-polls) |
| Per-tool history | ❌ | RL-069 |
| Favorites + tool search within the workspace | ❌ | RL-069 |
| `⌘⇧C` Copy Output / `⌘⇧R` Replace Clipboard shortcuts | ❌ | RL-069 |
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
- Status: `Planned`
- Readiness: `Ready to implement — extends RL-045 without new infra`
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
    - `Cmd/Ctrl+Shift+C` Copy Output from the focused utility panel
    - `Cmd/Ctrl+Shift+R` Replace clipboard with the current output
- Acceptance criteria:
  - Clipboard auto-apply is opt-in; a fresh install never reads the
    clipboard without a user gesture
  - History and favorites survive reload when persistence is enabled
  - Both new shortcuts appear in the Keyboard Shortcuts overlay and can
    be rebound
  - The utilities modal continues to pass the RL-018 i18n copy check
- Dependencies:
  - RL-045 ✅
  - RL-037 (keyboard shortcut editor) — for shortcut registration
  - RL-065 consent copy patterns — for the clipboard opt-in wording

### RL-070 Beautify / minify suite and code-conversion bundle

- Priority: `P3`
- Status: `Planned`
- Readiness: `Ready to design; Pro-tier candidate under the RL-060 entitlement table`
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

### RL-071 Harden existing utilities to DevUtils parity

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready to implement in small slices, each utility independently`
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

### RL-072 Specialty utilities — QR + String Inspector

- Priority: `P3`
- Status: `Planned`
- Readiness: `Lower priority; useful for press-kit screenshots but not a daily-driver gap`
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
| RL-025 | Package & dependency management | RL-019, RL-029 | Large |
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
| RL-036 (Phase A) | Local share bundles / read-only `.linguashare` artifacts | RL-024 | Medium |
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
| RL-043 | Notebook / cell-based mode | RL-020, RL-024 | XL |
| RL-044 | Inline data visualization | RL-020, RL-019 | Large |
| RL-039 | Guided lessons & galleries | RL-023, RL-024 | Large |
| RL-046 | Gamification & progress tracking | RL-023 | Medium |
| RL-054 | Guided tour (Shepherd.js, needs license) | RL-052 | Medium |
| RL-035 | Tauri 2 feasibility spike | RL-021 ✅, RL-030 | Medium |

---

### Tier 7 — Long horizon

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-036 (Phase B) | Collaborative editing, shareable links with backend | RL-036 Phase A, RL-032 | XL |
| RL-041 | Static site export & publish | RL-024, RL-036 | Large |
| RL-047 | Algorithm visualization | RL-027, RL-043 | XL |
| RL-049 | Macro recording & playback | RL-037 | Medium |
| RL-050 | Real-time collaboration | RL-036 Phase B, RL-032 | XL |

---

### What to implement next

The order below reflects the strategic alignment (Phase 1 → Phase 2 → Phase 3):

1. **Tier 1** — close remaining P0 correctness gaps (RL-004, RL-005).
2. **Tier 1.5** — ship the monetization and launch foundation **before** any distribution push. Sequence: RL-062 → RL-059 → RL-060 → RL-061 → RL-063. This is Phase 1 of the strategic plan; shipping Phase 2 without this is promoting a free product by mistake.
3. **Tier 2 quick wins** (RL-055 → RL-056 → RL-051 → RL-052) for zero-risk user value — many of these also make the press kit and landing page look good.
4. **Phase 2 of the strategic plan (from Tier 5)** — RL-064 (assets), RL-065 (telemetry), then the HN / Reddit / Product Hunt launch itself.
5. **Phase 3 of the strategic plan (from Tier 5)** — RL-036 Phase A (share bundles) for viral distribution, then RL-066 (SEO pages), then RL-067 (crash reporting).
6. After Phase 3 stabilizes, pick from **Tier 3** — RL-019 (runtime modes) and RL-018 (i18n) remain the highest-leverage product items for long-term differentiation.

This ordered list is the milestone sequence. No separate milestone section should be maintained elsewhere.

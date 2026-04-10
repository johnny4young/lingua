# RunLang — Unified Delivery Plan

This document is the operational source of truth for RunLang. It replaces the old split between "roadmap", "workstreams", and "milestones" with one ordered backlog based on verified product state, desktop validation, and implementation readiness.

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
- Status: `Partially wired`
- Readiness: `Ready to implement as MVP`
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
- Status: `Partial`
- Readiness: `Incrementally implemented on 2026-04-10`
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
- Acceptance criteria:
  - A type error in TS is visible in the editor without running
  - A runtime error in JS/TS/Python highlights the relevant source line
  - A Go or Rust compiler error highlights the reported source location when line data is available
- Dependencies:
  - RL-003

### RL-005 Keep desktop UI validation as a maintained workflow

- Priority: `P0`
- Status: `Partial`
- Readiness: `In progress`
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
- Status: `Needed for maintainability`
- Readiness: `Ready to implement incrementally`
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
- Dependencies:
  - Prefer after RL-001 through RL-008 so refactors do not obscure bug-fix work

---

## 3. Developer experience after core correctness

### RL-010 Add format-on-save

- Priority: `P2`
- Status: `Planned`
- Readiness: `Mostly ready, but should start with desktop-capable languages`
- Recommended rollout:
  - Phase A:
    - JS/TS via Prettier
    - Go via `gofmt`
    - Rust via `rustfmt`
  - Phase B:
    - Python formatting once the desktop/web execution story is defined clearly for tooling
- Acceptance criteria:
  - Save formatting is deterministic
  - Missing formatter binaries are handled with actionable user feedback
- Dependencies:
  - Desktop tooling conventions

### RL-011 Add an environment variables panel for execution contexts

- Priority: `P2`
- Status: `Planned`
- Readiness: `Needs execution-model scoping before implementation`
- Decisions needed:
  - Which runtimes receive env vars in desktop mode
  - Which env vars, if any, should exist in web mode
  - Whether env vars are tab-scoped, project-scoped, or global
- This item should not start until those decisions are written down

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

### RL-014 AI assistance

- Priority: `Future`
- Includes:
  - provider abstraction
  - chat sidebar
  - code explanation and fix suggestions
  - local model option
- Not ready to implement until editor diagnostics and snippet/productivity features are stable

### RL-015 i18n, custom theming, and shortcut customization

- Priority: `Future`
- Includes:
  - translation framework
  - locale packs
  - custom theme import
  - user-defined shortcuts
- These are valid enhancements, but they should follow after workflow correctness and settings cleanup

---

## 5. Operational hardening

### RL-016 Release validation and update readiness

- Priority: `P2`
- Status: `Partial`
- Scope:
  - validate tagged release flow in CI with real secrets
  - validate packaged update behavior against the chosen release channel
  - verify signing and notarization paths in CI
- This remains important, but it does not come before the current product correctness backlog

### RL-017 Migrate away from deprecated Vite CJS Node API usage

- Priority: `P2`
- Status: `Done`
- Scope:
  - move Vite config entry points to the supported ESM config path without breaking Forge integration
- Acceptance criteria:
  - the deprecation warning no longer appears during the standard dev/build flow

---

## Execution order summary

Implement in this order unless a newly discovered regression changes severity:

1. RL-002 File watching MVP
2. RL-003 Monaco runtime-aligned diagnostics
3. RL-004 Unified editor error surfacing
4. RL-005 Repeatable Electron validation scripts
5. RL-006 Explicit new-file UX
6. RL-007 Snippets MVP
7. RL-008 Settings truthfulness and app theme decision
8. RL-009 Renderer module splits
9. RL-010 through RL-017 as follow-on work

This ordered list is the milestone sequence. No separate milestone section should be maintained elsewhere.

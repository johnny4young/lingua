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
- Status: `Partial`
- Readiness: `Phases 1-2 completed on 2026-04-14`
- Current progress:
  - Phase 1 (Foundation and Bootstrap) is complete
  - Phase 2 (highest-visibility surfaces) is complete
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
  - Focused i18n coverage now includes renderer surfaces, Electron IPC dialog copy, and web adapter stub messaging (357 total passing)
  - Phases 3-4 remain planned
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
- Status: `Planned`
- Readiness: `Ready after RL-021`
- Current gap:
  - Quick Open only sees tabs and the already-loaded part of the current file tree
- Scope:
  - Build a background index for the active project
  - Add fuzzy search across all files, not only expanded directories
  - Add project-wide text search with match previews
  - Add symbol outline and symbol jump for supported languages
  - Reuse the same index for command palette actions such as "open symbol" and "reveal in tree"
- Acceptance criteria:
  - Quick Open can find unopened files anywhere in the active project
  - Search results remain responsive on medium-size projects
  - Symbol navigation works at least for JS/TS from the first rollout
- Dependencies:
  - RL-021

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
- Status: `Planned`
- Readiness: `Blocked on runtime-mode work`
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
- Status: `Planned`
- Readiness: `Ready after REPL state/history exists`
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
- Status: `Planned`
- Readiness: `Ready now as an architecture task`
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
- Status: `Planned`
- Readiness: `Positive but gated`
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
- Status: `Planned`
- Readiness: `Ready after the Vite-major spike`
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
- Status: `Planned`
- Readiness: `Useful only as a bounded spike`
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

- Priority: `Future`
- Status: `Planned`
- Readiness: `Not MVP-ready`
- Scope:
  - Phase A:
    - local export/import of runnable project bundles
    - read-only share artifacts
  - Phase B:
    - shareable links
    - interview mode
    - collaborative editing
    - one-click publish for web projects
  - Keep cloud/account scope out of the first rollout until a backend design is explicit
- Acceptance criteria:
  - Phase A ships without requiring a cloud backend
  - Cloud sharing does not start until there is a concrete storage/auth design
- Dependencies:
  - RL-024
  - RL-032

### RL-037 Add deep editor personalization

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready after i18n and loose-file work`
- Scope:
  - Shortcut editor
  - custom keymaps
  - theme import/export
  - Vim mode
  - Font selection panel with curated developer fonts:
    - JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, Consolas, Menlo, Monaco, IBM Plex Mono
    - Font ligature toggle
    - Configurable font size with live preview
    - Inspired by WizardJS (5 font choices) and CodeRunner (customizable fonts)
  - alternate font packs
  - result/console theme alignment
  - macro recording and playback (simple sequences) — see also RL-049 for advanced macros
- Acceptance criteria:
  - Users can customize shortcuts without editing source files
  - At least one custom theme pack and one alternate keymap ship from the first rollout
- Dependencies:
  - RL-018

### RL-038 Build a conservative language-pack architecture before expanding plugins

- Priority: `P2`
- Status: `Planned`
- Readiness: `Ready for design`
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
- Status: `Planned`
- Readiness: `Ready after Snippet Lab and starter projects exist`
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
| Built-in developer utilities (regex, JSON, diff) | DevToys, VS Code extensions, cod-ai.com | New: RL-045 dev utilities |
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
- Status: `Planned`
- Readiness: `Ready to implement`
- Why this matters:
  - WizardJS registers `wizardjs://` for deep linking
  - Deep links enable: open files from terminal, open from browser, share snippets via URL
  - This is a standard Electron capability with minimal implementation cost
- Scope:
  - Register `lingua://` custom protocol in Electron main and in forge packagerConfig
  - Support deep link actions:
    - `lingua://open?file=/path/to/file.js`
    - `lingua://snippet?id=xxx`
    - `lingua://new?lang=python`
  - Handle deep links on app cold start and when app is already running
  - Add `app.setAsDefaultProtocolClient('runlang')` on first launch
  - Add forge config: `protocols: [{ name: 'Lingua', schemes: ['runlang'] }]`
- Acceptance criteria:
  - Clicking a `lingua://` link from a browser or terminal opens the app with the correct context
  - Deep links work on macOS, Windows, and Linux
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
- Status: `Planned`
- Readiness: `Ready after language-pack architecture exists`
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
- Status: `Planned`
- Readiness: `Ready to implement incrementally`
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
- Status: `Planned`
- Readiness: `Ready now — trivial config change`
- Why this matters:
  - WizardJS sets `appCategory: 'developer-tools'` in forge config
  - macOS uses this for Finder and Spotlight categorization
  - Missing category may affect discoverability on macOS
- Scope:
  - Add `appCategory: 'public.app-category.developer-tools'` to packagerConfig (macOS LSApplicationCategoryType)
  - Register `lingua://` protocol in packagerConfig via `protocols` field
  - These are one-line config additions with zero runtime cost
- Acceptance criteria:
  - macOS build shows correct app category in Finder info
  - Protocol registration is included in packaged builds
- Dependencies:
  - None

---

## 10. Product identity, release notes, and guided tour (2026-04-12)

### RL-052 Add About view with product name and version

- Priority: `P1`
- Status: `Planned`
- Readiness: `Ready to implement`
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
- Status: `Planned`
- Readiness: `Ready to implement after CHANGELOG.md exists`
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
- Status: `Planned`
- Readiness: `Ready to implement — requires Shepherd.js commercial license purchase before shipping`
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
- Status: `Ready to implement`
- Readiness: `Immediate — no architectural dependencies`
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
- Status: `Ready to implement`
- Readiness: `Immediate — does not require LSP, RL-038, or RL-030`
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
| `lingua.run` | Primary | Perfect fit: "Lingua" + "run" = execute languages. Cheap (~$3-5/year). `.run` TLD is underused |
| `lingua.dev` | Secondary | Premium developer TLD. Verify availability — may be registered |
| `getlingua.dev` | Fallback | Classic SaaS landing pattern if `lingua.dev` is unavailable |
| `lingua.app` | Alternative | Good for desktop app marketing. Google-managed TLD |

### Pricing model (research-backed recommendation)

**Strategy: Freemium with perpetual one-time purchase (RunJS model)**

Rationale:
- Product is desktop-first with no cloud infrastructure costs
- Developers prefer one-time purchases for local tools
- RunJS validated this model successfully at $26 perpetual
- Students need generous free access for adoption

| Tier | Price | Includes |
|------|-------|----------|
| **Lingua Free** | $0 | Editor completo, 5 lenguajes base (JS/TS/Python/Go/Rust), auto-run, magic comments, 1 tab, dark/light theme, ejecución ilimitada |
| **Lingua Pro** | $29 one-time (perpetuo) | Todo Free + tabs ilimitados, snippets, npm packages, 15+ lenguajes, dev utilities, variable inspector, temas extra, custom fonts, deep links, execution history, benchmarking. Updates 1 año |
| **Lingua Pro Lifetime** | $49 one-time | Todo Pro + actualizaciones de por vida incluyendo major versions |
| **Lingua Education** | $0 (verificado) | Todo Pro gratis para estudiantes y educadores (.edu email, GitHub Education) |

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
- Team licenses (per-seat)
- Cloud sync subscription ($2-3/month, optional)

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

### Tier 5 — Platform hardening & expansion

| # | Task | Deps | Effort |
|---|------|------|--------|
| RL-033 | Vite major upgrade | RL-005 | Medium |
| RL-034 | Build-system ADR (Forge vs alternatives) | RL-033 | Small |
| RL-032 | Marketing website & docs hub | RL-018 | Large |
| RL-016 | Release validation & signing CI | — | Medium |
| RL-042 | 15+ languages | RL-038 | Large |
| RL-026 | Language intelligence beyond JS/TS (LSP) | RL-030, RL-038 | Large |
| RL-029 | WebContainers pilot (JS/TS web only) | RL-025 | Medium |
| RL-037 | Deep editor personalization (keys, fonts, vim) | RL-018 | Medium |

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
| RL-036 | Sharing & collaboration | RL-024, RL-032 | XL |
| RL-041 | Static site export & publish | RL-024, RL-036 | Large |
| RL-047 | Algorithm visualization | RL-027, RL-043 | XL |
| RL-049 | Macro recording & playback | RL-037 | Medium |
| RL-050 | Real-time collaboration | RL-036, RL-032 | XL |

---

### What to implement next

**Start with Tier 1** (RL-004, RL-005) to close remaining P0 gaps, then **Tier 2 quick wins** (RL-055 → RL-056 → RL-051 → RL-052) for immediate user value with zero risk. After that, pick from **Tier 3** based on strategic priority — RL-019 (runtime modes) and RL-018 (i18n) are the highest-leverage items.

This ordered list is the milestone sequence. No separate milestone section should be maintained elsewhere.

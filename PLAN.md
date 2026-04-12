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
- Status: `Partial`
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

### Benchmark signals that matter for RunLang

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

- RunLang is already ahead of the JS-only scratchpads on breadth of language support
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
- Status: `Planned`
- Readiness: `Ready for phased implementation`
- Why this is now concrete:
  - Benchmark apps and websites already use multilingual product messaging and maintainable locale structures
  - RunLang currently hardcodes most user-facing copy in the renderer, Electron `main`, and web adapters
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
- Acceptance criteria:
  - Auto-run skips obviously incomplete code states
  - Users can rerun a previous execution from history
  - Supported runtimes can accept simple stdin text without custom code changes
- Dependencies:
  - RL-019

### RL-021 Fix loose-file workflow and session continuity

- Priority: `P1`
- Status: `Planned`
- Readiness: `Ready now`
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
  - RunLang already has the right building blocks:
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
  - Support Ollama over loopback only as the first and only provider in the MVP
  - Keep the internal design compatible with future provider abstraction, but do not expose provider switching in the first user-facing iteration
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
- Why this shape is preferred:
  - The app is already strongest as a local code runner and scratchpad
  - A constrained assistant aligns with the existing language/template/snippet workflow better than a free-form chat pane
  - Small local models are sufficient for "Fibonacci in the selected language" and similar tasks, while reducing latency and memory compared to large local models
- Detailed implementation blueprint:

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
  - `src/preload/index.ts`
  - `src/types.d.ts`
- Acceptance criteria:
  - Renderer can query local AI availability through preload without direct network access
  - An in-flight response can be cancelled
  - Web mode reports the feature as unavailable with an explicit reason

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
- Suggested file touch points:
  - `src/renderer/components/Toolbar/Toolbar.tsx`
  - `src/renderer/components/CommandPalette/commandPaletteModel.ts`
  - a new UI surface such as `src/renderer/components/AI/AIAssistantModal.tsx`
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
  - alternate font packs
  - result/console theme alignment
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
10. RL-018 i18n foundation
11. RL-021 loose-file workflow and session continuity
12. RL-019, RL-020, and RL-022 to deepen the REPL and navigation model
13. RL-023, RL-024, and RL-025 to turn RunLang into a stronger practice/prototyping environment
14. RL-030 and RL-029 before any large "webassembly first" or WebContainer claims
15. RL-026, RL-027, and RL-028 as advanced language and debugging follow-ons
16. RL-031 and RL-032 once the core app/product surface is stable enough to support them
17. RL-033, RL-034, and RL-035 as platform/tooling decision work
18. RL-036 through RL-039 as broader ecosystem, learning, and personalization work

This ordered list is the milestone sequence. No separate milestone section should be maintained elsewhere.

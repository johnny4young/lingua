# Changelog

All notable changes to Lingua are documented here.

---

## [Unreleased] — 2026-04-12

### Fixed
- **Monaco crash**: `TypeError: Cannot read properties of undefined (reading 'ModuleKind')` on app load — split `configureMonaco()` (workers/loader only) from `applyTypeScriptDefaults(m)` (called in `beforeMount` where Monaco is fully initialized)
- **Electron modal buttons unresponsive**: `-webkit-app-region: drag` on the toolbar was intercepting pointer events at the OS level even over modal overlays — added `-webkit-app-region: no-drag` to `.overlay-backdrop`
- **Dev server port mismatch**: Stale `.vite/build/main.js` artifacts used old env var `RUNLANG_RENDERER_URL`; added `__LINGUA_UPDATE_URL__` define to the esbuild command in `run-electron-desktop.mjs`

### Tests
- Updated `monaco.test.ts` to cover the new two-function API (`configureMonaco` + `applyTypeScriptDefaults`) — 296 tests passing

---

## 2026-04-12

### Added
- **Update server**: Cloudflare Worker for auto-update delivery with GitHub release integration (`update-server/`) and deploy workflow (`.github/workflows/deploy-update-server.yml`)

### Changed
- **Rename**: Project renamed from RunLang to **Lingua** — updated branding, env vars, and all references throughout

---

## 2026-04-11

### Documentation
- Added AI assistant detail for multilingual code execution
- Added MAS (Mac App Store) feature to the backlog
- Explained desktop architecture design

---

## 2026-04-10

### Added
- **Error location reveal**: Execution errors are revealed directly in the editor (scroll + cursor position)
- **Editor diagnostics sync**: Monaco diagnostics aligned with manual execution results
- **Magic comments support**: `// @lingua-run` and similar annotations for JS/TS/Python
- **Inline result panel**: Per-line output with auto-run for JS/TS/Python

### Fixed
- Apply saved app theme before renderer mounts (prevents theme flash)
- Close compact explorer drawer after navigation
- Preserve explorer focus when compact drawer widens into sidebar
- Make compact file tree drawer a true modal with focus trap
- Restore focus when compact file tree drawer closes
- Make file tree usable in compact layouts; improve panel resizing
- Fixed rigid splitter behavior
- Fixed file tree issues
- Move Vite configs to ESM; quiet forced desktop shutdown noise
- Harden Electron renderer trust and file rename validation

### Refactored
- Extract project tree helpers from the project store
- Split command palette model and results rendering into focused modules
- Split file tree views into focused explorer modules
- Split `CodeEditor` into focused editor modules

---

## 2026-04-09

### Added
- **Snippet library**: In-app snippet create/edit/delete workflow with "Open in New Tab" and "Insert into Active Tab" actions
- **Toolbar language selector**: Explicit new-file language selection dropdown
- **Managed Electron launcher**: `run-electron-desktop.mjs` for local dev testing
- **Project tree sync**: File tree updates when external changes are detected
- **Hide undefined toggle**: Option in ResultPanel to suppress `undefined` inline results

### Fixed
- Restore Go desktop execution in Electron (IPC path corrections)
- Redesign renderer shell with responsive dark and light themes

---

## 2026-04-08

### Added
- Loop protection (WIP): safeguard against runaway JS/TS loops
- Magic comments implementation for JS/TS/Python (`// @ts-ignore`-style hints)

---

## 2026-04-07

### Added
- Live result panel with per-line output and auto-run (initial implementation)
- Improved UI styling and layout

### Refactored
- Simplified renderer orchestration and settings architecture

---

## 2026-04-06

### Added
- **Desktop updater foundation**: `electron-updater` integration with Squirrel protocol support
- **Local plugin discovery**: Plugin registry scans `~/.lingua/plugins` at startup
- **Lua plugin runtime**: Fengari-based Lua execution + web catalog stub
- Release pipeline: code signing, checksum publishing, CI hardening

### Fixed
- Restore Python web runner and stabilize macOS packaging
- Restore web build, Monaco workers; raise Node minimum to 24

---

## 2026-03-31

### Added
- **Phase 1 UI shell**: Monaco editor, resizable panels, Zustand stores (editorStore, settingsStore, resultStore, uiStore)
- **JS/TS execution engine**: Web Workers, RunnerManager, inline result decorations
- **Go runner**: Native Go binary execution via Electron IPC
- **Python runner**: Python subprocess execution via IPC
- **Rust runner**: `rustc` compile-and-run via IPC
- **File system IPC**: Secure file read/write/watch with path guards and permission checks
- **Project management**: Open folder, create project, file tree explorer
- **Command palette**: Fuzzy-search over templates, snippets, and commands (Cmd+Shift+P)
- **Quick Open**: File switcher (Cmd+P)
- **Settings modal**: Theme, font, layout, Monaco options — autosaved to localStorage
- **Console panel**: Structured log output with INF/LOG/WRN/ERR filters
- **Templates**: Built-in Hello World starters for JS, TS, Go, Python, Rust
- **IPC security hardening**: Block sensitive path reads, rename/watch guards, renderer sandbox
- **CI pipeline**: GitHub Actions for build, test, release, and GitHub Pages deploy
- **Distribution config**: electron-builder with macOS `.dmg` and Windows `.exe` targets
- **71 new tests**: IPC security guards, tree helpers, workers, components, JS execution integration (tracks 1–7)
- **Plugin registry**: Foundation for Lua/JS plugin loading
- **README**: Project documentation and architecture overview

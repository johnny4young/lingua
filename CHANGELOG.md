# Changelog

All notable changes to Lingua are documented here.

The format follows Keep a Changelog and groups changes by release.

## [Unreleased] — 2026-04-16

### Added
- **About view (`RL-052`)**: Settings now includes a dedicated About surface with product metadata, repository/license links, and a direct entry point into the update flow.
- **What's New view (`RL-053`)**: Lingua now bundles structured release notes from this changelog, exposes them through a dedicated overlay, links them from the About view, and adds a Command Palette action for quick access.
- **Editable keyboard shortcuts (`RL-037`)**: The keyboard-shortcuts overlay now lets users rebind any catalogued shortcut inline, with conflict detection against existing bindings, per-row and global reset, and persistence across sessions. The global dispatcher consumes the override map directly instead of a hand-rolled combo ladder, so defaults and user bindings follow the same path. Escape (close overlay) stays non-editable.
- **Keymap presets (`RL-037`)**: The keyboard-shortcuts overlay ships a preset selector with a Sublime Text-inspired bundle alongside the default. Applying a preset replaces per-shortcut overrides in one move; any manual edit afterwards flips the selector back to "Default" so the UI stays honest.
- **Theme packs (`RL-037`)**: Settings → Appearance now has a theme pack selector with a Solarized Daylight bundle alongside the default. Applying a pack swaps appearance, typography, and layout wholesale without touching safety/workflow prefs; any manual appearance edit flips the selector back to "Default".
- **Extra keymap + theme options (`RL-037`)**: The keymap preset dropdown adds a JetBrains-style "Classic IDE" bundle (Go to Symbol on Mod+Alt+O, project search on Mod+Alt+F, console on Mod+J). The theme pack dropdown adds "Nord Night" (dark nord editor + Fira Code).
- **Infra-file language detection (`RL-058`)**: `Dockerfile`/`Containerfile`/`Dockerfile.*`, `Makefile`/`GNUmakefile`, `.gitignore`/`.dockerignore`/`.npmignore`, and `.editorconfig` now open with appropriate Monaco grammars and explicit view-only execution mode instead of falling back to plaintext.
- **Shortcut overrides export/import (`RL-037`)**: The shortcuts overlay footer now has Export/Import JSON actions symmetric with the theme-preset pair. Export writes a versioned document; import validates schema, version, combo shape, and duplicate bindings (dropping unknown ids / non-editable or conflicting combos) and surfaces failures through the shared status-notice pipeline.
- **EditorConfig + Dockerfile validators (`RL-058`)**: Running (Cmd+Enter) a `.editorconfig` or `Dockerfile` now surfaces lightweight diagnostics via Monaco markers. EditorConfig flags unknown keys and invalid enum values; Dockerfile warns on deprecated `MAINTAINER`, `ADD <url>` usage, and missing `FROM`.
- **Gitignore + Makefile validators (`RL-058`)**: `.gitignore` / `.dockerignore` / `.npmignore` now surface duplicate-pattern info notices, "`!` with no pattern" warnings, and flag backslash-as-separator (a Windows-path footgun). `Makefile` / `GNUmakefile` now flag the classic space-indented recipe trap and tab-indented commands with no preceding target. Both languages graduated from view-only to the validate execution path.
- **Dockerfile validator enhancements (`RL-058`)**: The Dockerfile validator now also warns on `FROM image:latest` or `FROM image` without a tag (non-reproducible builds) and on `RUN apt-get install` without `-y` (builds will hang on the interactive prompt). `FROM scratch` and pinned `@sha256` digests are intentionally skipped.

### Changed
- **Release workflows**: Pushes to `main` now validate CI only; web deploy, update-server deploy, and desktop release creation stay manual workflows.

## [0.1.0] — 2026-04-16

### Added
- **Desktop code runner foundation**: Electron Forge + Vite + React 19 shell with Monaco editor, project explorer, command palette, quick open, snippets, settings, and a structured console panel.
- **Language execution backends**: JavaScript, TypeScript, Go, Python, and Rust execution paths, with browser support for JS/TS/Python and desktop-only native toolchain flows for Go/Rust.
- **Inline execution feedback**: Result panel, per-line inline output, runtime markers, execution timing, and magic-comment support for dynamic languages.
- **Project and file workflows**: Open folder, recent projects, loose-file editing, save/save-as, rename, delete, duplicate tab, and session restore support.
- **Monaco authoring support**: Runtime-aligned JavaScript/TypeScript diagnostics, file-extension language detection, and immediate completion providers for Go, Python, Rust, and Lua.
- **Localization and docs**: English/Spanish UI, i18n validation tooling, architecture docs, renderer reference docs, and contributor guidance for the renderer surface.
- **Packaging and update infrastructure**: Desktop updater foundation, packaging metadata hardening, protocol registration, release checksums, and manual GitHub release workflows.

### Changed
- **Renderer architecture**: Split oversized modules into focused feature folders for editor, file tree, command palette, settings, and project tree helpers.
- **Shell behavior**: Responsive sidebar drawer, persistent resizable layouts, safer overlays over Electron drag regions, and cleaner settings/about organization.
- **Release and delivery model**: CI now validates build quality; publish/deploy operations are explicitly manual.

### Fixed
- Restored Go desktop execution after IPC regressions.
- Hardened file-system IPC, rename handling, and trusted renderer navigation.
- Fixed Monaco initialization crashes and synchronized diagnostics with execution output.
- Corrected theme bootstrap to prevent shell flash on load.
- Fixed Electron overlay interaction issues caused by draggable titlebar regions.

### Documentation
- Added architecture guidance for project lifecycle, file-system IPC, and renderer ownership boundaries.
- Added release, CI, and renderer maintenance documentation for future contributors.

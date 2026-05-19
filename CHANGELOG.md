# Changelog

All notable changes to Lingua are documented here.

The format follows Keep a Changelog and groups changes by release.

## [0.4.0] — 2026-05-18

### Added
- **Scratchpad excellence**: A full nine-slice closeout for the JS / TS / Python Scratchpad workflow. Per-tab Run / Debug / Scratchpad mode toggle with the Run mode disabling auto-run for compiled languages. Smart auto-run completion gate so the runner waits for a coherent edit before firing. Pinned `// @watch <expr>` and `# @watch <expr>` annotations that survive across runs. Per-tab recent-runs replay with one-click rerun (`Mod+Shift+H`) and a Pro-gated `<RecentRunsPill>` in the result header (Free tier sees an upsell variant). Opt-in bare-expression auto-log mode for JS / TS with per-language Settings defaults and per-tab overrides. Pre-set stdin buffer with a dedicated bottom-panel `Input` tab consumed by `prompt()` / `readline()` (JS / TS) and `input()` (Python), with a "Used N of M lines" pill after the run. Per-language execution timeout presets (`quick` / `normal` / `long` / `extended`) with optional live `mm:ss` countdown pill and a `// @timeout 60s` magic-comment override. Compare-with-last-stable-run toggle in the result header with a multi-snapshot ring, pin/freeze support, three diff granularities (line / word / character), and inline `+ / − / ~` diff badges. Post-execute variable inspector panel mutually exclusive with Compare, surfacing typed previews for primitives, objects, arrays, Maps, Sets, errors, dates, and functions with `Mod+Shift+I` toggle, optional recursive expansion, and a case-insensitive name filter.
- **Explicit JS / TS runtime modes**: Per-tab runtime selector with three implemented modes. **Worker** (default) keeps the existing fast Web-Worker scratchpad path. **Browser Preview** ships an iframe-sandboxed runtime with srcdoc CSP, runId-anchored postMessage bridge, parent-owned timeout, scoped multi-file preview seed, and an inspect-in-window button — useful for HTML / DOM / canvas demos. **Desktop Node** spawns a real `node` child process with a parent-owned SIGTERM→SIGKILL timeout, a `NODE_TOOLCHAIN_KEYS` env allowlist, automatic `node_modules/` cwd resolution, `package.json#type === 'module'` detection, and a first-run trust notice before the first execution touches your filesystem and network.
- **Signal-Slate v2 chrome**: New 36px header row above the toolbar with app mark, filename + unsaved dot, license badge, command-palette search, and settings gear. Toolbar trimmed of the seven right-side icons that duplicated the new header. Variables panel can now dock to a Variables tab in the bottom panel (Settings → Editor → Variable inspector surface) instead of the floating card. Toolbar chips (Lang / Runtime / Workflow) stay clickable even without an open tab and auto-create the right tab on demand so the toolbar can never deadlock the user out of a fresh session.
- **Rich-output foundation + `//=> table` directive**: New `RichOutputPayload` type discriminator (superset of `ScopeValue`) covering map / set / date / promise / table / rawText payloads, with `image` and `chart` stubs reserved for the next slice. JS / TS runners attach a typed `RichOutputTable` payload when the user annotates an expression with `//=> table` — the inline pill upgrades from a JSON blob to a compact `Table(N×M) — cols` summary. Python's `#=> table` is recognised by the parser even though the Pyodide runner does not emit the payload yet. Foundation for the upcoming console-panel widget, popover surface, and chart / image / sandboxed-HTML rendering.
- **Debugger UX refinements**: Breakpoint controls consolidated inside the debugger panel for a cleaner gutter, clearer affordances around the active debug session and the bottom-panel tab strip.
- **Public R2 release mirror**: The release workflow now mirrors desktop installers, checksums, SBOM, and the third-party license report to a Cloudflare R2 bucket served at `downloads.linguacode.dev`. This is the public download surface for marketing-site CTAs while the source repository stays private. Includes a root `manifest.json` for programmatic discovery, a `latest/` prefix that always points at the current release, a `check:r2-mirror` parity validator, and per-release evidence under `output/r2-mirror-validation/<tag>.json`. Setup runbook: [`docs/runbooks/r2-release-mirror-setup.md`](./docs/runbooks/r2-release-mirror-setup.md).
- **Telemetry export pipeline**: New infrastructure path for periodic export of the closed-enum telemetry buffer to the update-server, enabling downstream analytics + observability without the renderer talking to a third-party service.

### Changed
- **Toolchain modernization**: Vite 5 → 8 (Rolldown default), Vitest 3 → 4, ESLint 9 → 10, `eslint-plugin-react-hooks` 5 → 7, Electron 41 → 42, TypeScript 5 → 6, Pyodide 0.26 → 0.29, `esbuild-wasm` 0.27 → 0.28, Node engine moved to `>=24.5.0`. Held `@electron/fuses` at 1.8.0 because `@electron-forge/plugin-fuses` 7.11.1 still pins `^1.0.0`; documented in `tests/build/depFreshness.test.ts`. Three lint rules surfaced by the bumps (`no-useless-assignment`, `preserve-caught-error`, `react-hooks/purity`) re-promoted from `warn` to `error` after fixing every violation; four others (`set-state-in-effect`, `immutability`, `exhaustive-deps`, `refs`) intentionally stay at `warn` because the existing call sites are intentional `useEffect` patterns whose refactor would be a design change.
- **Toolbar layout**: Toolbar no longer ships duplicated chrome (LicenseBadge, Open File, Quick Open, Palette, Snippets, Utilities, Console, Settings icons) — those moved to the Signal-Slate v2 header row. Left padding tightened to match.

### Fixed
- **Inline-pill overflow on long values**: Stringified values longer than the editor's viewport used to paint past the right edge, wrap onto a second line, and overrun the gutter. Truncate at 80 characters with an ellipsis and surface the full text via the `title` attribute (visible on hover). The new `//=> table` directive side-steps this for array-of-objects entirely.
- **`CompareResultsPanel` purity**: Relative-time strings inside the compare panel were derived from `Date.now()` inline in render, causing churn on every re-render. Anchored to the snapshot's `capturedAt` instead so the render stays pure (re-enables the `react-hooks/purity` rule at `error`).

## [0.3.0] — 2026-05-11

### Added
- **Rich language intelligence for Python, Rust, and Go**: Inline diagnostics, completions, hover documentation, and parameter hints. Rust uses rust-analyzer and Go uses gopls when installed locally; Python runs in-process. Web build keeps these languages in validate-only mode.
- **JS/TS debugger (preview)**: Click-to-toggle gutter breakpoints with `Mod+Shift+B`, a Debugger drawer with step controls, Settings entries to disable or clear all breakpoints, and TypeScript source-map composition so breakpoints stop at the line you authored.
- **Developer utilities productivity layer**: `Cmd/Ctrl+K` launcher with fuzzy search, `Cmd+Shift+C` / `Cmd+Alt+R` to copy or replace utility output, per-tool history with persistence, drag-reorder favorites with full keyboard support, clipboard-on-focus consent, and Apply-from-input across 29 panels.
- **QR utility closeout**: Drag-drop image decode, Copy-as-PNG, FG/BG color pickers with a WCAG-AA contrast guard, high-contrast preset, and SVG download.
- **Recovery experience**: Safe-mode boot via `?safe-mode=1`, automatic factory mode after repeated crashes, a Settings recovery section with five scoped resets, and a reveal-folder shortcut.
- **Profile backup and restore**: Versioned profile export and restore with explicit conflict handling, replace confirmation, and machine-bound data exclusions.
- **Performance visibility**: Release validation captures bundle size, runtime timings, and memory diagnostics before a build ships.
- **Release update feed gate**: Desktop release validation now includes a draft-channel update-feed check with archived evidence.
- **Public-source readiness guidance**: Release, security, auto-update, Cloudflare, performance, and source-available publication checks documented in one place.

### Changed
- **Desktop watcher reliability**: Watcher diagnostics, opaque watch IDs, and degraded-event handling are documented and covered more directly.
- **Plugin hardening**: Built-in plugin catalog and manifest validation reject malformed or prototype-derived ids more defensively.
- **Release validation**: Performance budgets are part of the normal web-build quality gate.

### Fixed
- **Trust-boundary hardening**: Filesystem capability checks and native runtime detection paths were tightened to keep host secrets out of subprocess environments.
- **Overlay accessibility**: Modal overlays preserve dialog boundaries, contain focus, and restore focus after close.
- **Auto-update docs**: Runbooks match the desktop updater's one-hour check interval.

### Security
- **Public-release secret scan**: A gitleaks scan now runs as part of release readiness.

## [0.2.3] — 2026-04-30

### Fixed
- **Web build stability**: Lifted the Node heap limit for the web build job so release builds stop failing from memory pressure.

## [0.2.2] — 2026-04-30

### Added
- **Public release hygiene**: Added source-publication checklists, release security guidance, third-party notice reporting, and secret-scan configuration.
- **Offline Python runtime validation**: Vendored Pyodide runtime assets with integrity checks so packaged desktop builds can prove Python runs without a CDN fallback.
- **Desktop release verification**: Added production dependency audit, checksum verification, SBOM generation, and packaged macOS smoke coverage.

### Changed
- **Native execution trust boundary**: Go and Rust execution now require explicit acknowledgement and use a filtered environment across detection and run paths.
- **Filesystem capability model**: Desktop file access moved to root-token plus relative-path IPC contracts with protected-path enforcement.
- **Public web surfaces**: Repo docs now point to `linguacode.dev` and `app.linguacode.dev` as the live public surfaces.

## [0.2.1] — 2026-04-22

### Added
- **URL Parser** (Developer Utilities): A new panel breaks any URL into scheme, origin, user, password, host, port, path, search, and fragment. Each component renders on its own card with a copy button, and the query string shows as a one-row-per-parameter table that preserves duplicate keys. The password cell stays masked until you explicitly reveal it.
- **String Case Converter** (Developer Utilities): Type any phrase or identifier and see seven casings live: camelCase, PascalCase, snake_case, kebab-case, CONSTANT_CASE, Sentence case, and Title Case. The tokenizer understands acronyms (`HTTPRequest` → `HTTP Request`), letter-digit boundaries, and leaves CJK, emoji, and accented characters intact.
- **HTML Entity Encode / Decode** (Developer Utilities): A new panel with four modes — Encode (minimal), Encode (named), Encode (numeric), and Decode. Named encoding covers Latin-1 Supplement plus common punctuation / symbol entities; codepoints outside the named table fall back to decimal numeric. Decode resolves named, decimal, and hex references and surfaces a small hint when any reference could not be resolved.
- **String Inspector** (Developer Utilities): Paste any text to see its UTF-16 units, approximate graphemes, and UTF-8 byte length alongside a per-codepoint table that labels every character (printable, whitespace, control, invisible, BiDi). Warning cards call out zero-width characters, BiDi overrides, mixed-script words, and common Latin / Cyrillic homoglyphs — the usual suspects when a pasted string behaves mysteriously.
- **Diff Viewer granularity**: The Diff Viewer now supports line-level, word-level, and character-level comparison via a selector at the top of the result. Word and character modes render inline so small edits pop visually, while the line summary keeps the familiar added / removed / unchanged counts.
- **More copy buttons across Developer Utilities**: The UUID Generator, Timestamp Converter, JSON Formatter, and JWT Debugger now ship a dedicated copy affordance on every result — each generated UUID row, the four timestamp cards (Unix seconds, Unix milliseconds, ISO 8601, local time), the current JSON input, and the decoded JWT header and payload.
- **Backslash Escape / Unescape** (Developer Utilities): Convert pasted strings for JavaScript, JSON, Python, or SQL-MySQL contexts, then unescape them back with clear inline errors when a sequence is incomplete or malformed.
- **Random String Generator** (Developer Utilities): Generate one or many secure random strings with length, count, character-class toggles, and an option to exclude ambiguous characters such as `0`, `O`, `1`, and `l`.
- **Lorem Ipsum Generator** (Developer Utilities): Generate placeholder copy as words, sentences, or paragraphs, with an optional classic opening and natural sentence rhythm for mockups, layout tests, and sample content.
- **Base64 Image Encode / Decode** (Developer Utilities): Drop an image to create a data-URI, or paste a data-URI to preview it with MIME and size metadata. Oversized pasted payloads are rejected before preview so the app stays responsive.
- **JWT Debugger algorithm coverage**: Verify and sign JWTs across the full HS, RS, ES, and PS families, including RS384 and RS512, without leaving the local renderer.
- **Beautify / Minify expansion** (Developer Utilities): The panel now covers JSON, JavaScript, HTML, CSS, SCSS, LESS, and XML. JavaScript minify uses a real ECMAScript minifier, while markup and stylesheet modes preserve raw text, strings, URLs, CDATA, and other sensitive content.
- **SVG to CSS converter** (Developer Utilities): Paste SVG markup and copy either a Base64 or URL-encoded data-URI plus a ready-to-use CSS `background-image` block, with detected size hints when the SVG exposes safe dimensions.
- **Cron Parser** (Developer Utilities): Explain cron expressions in plain language and list the next scheduled run times from your machine clock, with English and Spanish descriptions plus a configurable upcoming-runs count.
- **Hash Generator closeout** (Developer Utilities): Adds MD5 via a lazy-loaded spark-md5 chunk, SHA-384, SHA-512, HMAC over the full SHA family, plus a drag-drop file input so local payloads up to 50 MB can be hashed without ever leaving the device.
- **HTML to JSX converter** (Developer Utilities): Paste HTML markup and copy valid JSX with React-compatible attribute names, self-closing void elements, inline styles translated to object literals, HTML comments converted to JSX comments, and multi-root inputs optionally wrapped in a fragment.
- **cURL to Code converter** (Developer Utilities): Paste common cURL commands and generate equivalent code for fetch (browser), undici (Node), Python requests, or Go net/http. Headers, methods, inline bodies, basic auth, and cookies all carry over; file-backed bodies get a clear error, and unknown flags surface as inline warnings instead of hard failures.
- **YAML and JSON converter** (Developer Utilities): Convert between YAML and JSON with a 2 / 4-space indent toggle. A diagnostic flags when YAML comments are dropped at the JSON boundary; quoted-scalar `#` characters are correctly preserved.
- **JSON and CSV converter** (Developer Utilities): RFC 4180-compliant CSV ↔ JSON-array converter with configurable delimiter (comma, tab, semicolon, pipe), header-row toggle, sparse-row support, and full quoted-field handling for embedded delimiters and newlines.
- **Markdown Preview** (Developer Utilities): Render Markdown to a sanitized HTML preview locally — DOMPurify backstops the sanitization and remote `<img src="…">` attributes are stripped before rendering so nothing leaves the renderer.
- **SQL Formatter** (Developer Utilities): Format SQL with ANSI standard, PostgreSQL, or MySQL dialect rules. Configurable indent (2 / 4 spaces) and keyword case (preserve / UPPERCASE / lowercase).

## [0.2.0] — 2026-04-21

### Added
- **License management**: A new License section in Settings lets you paste a Lingua token to unlock your plan. The current tier is visible next to the input, and a FREE / PRO pill in the toolbar shows your active plan at a glance. Click the pill to jump straight to the License section.
- **Environment variables**: A new Settings section where you can define environment variables at the workspace or per-project level. Values stay on your machine and flow to desktop runners when you execute a file.
- **Expanded language catalog**: Ruby, Java, Kotlin, Scala, Swift, C, and C++ files now open with proper syntax highlighting, file-extension detection, and a clear indicator in the file tree when they aren't runnable yet.
- **Privacy controls**: A first-launch prompt asks whether you want to share anonymous usage signals before anything leaves your machine, and Settings → Privacy lets you change your mind at any time. Telemetry and crash reporting are off until you opt in, and never include your code or file paths.
- **About and What's New**: Settings now ships a dedicated About panel with version and release links, plus a What's New overlay that surfaces these release notes without leaving the app.
- **Editable keyboard shortcuts**: Rebind any built-in shortcut from the Keyboard Shortcuts overlay. Conflicts are detected and refused with a helpful notice, per-row and global reset restore the defaults, and your changes persist across sessions. Escape stays reserved so you can always close an overlay.
- **Keyboard shortcut presets**: Switch between "Default (Lingua)", "Sublime Text-inspired", and "Classic IDE (JetBrains-style)" bundles in one click. Any manual edit afterwards flips the selector back to Default so the UI always reflects the truth.
- **Export and import your keymap**: Save your personalised shortcuts to a JSON file or import one from another install. The file is validated for shape, version, and conflict-free combos before it is applied.
- **Theme packs**: Settings → Appearance adds a theme pack selector. Pick "Solarized Daylight" for warm paper light mode, "Nord Night" for a calm blue-grey dark mode, or stay on the Lingua default. A pack swaps appearance, typography, and layout in one move.
- **Guided tour on-startup toggle**: Every step of the guided tour now has a "Don't show this tour on startup" checkbox. A matching switch lives in Settings → About for anyone who wants to replay or silence the tour on demand.
- **Execution history everywhere**: A new clock icon in the console toolbar opens a popover with your most recent runs — language, duration, and relative time — and the Command Palette surfaces the same list so you can re-run a recent file from the keyboard. Clear the history any time.
- **Number Base Converter** (Developer Utilities): Convert integers between binary, octal, decimal, hexadecimal, or any custom base from 2 to 36. `0x`, `0o`, and `0b` prefixes are honoured and underscores work as digit separators.
- **UUID v7 and ULID** (Developer Utilities): Generate modern time-ordered identifiers alongside the classic UUID v4. A new decoder surfaces the embedded timestamp from any UUID v7 or ULID you paste.
- **Beautify / Minify panel** (Developer Utilities): Pretty-print or compact JSON and JavaScript side-by-side. JSON round-trips through a parse and restringify; JavaScript gets an honest whitespace-only minifier with a clearly labelled hint.
- **Quick copy in Developer Utilities**: Every result field in Developer Utilities — hex/RGB/HSL colors, hashes, Base64 output, URL encode/decode, Beautify / Minify results — now has a small copy icon that writes the value to the clipboard with a brief confirmation.
- **Format on save for Python**: Python files now run through ruff (falling back to black) when format-on-save is enabled, alongside the existing support for JavaScript, TypeScript, JSON, CSS, Go, and Rust.
- **Support for infrastructure files**: `Dockerfile`, `Containerfile`, `Makefile`, `.gitignore`, `.dockerignore`, `.npmignore`, `.editorconfig`, and shell scripts (`.sh`, `.bash`, `.zsh`, plus common shell dotfiles) now open with proper syntax highlighting.
- **Inline validators with friendly diagnostics**: Running a JSON, YAML, `.env`, CSV, `.editorconfig`, Dockerfile, Makefile, `.gitignore`, or shell script file now surfaces lightweight warnings inline — duplicate `.gitignore` patterns, space-indented Makefile recipes, missing Dockerfile `FROM` or deprecated `MAINTAINER`, unknown EditorConfig keys, missing shebangs in shell scripts, and more.

### Changed
- **Dark / Light toggle**: Picking a shell theme always takes effect now. Previously the "match shell to editor theme" option could quietly override your choice.
- **Clearer license errors**: Invalid tokens surface a tier-specific explanation — "malformed token", "signature does not match", "expired", "clock is off", and so on — rather than a generic fallback.
- **Color Converter picker**: The colour picker row now reads as a proper control, with a Palette icon and a hint line instead of an anonymous square.

### Fixed
- **Shortcut row spacing**: Keyboard Shortcuts rows keep clear breathing room between the combo and the Edit / Reset buttons in every language, including Spanish.

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

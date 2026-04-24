# Changelog

All notable changes to Lingua are documented here.

The format follows Keep a Changelog and groups changes by release.

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

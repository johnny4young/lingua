# Lingua

[![CI](https://github.com/johnny4young/lingua/actions/workflows/ci.yml/badge.svg)](https://github.com/johnny4young/lingua/actions/workflows/ci.yml)
[![Node 24+](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)
[![License: Source-available (commercial)](https://img.shields.io/badge/license-source--available%20(commercial)-6f42c1)](./LICENSE)

**Multi-language desktop code runner — JavaScript, TypeScript, Python, Go, and Rust in one offline-first Monaco-powered app.** Lingua combines Monaco Editor, a project file tree, inline console output, and language-specific execution backends for both desktop and web builds. It is the multi-language answer to RunJS: the same "open, write, run" ergonomics, but with Go, Rust, and Python as first-class citizens instead of JavaScript-only.

## Pricing and licensing

Lingua is a commercial product distributed under a source-available license — see [`LICENSE`](./LICENSE) for the full text. The repository is public so the community can read the source, audit security, and submit contributions; production, paid, or at-scale use requires a commercial license.

- **Free tier** — personal evaluation, self-learning, single-user non-commercial use with the default feature set.
- **Pro (one-time)** — unlocks Pro entitlements for a major version with 12 months of updates.
- **Pro Lifetime** — the Pro entitlement set with lifetime updates.
- **Team / Education** — seat-based licensing and free access for verified students and educators.

The public pricing summary lives in [`docs/press-kit/pricing-one-pager.md`](./docs/press-kit/pricing-one-pager.md). The download page and checkout will live at [`linguacode.dev`](https://linguacode.dev) once `RL-063` ships.

## Who it is for

- Developers juggling JavaScript, TypeScript, Python, Go, and Rust snippets across Slack, Stack Overflow answers, and interview prep.
- Teachers and students who want a single offline-capable multi-language sandbox that runs on laptops without per-language CLI setup.
- Teams who need a lightweight, reviewable, commercial-licensed alternative to web-hosted playgrounds for proprietary code.

## Current capabilities

- Desktop app built with Electron Forge, Vite, React 19, and TypeScript
- Monaco-powered editor with tabs, templates, and inline execution results
- Built-in runners for JavaScript, TypeScript, Go, Python, and Rust
- Validate-only editor modes for JSON, YAML, `.env`, and CSV, plus explicit view-only handling for TOML and INI/config-style files
- Project explorer with file open, save, rename, create, delete, recent projects, and project-wide Quick Open for unopened files
- Command palette, quick open, snippet library, settings, persisted resizable panels, and a compact sidebar drawer for narrow widths
- Shared hover/focus tooltips across toolbar, editor tabs, console controls, command palette utilities, and file tree actions
- About section in Settings with bundled product metadata, GitHub/license links, update entry points, and a linked What's New surface
- Interactive guided tour for editor, console, explorer, snippets, and command palette onboarding, launchable from About or the Command Palette
- Built-in developer utilities, available from the toolbar and Command Palette, covering JSON formatting, Base64/URL transforms, UUID generation, hashing, timestamp conversion, JWT decoding, regex testing, hex/rgb/hsl color conversion, and line-level diffing
- Auto-run, magic comments, loop protection, and hide-undefined controls for dynamic languages
- Optional format-on-save using Prettier (JS, TS, JSON, CSS) and desktop-only gofmt, rustfmt, and Python formatters (ruff preferred, black fallback), with a dismissable status banner for parse errors and missing binaries
- Curated developer fonts (JetBrains Mono, Fira Code, Cascadia Code, Source Code Pro, IBM Plex Mono, Consolas, Menlo, Monaco, Courier New, System Monospace) with a ligature toggle that self-disables for stacks without programmer ligatures, plus a live preview card in Settings
- Theme preset export/import: save your editor theme, fonts, and layout as a versioned JSON file and share it between machines, with validation errors surfaced through the status banner (appearance/typography/layout only — safety prefs are never overridden by an imported preset)
- Shell polarity follows the editor theme by default, so picking a light Monaco theme flips the console and run-result panels to light without a separate click; a Settings toggle keeps the legacy independent behavior one click away
- Keyboard shortcut reference/editor reachable via the Command Palette (`Open Keyboard Shortcuts`), with a search filter, platform-aware combo rendering (⌘ on macOS, `Ctrl+...` elsewhere), inline rebinding, preset switching, and JSON export/import for override bundles
- Commercial license-key infrastructure: Ed25519-signed offline-verifiable tokens, renderer store with active / grace / invalid states, and entitlement-based feature gating (11 entitlements, Free ceilings of 1 tab / 5 snippets / JS-TS-Python)
- Opt-in privacy-respecting telemetry and crash reporting — off by default; the Settings → Privacy section surfaces the consent toggle, build-level kill switches disable both regardless of user choice, and every payload is passed through a redactor that drops anything outside an explicit allow-list (never user code or file paths)
- Web build for browser-based usage, with JavaScript, TypeScript, and Python support plus browser file access
- CI plus manual deploy/release workflows

### Configuration env vars

| Name | Scope | Purpose |
| ---- | ----- | ------- |
| `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` | renderer build | Ed25519 public key (JWK JSON) the app uses to verify paid-tier licenses. Missing key keeps every build on Free |
| `VITE_LINGUA_TELEMETRY_URL` | renderer build | HTTPS endpoint that receives redacted telemetry events when the user has opted in. Unset disables telemetry |
| `VITE_LINGUA_TELEMETRY_DISABLED` | renderer build | Set to `1` to disable telemetry regardless of user choice |
| `LINGUA_CRASH_REPORTER_URL` | main runtime | Minidump submission endpoint. Unset disables crash reporting |
| `LINGUA_CRASH_REPORTER_DISABLED` | main runtime | Set to `1` to disable crash reporting regardless of user choice |
- Repeatable desktop smoke validation with artifact output under `output/playwright/desktop-smoke`

Use [`.env.example`](./.env.example) as the safe template for local overrides.
Never commit private keys, API tokens, signing certificates, webhook secrets, or
real customer license tokens.

## Editor diagnostics and results

- Monaco JavaScript and TypeScript diagnostics target the same ES2022 + Web Worker runtime contract used by execution
- Go, Python, Rust, and Lua now ship immediate Monaco keyword/snippet completions so non-JS files get editor assistance before full LSP support exists, and Monaco suggestions are configured to surface while you type instead of waiting for manual invocation
- Common development files now advertise honest editor modes: JSON/YAML/`.env`/CSV validate in-place with diagnostics, Dockerfile/`.editorconfig`/`.gitignore`/`Makefile` now do the same with lightweight rule checks, while TOML/INI stay editable without fake run semantics
- Auto-run and manual run now feed the same result state, so the result panel and editor stay synchronized instead of diverging by execution path
- Dynamic-language runs render inline line decorations in the editor, and runtime or compile errors with source locations are surfaced as Monaco markers without overwriting TypeScript diagnostics
- Go and Rust compile failures now normalize their primary compiler messages and parsed source locations before they reach Monaco markers, so editor highlights stay focused on the real failing span instead of a raw stderr blob
- Manual runs reveal location-aware execution errors in the editor, while auto-run keeps the current caret position stable so background checks do not steal focus mid-typing

## Release notes and onboarding surfaces

- [`CHANGELOG.md`](./CHANGELOG.md) now follows a Keep a Changelog-style semver structure so release notes stay readable in git and in-product
- The renderer bundles parsed changelog data at build time, so the desktop and web shells can show release notes without direct file-system access
- A dedicated What's New overlay is available from both the Command Palette and the About section, and it auto-opens once when the app sees a newer version than the last one stored locally
- A Shepherd-based guided tour now opens from the About section, the Command Palette, or automatically after first-launch gating when the user has not completed onboarding yet
- Lingua is a source-available commercial product, so Shepherd's commercial license still must be purchased before public distribution even though the tour is already integrated in development builds

## Theme behavior

- App theme and editor theme stay independent: the shell uses the saved dark/light setting while Monaco uses its own editor theme selection
- The saved app theme is applied before React mounts, so reloads reopen directly into the previous shell theme instead of flashing the wrong palette first
- The renderer keeps `theme-color` in sync with the active shell theme for browser chrome and packaged-window surfaces that read it

## Developer utilities

- Open the utilities workspace from the toolbar wrench button or via Command Palette actions such as `Open JSON Formatter`
- The current slice is lazy-loaded so it does not inflate the main editor bundle before you open it
- Current utilities:
  - JSON formatter / validator / tree viewer
  - Base64 encode/decode
  - URL encode/decode
  - UUID generator
  - Hash generator (`SHA-1`, `SHA-256`)
  - Unix timestamp converter
  - JWT decoder
  - Regex tester with live matches and capture groups
  - Color converter across hex, rgb, and hsl with a live swatch preview
  - Line-level diff viewer with add/remove markers and a summary

## Runtime model

- JavaScript and TypeScript run in renderer workers
- Monaco JavaScript and TypeScript diagnostics now target the same ES2022 + Web Worker runtime contract, including top-level await and worker globals such as `fetch`
- Go is compiled to WebAssembly through the desktop IPC bridge and a local Go toolchain
- Python runs through Pyodide
- Rust is compiled and executed natively through the desktop IPC bridge and a local Rust toolchain
- The web build stubs Go and Rust execution because local toolchains are not available in the browser
- JSON, YAML, `.env`, and CSV never execute; they surface validation diagnostics only
- TOML, INI, and unknown plaintext-style files stay editable but do not expose fake run/lint affordances

## Requirements

| Dependency     | Version | Notes                                             |
| -------------- | ------- | ------------------------------------------------- |
| Node.js        | >= 24   | Required for local development, tests, and builds |
| Go             | >= 1.21 | Required only for desktop Go execution            |
| Rust (`rustc`) | stable  | Required only for desktop Rust execution          |

## Local development

```bash
git clone https://github.com/johnny4young/lingua.git
cd lingua
npm install
npm run dev:desktop
```

For browser-only iteration, use:

```bash
npm run dev:web
```

Renderer architecture note:

- The editor shell is now split so Monaco theme registration, editor option construction, and the empty-state surface live in focused modules instead of one oversized `CodeEditor` file.
- The explorer shell is now split so recursive tree rendering, inline creation input, and the no-project surface live in focused `FileTree` modules instead of one monolithic component file.
- The command palette now delegates command construction/filtering and result-list rendering to focused modules, keeping the modal container centered on interaction state instead of catalog assembly.
- The project store now delegates pure file-tree shaping and mutation helpers to a dedicated module, leaving the Zustand store focused on project lifecycle, file-system IPC, and watch-state transitions.

Architecture deep dive:

- [`AGENTS.md`](./AGENTS.md) is the canonical guidance for any agent (Claude Code, Cursor, Codex, Aider) working in this repo — routing, landmines, UI verification tiers, commit rules. `CLAUDE.md` at the repo root is a symlink to it so Claude Code's auto-loader picks the same file.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) explains the project lifecycle, Electron IPC file-system bridge, and watch-state flow with diagrams and extension guidance.
- [`docs/CAPABILITY_MATRIX.md`](./docs/CAPABILITY_MATRIX.md) is the decision record for what runs where (browser WASM, browser interpreter, desktop native, hybrid) with the promotion rules for future WASM-first migrations.
- [`docs/BUILD_SYSTEM_ADR.md`](./docs/BUILD_SYSTEM_ADR.md) is the ADR for the desktop build system (stay on Electron Forge vs. move to electron-vite or electron-builder) with the scoring matrix and when-to-revisit triggers.
- [`docs/TAURI_SPIKE_ADR.md`](./docs/TAURI_SPIKE_ADR.md) is the written no-go decision on migrating to Tauri 2, with the architectural gap analysis and the triggers that would reopen the question.
- [`docs/LANGUAGE_PACK_ADR.md`](./docs/LANGUAGE_PACK_ADR.md) documents the declarative `LanguagePack` descriptor and the three-slice migration plan for built-in + Lua language support.
- [`docs/ENV_VARS_ADR.md`](./docs/ENV_VARS_ADR.md) records the RL-011 env-var scoping decisions (which runtimes, web-mode answer, tab > project > global precedence) and the four-slice implementation roadmap.
- [`docs/VITE_UPGRADE_ADR.md`](./docs/VITE_UPGRADE_ADR.md) plans the Vite 5 → 7 bump with the impact matrix, four blocker peer-range checks, the verification matrix, and the rollback plan.
- [`docs/VIM_MODE_ADR.md`](./docs/VIM_MODE_ADR.md) records the RL-037 Vim mode integration decisions (monaco-vim as the lazy-loaded layer, focus-gated keystroke ownership, English-only status bar posture) and the rollback + revisit triggers.
- [`docs/DEBUGGER_ADR.md`](./docs/DEBUGGER_ADR.md) plans the RL-027 debugger MVP — JS/TS first via Monaco, then Python via pdb, Go via Delve, Rust via lldb — with a bounded feature budget (breakpoints, step, watch, stack, variables) and explicit out-of-scope list.
- [`RELEASE.md`](./RELEASE.md) is the RL-016 release checklist — preconditions, 14 numbered release steps including the packaged desktop smoke and post-publish smoke, the validation gate, and the rollback plan.
- [`docs/PUBLIC_RELEASE_CHECKLIST.md`](./docs/PUBLIC_RELEASE_CHECKLIST.md) gates changing the source repository visibility to public.
- [`docs/RELEASE_SECURITY.md`](./docs/RELEASE_SECURITY.md) is the security sign-off checklist for public releases.
- [`SECURITY.md`](./SECURITY.md), [`PRIVACY.md`](./PRIVACY.md), [`CONTRIBUTING.md`](./CONTRIBUTING.md), and [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) cover public security reporting, privacy posture, contribution rules, and runtime dependency notices.
- [`docs/press-kit/`](./docs/press-kit/) holds the Phase 2 launch asset boilerplate (en + es) — product descriptions, pricing one-pager, founder bio, Show HN / Product Hunt / subreddit drafts.
- [`docs/seo-pages/`](./docs/seo-pages/) holds the RL-066 SEO landing page scaffolds (five language-intent pages) ready for `linguacode.dev` to consume once the domain ships.
- [`docs/lessons/`](./docs/lessons/) holds the RL-039 first-slice guided lesson scaffolds (en + es) — read-only Markdown today, picked up by the future interactive lesson runner.
- [`src/renderer/README.md`](./src/renderer/README.md) maps the renderer folders, state ownership, styling rules, extraction conventions, and common change/test paths.

### Windows contributors: enable symlinks before cloning

`CLAUDE.md` is a git symlink (`mode 120000`) that points at `AGENTS.md`. Linux and macOS follow it transparently. Windows needs one-time setup so git materializes it as a real symlink instead of a text file containing the word `AGENTS.md`:

1. Enable **Developer Mode** (Settings → Privacy & security → For developers → Developer Mode on).
2. `git config --global core.symlinks true` before `git clone`.

Without this, `CLAUDE.md` still works as a pointer — it just shows up as a regular text file containing `AGENTS.md`. Edit `AGENTS.md` in either case; never edit the symlink.

## Quality checks

```bash
npm run lint
npm run check:i18n
npm run check:i18n:copy
npm test
npx tsc --noEmit
npm run build:web
npm run smoke:desktop
```

These are the main local verification commands. CI also runs a non-blocking `npm audit`.

Desktop smoke notes:

- `npm run smoke:desktop` launches a real Electron window against a local renderer server, exercises JavaScript, TypeScript, Python, Go, and Rust, and exits with a failing status if any language smoke case fails.
- Artifacts land in `output/playwright/desktop-smoke/`:
  - `desktop-smoke-bootstrap.json`
  - `desktop-smoke-progress.json`
  - `desktop-smoke-summary.json`
  - one screenshot per language case

## i18n contributor workflow

- Locale files live in `src/renderer/i18n/locales/<language>/`. The current source locale is `src/renderer/i18n/locales/en/common.json`.
- Add new user-facing copy with stable semantic keys such as `settings.title`; do not use raw English sentences as keys.
- Resolve translated text at render/use sites with `t(...)` or shared i18n helpers instead of storing translated labels in config/state objects.
- Keep these values non-localized in the current MVP: code samples, generated file names, language ids, plugin ids, and similar internal identifiers.
- Command palette discoverability should stay language-aware: localize labels/descriptions, but keep English aliases in keyword lists when they help search.

Verification commands:

```bash
npm run check:i18n
npm run check:i18n:copy
```

What they enforce:

- `check:i18n` fails on invalid locale JSON, missing translation keys, and orphaned keys relative to the English source locale.
- `check:i18n:copy` inspects touched `src/renderer/**/*.ts(x)` files and flags obvious hardcoded JSX copy or literal UI attributes such as `title`, `aria-label`, and `placeholder`.

## UI smoke test

The most reliable interactive validation path today is the web build:

```bash
npm run build:web
npm exec vite preview -- --config vite.web.config.mts --host 127.0.0.1 --port 4173
```

Then drive the preview with the Playwright CLI wrapper:

```bash
export PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --session lingua open http://127.0.0.1:4173/
"$PWCLI" --session lingua snapshot
"$PWCLI" --session lingua screenshot --full-page --filename output/playwright/lingua-web-validation.png
```

This is currently the best end-to-end check for renderer behavior. Desktop-only paths such as native Go/Rust execution, packaged auto-updates, and local plugin discovery still need targeted desktop validation.

## Desktop dev and validation

Use the desktop launcher when you need the real Electron app without going through a full `electron-forge start` cycle:

```bash
npm run dev:desktop
```

What it does:

- starts the renderer dev server on the URL expected by the current desktop bundle
- launches the Electron app from the repository root
- shuts the local renderer server down automatically when Electron exits

If `src/main` or `src/preload` changed and the existing `.vite/build` bundle may be stale, resync those artifacts once before launch:

```bash
npm run dev:desktop:sync
```

Useful flags:

```bash
# Reuse an already-running matching renderer server instead of owning it
npm run dev:desktop -- --reuse-server

# Auto-close Electron after a few seconds (useful for smoke automation)
npm run dev:desktop -- --exit-after-ms 4000
```

The launcher avoids rebuilds during normal renderer-focused desktop testing. A resync is only needed when `main` or `preload` code changes, or when `.vite/build` is missing.
The Vite configs use `.mts` so the standard dev/build flow stays on Vite's supported ESM config path and avoids the deprecated CJS Node API warning.

If you specifically need the raw Electron Forge boot path, use:

```bash
npm run dev:desktop:forge
```

## Testing Pro locally

Fast paths:

```bash
npm run dev:web:pro
npm run dev:desktop:pro
```

Both commands mint a throwaway dev public key + signed token, print the token to the terminal, and start the target surface with `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` already wired in. Copy the token into **Settings → License → Paste a license token** to unlock Pro locally.

The desktop wrapper also forwards the managed-launcher flags you already use on `dev:desktop`:

```bash
npm run dev:desktop:pro -- --sync-main --exit-after-ms 4000
```

If you need the keypair + token as data for CI or a custom local workflow:

```bash
node scripts/mint-dev-license.mjs --tier pro --days 30 > dev-license.json
export VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK="$(jq -r .publicKeyJwk dev-license.json)"
npm run dev:desktop
```

## Desktop smoke validation

Use the repeatable Electron smoke workflow when you need a contributor-friendly UI pass instead of ad hoc manual clicks:

```bash
npm run smoke:desktop
```

What it does:

- resyncs `main` and `preload`
- launches the real Electron app against the renderer dev server
- runs a built-in smoke flow across JavaScript, TypeScript, Python, Go, and Rust
- captures per-language screenshots and a JSON summary under `output/playwright/desktop-smoke`

Failure artifacts:

- `output/playwright/desktop-smoke/desktop-smoke-summary.json`
- one screenshot per exercised language

If Go or Rust toolchains are missing locally, the smoke run fails with captured artifacts instead of silently skipping those languages.

## Shell layout behavior

- The desktop shell persists the resized widths for the sidebar, editor/results split, and editor/console split
- The explorer sidebar keeps a practical desktop width and uses a larger drag target so the separator remains easy to grab
- Below the compact shell breakpoint, the sidebar stops compressing the editor and opens as an overlay drawer instead
- `Cmd+B` / `Ctrl+B` still toggles the same sidebar state; in compact mode that means open or close the drawer
- The compact drawer can also be dismissed by clicking the backdrop, pressing `Escape`, or using the close button
- Opening a file or switching to an existing tab from the compact explorer closes the drawer so the editor regains the viewport immediately
- When the compact drawer opens, focus moves to the close button and returns to the previous control after dismissal
- While the compact drawer is open, keyboard focus stays trapped inside the drawer until it is dismissed
- While the compact drawer is open, the rest of the shell becomes inert and page scrolling stays locked until the drawer closes
- If the shell widens while the compact drawer is open, the explorer hands focus back into the persistent sidebar and clears the temporary modal state automatically

## Build commands

### Desktop packages

```bash
npm run make:desktop:mac
npm run make:desktop:linux
npm run make:desktop:win
```

Artifacts are written to `out/make/`.

### Web build

```bash
npm run build:web
npm run preview:web
```

The local web build defaults to `/` as its base path.
The GitHub Pages deployment workflow builds `dist/web` with `VITE_BASE_PATH=/lingua/` when the manual deploy workflow is run.

## Keyboard shortcuts

- The Keyboard Shortcuts overlay can now export/import override bundles as versioned JSON. Import sanitizes unknown ids, malformed combos, and conflicting bindings before writing to settings.

| Action                  | macOS         | Windows / Linux |
| ----------------------- | ------------- | --------------- |
| Run or stop active file | `Cmd+Enter`   | `Ctrl+Enter`    |
| Save active tab         | `Cmd+S`       | `Ctrl+S`        |
| Close active tab        | `Cmd+W`       | `Ctrl+W`        |
| Toggle sidebar          | `Cmd+B`       | `Ctrl+B`        |
| Toggle console          | `Cmd+\`       | `Ctrl+\`        |
| Quick open              | `Cmd+P`       | `Ctrl+P`        |
| Command palette         | `Cmd+Shift+P` | `Ctrl+Shift+P`  |
| Search in files         | `Cmd+Shift+F` | `Ctrl+Shift+F`  |
| Go to symbol in file    | `Cmd+Shift+O` | `Ctrl+Shift+O`  |
| Settings                | `Cmd+,`       | `Ctrl+,`        |
| Close open overlay      | `Escape`      | `Escape`        |

## Desktop deep links

Packaged desktop builds now register the `lingua://` protocol and handle these entry points:

- `lingua://open?file=/absolute/path/to/file.ts`
- `lingua://new?lang=python`
- `lingua://snippet?id=snippet-123`

Notes:

- `open` reuses an already-open tab when the target file is open, otherwise it opens the file from disk
- `new` creates a fresh tab using the same starter content as the toolbar language actions
- `snippet` opens the Snippet Library and focuses the matching saved snippet when that id exists locally
- Web builds expose the same bridge shape internally for consistency, but the OS-level protocol registration is desktop-only

## Automation and delivery

- CI runs web build, type checking, linting, tests, and a non-blocking `npm audit`
- GitHub Pages deploy is manual via the `Deploy web version to GitHub Pages` workflow
- The Pages build uses `/lingua/` as the web base path so static assets, the manifest, and the service worker resolve correctly under the repository subpath
- GitHub Release publishing is manual via the `Release` workflow, which accepts a single stable tag input in the form `vX.Y.Z`, creates that tag from `main`, and publishes from it
- Update server deployment is manual via the `Deploy Update Server` workflow
- Packaged macOS and Windows builds enable `update-electron-app`, which checks GitHub Releases for updates
- The active release/update channel policy is stable-only; prerelease tags are rejected by the release workflow

## Update behavior

- Automatic updates are only active in packaged desktop builds on macOS and Windows
- Linux and web builds report updates as unavailable
- The renderer now exposes update state in Settings and a manual "Check for Updates" command in the command palette, which opens Settings so the current state and message are visible immediately
- Restart-to-apply is only enabled after the main process reports that an update has been downloaded
- The updater currently targets the stable GitHub Release channel only

## Local plugins

Lingua now supports a conservative local plugin model for language integrations:

- Plugin manifests are discovered from the app-local plugin directory at runtime
- A manifest only enables runtimes that are already bundled with the current build
- Arbitrary third-party code loading is intentionally out of scope today
- Invalid, disabled, incompatible, or unsupported plugins are surfaced in Settings with explicit diagnostics

Current plugin scope:

- Local language plugins are a supported product goal
- The bundled Lua runtime is now executable through Fengari once a local `lua` plugin manifest is installed

Current install directory:

- Desktop builds discover plugins from `<app userData>/plugins`
- Web builds keep the plugin surface read-only and do not load local manifests

## Browser-only limitations

- Go compilation stays unavailable in the browser build and returns an explicit desktop-only message
- Rust compilation stays unavailable in the browser build and returns an explicit desktop-only message
- Automatic updates stay unavailable in the browser build
- Local plugin discovery stays unavailable in the browser build
- External file watching stays unavailable in the browser build

## Browser file access

- The web build can open local folders through the File System Access API in supported browsers
- Browser file access supports open, read, write, rename, create, and delete flows
- File pickers now stay scoped to code/text-oriented files so binary formats such as PDFs are not accidentally opened into the editor surface
- Browser file watching is not available, so external edits are not reflected automatically

Minimal manifest:

```json
{
  "pluginId": "lua",
  "apiVersion": 1,
  "enabled": true,
  "minAppVersion": "0.1.0"
}
```

Manifest rules:

- `pluginId` must be a string and must match a bundled plugin runtime known to this build
- `apiVersion` is currently `1`
- `enabled: false` keeps the plugin installed but inactive
- `minAppVersion` and `maxAppVersion` gate compatibility against the running app version

## Release requirements

Manual release runs are intended to publish a draft GitHub Release after platform builds succeed.

Stable channel policy:

- Only stable tags in the form `vX.Y.Z` are valid for the active release workflow input
- Prerelease tags with suffixes such as `-beta` or `-rc.1` are intentionally rejected by the workflow today

### Required secrets

- macOS:
  - `APPLE_ID`
  - `APPLE_ID_PASSWORD`
  - `APPLE_TEAM_ID`
  - `APPLE_SIGNING_IDENTITY`
  - `APPLE_CERT_P12_BASE64`
  - `APPLE_CERT_PASSWORD`
- Windows:
  - `WIN_CERT_FILE`
  - `WIN_CERT_PASSWORD`
- GitHub publishing:
  - `GITHUB_TOKEN`

### Secret formats

- `APPLE_CERT_P12_BASE64` must be the base64-encoded contents of the exported macOS signing `.p12` file.
- `APPLE_CERT_PASSWORD` must be the password used when exporting that `.p12` file.
- `WIN_CERT_FILE` must be the base64-encoded contents of the Windows signing `.pfx` or `.p12` file.
- `WIN_CERT_PASSWORD` must be the password for that Windows certificate export.

### Current artifact policy

- macOS currently ships ZIP artifacts in the active release path.
- Windows uses Squirrel packaging, which is also the most update-friendly target in the current setup.
- Linux publishes package artifacts built by the Debian and RPM makers.
- GitHub Release publication remains draft-first until signing and verification are proven stable in CI.
- The release workflow generates a `SHA256SUMS.txt` manifest before publishing.

### Release operations

- The repository currently stays on a draft-first release policy. Promotion to a non-draft release is a human step after validation.
- To publish, open GitHub Actions, run the `Release` workflow manually, and provide the stable tag/version to create from `main` and publish.
- Use [RELEASE.md](./RELEASE.md) as the operator checklist for version tags, signing prerequisites, verification, and promotion.
- Use [docs/RELEASE_SECURITY.md](./docs/RELEASE_SECURITY.md) for the public-release security sign-off before promotion.

## Notes for contributors

- The repository currently documents product status in `docs/PLAN.md`, not as a historical implementation roadmap
- Plugin support is currently limited to local language manifests that resolve to bundled runtimes
- If you change shortcuts, runner behavior, or workflow behavior, update the documentation in the same change
- Do not add machine-local absolute links to committed Markdown

## License

Lingua is a commercial product distributed under a source-available license. The full terms live in [`LICENSE`](./LICENSE); the short version is: the repository is public for evaluation, contributor review, and security auditing, but production, paid, or at-scale use requires a commercial license purchased via [`linguacode.dev`](https://linguacode.dev). Redistributing packaged binaries or competing hosted offerings is not permitted.

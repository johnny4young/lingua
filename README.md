# RunLang

[![CI](https://github.com/johnny4young/run-lang/actions/workflows/ci.yml/badge.svg)](https://github.com/johnny4young/run-lang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 24+](https://img.shields.io/badge/node-%3E%3D24-brightgreen)](https://nodejs.org)

RunLang is an Electron-based code runner for JavaScript, TypeScript, Go, Python, and Rust. It combines Monaco Editor, a project file tree, inline console output, and language-specific execution backends for both desktop and web builds.

## Current capabilities

- Desktop app built with Electron Forge, Vite, React 19, and TypeScript
- Monaco-powered editor with tabs, templates, and inline execution results
- Built-in runners for JavaScript, TypeScript, Go, Python, and Rust
- Project explorer with file open, save, rename, create, delete, and recent projects
- Command palette, quick open, snippet library, settings, persisted resizable panels, and a compact sidebar drawer for narrow widths
- Auto-run, magic comments, loop protection, and hide-undefined controls for dynamic languages
- Web build for browser-based usage, with JavaScript, TypeScript, and Python support plus browser file access
- CI, GitHub Pages deployment, and tagged release workflows

## Editor diagnostics and results

- Monaco JavaScript and TypeScript diagnostics target the same ES2022 + Web Worker runtime contract used by execution
- Auto-run and manual run now feed the same result state, so the result panel and editor stay synchronized instead of diverging by execution path
- Dynamic-language runs render inline line decorations in the editor, and runtime or compile errors with source locations are surfaced as Monaco markers without overwriting TypeScript diagnostics

## Theme behavior

- App theme and editor theme stay independent: the shell uses the saved dark/light setting while Monaco uses its own editor theme selection
- The saved app theme is applied before React mounts, so reloads reopen directly into the previous shell theme instead of flashing the wrong palette first
- The renderer keeps `theme-color` in sync with the active shell theme for browser chrome and packaged-window surfaces that read it

## Runtime model

- JavaScript and TypeScript run in renderer workers
- Monaco JavaScript and TypeScript diagnostics now target the same ES2022 + Web Worker runtime contract, including top-level await and worker globals such as `fetch`
- Go is compiled to WebAssembly through the desktop IPC bridge and a local Go toolchain
- Python runs through Pyodide
- Rust is compiled and executed natively through the desktop IPC bridge and a local Rust toolchain
- The web build stubs Go and Rust execution because local toolchains are not available in the browser

## Requirements

| Dependency | Version | Notes |
| --- | --- | --- |
| Node.js | >= 24 | Required for local development, tests, and builds |
| Go | >= 1.21 | Required only for desktop Go execution |
| Rust (`rustc`) | stable | Required only for desktop Rust execution |

## Local development

```bash
git clone https://github.com/johnny4young/run-lang.git
cd run-lang
npm install
npm start
```

## Quality checks

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build:web
```

These are the main local verification commands. CI also runs a non-blocking `npm audit`.

## UI smoke test

The most reliable interactive validation path today is the web build:

```bash
npm run build:web
npm exec vite preview -- --config vite.web.config.mts --host 127.0.0.1 --port 4173
```

Then drive the preview with the Playwright CLI wrapper:

```bash
export PWCLI="$HOME/.codex/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" --session runlang open http://127.0.0.1:4173/
"$PWCLI" --session runlang snapshot
"$PWCLI" --session runlang screenshot --full-page --filename output/playwright/runlang-web-validation.png
```

This is currently the best end-to-end check for renderer behavior. Desktop-only paths such as native Go/Rust execution, packaged auto-updates, and local plugin discovery still need targeted desktop validation.

## Desktop dev and validation

Use the desktop launcher when you need the real Electron app without going through a full `electron-forge start` cycle:

```bash
npm run desktop:dev
```

What it does:

- starts the renderer dev server on the URL expected by the current desktop bundle
- launches the Electron app from the repository root
- shuts the local renderer server down automatically when Electron exits

If `src/main` or `src/preload` changed and the existing `.vite/build` bundle may be stale, resync those artifacts once before launch:

```bash
npm run desktop:dev:sync
```

Useful flags:

```bash
# Reuse an already-running matching renderer server instead of owning it
npm run desktop:dev -- --reuse-server

# Auto-close Electron after a few seconds (useful for smoke automation)
npm run desktop:dev -- --exit-after-ms 4000
```

The launcher avoids rebuilds during normal renderer-focused desktop testing. A resync is only needed when `main` or `preload` code changes, or when `.vite/build` is missing.
The Vite configs use `.mts` so the standard dev/build flow stays on Vite's supported ESM config path and avoids the deprecated CJS Node API warning.

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
npm run make:mac
npm run make:linux
npm run make:win
```

Artifacts are written to `out/make/`.

### Web build

```bash
npm run build:web
npm run preview:web
```

The local web build defaults to `/` as its base path.
The GitHub Pages deployment workflow builds `dist/web` with `VITE_BASE_PATH=/run-lang/` after a successful `main` branch CI run.

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
| --- | --- | --- |
| Run or stop active file | `Cmd+Enter` | `Ctrl+Enter` |
| Save active tab | `Cmd+S` | `Ctrl+S` |
| Close active tab | `Cmd+W` | `Ctrl+W` |
| Toggle sidebar | `Cmd+B` | `Ctrl+B` |
| Toggle console | `Cmd+\` | `Ctrl+\` |
| Quick open | `Cmd+P` | `Ctrl+P` |
| Command palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Settings | `Cmd+,` | `Ctrl+,` |
| Close open overlay | `Escape` | `Escape` |

## Automation and delivery

- CI runs type checking, linting, tests, and a non-blocking `npm audit`
- The web build is deployed to GitHub Pages from `main` after a successful CI workflow
- The Pages build uses `/run-lang/` as the web base path so static assets, the manifest, and the service worker resolve correctly under the repository subpath
- Pushing a tag that matches `v*.*.*` triggers cross-platform packaging and GitHub Release publishing
- Packaged macOS and Windows builds enable `update-electron-app`, which checks GitHub Releases for updates
- The active release/update channel policy is stable-only; prerelease tags are rejected by the release workflow

## Update behavior

- Automatic updates are only active in packaged desktop builds on macOS and Windows
- Linux and web builds report updates as unavailable
- The renderer now exposes update state in Settings and a manual "Check for Updates" command in the command palette
- Restart-to-apply is only enabled after the main process reports that an update has been downloaded
- The updater currently targets the stable GitHub Release channel only

## Local plugins

RunLang now supports a conservative local plugin model for language integrations:

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

Tagged releases are intended to publish a draft GitHub Release after platform builds succeed.

Stable channel policy:
- Only stable tags in the form `vX.Y.Z` are valid for the active release workflow
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
- Use [RELEASE.md](/Users/johnny4young/Personal/github/run-lang/RELEASE.md) as the operator checklist for version tags, signing prerequisites, verification, and promotion.

## Notes for contributors

- The repository currently documents product status in `PLAN.md`, not as a historical implementation roadmap
- Plugin support is currently limited to local language manifests that resolve to bundled runtimes
- If you change shortcuts, runner behavior, or workflow behavior, update the documentation in the same change

## License

MIT. See [LICENSE](LICENSE).

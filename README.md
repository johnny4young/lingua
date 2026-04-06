# RunLang

[![CI](https://github.com/johnny4young/run-lang/actions/workflows/ci.yml/badge.svg)](https://github.com/johnny4young/run-lang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

RunLang is an Electron-based code runner for JavaScript, TypeScript, Go, Python, and Rust. It combines Monaco Editor, a project file tree, inline console output, and language-specific execution backends for both desktop and web builds.

## Current capabilities

- Desktop app built with Electron Forge, Vite, React 19, and TypeScript
- Monaco-powered editor with tabs, templates, and inline execution results
- Built-in runners for JavaScript, TypeScript, Go, Python, and Rust
- Project explorer with file open, save, rename, create, delete, and watch support
- Command palette, quick open, settings, and resizable editor/console layouts
- Web build for browser-based usage, with JavaScript, TypeScript, and Python support
- CI, GitHub Pages deployment, and tagged release workflows

## Runtime model

- JavaScript and TypeScript run in renderer workers
- Go is compiled to WebAssembly through the desktop IPC bridge and a local Go toolchain
- Python runs through Pyodide
- Rust is compiled and executed natively through the desktop IPC bridge and a local Rust toolchain
- The web build stubs Go and Rust execution because local toolchains are not available in the browser

## Requirements

| Dependency | Version | Notes |
| --- | --- | --- |
| Node.js | >= 22 | Required for local development, tests, and builds |
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
```

These are the repository quality scripts. CI also runs a no-emit TypeScript type check.

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

The GitHub Pages deployment workflow builds `dist/web` after a successful `main` branch CI run.

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
- Pushing a tag that matches `v*.*.*` triggers cross-platform packaging and GitHub Release publishing
- Packaged desktop builds enable `update-electron-app`, which checks GitHub Releases for updates

## Notes for contributors

- The repository currently documents product status in `PLAN.md`, not as a historical implementation roadmap
- Plugin infrastructure exists in the codebase, but it is not yet fully productized as a generalized user-facing extension system
- If you change shortcuts, runner behavior, or workflow behavior, update the documentation in the same change

## License

MIT. See [LICENSE](LICENSE).

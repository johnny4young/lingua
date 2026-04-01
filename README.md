# RunLang

[![CI](https://github.com/johnny4young/run-lang/actions/workflows/ci.yml/badge.svg)](https://github.com/johnny4young/run-lang/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node 22+](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

A desktop code runner for **JavaScript, TypeScript, Go, Python, and Rust** — powered by Monaco Editor and WebAssembly.

![RunLang screenshot](docs/screenshot.png)

---

## Features

- **5 languages** — JS, TS, Go (compiled to WASM), Python (Pyodide), Rust (compiled natively)
- **Monaco Editor** — same engine as VS Code, with syntax highlighting and IntelliSense
- **Rich console** — ANSI colours, filter by log level, inline result display
- **Project explorer** — open any local directory, live file-watch, full CRUD
- **Themes** — Dark (default), Light, High Contrast
- **Command palette** — `Cmd/Ctrl+Shift+P`
- **Quick open** — `Cmd/Ctrl+P`
- **Templates** — starter code for every language
- **Web version** — runs entirely in-browser (JS/TS/Python only)
- **Auto-updates** — packaged app updates silently via GitHub Releases

---

## Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | ≥ 22 | Required to build and run |
| Go | ≥ 1.21 | Only needed to run Go code |
| Rust + Cargo | stable | Only needed to run Rust code |

---

## Quick start

```bash
git clone https://github.com/johnny4young/run-lang.git
cd run-lang
npm install
npm start
```

---

## Build

### Desktop (Electron)

```bash
# macOS — produces a universal DMG (arm64 + x64)
npm run make:mac

# Linux — produces .deb and .rpm
npm run make:linux

# Windows — produces a Squirrel installer
npm run make:win
```

Artifacts are written to `out/make/`.

### Web version

```bash
npm run build:web      # builds to dist/web/
npm run preview:web    # serve locally for testing
```

The web build is automatically deployed to GitHub Pages on every push to `main`.

---

## Keyboard shortcuts

| Action | macOS | Windows / Linux |
|--------|-------|-----------------|
| Run code | `Cmd+Enter` | `Ctrl+Enter` |
| Stop execution | `Cmd+.` | `Ctrl+.` |
| Command palette | `Cmd+Shift+P` | `Ctrl+Shift+P` |
| Quick open | `Cmd+P` | `Ctrl+P` |
| New tab | `Cmd+T` | `Ctrl+T` |
| Close tab | `Cmd+W` | `Ctrl+W` |
| Toggle sidebar | `Cmd+B` | `Ctrl+B` |
| Toggle console | `Cmd+J` | `Ctrl+J` |
| Settings | `Cmd+,` | `Ctrl+,` |

---

## Project structure

```
src/
  main/          Electron main process (IPC, Go/Rust compilers, file system)
  preload/       Context bridge — exposes safe IPC API to renderer
  renderer/      React app (Monaco, stores, runners, workers)
    runners/     Language runner implementations
    workers/     Web Workers for JS/TS/Go/Python execution
    stores/      Zustand state (editor, console, project, settings, UI)
    plugins/     Plugin registry for extending language support
  web/           Web-only entry point and FS adapter
tests/           Vitest unit + integration tests
```

---

## Contributing

1. Fork the repo and create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes — `npm test` and `npx tsc --noEmit` must pass
3. Open a pull request against `main`

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages.

---

## License

MIT — see [LICENSE](LICENSE).

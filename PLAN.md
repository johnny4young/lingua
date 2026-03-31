# run-lang — Work Plan

> Desktop application (Electron) for running code in multiple languages (JavaScript, TypeScript, Go, Rust, Python) with WebAssembly support, polished UX, and a file permissions system.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Desktop Shell** | Electron 40 + Electron Forge |
| **Frontend** | React 19 / TypeScript 5.9 / Vite 7 / Tailwind CSS v4 |
| **Build Tool** | Electron Forge Vite Plugin |
| **Editor** | Monaco Editor (@monaco-editor/react) |
| **JS/TS Execution** | V8/Node.js sandbox in Web Worker |
| **Go Execution** | `GOOS=js GOARCH=wasm go build` (requires local Go toolchain) |
| **Rust Execution** | Native `rustc` (local) + WASM fallback (future) |
| **Python Execution** | Pyodide (CPython compiled to WASM) |
| **File System** | Electron fs API with permissions layer |
| **State Management** | Zustand v5 |
| **IPC** | Electron IPC (main <-> renderer) |
| **Panels** | react-resizable-panels |
| **Testing** | Vitest 4 + Testing Library |
| **Linting** | ESLint 9 (flat config) + Prettier 3 |
| **Node** | v22+ |

---

## High-Level Architecture

```
┌──────────────────────────────────────────────────┐
│              Electron Main Process                │
│  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │ File Sys │  │Permissions│  │  Auto-Update  │  │
│  └─────┬────┘  └─────┬─────┘  └───────────────┘  │
│        └──────┬───────┘                            │
│          IPC Bridge (contextBridge)                │
├──────────────────────────────────────────────────┤
│             Renderer Process (React)              │
│  ┌─────────┐  ┌─────────┐  ┌──────────────────┐  │
│  │ Sidebar │  │ Monaco  │  │  Console/Output  │  │
│  │FileTree │  │ Editor  │  │     Panel        │  │
│  └─────────┘  └─────────┘  └──────────────────┘  │
│                     │                              │
│          ┌──────────┴──────────┐                  │
│          │   Runner Manager    │                  │
│          └──────────┬──────────┘                  │
│   ┌────────┬────────┼────────┬─────────┐          │
│   │   JS   │   TS   │   Go   │ Python  │  Rust   │
│   │ Worker │ Worker │  WASM  │ Pyodide │ Native  │
│   │        │        │ Worker │ Worker  │ /WASM   │
│   └────────┴────────┴────────┴─────────┘          │
└──────────────────────────────────────────────────┘
```

---

## Folder Structure

```
run-lang/
├── .nvmrc
├── .npmrc
├── .prettierrc
├── .gitignore
├── eslint.config.js
├── forge.config.ts
├── package.json
├── tsconfig.json
├── vite.main.config.ts
├── vite.preload.config.ts
├── vite.renderer.config.ts
├── index.html
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts
│   │   ├── ipc/                 # IPC handlers
│   │   │   ├── fileSystem.ts    # fs operations
│   │   │   └── permissions.ts   # file permissions
│   │   └── auto-updater.ts      # auto-update
│   ├── preload/                 # Preload scripts
│   │   └── index.ts             # contextBridge API
│   └── renderer/                # React app
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css            # Tailwind v4 (@import "tailwindcss" + @theme)
│       ├── components/
│       │   ├── Editor/          # Monaco wrapper
│       │   ├── Console/         # Output panel
│       │   ├── FileTree/        # Sidebar file explorer
│       │   ├── Toolbar/         # Run, Stop, Clear, Settings
│       │   └── Layout/          # Panel layout with resize
│       ├── runners/             # Language execution engines
│       │   ├── types.ts         # LanguageRunner interface
│       │   ├── RunnerManager.ts
│       │   ├── javascript.ts
│       │   ├── typescript.ts
│       │   ├── golang.ts
│       │   ├── python.ts
│       │   └── rust.ts
│       ├── workers/             # Web Workers
│       │   ├── js-worker.ts
│       │   ├── ts-worker.ts
│       │   ├── go-worker.ts
│       │   └── python-worker.ts
│       ├── stores/              # Zustand stores
│       │   ├── editorStore.ts
│       │   ├── projectStore.ts
│       │   └── settingsStore.ts
│       ├── hooks/
│       ├── themes/
│       └── types/
├── resources/                   # WASM binaries, icons
│   ├── wasm/
│   │   └── pyodide/             # Python runtime
│   └── icons/
└── tests/
```

---

## Implementation Phases

### Phase 1: Scaffolding & Base

**Goal:** Functional project with Monaco editor and base structure.

- [ ] Initialize project with Electron Forge (Vite + TypeScript template)
- [ ] Configure Vite configs (main, preload, renderer) following open_yojob patterns
- [ ] Configure Electron Forge with security Fuses enabled
- [ ] Set up Tailwind CSS v4 with `@tailwindcss/vite` plugin (dark theme by default)
- [ ] Set up tooling: ESLint 9 flat config, Prettier, .nvmrc, .npmrc, .gitignore
- [ ] Install and configure Monaco Editor (`@monaco-editor/react`)
  - Syntax highlighting for: JS, TS, Go, Rust, Python
  - Themes: Dracula, One Dark, Monokai, VS Code Dark+
- [ ] Create main layout with `react-resizable-panels`
  - Left sidebar: file tree + language selector
  - Center panel: Monaco Editor with multi-file tabs
  - Right/bottom panel: console output (toggleable split)
- [ ] Toolbar: Run, Stop, Clear, Settings buttons, language selector
- [ ] Configure base Zustand v5 stores (editor, settings)

**Result:** Electron app that opens, displays a Monaco editor with tabs and an empty output panel.

---

### Phase 2: JS/TS Execution Engine

**Goal:** Execute JavaScript and TypeScript within the app.

- [ ] Define `LanguageRunner` interface
  ```typescript
  interface LanguageRunner {
    id: string;
    name: string;
    extensions: string[];
    icon: string;
    init(): Promise<void>;
    execute(code: string, context?: ExecutionContext): Promise<ExecutionResult>;
    stop(): void;
    getCompletions?(): CompletionItem[];
  }

  interface ExecutionResult {
    stdout: string[];
    stderr: string[];
    result?: unknown;
    executionTime: number;
    error?: { message: string; line?: number; column?: number };
  }
  ```
- [ ] Implement JS Runner
  - Execution in isolated Web Worker
  - Capture console.log/warn/error/info redirected to output panel
  - Configurable timeout (default 30s) to prevent infinite loops
  - ES Modules support
- [ ] Implement TS Runner
  - Transpilation with esbuild-wasm (lightweight, fast)
  - Type checking in real-time via Monaco TS worker (separate from execution)
- [ ] Implement inline results (RunJS-style)
  - Monaco decorations showing values next to each line
  - Toggle between "inline results" and "console panel" modes
- [ ] RunnerManager: orchestrator that selects the runner based on language
- [ ] Add unit tests for runners (Vitest)

**Result:** Write JS/TS and see output in console + inline results.

---

### Phase 3: WebAssembly Integration — Go & Python

**Goal:** Execute Go and Python within the app.

#### 3.1 Go Runner (GOOS=js/wasm)

- [ ] Detect local Go installation (`go version`)
- [ ] Compile user code to WASM using `GOOS=js GOARCH=wasm go build`
  - Use temporary directory for compilation
  - Bundle `wasm_exec.js` from Go installation
- [ ] Load compiled WASM module in dedicated Web Worker
- [ ] Full stdlib support (whatever Go's WASM target supports)
- [ ] Capture stdout/stderr
- [ ] Error handling with line/column mapping
- [ ] Fallback UI: clear message if Go is not installed + installation link

#### 3.2 Python Runner (Pyodide)

- [ ] Integrate Pyodide (CPython 3.11+ compiled to WASM)
  - Bundle: ~11MB initial (cacheable in IndexedDB)
- [ ] Load in dedicated Web Worker
- [ ] Full Python stdlib support
- [ ] `micropip` for package installation (numpy, pandas, etc.)
- [ ] Capture stdout/stderr and errors with traceback

#### 3.3 WASM Optimizations

- [ ] Lazy loading: load WASM runtime only when the language is selected
- [ ] Cache WASM modules in IndexedDB for fast subsequent loads
- [ ] Progress indicator during initial runtime loading

**Result:** Execute Go and Python in the app (Go requires local toolchain, Python runs entirely in WASM).

---

### Phase 4: Rust Runner + File System with Permissions

**Goal:** Rust support and secure file management.

#### 4.1 Rust Runner

- [ ] Execute `rustc` natively if installed on the system
  - Detect Rust installation (`rustc --version`)
  - Compile and execute in temporary directory
  - Capture stdout/stderr from process
- [ ] Future phase: explore Rust-to-WASM compilation
  - Options: Rust subset via `swc`, or `rustc` WASM (experimental)
- [ ] Fallback UI: clear message if Rust is not installed + installation link

#### 4.2 File System with Permissions

- [ ] Electron main process: IPC handlers for fs operations
  ```typescript
  interface FilePermissions {
    read: boolean;
    write: boolean;
    delete: boolean;
    allowedPaths: string[];     // allowed paths
    blockedPaths: string[];     // blocked paths (e.g., /etc, /System)
  }
  ```
- [ ] Confirmation dialog for destructive operations (delete)
- [ ] Per-project sandbox: each project has its isolated directory
- [ ] API exposed via `contextBridge` (secure preload script)
- [ ] Operations: read, write, delete, rename, mkdir, readdir, stat
- [ ] Watch mode: detect external file changes

#### 4.3 Project Management

- [ ] Create / open / save projects
- [ ] File tree with CRUD operations
- [ ] Multi-file with editor tabs
- [ ] State persistence (last open file, layout, cursor position)
- [ ] Recent projects

**Result:** Working Rust support + complete file management with permissions.

---

### Phase 5: UX & Advanced Features

**Goal:** Polish the user experience.

#### 5.1 Rich Console

- [ ] Output with colors (ANSI escape codes support)
- [ ] Timestamps per output line
- [ ] Filters: log / warn / error / info
- [ ] Expand/collapse complex objects (Chrome DevTools style)
- [ ] Execution time indicator
- [ ] Clear button and auto-scroll

#### 5.2 Themes & Customization

- [ ] Theme switcher: dark / light + editor themes
- [ ] Configurable font size and font family
- [ ] Layout presets: horizontal split, vertical split, editor only
- [ ] Preferences persistence

#### 5.3 Snippets & Templates

- [ ] Per-language templates (Hello World, HTTP server, sorting, etc.)
- [ ] Custom snippets saved locally
- [ ] Example gallery when creating a new file
- [ ] Quick insert from command palette

#### 5.4 Shortcuts & Productivity

| Shortcut | Action |
|---|---|
| `Cmd/Ctrl + Enter` | Run code |
| `Cmd/Ctrl + S` | Save file |
| `Cmd/Ctrl + P` | Find file |
| `Cmd/Ctrl + Shift + P` | Command palette |
| `Cmd/Ctrl + \` | Toggle console panel |
| `Cmd/Ctrl + B` | Toggle sidebar |
| `Cmd/Ctrl + W` | Close current tab |
| `Cmd/Ctrl + ,` | Open settings |

**Result:** Polished app with professional UX comparable to RunJS/VS Code.

---

### Phase 6: Distribution & Web Preparation

**Goal:** Package for distribution and lay groundwork for web version.

#### 6.1 Electron Packaging

- [ ] Configure Electron Forge makers
  - macOS: `.dmg` (Universal: Intel + Apple Silicon)
  - Windows: Squirrel installer
  - Linux: `.deb` + `.rpm`
- [ ] Auto-updates with `update-electron-app`
- [ ] Code signing: macOS (notarization) + Windows (Authenticode)
- [ ] Optimize bundle size
  - Tree-shaking of unused WASM modules
  - Lazy load of heavy runtimes (Pyodide)

#### 6.2 Web Version Preparation

- [ ] Abstract execution layer (already uses Web Workers — web-compatible)
- [ ] Replace Electron fs with File System Access API (browser)
- [ ] Service Worker for offline support
- [ ] WASM architecture is inherently web-compatible
- [ ] Consider deployment on Vercel/Cloudflare Pages

#### 6.3 Future Extensibility

- [ ] Plugin system for adding new languages
- [ ] Standard `LanguageRunner` interface as plugin contract
- [ ] Future language candidates:
  - C/C++ via Emscripten
  - Java via TeaVM
  - Ruby via ruby.wasm
  - Zig via WASM
  - Lua via Fengari

---

## Core Dependencies

```json
{
  "core": {
    "electron": "^40.x",
    "@electron-forge/cli": "^7.x",
    "react": "^19.x",
    "react-dom": "^19.x",
    "typescript": "^5.9.x",
    "vite": "^7.x",
    "@vitejs/plugin-react": "^4.x",
    "@tailwindcss/vite": "^4.x",
    "tailwindcss": "^4.x",
    "@monaco-editor/react": "^4.x",
    "monaco-editor": "^0.52.x",
    "zustand": "^5.x",
    "react-resizable-panels": "^2.x"
  },
  "wasm_runtimes": {
    "pyodide": "^0.26.x",
    "esbuild-wasm": "^0.24.x"
  },
  "dev": {
    "vitest": "^4.x",
    "@testing-library/react": "^16.x",
    "eslint": "^9.x",
    "typescript-eslint": "^8.x",
    "prettier": "^3.x"
  }
}
```

---

## Inspirations & References

| Project | What we take |
|---|---|
| [RunJS](https://runjs.app) | Inline results, minimalist UX, Dracula theme |
| [PlayCode Go](https://playcode.io/go-compiler) | Go execution, 3-panel layout, console with timestamps |
| [CodeSandbox](https://codesandbox.io) | Multi-file, file tree, tabs |
| [Pyodide](https://pyodide.org) | Python in WASM, micropip |
| [VS Code](https://code.visualstudio.com) | Monaco Editor, command palette, shortcuts |
| [open_yojob](internal) | Electron Forge config, Vite setup, Tailwind v4, security Fuses |

---

## Implementation Priority

```
1. MVP (Phase 1 + 2)        → Editor + JS/TS execution        → 4 weeks
2. Differentiator (Phase 3)  → Go + Python via WASM            → 3 weeks
3. Robustness (Phase 4)      → Rust + File system + permissions → 3 weeks
4. Polish (Phase 5)          → Advanced UX, themes, snippets    → 3 weeks
5. Ship (Phase 6)            → Distribution + web preparation   → 2 weeks
```

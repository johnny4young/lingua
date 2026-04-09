# RunLang — Product Plan

This document tracks the current state of RunLang, the feature roadmap, and the delivery backlog. It serves as the single source of truth for what is built, what is next, and what the product aspires to become.

---

## Vision

RunLang is a multi-language desktop code runner inspired by RunJS, PlayCode, and CodeSandbox. The goal is a unified, offline-capable code playground that goes beyond JS/TS to support systems languages (Go, Rust) via WebAssembly and scripting languages (Python) via in-browser runtimes — all with an elegant, instant-feedback UX.

**Core principles:**
- Instant feedback — results appear as you type, not after you click Run
- Multi-language — first-class support for JS, TS, Go, Python, Rust, and extensible via plugins
- Desktop-first — full filesystem, native compilation, real Node.js APIs — with a web fallback
- Beautiful — clean, focused UI that gets out of the way

---

## Current state (what is built)

### Infrastructure
- Desktop shell: Electron Forge + Vite (main, preload, renderer)
- Renderer: React 19, TypeScript, Monaco Editor, Zustand stores
- UI: Command palette, quick open, settings modal, resizable panels, macOS-native titlebar
- Web shell: browser adapter, File System Access API integration, service worker registration
- CI/CD: GitHub Pages web deploy, tagged release builds for macOS/Windows/Linux

### Language execution
- **JavaScript** — Web Worker, instant execution, per-line results via stack trace capture
- **TypeScript** — esbuild-wasm transpilation, then JS worker execution
- **Go** — IPC to main process, Go toolchain compiles to WASM, executed in worker
- **Python** — Pyodide (WASM CPython), persistent worker
- **Rust** — IPC to main process, native `rustc` compilation and execution
- **Lua** — Bundled plugin via Fengari (partial)

### Editor features (implemented)
- [x] Monaco Editor with custom themes (RunLang Dark, Dracula, One Dark Pro, Monokai, Solarized Light)
- [x] Split-panel layout: code (left) + results (right)
- [x] Per-line result alignment for dynamic languages (JS, TS, Python)
- [x] Full output view for compiled languages (Go, Rust)
- [x] Auto-run with 2-second debounce after typing stops
- [x] Magic comments for JS/TS and Python
- [x] Loop protection with configurable iteration limits for JS/TS and Python
- [x] Show/hide undefined toggle for dynamic language result panes
- [x] Scroll sync between editor and result panel
- [x] Tab system with language badges and dirty indicators
- [x] File tree with project management (open, create, rename, delete)
- [x] Console panel with log/info/warn/error filtering and ANSI color support
- [x] Template gallery (welcome screen with quick-start by language)
- [x] Snippet persistence with command-palette insertion hooks

### Delivery (implemented)
- [x] Release pipeline with signing placeholders (macOS notarization, Windows Authenticode)
- [x] Auto-update module with IPC bridge and renderer UI
- [x] Plugin system (manifest-driven local plugins with Lua as reference implementation)
- [x] Web build with Go/Rust gracefully stubbed

### Operational notes
- File-system watch IPC exists in main/preload, but the renderer does not yet subscribe to change events; external edits are not reflected automatically
- Monaco's TypeScript worker is loaded, but compiler options and richer diagnostics are not yet tuned to the execution environment
- The snippet data layer exists, but there is no dedicated snippet management UI yet

---

## Feature roadmap

Features are grouped into phases. Each phase builds on the previous and can ship independently. Phases are ordered by user impact and technical dependency.

### Phase 1: Live coding experience _(current focus)_

The core value proposition — making RunLang feel like a live coding scratchpad where you see what your code does instantly.

| Feature | Description | Languages | Priority | Status |
|---------|-------------|-----------|----------|--------|
| **Per-line results** | Show the value of each expression/statement next to the code line that produced it | JS, TS, Python | P0 | Done |
| **Auto-run** | Re-execute code automatically after 2s of no typing | All | P0 | Done |
| **Magic comments** | `//=>` / `#=>` comments that evaluate and display inline results | JS, TS, Python | P0 | Done |
| **Inline error indicators** | Show errors/warnings inline in the editor (red squiggly + gutter icon) with hover details | All | P0 | Planned |
| **Type checking (live)** | TypeScript language service runs continuously, surfacing type errors as diagnostics | JS, TS | P0 | Planned |
| **Expression results** | Show expression results without `console.log` | JS, TS, Python | P1 | Partial (final result path is implemented) |
| **Loop protection** | Halt infinite loops after configurable iteration count | JS, TS, Python | P1 | Done |
| **Show/hide undefined** | Toggle whether `undefined` results appear in the output panel | JS, TS | P2 | Done |

#### Magic comments — design notes

Inspired by RunJS's magic comments. When a comment starts with a special marker, the expression after it is evaluated and the result is displayed inline.

```javascript
const name = "RunLang";
name; //=> "RunLang"

[1, 2, 3].map(x => x * 2); //=> [2, 4, 6]

Math.PI; //=> 3.141592653589793
```

**Syntax:** `//=>` at the end of a line (or `#=>` for Python)
**Implementation:** Parse comments before execution, wrap target expressions to capture their values, map results back to source lines.
**Extensibility:** Each language runner defines its own magic comment prefix and expression-wrapping strategy.

#### Inline error indicators — design notes

Errors and warnings should appear:
1. **In the editor gutter** — red circle for errors, yellow triangle for warnings
2. **As underline decorations** — red squiggly under the offending code
3. **In the result panel** — error message aligned to the error line
4. **In the tab** — error/warning count badge

Sources of diagnostics:
- **TypeScript language service** — type errors, unused variables, unreachable code (JS/TS)
- **Runtime errors** — exceptions with line numbers from execution (all languages)
- **Compilation errors** — Go/Rust compiler output parsed for line:col (Go, Rust)
- **Linter output** — future integration point

---

### Phase 2: Developer experience

Features that make RunLang feel like a real development environment, not just a toy.

| Feature | Description | Languages | Priority | Status |
|---------|-------------|-----------|----------|--------|
| **Autocomplete** | Code suggestions while typing, powered by Monaco's IntelliSense + TypeScript language service | JS, TS | P0 | Partial (Monaco built-in) |
| **Hover info** | Show type information and documentation on symbol hover | JS, TS | P0 | Partial (Monaco built-in) |
| **Function signatures** | Show parameter hints while typing function calls | JS, TS | P1 | Partial (Monaco built-in) |
| **Go to definition** | Navigate to symbol definitions | JS, TS | P1 | Partial (Monaco built-in) |
| **Bracket colorization** | Color-matched brackets for readability | All | P2 | Done |
| **Format on save** | Auto-format code using Prettier (JS/TS), `gofmt` (Go), `rustfmt` (Rust), `black` (Python) | All | P1 | Planned |
| **Linting** | Live linting with ESLint (JS/TS), configurable rules | JS, TS | P2 | Planned |
| **Environment variables** | Define env vars accessible via `process.env` in execution context | JS, TS, Python | P2 | Planned |

#### Autocomplete and IntelliSense — design notes

Monaco already provides basic autocomplete for JS/TS via its built-in TypeScript worker. To make this production-quality:
1. **Configure Monaco's TypeScript worker** with `compilerOptions` matching our execution environment (ES2022, top-level await, DOM types)
2. **Add type definitions** for Node.js built-ins and browser APIs available in our worker context
3. **Integrate snippet completions** — user-saved snippets appear in the autocomplete list
4. **For non-JS languages** — provide keyword completions and (future) LSP integration

---

### Phase 3: Package management

The ability to install and use third-party packages makes RunLang useful for real experimentation.

| Feature | Description | Languages | Priority | Status |
|---------|-------------|-----------|----------|--------|
| **NPM package install** | Search, install, and import npm packages | JS, TS | P0 | Planned |
| **Package resolution** | Resolve and bundle imported packages for worker execution | JS, TS | P0 | Planned |
| **pip packages** | Install Python packages via Pyodide's micropip | Python | P1 | Planned |
| **Go modules** | `go get` integration for Go package imports | Go | P2 | Planned |
| **Cargo crates** | `cargo add` integration for Rust dependencies | Rust | P2 | Planned |
| **Package manager UI** | Dedicated panel for searching, installing, and managing packages | All | P1 | Planned |

#### NPM packages — design notes

**Approach (JS/TS):**
1. User opens package manager UI (Tools > Packages or Cmd+Shift+N)
2. Search npm registry API for packages
3. Install to a project-local `node_modules` or a shared RunLang package cache
4. For worker execution: use esbuild to bundle the import into the execution payload
5. For Electron context: packages are available via Node.js `require`

**Approach (Python):**
- Pyodide's `micropip.install("package")` handles pure-Python packages
- Pre-bundled packages available from Pyodide's package index

**Extensibility:** Each language defines a `PackageManager` interface:
```typescript
interface PackageManager {
  search(query: string): Promise<PackageInfo[]>;
  install(name: string, version?: string): Promise<void>;
  uninstall(name: string): Promise<void>;
  list(): Promise<InstalledPackage[]>;
}
```

---

### Phase 4: Snippets and productivity

| Feature | Description | Priority | Status |
|---------|-------------|----------|--------|
| **Snippet library** | Save, organize, and reuse code snippets with name + description + body | P0 | Partial (store exists, dedicated UI is missing) |
| **Snippet autocomplete** | Snippets appear in autocomplete suggestions matched by name | P1 | Planned |
| **Snippet import/export** | Import and export snippets as JSON for sharing | P2 | Planned |
| **Snippet context menu** | Right-click selected code > "Save as snippet" | P1 | Planned |
| **Tab title from code** | First line of code becomes the tab title (editable via right-click) | P2 | Planned |
| **Recent tabs** | Restore recently closed tabs | P2 | Planned |
| **Multi-cursor editing** | Edit multiple locations simultaneously | P2 | Done (Monaco built-in) |

#### Snippet library — design notes

**Storage:** Snippets are already persisted in a Zustand store with `persist` middleware.

**Schema:**
```typescript
interface Snippet {
  id: string;
  language: Language;
  label: string;
  description: string;
  code: string;
  createdAt: number;
}
```

**Current UI surface:** snippets are consumable from the command palette, but there is no dedicated library/editor panel yet.

---

### Phase 5: AI integration

| Feature | Description | Priority | Status |
|---------|-------------|----------|--------|
| **AI chat sidebar** | Context-aware coding assistant (knows current tab content) | P1 | Planned |
| **Code generation** | Generate code from natural language description | P1 | Planned |
| **Code explanation** | Select code > "Explain this" | P2 | Planned |
| **Error fix suggestions** | AI suggests fixes for runtime and type errors | P2 | Planned |
| **AI provider selection** | Support OpenAI, Anthropic, local models (Ollama) | P1 | Planned |

#### AI chat — design notes

**Architecture:** The AI sidebar is a React component that communicates with an AI provider via API. The current tab's code is included as context in every message.

**Provider abstraction:**
```typescript
interface AIProvider {
  id: string;
  name: string;
  chat(messages: ChatMessage[], context: CodeContext): AsyncIterable<string>;
  isConfigured(): boolean;
}
```

**Privacy:** API keys stored locally only. No code is sent to any service without explicit user action. Local model support (Ollama) provides a fully offline option.

---

### Phase 6: Appearance and accessibility

| Feature | Description | Priority | Status |
|---------|-------------|----------|--------|
| **Theme system** | Multiple editor themes with live preview | P0 | Done (5 themes) |
| **Custom themes** | Import custom Monaco themes | P2 | Planned |
| **Font selection** | Choose from pre-loaded fonts + custom font path | P1 | Partial (font family setting exists) |
| **Output syntax highlighting** | Syntax-highlight results in the output panel | P2 | Planned |
| **i18n / translation support** | Internationalized UI strings | P2 | Planned |
| **Keyboard shortcuts customization** | Rebindable keyboard shortcuts | P2 | Planned |
| **Activity bar** | Vertical sidebar with quick-access icons (run, snippets, settings, AI) | P1 | Planned |

#### i18n — design notes

**Approach:** Use `react-i18next` with JSON translation files. Start with English as the default locale. UI strings are extracted into `src/renderer/i18n/en.json`. Language selector in settings.

**Priority locales:** English, Spanish, Chinese (Simplified), Japanese, Korean, Portuguese.

---

### Phase 7: Node.js and Browser API access

RunLang should provide a hybrid execution environment that combines Node.js APIs with browser APIs — similar to RunJS but extended to all supported languages.

| Feature | Description | Languages | Priority | Status |
|---------|-------------|-----------|----------|--------|
| **DOM access** | Full DOM manipulation via `document`, `window` in a sandboxed iframe | JS, TS | P1 | Planned |
| **Node.js built-ins** | `fs`, `path`, `http`, `crypto`, etc. available in execution context | JS, TS | P1 | Planned |
| **Web APIs** | `fetch`, `WebSocket`, `Web Audio`, `Canvas`, `localStorage` | JS, TS | P1 | Partial (fetch works) |
| **Preview pane** | Live HTML/CSS preview for DOM manipulation results | JS, TS | P2 | Planned |
| **Python stdlib** | Python standard library available via Pyodide | Python | P1 | Done |

#### Hybrid runtime — design notes

**JS/TS execution modes:**
1. **Worker mode** (current) — isolated Web Worker, no DOM, limited APIs. Fast and safe.
2. **Iframe mode** (planned) — sandboxed iframe with full DOM and browser APIs. Needed for visual output.
3. **Node mode** (planned, desktop only) — execution via Electron's Node.js context. Full Node.js API access.

The user can select the execution mode per tab or let RunLang auto-detect based on imports.

---

## Infrastructure backlog (unchanged from prior plan)

### Release pipeline hardening
- [ ] Validate the full tagged-release path in GitHub Actions with real secrets

### Auto-update
- [ ] Validate packaged update behavior against the chosen release channel

### Signed publishing readiness
- [ ] Verify macOS signing identity and notarization flow in CI
- [ ] Verify Windows signing flow in CI

### Plugin productization
- [x] Plugin registry, manifest format, API versioning, local discovery — all complete
- Future: Broader extension model if product requirements expand

### Web build
- [x] GitHub Pages deployment working
- [x] Go/Rust stubbed with clear messaging

## Recommended engineering workstreams

### P0
- [ ] Wire file watching end-to-end in the renderer, or remove the remaining watch expectations from product language until it is real
- [ ] Configure Monaco's TypeScript/JavaScript defaults to surface diagnostics that match the runtime model
- [ ] Add a documented UI smoke-test path to contributor workflows and keep it green alongside lint/typecheck/tests

### P1
- [ ] Split oversized renderer modules (`FileTree`, `CodeEditor`, `CommandPalette`, `projectStore`) into smaller units with narrower responsibilities
- [ ] Turn snippet persistence into a complete feature with creation, editing, and browsing UI
- [ ] Rework the toolbar language selector so "create file in language X" is explicit instead of piggybacking on a dropdown change

### P2
- [ ] Migrate Vite-facing Node config usage away from the deprecated CJS Node API path
- [ ] Revisit settings surface area and hide or defer controls that are not yet visibly wired

---

## Milestone schedule

### Milestone 6: Live coding polish (Phase 1 completion)
- [x] Magic comments (`//=>`) for JS/TS
- [x] Magic comments (`#=>`) for Python
- [ ] Inline error indicators (gutter icons + squiggly underlines)
- [ ] Live TypeScript type checking via Monaco's TS worker
- [ ] Broaden expression result display beyond the current final-result path
- [x] Loop protection (configurable iteration limit)
- [x] Error details in result panel
- [ ] Error line highlighting in the editor/result gutter

### Milestone 7: Developer experience (Phase 2)
- [ ] Configure Monaco TypeScript worker with proper compiler options
- [ ] Add Node.js and DOM type definitions to TypeScript context
- [ ] Format on save (Prettier for JS/TS)
- [ ] Environment variables panel

### Milestone 8: Package management (Phase 3)
- [ ] NPM package search UI
- [ ] NPM package install + esbuild bundling for worker
- [ ] Python micropip integration
- [ ] Package manager panel in sidebar

### Milestone 9: Snippets (Phase 4)
- [x] Snippet store with CRUD operations
- [ ] Snippet library panel
- [ ] Snippet autocomplete integration
- [ ] Snippet import/export

### Milestone 10: AI integration (Phase 5)
- [ ] AI provider abstraction
- [ ] AI chat sidebar with code context
- [ ] OpenAI and Anthropic provider implementations
- [ ] Local model support (Ollama)

### Milestone 11: Appearance and i18n (Phase 6)
- [ ] Custom theme import
- [ ] i18n framework setup
- [ ] Initial translations (ES, ZH, JA, KO, PT)
- [ ] Keyboard shortcuts customization

### Milestone 12: Hybrid runtime (Phase 7)
- [ ] Sandboxed iframe execution mode for DOM access
- [ ] Node.js execution mode (desktop only)
- [ ] Execution mode selector per tab
- [ ] HTML/CSS preview pane

---

## Operating defaults

- Treat this document as an operational status file
- Describe only implemented behavior as current capability
- Record speculative ideas only when they are concrete backlog items
- Keep product claims conservative when a feature is only partially wired
- Every feature must be designed with multi-language extensibility in mind — not just JS/TS
- Each language runner can implement a subset of features (e.g., magic comments for JS but not Go)

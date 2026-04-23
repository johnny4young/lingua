# Capability matrix

This document records where each capability in Lingua runs today and what
execution class is recommended going forward. It exists so the team does not
commit to a "WASM-first everywhere" migration slogan without evidence that
each flow benefits from it. **Do not start a WASM-first migration for any
runtime or shell feature before updating this matrix and getting the change
reviewed.**

This is an **explanation and decision-record** document. Related reading:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) for the project-lifecycle and IPC
  file-system contract
- [`PLAN.md`](./PLAN.md) item **RL-030** for the originating acceptance
  criteria
- [`README.md`](../README.md) for a user-facing summary of what runs where

## Execution classes

The matrix below rates each capability against these five classes:

1. **Browser WASM** — compiled code (Pyodide, esbuild-wasm, TinyGo output,
   etc.) that runs inside the renderer's Web Worker or the browser main
   thread. No host process, no filesystem by default.
2. **Browser interpreter** — pure-JS evaluation in the renderer worker
   (today's `js-worker` running transpiled JS or raw JS source). Benefits
   from Monaco and AST-level instrumentation (loop protection, magic
   comments) for free.
3. **WebContainer** — an in-browser Node.js (StackBlitz) or equivalent that
   exposes a full POSIX-ish shell to the browser. Experimental; heavy
   download; licensed under third-party terms.
4. **Desktop native** — a child process spawned by Electron main (`go
   build`, `rustc`, `gofmt`, `rustfmt`, OS file watchers, OS update
   channel). Requires the user to have the toolchain installed and the
   desktop app running.
5. **Hybrid** — the capability picks between the classes above at runtime
   based on platform detection (`window.lingua.platform`), explicit user
   choice, or both. Must always degrade honestly when the preferred class is
   unavailable.

## Rating legend

| Rating  | Meaning                                                  |
|---------|----------------------------------------------------------|
| **Primary**   | The current shipping default for that execution class |
| **Shipping**  | Implemented and behind a flag or secondary path      |
| **Stub**      | Only the "not available" messaging is wired         |
| **Research**  | Investigated but not implemented                     |
| **Out**       | Not a fit and not being pursued                      |

## Runtime matrix

| Capability            | Browser WASM  | Browser interpreter | WebContainer | Desktop native | Hybrid | Recommended class | Notes |
|-----------------------|---------------|---------------------|--------------|----------------|--------|-------------------|-------|
| JavaScript execution  | Out           | **Primary**         | Research     | Research       | —      | Browser interpreter | `src/renderer/runners/javascript.ts` runs transpiled code in `js-worker`; loop protection and magic comments are AST-instrumented at the source level, which a WASM execution path cannot replicate without losing those features |
| TypeScript execution  | **Primary** (transpile) | **Primary** (execute) | Research | Research | Hybrid today | Browser interpreter with WASM transpile | `src/renderer/runners/typescript.ts` uses `esbuild-wasm` for transpile and then delegates to the JS interpreter path. No reason to move execution off the worker |
| Python execution      | **Primary**   | Out                 | Out          | Research       | —      | Browser WASM | Pyodide WASM worker ships in both web and desktop. A desktop-native CPython path is worth researching for `pip` support but today's Pyodide path covers the common case |
| Go execution          | Shipping      | Out                 | Research     | **Primary** (compile) + WASM (run) | **Hybrid** | Hybrid | `src/renderer/runners/go.ts` compiles Go via `go build` in the main process (`go:compile` IPC) and runs the resulting WASM in a worker. Web build degrades honestly via the stub in `src/web/adapter.ts` |
| Rust execution        | Research      | Out                 | Out          | **Primary**   | —      | Desktop native | `src/main/rust-compiler.ts` uses `rustc` + native subprocess. Browser-WASM compile-and-run for Rust (wasm-pack style) is tracked as a future research item, not a current migration target |
| Lua execution         | Out           | Shipping            | Out          | **Primary** (plugin discovery gate) | **Hybrid** | Hybrid | `src/renderer/plugins/lua-runner.ts` executes Lua through Fengari, which is a pure-JS interpreter rather than WASM. The runtime is bundled, but it only activates after desktop plugin discovery loads a local `lua` manifest, so web does not ship Lua execution today |

## Shell-feature matrix

| Capability             | Browser WASM | Browser interpreter | WebContainer | Desktop native | Hybrid | Recommended class | Notes |
|------------------------|--------------|---------------------|--------------|----------------|--------|-------------------|-------|
| Filesystem access      | Out          | Out                 | Research     | **Primary**    | **Hybrid** | Hybrid (FSA API in web, IPC in desktop) | Desktop goes through `src/main/ipc/fileSystem.ts`; web uses the File System Access API via `src/web/fs-adapter.ts`. Both land on the same `window.lingua.fs.*` contract, but only desktop enforces the explicit blocked-path guard because the browser backend is already constrained to user-granted handles. Moving desktop to a WASM sandbox would lose ergonomic features like `fs.rename` / `fs.watchStart` |
| File watching          | Out          | Out                 | Out          | **Primary**    | —      | Desktop native | Uses Node's `fs.watch` through the main process. Browsers have no equivalent API; watchers gracefully no-op on web |
| Updates                | Stub         | Stub                | Out          | **Primary**    | —      | Desktop native | `src/main/updater.ts` uses electron-updater's GitHub feed. Web build exposes an `unavailable` stub through `src/web/adapter.ts` |
| Plugin discovery/load  | Stub         | Stub                | Research     | **Primary**    | —      | Desktop native with a bundled allowlist | `src/main/plugins.ts` loads from disk via IPC. Plugins from untrusted sources would need a sandbox story before any WebContainer migration |
| Deep-link protocol     | Out          | Out                 | Out          | **Primary**    | —      | Desktop native | `lingua://` protocol (see RL-040). Browsers cannot register custom protocols for the PWA without OS-level install |
| Local AI inference     | Research     | Out                 | Out          | Research       | Research | Hybrid (undecided) | Tracked in RL-031. Browser WASM via transformers.js or webllm is viable for tiny models; larger models need desktop native with a local runtime (Ollama, llama.cpp). Decision pending a dedicated spike |
| Formatter binaries     | Out          | Out                 | Research     | **Primary**    | —      | Desktop native for gofmt / rustfmt / Python; browser interpreter for Prettier | Desktop spawns gofmt, rustfmt, and Python formatters (`ruff format -` preferred, `black --quiet -` fallback) via `src/main/formatters.ts`. Prettier runs in the renderer via `prettier/standalone` for JS / TS / JSON / CSS in both web and desktop |

## Per-capability decision record

### JavaScript and TypeScript
- **Stay on the browser interpreter.** The worker path owns loop protection,
  magic comments, and the `//=>` inline-result decorations. Moving to a
  WASM-native runtime (QuickJS WASM, etc.) would require porting the
  instrumentation layer and losing Monaco-level error spans.
- **esbuild-wasm stays as the transpiler.** TypeScript support rides on
  `esbuild-wasm` because it is portable and produces worker-friendly JS.

### Python
- **Browser WASM via Pyodide stays Primary.** Works in both shells; avoids
  a Python toolchain requirement on desktop.
- **Desktop-native CPython remains a research target**, only interesting if
  users demand arbitrary `pip install` beyond `micropip`. This pairs with
  RL-025 Phase B and should not begin before that item moves.

### Go
- **Hybrid is correct and should stay.** Compiles via `go build GOOS=js
  GOARCH=wasm` in the desktop main process, then runs the resulting WASM
  in a renderer worker — so execution is web-portable once compile has
  happened on a host that has Go installed.
- **Web build degrades honestly** with the stub in `src/web/adapter.ts`.
  Do not promise Go execution in pure-web without a browser-side compiler
  (not viable today).

### Rust
- **Desktop native stays Primary.** `rustc` is needed for compile, and the
  toolchain is too heavy to ship as a WASM blob.
- **Browser WASM compile-and-run** (via `rustc`'s wasm backend or similar)
  is a Future-priority experiment, not a current migration target.

### Filesystem access
- **Hybrid is correct and should stay.** One contract (`window.lingua.fs.*`)
  maps to different backends — IPC on desktop, File System Access API on
  web. Desktop applies the explicit blocked-path guard in
  `src/main/ipc/fileSystem.ts`, while web remains sandboxed to the handles
  the user granted through `src/web/fs-adapter.ts`.
- **Do not chase "WASM-first filesystem".** A WASM sandbox would force us
  to ship a virtual filesystem on desktop and give up ergonomic features.

### File watching
- **Desktop native only.** Browsers lack a native watch API, and polling
  substitutes would drain battery and break the project-index sync story.
- **Web gracefully no-ops.** The adapter returns a dummy unsubscribe.

### Updates
- **Desktop native only.** `electron-updater` + GitHub releases.
- **Web is explicitly "unavailable".** The UI surfaces that through the
  existing `UpdateState.status === 'unavailable'` branch.

### Plugin discovery / loading
- **Desktop native is the default, bundled plugins only.** `src/main/plugins.ts`
  reads a constrained directory.
- **Untrusted plugin loading is out** until a sandbox story exists. Any
  future WebContainer migration must solve `PluginInstallStatus ===
  'invalid' | 'incompatible'` guardrails with equivalent rigor.

### Lua
- **Do not describe Lua as a web-shipping runtime yet.** The execution engine
  is the bundled Fengari JS interpreter, but activation still depends on the
  desktop plugin discovery path loading a local `lua` manifest.
- **Treat the current state as hybrid/gated.** The interpreter itself is
  portable, yet the product surface is still constrained by the conservative
  local-plugin model documented in `README.md`.

### Local AI inference (RL-031 spike)
- **Decision deferred.** Write this back into the matrix once the RL-031
  spike produces measurements. The likely landing spot is a **hybrid**
  class: tiny transformers.js models in the browser for web parity, with
  an Ollama / llama.cpp desktop path for larger models.

## Promotion rules

A capability only moves to a WASM-first stance when at least one of these
is true:

1. **Portability win** — the feature becomes available on web without a
   honest-degradation stub (as Pyodide did for Python).
2. **Privacy win** — user data stops crossing a process or network boundary
   (as the future local-AI story may offer).
3. **Maintainability win** — the hybrid split is producing meaningfully more
   bug surface than a single path would (not the case for filesystem today;
   is arguably the case for future AI inference).

Missing all three, the desktop-native or browser-interpreter path stays.

## Review log

| Date       | Reviewer         | Change                                    |
|------------|------------------|-------------------------------------------|
| 2026-04-17 | RL-030 drafters  | Initial matrix and decision records landed |

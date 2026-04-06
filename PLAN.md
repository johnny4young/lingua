# RunLang Project Status

This document tracks the current state of the repository, the main documentation and architecture drift that has accumulated, and the backlog that still matters. It is not the original implementation roadmap anymore.

## Current state

RunLang is already a working multi-language code runner with both desktop and web entry points.

- Desktop shell: Electron Forge with Vite-based main, preload, and renderer builds
- Renderer: React 19, TypeScript, Monaco Editor, Zustand stores, command palette, quick open, settings, and resizable layouts
- Language execution:
  - JavaScript and TypeScript via renderer workers
  - Go via desktop IPC compilation to WebAssembly using a local Go toolchain
  - Python via Pyodide
  - Rust via desktop IPC native compilation and execution using `rustc`
- File system support: open directory, browse tree, read, write, create, rename, delete, and file watching through the preload bridge
- Web support: separate browser entry point with a web filesystem adapter and desktop-only stubs for Go and Rust
- Verification status: the repository currently passes linting, tests, and TypeScript type checking
- Delivery:
  - CI runs type check, lint, tests, and a non-blocking audit
  - GitHub Pages deploys the web build after successful `main` branch CI
  - Tagged releases build desktop packages and publish to GitHub Releases

## Documentation and architecture drift

The repository had a large mismatch between the previous planning document and the implemented code. The main confirmed issues were:

1. Stack versions in the old plan no longer matched `package.json`.
   - The prior document described Electron 40, TypeScript 5.9, Vite 7, and Vitest 4.
   - The current repository uses Electron 41.1.0, TypeScript 5.7.x, Vite 5.4.x, and Vitest 3.x.

2. The old folder structure description was partially stale.
   - Some listed files no longer exist exactly as described.
   - Some implemented areas, such as the web adapter split and plugin example support, were missing or underspecified.

3. Keyboard shortcut documentation was wrong.
   - The previous docs listed `Cmd/Ctrl+J` for toggling the console.
   - The current implementation uses `Cmd/Ctrl+\`.

4. The README referenced a screenshot asset that does not exist in the repository.

5. The old phase-based roadmap still marked large portions of the implemented application as pending.
   - Base scaffolding, editor integration, resizable layout, settings, runners, IPC filesystem support, tests, web build, and release workflows are already present.

6. Plugin support exists as infrastructure, but not as a fully generalized product feature.
   - There is a plugin registry and a Lua example runner stub.
   - The main type system and editor flow still center on the built-in language union.
   - This means plugin support should be described as partial infrastructure, not as finished extensibility.

## Real backlog

These are the meaningful pending areas that still deserve engineering attention.

### Documentation and maintenance

- Keep README shortcuts, commands, and workflow descriptions synchronized with code and GitHub Actions
- Preserve this file as current state plus backlog rather than letting it drift back into speculative roadmap writing
- Add or automate doc consistency checks if documentation drift becomes recurrent

### Plugin productization

- Decide whether plugins are a real product goal or only internal/example infrastructure
- If plugins become first-class, generalize language handling across editor state, file detection, runner selection, and UI affordances
- Replace the Lua stub path with either a documented example-only posture or a fully supported plugin lifecycle

### Web build hardening

- Verify that the web build remains correct for the intended GitHub Pages hosting mode, including asset base-path behavior
- Continue keeping desktop-only behavior explicit in the browser experience for Go and Rust

### Execution and UX polish

- Continue improving user-facing feedback around runtime initialization, toolchain detection, and execution failures
- Expand tests when new runner states, shortcuts, or filesystem behaviors are added

## Operating defaults

- Treat this document as an operational status file
- Describe only implemented behavior as current capability
- Record speculative ideas only when they are concrete backlog items
- Keep product claims conservative when a feature is only partially wired

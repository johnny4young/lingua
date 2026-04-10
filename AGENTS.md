# AGENTS.md

## Skill routing

- Default to `typescript-react-reviewer` for future implementation work in this repository unless the task is clearly outside renderer or React/TypeScript scope.
- Use `typescript-react-reviewer` for renderer React code, hooks, Zustand stores, editor UI, and general renderer architecture review.
- Use `node` for Electron main/preload code, IPC handlers, Vite or Forge configuration, workers, and local toolchain integration.
- Use `documentation` for README, PLAN, and other documentation synchronization work.
- Use `init` when updating this file.

## Landmines

- Do not describe plugin support as a finished user-facing extension system until language typing and UI flows are generalized beyond the built-in language set.
- If a change touches shortcuts, execution behavior, or workflow behavior, update the related documentation in the same change.
- Treat `PLAN.md` as the current-state and backlog document for this repository, not as a speculative roadmap.

## UI validation

- Unless the task explicitly asks for Electron desktop behavior, start with a local web preview flow for renderer/UI validation because it is faster and easier to automate.
- Switch to Electron validation when the task depends on desktop-only behavior such as native Go/Rust execution, local plugin discovery, packaged update behavior, or Electron-specific window/runtime behavior.
- For direct renderer/UI validation, prefer the web build: `npm run build:web`, then `npm exec vite preview -- --config vite.web.config.ts --host 127.0.0.1 --port 4173`.
- Drive that preview with the Playwright CLI wrapper at `/Users/johnny4young/.codex/skills/playwright/scripts/playwright_cli.sh`, reuse a named session, and save artifacts under `output/playwright/`.
- Treat that flow as coverage for renderer behavior only; desktop-only paths such as native Go/Rust execution, packaged auto-updates, and local plugin discovery still require targeted desktop validation.
- For Electron desktop validation, prefer `npm run desktop:dev`. It starts the renderer dev server on the URL expected by the current desktop bundle, launches Electron, and shuts the local server down when Electron exits.
- If `src/main` or `src/preload` changed and the existing `.vite/build` bundle may be stale, use `npm run desktop:dev:sync`. That regenerates `.vite/build/main.js` and `.vite/build/preload.js` once via `esbuild`, then launches the app without going through `electron-forge start`.
- `npm run desktop:dev -- --reuse-server` is allowed when a matching renderer dev server is already running and should be kept alive after Electron closes. Without `--reuse-server`, the script manages its own server lifecycle.
- For automated desktop smoke runs, `npm run desktop:dev -- --exit-after-ms 4000` is the simplest way to guarantee Electron closes and the owned local server is cleaned up.
- A working desktop automation path is still Playwright Electron: launch the app from the repo root with `_electron.launch({ args: ['.'] })` after the desktop launcher has brought up the renderer URL, then save artifacts under `output/playwright/`.

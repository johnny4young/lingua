# AGENTS.md

## Routing

- Default to `typescript-react-reviewer` for future implementation work in this repository unless the task is clearly outside renderer or React/TypeScript scope.
- Use `node` for Electron main/preload code, IPC handlers, Vite or Forge configuration, workers, and local toolchain integration.
- Use `init` when updating this file.

## Landmines

- Do not describe plugin support as a finished user-facing extension system until the typing and UI flows go beyond the built-in language set.
- If a change touches shortcuts, execution behavior, or workflow behavior, update the related docs in the same change.
- Treat `PLAN.md` as the local current-state/backlog document, not as a speculative roadmap.

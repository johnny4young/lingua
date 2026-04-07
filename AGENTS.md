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

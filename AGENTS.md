# AGENTS.md

Canonical guidance for any agent (Claude Code, Cursor, Codex, Aider,
Cline, etc.) working in this repository. `CLAUDE.md` at the repo root is
a symlink to this file so Claude Code's auto-loader picks it up
transparently — edit this file, not the symlink.

## Read on arrival

Before making non-trivial changes, open these files (in order):

1. This file — routing, skill preferences, landmines, UI validation,
   commit rules.
2. `PLAN.md` — current backlog, RL-XXX status, and execution order.
   Never invent plan items; reference the existing RL numbering.
3. `ARCHITECTURE.md` — project lifecycle, IPC filesystem bridge, and
   watch-state model.
4. `CAPABILITY_MATRIX.md` — which execution class (browser WASM, browser
   interpreter, WebContainer, desktop native, hybrid) owns each
   capability today. Do not propose WASM-first migrations outside the
   promotion rules there.
5. `src/renderer/README.md` — renderer folder map and state ownership.

## Routing

- Default to `typescript-react-reviewer` for future implementation work in this repository unless the task is clearly outside renderer or React/TypeScript scope.
- Use `node` for Electron main/preload code, IPC handlers, Vite or Forge configuration, workers, and local toolchain integration.
- Use `init` when updating this file.

## Landmines

- Do not describe plugin support as a finished user-facing extension system until the typing and UI flows go beyond the built-in language set.
- If a change touches shortcuts, execution behavior, or workflow behavior, update the related docs in the same change.
- Treat `PLAN.md` as the local current-state/backlog document, not as a speculative roadmap.

## UI verification preference order

When a change needs to be verified visually, pick the cheapest path
first:

1. **Isolated React component or static HTML artifact** → embedded
   preview. Zero overhead, no server, no Chrome instance.
2. **Web build end-to-end** (`dist/web` or `npm run preview:web`) →
   Playwright MCP with a persistent Chrome instance. Prefer
   `browser_snapshot` over screenshots — DOM snapshots cost ~1–3k
   tokens vs. ~5–15k for a PNG, and the DOM stays queryable.
3. **Electron surfaces that need main + IPC + renderer together** →
   `npm run desktop:smoke` (it writes artifacts under
   `output/playwright/desktop-smoke` and exercises JS, TS, Python, Go,
   and Rust in the real desktop shell) or Playwright Electron. Only
   reach for MCP `computer-use` when a flow genuinely can't be
   scripted — it's the most expensive tier in tokens and time.
4. Avoid raw screenshot + click-by-pixel flows. They are a last resort
   for native targets with no scriptable alternative.

Corollary: when the change is purely backend, internal, or covered by
unit tests, skip UI verification entirely.

## Workflow conventions

- Run `npm test -- --run`, `npx tsc --noEmit`, `npm run lint`,
  `npm run check:i18n`, and `npm run check:i18n:copy` before declaring
  a slice done. The `check:i18n` guards catch untranslated keys and
  hardcoded renderer copy.
- Web builds: `npm run build:web`. Desktop dev: `npm run desktop:dev`.
- Keep scope tight. If a review surfaces something out of scope, flag
  it in `PLAN.md` rather than expanding the current slice.

## Commit attribution — no AI co-authorship

Never add AI co-authorship trailers to commits or PR descriptions
produced in this repo — no `Co-Authored-By: Claude …`, no
`Generated with Claude Code` watermarks, no footers, no signatures.
Applies to every surface: `git commit -m`, heredoc bodies,
`git commit --amend`, `gh pr create`, `gh pr edit`, rebase/squash
messages, and `COMMIT_EDITMSG` files.

Only add attribution if the user explicitly requests it in the same
turn. Implicit or past permissions do not carry over.

## Commit message style

Conventional Commits. No double-quotes and no backticks in commit
messages — they break the heredoc the maintainer uses to commit. Use
hyphen bullets for the body when listing changes.

Scope examples: `feat(settings): …`, `fix(main): …`,
`refactor(licensing): …`, `docs(plan): …`, `test(shared): …`.

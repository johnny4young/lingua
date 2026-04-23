# AGENTS.md

Canonical guidance for any agent (Claude Code, Cursor, Codex, Aider,
Cline, etc.) working in this repository. `CLAUDE.md` at the repo root is
a symlink to this file so Claude Code's auto-loader picks it up
transparently — edit this file, not the symlink.

## Read on arrival

Before making non-trivial changes, open these files (in order). The
three planning files in `docs/` are intentionally split by cost —
load the cheapest one that answers your current question, not
`PLAN.md` by default. **All planning state lives in `docs/*.md`
committed to git; do not rely on `.claude/plans/*` or any other
machine-local state.**

1. This file — routing, skill preferences, landmines, UI validation,
   commit rules.
2. `docs/ROADMAP.md` — canonical `Status` + priority for every
   `RL-XXX`. The cheapest planning doc and the first one you read
   when deciding what to pick next. Never invent new RL ids.
3. `docs/SPRINT-PLAN.md` — per-commit execution detail for the
   currently-active iters. Read this when executing an approved iter.
4. `docs/PLAN.md` — deep scope + acceptance criteria + historical
   reasoning. Large; load a single `### RL-XXX` section via grep,
   not the whole file. When this and ROADMAP disagree on status,
   ROADMAP wins.
5. `docs/BACKLOG.md` — pre-commitment raw ideas. Read when capturing
   something new; never pick implementation work from here.
6. `docs/ARCHITECTURE.md` — project lifecycle, IPC filesystem bridge,
   and watch-state model.
7. `docs/CAPABILITY_MATRIX.md` — which execution class (browser WASM,
   browser interpreter, WebContainer, desktop native, hybrid) owns
   each capability today. Do not propose WASM-first migrations
   outside the promotion rules there.
8. `src/renderer/README.md` — renderer folder map and state ownership.

## Routing

- Default to `typescript-react-reviewer` for future implementation work in this repository unless the task is clearly outside renderer or React/TypeScript scope.
- Use `node` for Electron main/preload code, IPC handlers, Vite or Forge configuration, workers, and local toolchain integration.
- Use `init` when updating this file.

## Landmines

- Do not describe plugin support as a finished user-facing extension system until the typing and UI flows go beyond the built-in language set.
- If a change touches shortcuts, execution behavior, or workflow behavior, update the related docs in the same change.
- Treat `docs/ROADMAP.md` as the local current-state/backlog document, not as a speculative roadmap. `docs/PLAN.md` is deep reference only.

## UI verification — MANDATORY when the diff touches user-facing surfaces

**Hard rule**: any change that touches a React component, a Settings
section, a status notice, a keyboard shortcut, an i18n copy string, or
any other user-facing surface MUST be verified in a running app before
the slice is declared done. Tests passing is necessary but not
sufficient — they do not catch runtime render errors, Tailwind class
collisions, store rehydration timing, or i18n interpolation bugs.

Order of preference:

1. **Isolated React component or static HTML artifact** → embedded
   preview. Zero overhead, no server, no Chrome instance.
2. **Web build end-to-end** (`npm run preview:web`, port 4173) →
   Playwright MCP with a persistent Chrome instance. This is the
   default for any renderer-side slice. Use `browser_snapshot` over
   screenshots (DOM snapshots cost ~1–3k tokens vs. ~5–15k for a PNG
   and stay queryable). Always end the pass with
   `browser_console_messages({ level: 'error' })` — zero errors is
   the gate.
3. **Electron shell** (fallback when the slice only works in desktop
   — IPC handlers that have no web stub, `crashReporter` boot,
   `protocol.registerFileProtocol`, etc.) → `npm run smoke:desktop`
   (writes artifacts under `output/playwright/desktop-smoke` and
   exercises JS, TS, Python, Go, and Rust in the real desktop shell)
   or Playwright Electron. Only reach for MCP `computer-use` when a
   flow genuinely can't be scripted — it's the most expensive tier in
   tokens and time.
4. Avoid raw screenshot + click-by-pixel flows. Last resort for
   native targets with no scriptable alternative.

Minimum smoke pass for a renderer-side slice:

- Start `npm run preview:web` in background, navigate to
  `http://localhost:4173/`.
- Open the surface the slice touched. Exercise the happy path plus
  the primary error path.
- Flip `lingua-settings.language` to `es`, reload, re-exercise — at
  least confirm the changed strings render without missing keys.
- Assert `browser_console_messages({ level: 'error' })` is 0 at the
  end of the pass.
- Kill the preview server before closing out.

Skip UI verification only when ALL of these are true: the diff is
purely main-process IPC with no renderer effect, purely a shared
helper with component-test coverage, purely a doc/ADR/test change, or
purely a dependency bump with no behavior delta. When in doubt, run
the web smoke. The token cost is small; a shipped runtime bug is
larger.

Corollary: if the slice CAN'T be validated via web (it's Electron
main-only or needs IPC shapes the web adapter stubs out), fall
through to Electron smoke. Never skip both tiers silently.

## Workflow conventions

- Run `npm test -- --run`, `npx tsc --noEmit`, `npm run lint`,
  `npm run check:i18n`, and `npm run check:i18n:copy` before declaring
  a slice done. The `check:i18n` guards catch untranslated keys and
  hardcoded renderer copy.
- Web builds: `npm run build:web`. Desktop dev: `npm run dev:desktop`.
- Keep scope tight. If a review surfaces something out of scope, flag
  it in `docs/PLAN.md` rather than expanding the current slice.

## Testing Pro / paid mode locally

Lingua has no hardcoded "flip to Pro" switch by design — the renderer
only trusts an Ed25519-signed license token verified against a public
key embedded at build time. To exercise Pro-gated UI without the real
issuer, the repo ships two helpers that mint a throwaway keypair +
token for the session.

### Fast path — web: `npm run dev:web:pro`

One command starts Vite on `http://localhost:5174` with a fresh dev
public key injected into `VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` and
prints a signed token to the terminal.

```bash
npm run dev:web:pro               # tier=pro, valid 30 days
npm run dev:web:pro -- --tier team --days 7
```

Copy the token printed in the terminal → open the running app →
**Settings → License → "Paste a license token"** → Apply. The status
pill flips to `Active · pro` and `useEntitlement(...)` returns true
everywhere.

Revert: click **Remove license** in the same row, or
`localStorage.removeItem('lingua-license')` + reload. Stopping the
dev server discards the keypair; any previously-applied token becomes
invalid on the next restart.

### Fast path — desktop: `npm run dev:desktop:pro`

One command mints a fresh dev public key + token, injects the public
key into the managed desktop launcher, and prints the token you can
paste into Settings → License.

```bash
npm run dev:desktop:pro
npm run dev:desktop:pro -- --tier team --days 7
npm run dev:desktop:pro -- --sync-main --exit-after-ms 4000
```

Copy the token printed in the terminal → open the running desktop app
→ **Settings → License → "Paste a license token"** → Apply. The
status pill flips to `Active · pro` and `useEntitlement(...)` returns
true everywhere.

### Data path — `scripts/mint-dev-license.mjs`

Use this when you need the key and token as data (e.g. desktop-dev,
CI smoke, scripted tests). End-to-end coverage lives in
`tests/scripts/mintDevLicense.test.ts`.

1. Mint the keypair + token:

   ```bash
   node scripts/mint-dev-license.mjs --tier pro --days 7 \
     --issued-to you@local > dev-license.json
   ```

2. Export the public key before starting the target:

   ```bash
   export VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK="$(jq -r .publicKeyJwk dev-license.json)"
   npm run dev:desktop    # or: npm run dev:web
   ```

3. In the running app open **Settings → License** and paste the `token`
   field from `dev-license.json`.

Notes:

- The keypair is session-scoped. Once the dev server stops, the
  private key is gone — mint again for the next session.
- `--days 0` leaves no remaining support window so you can smoke
  grace/expiry handling without waiting days for the window to lapse.
- **Do not commit** `dev-license.json`, and never paste the private
  key (`privateKeyJwkDoNotShip`) into the app.
- Tests mint throwaway tokens in-process via
  `tests/__fixtures__/license.ts` — never import that module from app
  code.

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

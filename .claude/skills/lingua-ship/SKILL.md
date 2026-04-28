---
name: lingua-ship
description: This skill should be used when the user asks to "implement the next pending step", "work the next iter", "pick the next ticket", "ship the next slice", "continue where we left off", "implementa la próxima iter", "trabaja el siguiente RL", or anything that maps to advancing an RL-XXX ticket from docs/ROADMAP.md. Phase 1 picks one ticket and proposes a plan; STOPS for approval; Phase 2 executes end-to-end with all gates green and stages a single diff. Never runs git commit. Inline-fixes collateral bugs.
---

# Lingua Ship

Two-phase ticket workflow for the Lingua repo: plan, wait for
approval, execute one ticket end-to-end with everything staged for the
human to commit. The agent never runs `git commit`.

All planning state lives in git under `docs/*.md`. Do not rely on
`.claude/plans/*` or any other machine-local store.

## Sources of truth (read in this order)

1. `AGENTS.md` (CLAUDE.md is a symlink) — operational conventions, UI
   verification gate, copy style, commit attribution policy.
2. `docs/ROADMAP.md` § 4 — canonical RL-XXX status table. Cheapest
   planning doc; first to read when picking a ticket.
3. `docs/SPRINT-PLAN.md` — per-commit execution detail for the active
   iters.
4. `docs/PLAN.md` — deep reference. Large; load a single
   `### RL-XXX` section via grep. ROADMAP wins on Status conflicts.
5. `docs/BACKLOG.md` — pre-commitment ideas. Never pick implementation
   work from here.
6. `docs/README.md` — index of how the planning docs split.

## Git policy

The single mutating git command authorised is `git add <paths>`.
Read-only git (`status`, `diff`, `log`, `show`, `blame`) is
unrestricted.

Never run `git commit`, `git reset`, `git restore`, `git checkout`
against modified files, or hook-skipping flags. Full rules and
rationale in **`references/git-policy.md`**.

## Inline-fix policy (no threshold)

If a real observable bug surfaces during Phase 2 — broken gate, stale
import, forgotten dep, broken non-ticket test, config drift — fix it
inline. No line / file threshold. Add the paths to the same `git add`
and flag the fix as `Prerequisite fix` in the report and the suggested
commit message.

`docs/BACKLOG.md` is for **new requirements without acceptance
criteria** only. Bugs never go to BACKLOG; they get fixed now.

Three carve-outs require stopping and reporting instead of fixing —
**design change**, **ambiguous AC**, **security or privacy**. Full
rationale and examples in **`references/inline-fix-policy.md`**.

## Phase 1 — Plan (stop and wait)

1. **Pool of candidates** = ROADMAP § 4 rows with `Status ∈ {Partial,
   Planned}`. Exclude `Done`, `Gated`, `Deferred study`, `Research-backed
   spike`, `Superseded`. For `Partial`, the implementable scope is
   whatever `Readiness` flags as pending; for `Planned`, the full
   ticket scope from PLAN.md.

2. **Selection order:**
   a. Honour ROADMAP § 5 "Recommended sequence" when it applies.
   b. If a `Planned` ticket's `Dependencies` section in PLAN.md lists
      anything not yet `Done`, skip it.
   c. Prefer `Partial` over `Planned` when both qualify — scaffolding
      already exists, the risk is lower.

3. **Write a single-ticket plan** in chat. Use the exact structure in
   **`references/phase1-plan-format.md`** — header, scope, files,
   entitlement, i18n keys (en + es with tuteo), edge cases, coupled
   invariants, UI verification plan, PLAN.md citation, risks, time
   estimate, plus a trailing `Constraints understood` block. Then stop.

4. Wait for one of:
   - `approved` → execute as-is.
   - `approved with these changes: …` → fold the changes in, re-confirm
     mentally, then execute.
   - `change to RL-YYY` → restart Phase 1 with the new ticket.

   Without explicit input, do not assume permission to proceed.

## Phase 2 — Execute (only after approval)

5. **First chat line of the turn:**
   `Executing RL-XXX — <one-liner>`

6. Implement the full ticket against the approved plan. Code, tests,
   i18n, docs sync, and inline collateral fixes all land in one
   coherent staging area for a single human commit.

7. **Mandatory gates before staging.** Run in this order; everything
   green before `git add`:

   | Gate | Command | When |
   |---|---|---|
   | Lint | `npm run lint` | always |
   | Types | `npx tsc --noEmit` | always |
   | i18n keys | `npm run check:i18n` | always |
   | i18n copy | `npm run check:i18n:copy` | always |
   | Unit + integration | `npm test` | always |
   | Web e2e | `npm run test:e2e:web` | renderer touched |
   | Desktop smoke | `npm run smoke:desktop` | IPC or main touched |
   | License smoke | `npm run test:smoke:web:license` | licensing touched |

   "Licensing touched" = anything under `src/{renderer,main}/licensing/`,
   `tests/smoke/licenseWebSmoke.test.tsx`, or `scripts/mint-dev-license.mjs`.

   `npm run format` (Prettier) is optional pre-stage polish, not a
   blocking gate (consistent with CI).

   Do not loosen assertions to make a gate pass. If something fails:

   - Caused by your implementation → fix in the same ticket.
   - Real observable collateral bug → fix inline per the policy above
     and flag as `Prerequisite fix`. No threshold.
   - Falls in a carve-out → stop and report.

8. **Pre-staging review.** Run two reviewers in parallel against the
   still-unstaged diff (`git diff` without `--cached`):

   - `typescript-react-reviewer` for renderer / shared code.
   - `node` for main, preload, scripts, configs.

   Resolve every HIGH blocker inline. Surface MED findings in the
   report alongside the suggested commit message so the human decides
   whether to defer.

9. **Docs sync (lands in the same staged diff as the code):**

   a. `docs/ROADMAP.md` § 4 — flip the row's Status to `Done`, or keep
      `Partial` with an updated `Readiness` if only a sub-slice
      shipped. If the ticket is fully closed, move it to the § 6
      archive section.
   b. `docs/SPRINT-PLAN.md` — move the row in § 1 (Status at a glance)
      to `Shipped`, and shrink the detailed § N section to a single
      line: `Shipped on <ISO date> — see RL-XXX`.
   c. `docs/PLAN.md` — if the original scope drifts from reality,
      append a `### § X Status Update` block inside the RL-XXX section.
      Never rewrite history.

10. **New docs.** Register any ADR / runbook / spec authored this
    slice in `docs/README.md` under the ADRs index.

11. **New requirements without ACs.** Add a row to `docs/BACKLOG.md`
    tagged by domain + ISO date. Bugs never go to BACKLOG. Do not
    invent new RL ids without explicit input.

12. **Stage.** `git add <paths>` for every file touched (code + tests
    + i18n + docs sync + collateral fixes + BACKLOG row if any). Run
    `git diff --cached` to visually confirm the staging matches the
    ticket scope plus the disclosed collaterals — nothing more.

13. **Suggested commit message.** Single, unified, no split. Print
    in chat. Do not run `git commit`. Format and rules in
    **`references/commit-message-rules.md`** — Conventional Commits,
    real scopes from `git log` (`licensing`, `scripts`, `devutils`,
    `theme`, `settings`, `renderer`, `main`, `ci`, `security`,
    `deps`, `infra`), heredoc-safe (no `"`, no backticks),
    no AI co-authorship, `Prerequisite fixes` at the top of the body
    when applicable.

14. **Ticket closure report.** One line:

    `RL-XXX staged: <N> files changed across <code|tests|docs|i18n|...>. Gates green. Reviewer HIGH blockers resolved.`

    Then print the Review Guide.

15. **Review Guide.** Print the 9-section block exactly as in
    **`references/review-guide-template.md`** (Automated gates,
    Prerequisite fixes, Web smoke, Electron smoke, Risk areas,
    Coupled invariants, Docs sync checklist, Quick rollback,
    Deferred follow-ups). Substitute placeholders. Mark
    `Not applicable` explicitly when a section truly doesn't apply.

    Finish the turn by running `git status` and `git diff --cached
    --stat` so the chat shows the final staged state.

## Hard restrictions (both phases)

- Do not expand scope beyond the approved ticket — but inline
  collateral fixes have no threshold.
- Do not disable, skip, or loosen existing tests or type rules to make
  things pass.
- Refactor only the code touched by the ticket or by collateral fixes.
  No opportunistic refactors of adjacent files.
- No new runtime network fetches beyond the Pyodide CDN the web build
  already loads.
- Respect main vs renderer boundaries: every peripheral, filesystem,
  or process call goes through `ipcMain.handle` → preload →
  `window.lingua.*`. Never `require('fs')` in the renderer.
- The single mutating git command allowed is `git add <paths>`.
  Read-only git is unrestricted.
- If a design change is required mid-implementation, stop and report.
  Real observable collateral bugs are fixed inline; design changes
  are not.
- Never leave files half-staged.

## Additional resources

- **`references/git-policy.md`** — full git policy with rationale.
- **`references/inline-fix-policy.md`** — collateral-bug fix policy
  with carve-outs (design / AC / security).
- **`references/phase1-plan-format.md`** — exact plan structure for
  Phase 1 step 3.
- **`references/review-guide-template.md`** — exact 9-section block
  printed at Phase 2 step 15.
- **`references/commit-message-rules.md`** — Conventional Commits,
  scopes, heredoc safety, no-AI-attribution.

## Why this shape

Two phases with a human gate keep scope honest. The single staged diff
respects the human's review-before-commit cadence. Inline collateral
fixes keep the working tree clean — bugs that block gates have to be
fixed anyway, so accumulating them as "follow-up tickets" creates
phantom debt and slows future slices. The carve-out for design / AC /
security is the escape hatch where the agent's autonomy correctly
stops.

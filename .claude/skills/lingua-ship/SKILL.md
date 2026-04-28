---
name: lingua-ship
description: Ship the next pending step in the Lingua repo using a strict two-phase plan/execute workflow. Use this skill whenever the user asks to implement the next pending step, work the next iter, pick the next ticket, continue where we left off, ship the next slice, or anything that maps to advancing an RL-XXX ticket from docs/ROADMAP.md — even when they don't say the words ship or RL. Phase 1 picks one ticket from ROADMAP §4 and presents a plan; STOPS for approval; Phase 2 executes end-to-end with all gates green and leaves a single staged diff for the human to commit manually. The agent never runs git commit. Inline-fixes any unrelated bugs that block the gates without raising a separate ticket.
---

# Lingua Ship

Two-phase ticket workflow: plan, wait for approval, execute a single ticket
end-to-end with everything staged for the human to commit.

The repo's planning files live entirely in git under `docs/` — no machine-local
state in `.claude/plans/*` or anywhere else. Source the canonical status from
`docs/ROADMAP.md` § 4; load deeper detail only when needed.

## Sources of truth

Read on arrival, in this order. Each file has a specific purpose; do not load
the next one unless the previous didn't answer your question.

1. **`AGENTS.md`** (CLAUDE.md is a symlink to it) — operational conventions,
   skill routing, UI verification hard-rules, commit attribution policy
   (no AI co-authorship, no watermarks).
2. **`docs/ROADMAP.md` § 4** — canonical RL-XXX table with `Status` column.
   Cheapest planning doc. First file you read when picking a ticket.
3. **`docs/SPRINT-PLAN.md`** — per-commit execution detail for the active
   iters. Aligned 1:1 with ROADMAP. Read when executing an approved iter.
4. **`docs/PLAN.md`** — deep reference + acceptance criteria. Large; load a
   single `### RL-XXX` section via grep, not the whole file. When this and
   ROADMAP disagree on Status, ROADMAP wins.
5. **`docs/BACKLOG.md`** — pre-commitment raw ideas. Read when capturing
   something new. Never pick implementation work from here.
6. **`docs/README.md`** — index of how the four planning docs split
   responsibility.

## Git policy (non-negotiable, both phases)

The agent never runs `git commit`, `git reset`, `git restore --staged`, or
`git checkout` against modified files. The single mutating git command
allowed is `git add <paths>` to group the ticket diff plus any inline
collateral fixes into a coherent staging area.

`git status`, `git diff`, `git diff --cached`, `git log`, `git show`, and
`git blame` are read-only and may be run as often as needed for self-review.

When the ticket is ready, the agent prints a **suggested** commit message in
the chat — single message, covers ticket + docs sync + every collateral fix
together. The human pastes or adapts it. The agent never amends, never
splits, never force-pushes.

## Inline-fix policy for collateral bugs (no threshold)

During Phase 2, unrelated bugs may surface: a gate breaking for an unrelated
reason, a stale path after a reorg, a forgotten dependency, broken tests
that aren't yours, stale imports, a config out of sync with the repo.

**Rule: if it is a real observable bug, fix it inline.** No line threshold,
no file threshold, no asking. The ticket scope absorbs the fix and the work
continues. Flag the fix clearly in the report and the suggested commit
message so the human has traceability.

`docs/BACKLOG.md` is reserved for **new requirements without acceptance
criteria** (features, ideas, explorations, pending decisions). Bugs never go
to BACKLOG; they get fixed now.

When applying an inline fix:

- Add the paths to the same `git add` as the ticket so everything lands in
  one coherent staging.
- In the chat report (step 14), add a `Prerequisite fixes` section with the
  bug, the fix, why it surfaced, and the approximate lines/files touched.
- In the suggested commit message (step 13), list the fix as a separate
  bullet at the top of the body prefixed `- prerequisite:`. It is labelling
  for traceability, not an invitation to split — the commit stays single.

**Carve-out — stop and report instead of fixing:**

- **Design change.** The Phase 1-approved approach no longer holds (chosen
  library doesn't work, expected API doesn't exist, pattern contradicts
  AGENTS.md). That's a decision for the human, not a fix.
- **Ambiguous acceptance criteria.** The fix forces a decision PLAN.md /
  ROADMAP doesn't make explicit — pause and ask.
- **Security or privacy.** The bug exposes a vulnerability (credential
  leak, XSS, path traversal, timing-unsafe compare, etc.) — surface for
  human input before touching.

Incidental-with-scope mixing that's "hard to separate" is **not** a reason
to stop. If the fix can sit in distinct hunks from the ticket work, fix it
inline and let the human decide at review time whether to split via
`git add -p`.

## Phase 1 — Plan (stop and wait)

1. **Pool of candidates** = ROADMAP § 4 rows with `Status ∈ {Partial,
   Planned}`. Exclude `Done`, `Gated`, `Deferred study`, `Research-backed
   spike`, `Superseded`. For `Partial`, the implementable scope is whatever
   the `Readiness` column flags as pending; for `Planned`, the full ticket
   scope from PLAN.md.

2. **Selection order:**
   a. Honour ROADMAP § 5 "Recommended sequence" when it applies.
   b. If a `Planned` ticket's `Dependencies` section in PLAN.md lists
      anything not yet `Done`, skip it — not implementable yet.
   c. Prefer `Partial` over `Planned` when both qualify. The scaffolding
      already exists, the risk is lower.

3. Write a **single-ticket plan** in chat with this exact structure, then
   stop:

   `Proposed: RL-XXX`

   - One-liner of purpose (copy from ROADMAP § 4 scope cell).
   - Current Status + Priority (from ROADMAP).
   - Concrete scope:
     - For `Partial`: copy the pending fragment from `Readiness` and mark
       what this slice attacks now.
     - For `Planned`: summarise PLAN.md scope into 4-8 bullets.
   - Logical-units sequence (if the ticket has more than one unit in
     staging, call it out; if it's one coherent unit, say so explicitly).
     If `SPRINT-PLAN.md` § N already has a sequence for this ticket, copy
     it; otherwise propose one.
   - Files to create / modify (concrete paths, grouped by directory —
     `src/renderer/`, `src/main/`, `tests/`, `docs/`, etc.).
   - Entitlement decision: `free`, `pro`, `pro_lifetime`, `team`, or
     `trial`/`education`. Flag cross-cutting if introducing a new
     entitlement.
   - New i18n keys, listed per locale (`en` + `es`). Plurals explicit with
     `_one` / `_other` suffixes. Spanish copy follows tuteo Latin American
     convention (`Pega`, `Copia`, `puedes`, `quieres` — not `Pegá`,
     `Copiá`, `podés`, `querés`).
   - Edge cases the tests must cover: empty input, loading state, network
     failure, offline (Electron), invalid input, tier-gated denial, i18n
     fallback, reload persistence, truncation boundaries.
   - Coupled invariants likely to break — call them out by file:
     - `tests/components/commandPaletteModel.test.ts` (catalog count pin)
     - `tests/shared/appInfo.test.ts` (version pin)
     - `tests/web/adapter.test.ts` (web stub surface)
     - any other the scope mentions.
   - UI verification plan (see Phase 2 step 7 for the gates).
   - Did you read PLAN.md? Cite the exact `### RL-XXX` section grepped.
   - Risks or open questions blocking implementation.
   - Time estimate.

   Then add a `Constraints understood` block listing the rules from
   AGENTS.md, the ticket's ACs, and the specific constraints in this skill.

4. Do not write code. Do not run mutating commands (`git status`, `git
   diff`, greps, reads are fine). Wait for one of:

   - `approved` → execute as-is.
   - `approved with these changes: …` → fold the changes in, re-confirm
     mentally, then execute.
   - `change to RL-YYY` → restart Phase 1 with the new ticket.

   Without explicit input, do not assume permission to proceed.

## Phase 2 — Execute (only after approval)

5. **First chat line of the turn:**

   `Executing RL-XXX — <one-liner>`

6. Implement the full ticket against the approved plan. Code, tests, i18n,
   docs sync, and inline collateral fixes all land in one coherent staging
   area for a single human commit.

7. **Mandatory gates before staging.** Run in this order; everything green
   before `git add`:

   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run check:i18n`
   - `npm run check:i18n:copy`
   - `npm test -- --run`
   - `npm run test:e2e:web` (if the ticket touches the renderer)
   - `npm run smoke:desktop` (if the ticket touches IPC / main process)

   Do not loosen assertions to make a gate pass. If something fails:

   - Caused by your implementation → fix in the same ticket.
   - Real observable collateral bug → fix inline per the policy above and
     flag as `Prerequisite fix`. No threshold.
   - Falls in the carve-out (design change / ambiguous AC / security) →
     stop and report.

8. **Pre-staging review.** Run two reviewers in parallel against the still-
   unstaged diff (`git diff` without `--cached`):

   - `typescript-react-reviewer` for renderer / shared code.
   - `node` for main, preload, scripts, configs.

   Resolve every HIGH blocker inline. Surface MED findings in the chat
   report alongside the suggested commit message so the human decides
   whether to defer.

9. **Docs sync (lands in the same staged diff as the code):**

   a. `docs/ROADMAP.md` § 4 — flip the row's Status to `Done`, or keep
      `Partial` with an updated `Readiness` if only a sub-slice shipped. If
      the ticket is fully closed, move it to the § 6 archive section.
   b. `docs/SPRINT-PLAN.md` — move the row in § 1 (Status at a glance) to
      `Shipped`, and shrink the detailed § N section to a single line:
      `Shipped on <ISO date> — see RL-XXX`.
   c. `docs/PLAN.md` — if the original scope drifts from reality, append a
      `### § X Status Update` block inside the RL-XXX section. Never
      rewrite history.

10. **New docs.** If you authored an ADR, runbook, or spec, register it in
    `docs/README.md` under the ADRs index.

11. **New requirements without ACs.** Add a row to `docs/BACKLOG.md` tagged
    by domain + ISO date. **Bugs never go to BACKLOG** — they get fixed
    inline. Do not invent new RL ids without explicit input.

12. **Stage.** `git add <paths>` for every file touched (code + tests +
    i18n + docs sync + collateral fixes + BACKLOG row if any). Then run
    `git diff --cached` to visually confirm the staging matches the
    ticket scope plus the disclosed collaterals — nothing more.

13. **Suggested commit message** — single message, no split:

    - Conventional Commits with a meaningful scope:
      `feat(devutils): …`, `fix(licensing): …`, `refactor(renderer): …`.
    - **No double quotes, no backticks** in the body — they break the
      heredoc the human uses to paste it.
    - **No AI co-authorship** — no `Co-Authored-By: Claude`, no
      `Generated with Claude Code`, no watermarks of any kind.
    - Body uses hyphen bullets enumerating what changed.
    - `Prerequisite fixes` (if any) at the top of the body, prefixed
      `- prerequisite: …` for traceability. It is labelling, not a split
      cue.
    - If you deferred MED findings, add a `Follow-ups:` bullet listing them
      tersely.

    Print the message in the chat. Do not run `git commit`.

14. **Ticket closure report**, exactly:

    `RL-XXX staged. <N> files, gates green, HIGH blockers: 0.`
    `Ready for review via git diff --cached.`

    Then print the Review Guide described in step 15.

15. **Review Guide** — one markdown block, scannable. Format exactly:

    ```
    ## Review Guide — RL-XXX

    ### 1. Automated gates (already green)
    Re-run if uncertain:
    npm run lint
    npx tsc --noEmit
    npm run check:i18n
    npm run check:i18n:copy
    npm test -- --run
    npm run test:e2e:web    # if touched renderer
    npm run smoke:desktop   # if touched IPC / main

    Any failure on re-run is a regression after staging — flag it.

    ### 2. Prerequisite fixes
    List every collateral fix with location and reason:
    - path/file.ts:L — what was broken and how the fix resolves it.
    Write "None" explicitly if there were no inline fixes.

    ### 3. Live smoke — Web (if touched renderer)
    Start preview:
    npm run preview:web
    (or `npm run dev:web:pro` if the surface is Pro-gated and you need
    to paste a dev license token first.)

    Happy-path trace:
    1. Open <route or testid for the feature>.
    2. Interact with <concrete testids or controls>.
    3. Visually verify <expected result + concrete value>.

    Edge cases worth poking manually:
    - <empty input>
    - <malformed payload>
    - <flip locale to es and repeat>

    Hard assertion: `browser_console_messages({ level: 'error' })`
    must be 0 at end of the pass.

    ### 4. Live smoke — Electron (if touched IPC / main process)
    Start the shell:
    npm run dev:desktop         # Free mode
    npm run dev:desktop:pro     # Pro mode (mint + paste dev token)
    Steps + assertions for the surface touched.

    If the ticket is 100% renderer, write "Not applicable — covered by
    the web smoke."

    ### 5. Risk areas (look closely)
    - path/file.ts:L — why it deserves attention (new algorithm, delicate
      tagged union, possible race, etc.).
    Include resolved HIGH findings, deferred MED findings, and any design
    decision the reviewer should cross-check against AGENTS.md or an ADR.

    ### 6. Coupled invariants touched
    - tests/components/commandPaletteModel.test.ts — count bumped X→Y.
    - tests/shared/appInfo.test.ts — version pin bump.
    - any other touched.

    ### 7. Docs sync checklist
    - [ ] docs/ROADMAP.md § 4 Status flip applied
    - [ ] docs/SPRINT-PLAN.md § 1 + § N updated
    - [ ] docs/PLAN.md Status Update (if applicable)
    - [ ] docs/README.md (if new docs created)
    - [ ] docs/BACKLOG.md (only if a new requirement surfaced — bugs
          do not go here)

    ### 8. Quick rollback (if rejecting)
    git restore --staged .
    git checkout .
    Wipes the ticket from the working tree and the index. New files are
    deleted too.

    ### 9. Deferred follow-ups (not staged in this ticket)
    - Items added to docs/BACKLOG.md tagged today (requirements only).
    - Unresolved MED findings from review.
    - Ideas surfaced during implementation that didn't fit scope.
    ```

    Finish the turn by running `git status` and `git diff --cached --stat`
    one last time so the chat shows the final staged state.

## Hard restrictions (both phases)

- Do not expand scope beyond the approved ticket — but inline collateral
  fixes have no threshold.
- Do not disable, skip, or loosen existing tests or type rules to make
  things pass.
- Refactor only the code touched by the ticket or by collateral fixes.
  No opportunistic refactors of adjacent files.
- No new runtime network fetches beyond the Pyodide CDN the web build
  already loads.
- Respect main vs renderer boundaries: every peripheral, filesystem, or
  process call goes through `ipcMain.handle` → preload → `window.lingua.*`.
  Never `require('fs')` in the renderer.
- The single mutating git command allowed is `git add <paths>`. Read-only
  git is unrestricted.
- If a design change is required mid-implementation, stop and report.
  Real observable collateral bugs are fixed inline; design changes are not.
- Never leave files half-staged.

## Why this shape

Two phases with a human gate keep scope honest. The single staged diff
respects the human's review-before-commit cadence. Inline collateral fixes
keep the working tree clean — bugs that block gates have to be fixed
anyway, so accumulating them as "follow-up tickets" creates phantom debt
and slows future slices. The carve-out for design / AC / security is the
escape hatch where the agent's autonomy correctly stops.

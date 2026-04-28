---
name: lingua-review
description: This skill should be used when the user asks to "review my staged diff", "check git diff --cached", "validate this slice before commit", "look at what is about to be committed", "audit what got staged", "peer review this branch", "revisa mi diff staged", "revisa lo que está stageado", or anything that maps to inspecting an as-yet-uncommitted change in the Lingua repo. Reads the staged diff with a product-excellence lens, fixes EVERY issue inline (BLOCKER through STYLE) including unrelated bugs surfaced while reading the touched files, keeps reviewer fixes UNSTAGED so the human sees them as a separate diff, and outputs a single unified Conventional Commits message. Never runs git commit, never re-stages, never touches the implementer's index.
---

# Lingua Review

Final-pass review before the human commits. Read the staged diff with
a product-excellence lens. Fix everything found inline. Leave the
implementer's index untouched and put fixes in the unstaged worktree
so the human can inspect both layers separately and decide.

## Context to read first (read-only)

Run these reads before forming opinions. Each is informational, not
mutating.

1. `git status` — what is staged, unstaged, untracked.
2. `git diff --cached` — the implementer's diff. This is what's being
   reviewed.
3. `git log -n 10 --oneline` — repo's commit message style.
4. `AGENTS.md` (CLAUDE.md is a symlink) — landmines, conventions, UI
   verification gate.
5. `docs/ROADMAP.md` § 4 + `docs/SPRINT-PLAN.md` — the active ticket
   and its acceptance criteria.

## Git policy

The reviewer mutates **nothing** in git. The implementer's index is
sacred — do not touch it, unstage anything from it, or reorganise it.

Never run `git commit`, `git add`, `git reset`, `git restore`,
`git checkout`, `git stash`, or any hook-skipping flag
(`--no-verify`, `--no-gpg-sign`). Read-only git is unrestricted.

When done:

- `git diff --cached` = the implementer's diff, exactly as delivered.
- `git diff` = reviewer fixes, unstaged, ready for the human to
  inspect separately.

Full rules and rationale in **`references/git-policy.md`**.

## Review scope

Review with a product-excellence lens. There is no "out of scope": if
the diff touches a file and a real bug exists there — or in a file
imported by the diff and read for context — count it and fix it.

Cover these dimensions in roughly this order: **logical correctness,
security, concurrency, types, public-vs-internal API, testing, i18n,
accessibility, performance, bundle, docs sync, commit hygiene**. Each
dimension expanded with concrete patterns and examples in
**`references/review-dimensions.md`** — load it before forming
findings.

## Inline-fix policy (no severity threshold)

Fix everything found. The goal is that when the human types
`git commit`, the product is excellent.

- BLOCKER, HIGH, MEDIUM, LOW, STYLE, typo, stale comment → fix.
- No ceiling on lines or files touched.
- No "this is a product decision, hands off": if the product decision
  is *implemented incorrectly* relative to the ticket's ACs, fix it.
  The only thing to leave alone is product trade-offs that genuinely
  require human input — list those under `Product decisions to
  confirm` instead.

Fixes go into the **unstaged** worktree via the Edit tool. Do not
stage them. While inside a file fixing one bug, if another unrelated
bug appears in the same file or in an adjacent file read for context,
fix it too. Each unrelated fix gets its own bullet in the report,
marked `unrelated fix`.

If a fix involves a non-obvious decision (two reasonable paths, a
real trade-off), write a short rationale comment above the change
and surface the decision in the report. Don't pause for approval —
the human sees the rationale when reading the unstaged diff.

If a fix isn't covered by the test suite, **add the test**. Tests
are a fix mechanism, not a separate concern.

If a fix breaks an existing test that was wrong (asserting
implementation detail or vacuously passing), fix the test and report
it as a separate finding so the human knows.

## Validation gates

After fixes, re-run the same gates the implementer should have run:

| Gate | Command | When |
|---|---|---|
| Tests | `npm test` | always |
| Types | `npx tsc --noEmit` | always |
| Lint | `npm run lint` | always |
| i18n keys | `npm run check:i18n` | always |
| i18n copy | `npm run check:i18n:copy` | always |
| License smoke | `npm run test:smoke:web:license` | licensing touched |

"Licensing touched" = anything under `src/{renderer,main}/licensing/`,
`tests/smoke/licenseWebSmoke.test.tsx`, or `scripts/mint-dev-license.mjs`.

If the diff touches user-facing surfaces (components, Settings
sections, status notices, shortcuts, i18n copy), the **mandatory UI
gate** from AGENTS.md applies: smoke via `npm run preview:web` +
Playwright MCP, end with `browser_console_messages({ level: 'error' })`
at 0.

Report each gate's outcome in the validation section of the report.

## Report format

Print one report at the end of the review. Use the exact section
order in **`references/report-template.md`**:

1. **Summary** — one line: ticket, finding counts, recommendation.
2. **Ticket findings (fixed inline)** — every diff-related finding
   with severity, path:line, rationale.
3. **Unrelated fixes (fixed inline)** — every collateral fix with
   severity, path:line, why it surfaced.
4. **Product decisions to confirm** — trade-offs the human must
   decide. `Empty if none`.
5. **Validation run** — outcome per gate (`Tests`, `Types`, `Lint`,
   `i18n`, `License smoke` if applicable, `UI gate`).
6. **Physical diff layout** — file counts and lines for
   `git diff --cached` vs `git diff`.
7. **Suggested commit message** — single, unified Conventional
   Commits block per **`references/commit-message-rules.md`**.
8. **How the human proceeds** — four copy-paste commands.

## Report style rules

- Severities: `BLOCKER` / `HIGH` / `MEDIUM` / `LOW` / `STYLE`. One
  label per finding.
- No emojis (this repo's commits don't use them).
- `path:line` cited exactly. If the file moved, report
  `old path → new path`.
- If a fix lacks test coverage, add the test in the same review pass
  and list it as a separate finding bullet.
- If a fix breaks an existing test that was wrong, fix the test in
  the same pass and surface it under `Ticket findings`.

## What you never do

- Run any mutating git command (see `references/git-policy.md`).
- Stage your fixes. Zero `git add` of any form.
- Run `git commit`, `git commit --amend`, or rewrite history.
- Touch git config or skip hooks.
- Add AI co-authorship trailers to the suggested commit message.
- Pause partway through asking for permission. Run end-to-end and
  print the full report at the close.

## Additional resources

- **`references/git-policy.md`** — full reviewer git rules with
  rationale (zero git writes, sacred implementer index).
- **`references/review-dimensions.md`** — the 12 dimensions with
  concrete patterns and Lingua-specific examples (tuteo voseo
  detection, IPC validation, coupled invariants, etc.).
- **`references/report-template.md`** — exact 8-section block.
- **`references/commit-message-rules.md`** — Conventional Commits
  scopes from `git log`, heredoc safety, no-AI-attribution.

## Why this shape

The implementer's index stays untouched so the diff the human
reviews is the diff the implementer actually intended — provenance
that would be lost if the reviewer mixed in fixes. The unstaged-fixes
worktree gives the human a second physical layer to inspect, accept,
or reject independently. The "fix everything" policy raises the floor
on every commit without inventing follow-up tickets that pile up
unnoticed. The carve-out for product trade-offs is the only thing
deferred — those need a human decision, not a Claude one.

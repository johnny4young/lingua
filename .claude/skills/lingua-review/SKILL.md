---
name: lingua-review
description: Review the staged git diff in the Lingua repo before the human commits. Use this skill whenever the user asks to review my staged diff, check git diff --cached, validate this slice before commit, look at what is about to be committed, audit what got staged, peer review this branch, or anything that maps to inspecting an as-yet-uncommitted change. Reads the staged diff, fixes EVERY issue inline (BLOCKER through STYLE) — including unrelated bugs surfaced while reading the touched files — keeps reviewer fixes UNSTAGED so the human sees them as a separate diff, and outputs a single unified Conventional Commits message. Never runs git commit, never re-stages, never touches the implementer's index.
---

# Lingua Review

Final-pass review before the human commits. Read the staged diff with a
product-excellence lens. Fix everything you find inline. Leave the
implementer's index untouched and put your fixes in the unstaged worktree
so the human can inspect both layers separately and decide.

## Context to read first (read-only)

Run these reads before forming opinions. Each one is informational, not
mutating.

1. `git status` — what is staged, unstaged, untracked.
2. `git diff --cached` — the implementer's diff. This is what you're
   reviewing.
3. `git log -n 10 --oneline` — repo's commit message style.
4. `AGENTS.md` (CLAUDE.md is a symlink) — landmines, conventions, UI
   verification gate.
5. `docs/ROADMAP.md` § 4 + `docs/SPRINT-PLAN.md` — the active ticket and
   its acceptance criteria.

## Git policy (non-negotiable)

You **never** run any of these mutating git commands:
`git commit`, `git add`, `git reset`, `git restore`, `git checkout`,
`git stash`, `git rebase`, `git merge`, `git cherry-pick`, `git clean`.
Zero git writes — including no `git config` and no hook-skipping flags
(`--no-verify`, `--no-gpg-sign`).

You may run only read-only git: `git status`, `git diff`, `git diff
--cached`, `git log`, `git show`, `git blame`.

The implementer already ran `git add` on their work. **That index is
sacred** — do not touch it, unstage anything from it, or reorganise it.
When you're done:

- `git diff --cached` = the implementer's diff, exactly as delivered.
- `git diff` = your reviewer fixes, unstaged, ready for the human to
  inspect separately.

That separation is the physical artefact of the review. The human stages
the fixes (or selectively rejects them) and runs the final `git commit`.

## Review scope

Review with a product-excellence lens. There is no "out of scope": if the
diff touches a file and you spot a real bug there — or in a file imported
by the diff that you read for context — count it and fix it.

Cover these dimensions in roughly this order:

- **Logical correctness.** Edge cases, off-by-one, null / undefined,
  newly-possible impossible states, broken invariants.
- **Security.** Unsanitised input, ReDoS-prone regex, path traversal,
  XSS via raw HTML injection (the React unsafe-html attribute or direct
  `innerHTML`), secrets in logs, timing-unsafe compares, downgraded
  crypto.
- **Concurrency / races.** Unawaited promises, React effects setting
  state after unmount, IPC handlers with collidable request ids.
- **Types.** New `any`, unnecessary assertions, types that lie about
  runtime shape, tagged unions missing `never` tails.
- **Public API vs internal.** Module consumer contracts: if an exported
  signature changes, what call sites break?
- **Testing.** Real coverage of the delta (assertions, not just line
  coverage), vacuously-passing tests, tests asserting implementation
  detail, potential flakes.
- **i18n.** Hardcoded copy in components (would break
  `npm run check:i18n:copy`), plurals with `_one` / `_other`, en + es
  parity, dead keys, voseo leaking into the tuteo Spanish locale.
- **Accessibility.** Roles, labels, focus traps in modals, keyboard nav,
  contrast.
- **Performance.** Unnecessary renders, lists without stable keys,
  uncapped regex, heavy synchronous work on the renderer main thread.
- **Bundle.** New top-level imports that should be `await import(...)`,
  undeclared dependencies, redundant polyfills.
- **Docs sync.** ROADMAP / SPRINT-PLAN / PLAN updated when the slice
  warrants it.
- **Commit hygiene.** Files that don't belong to this ticket but ended
  up staged. Report them — do **not** unstage them yourself.

## Inline-fix policy (no severity threshold)

Fix everything you find. The goal is that when the human types
`git commit`, the product is excellent.

- BLOCKER, HIGH, MEDIUM, LOW, STYLE, typo, stale comment → fix.
- No ceiling on lines or files touched.
- No "this is a product decision, hands off": if the product decision
  is *implemented incorrectly* relative to the ticket's ACs, fix it.
  The only thing you do **not** touch is product trade-offs that
  genuinely require human input — list those under
  `Product decisions to confirm` instead.

Fixes go into the **unstaged** worktree via the Edit tool. Do not stage
them. While you're inside a file fixing one bug, if you spot another
unrelated bug in the same file or in an adjacent file you read for
context, fix it too. Each unrelated fix gets its own bullet in the
report, marked `unrelated fix`.

If a fix involves a non-obvious decision (two reasonable paths, a real
trade-off), write a short rationale comment above the change and surface
the decision in the report. Don't pause for approval — the human sees the
rationale when reading the unstaged diff.

If you fix something the test suite doesn't cover, **add the test**.
Tests are a fix mechanism, not a separate concern.

If a fix breaks an existing test that was wrong (asserting implementation
detail or vacuously passing), fix the test and report it as a separate
finding so the human knows.

## Validation gates

After fixes, re-run the same gates the implementer should have run:

- `npm test -- --run`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run check:i18n` and `npm run check:i18n:copy`

If the diff touches user-facing surfaces (components, Settings sections,
status notices, shortcuts, i18n copy), the **mandatory UI gate** from
AGENTS.md applies: smoke via `npm run preview:web` + Playwright MCP, end
with `browser_console_messages({ level: 'error' })` at 0.

Report each gate's outcome in the validation section of the report.

## Report format

Print one report at the end of the review, exactly these sections in this
order:

```
## Summary
One line: "Review of <ticket>'s staged diff. N findings, M fixed inline,
K unrelated fixes. Recommendation: commit / commit after confirming X /
block on Y."

## Ticket findings (fixed inline)
For every finding tied to the staged diff:
- **[Severity] Short title.** path:line. Description of the bug. Fix
  applied to the unstaged worktree. One sentence of rationale if not
  obvious.

## Unrelated fixes (fixed inline)
For every unrelated bug fixed while reading context:
- **[Severity] Short title.** path:line. What was wrong, what was fixed,
  why you saw it.

## Product decisions to confirm
Only trade-offs the human must decide. Empty if none.

## Validation run
- Tests: `npm test -- --run` → passed / failed with X cases.
- Types: `npx tsc --noEmit` → clean / N errors.
- Lint: `npm run lint` → clean / N warnings.
- i18n: `npm run check:i18n && npm run check:i18n:copy` → clean / N.
- UI gate: smoke result + console-error count (or "Not applicable —
  diff doesn't touch user-facing surfaces").

## Physical diff layout
- `git diff --cached` → M files / +A / -B lines (implementation intact).
- `git diff` → N files / +C / -D lines (reviewer fixes).
List the files on each side so the human eyeballs them in one pass.

## Suggested commit message (single, unified)

Conventional Commits block ready to paste. ONE message that covers the
implementer's ticket plus the unrelated fixes you applied. No AI
co-authorship. No backticks, no double quotes anywhere in the body
(they break the heredoc the human pastes into).

Format:

    <type>(<scope>): <subject of the original ticket>

    <short paragraph describing the ticket>

    - <bullet for each ticket-relevant change>
    - <bullet for each ticket-relevant change>

    Unrelated fixes applied during review:
    - <path>: <what was fixed and why> (severity: <BLOCKER|HIGH|MEDIUM|LOW>)
    - <path>: <what was fixed and why> (severity: ...)

The human runs `git commit` after staging the unstaged fixes with
`git add` (or selectively rejecting them with `git restore`).

## How the human proceeds
Four commands, in order, copy-paste:

    git diff --cached          # inspect the implementation
    git diff                   # inspect the reviewer fixes
    git add -A                 # if accepting all reviewer fixes
    git commit -m "..."        # with the suggested message above

To reject specific fixes: `git restore <path>` selectively before
`git add -A`.
```

## Report style rules

- Severities: BLOCKER / HIGH / MEDIUM / LOW / STYLE. One label per
  finding.
- No emojis unless the repo's commits already use them (this repo
  does not).
- `path:line` cited exactly. If the file moved, report `old path → new
  path`.
- If a fix lacks test coverage, add the test in the same review pass
  and list it as a separate finding bullet.
- If a fix breaks an existing test that was wrong, fix the test in the
  same pass and surface it under `Ticket findings`.

## What you never do

- Run any mutating git command (see the list at the top).
- Stage your fixes. Zero `git add` of any form.
- Run `git commit`, `git commit --amend`, or rewrite history.
- Touch git config or skip hooks (`--no-verify`, `--no-gpg-sign`).
- Add AI co-authorship trailers to the suggested commit message.
- Pause partway through asking for permission. Run end-to-end and
  print the full report at the close.

## Why this shape

The implementer's index stays untouched so the diff the human reviews is
the diff the implementer actually intended — provenance you'd lose if
the reviewer mixed in fixes. The unstaged-fixes worktree gives the human
a second physical layer to inspect, accept, or reject independently.
The "fix everything you find" policy raises the floor on every commit
without inventing follow-up tickets that pile up unnoticed. The carve-out
for product trade-offs is the only thing you defer — those need a human
decision, not a Claude one.

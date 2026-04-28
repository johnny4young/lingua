# Report template — lingua-review

Print one report at the end of the review. Include all sections in
this order. Mark sections empty (`None`, `Empty if none`,
`Not applicable`) explicitly rather than dropping them — the human
relies on the fixed shape.

## Layout

```
## Summary
One line: Review of <ticket>'s staged diff. N findings, M fixed inline,
K unrelated fixes. Recommendation: commit / commit after confirming X /
block on Y.

## Ticket findings (fixed inline)
For every finding tied to the staged diff:
- **[Severity] Short title.** path:line. Description of the bug. Fix
  applied to the unstaged worktree. One sentence of rationale if not
  obvious.

## Unrelated fixes (fixed inline)
For every unrelated bug fixed while reading context:
- **[Severity] Short title.** path:line. What was wrong, what was
  fixed, why you saw it.

## Product decisions to confirm
Only trade-offs the human must decide. Empty if none.

## Validation run
- Tests: npm test → passed / failed with X cases.
- Types: npx tsc --noEmit → clean / N errors.
- Lint: npm run lint → clean / N warnings.
- i18n: npm run check:i18n and npm run check:i18n:copy → clean / N.
- Licensing smoke: npm run test:smoke:web:license → ran / not applicable
  (only when the diff touches src/{renderer,main}/licensing/, the smoke
  test, or scripts/mint-dev-license.mjs).
- UI gate: smoke result + console-error count (or Not applicable —
  diff doesn't touch user-facing surfaces).

## Physical diff layout
- git diff --cached → M files / +A / -B lines (implementation intact).
- git diff → N files / +C / -D lines (reviewer fixes).
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

The human runs git commit after staging the unstaged fixes with
git add (or selectively rejecting them with git restore).

## How the human proceeds
Four commands, in order, copy-paste:

    git diff --cached          # inspect the implementation
    git diff                   # inspect the reviewer fixes
    git add -A                 # if accepting all reviewer fixes
    git commit -m ...          # with the suggested message above

To reject specific fixes: git restore <path> selectively before
git add -A.
```

## Style rules

- Severities: `BLOCKER` / `HIGH` / `MEDIUM` / `LOW` / `STYLE`. One
  label per finding.
- No emojis (this repo's commits don't use them).
- `path:line` cited exactly. If the file moved, report
  `old path → new path`.
- If a fix lacks test coverage, add the test in the same review pass
  and list it as a separate finding bullet.
- If a fix breaks an existing test that was wrong, fix the test in
  the same pass and surface it under `Ticket findings`.

## Example fragments

```
## Summary
Review of RL-061 Slice 3 staged diff. 4 findings, 4 fixed inline,
1 unrelated fix. Recommendation: commit after confirming the device-pairing
empty-state copy with the human.

## Ticket findings (fixed inline)
- **[HIGH] Stale device card after revoke.** src/renderer/licensing/DeviceList.tsx:48.
  removeDevice resolved before the local list refreshed, so the card
  remained until manual reload. Fix: invalidate the IPC cache and
  re-fetch in the same handler.
- **[MEDIUM] Missing es plural keys.** src/renderer/i18n/locales/es/common.json.
  pairing.devices.count had _other but no _one variant. Fix: added _one.

## Unrelated fixes (fixed inline)
- **[MEDIUM] Stale snapshot count.** tests/components/commandPaletteModel.test.ts:42.
  Catalog count pin was 14 but the live model has 15 since the slice
  added a license-status command. Fix: bumped to 15 with the new id added
  to the per-id presence assertions.
```

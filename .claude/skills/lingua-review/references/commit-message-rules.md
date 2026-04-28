# Commit message rules — lingua-review

The reviewer prints a single suggested commit message that covers the
implementer's ticket plus any unrelated fixes applied during review.
The human runs `git commit` themselves.

## Conventional Commits format

```
<type>(<scope>): <subject of the original ticket>

<short paragraph describing the ticket>

- <bullet for each ticket-relevant change>
- <bullet for each ticket-relevant change>

Unrelated fixes applied during review:
- <path>: <what was fixed and why> (severity: <BLOCKER|HIGH|MEDIUM|LOW>)
- <path>: <what was fixed and why> (severity: ...)
```

Types observed in this repo: `feat`, `fix`, `refactor`, `docs`,
`test`, `chore`, `perf`, `style`.

## Scopes — match the repo

Real scopes seen in `git log` (April 2026):

- `licensing`, `scripts`, `devutils`, `theme`, `settings`, `renderer`,
  `main`, `ci`, `security`, `deps`, `infra`.

Do **not** invent new scopes. If nothing fits, use the broader of
`renderer` / `main` / `infra`. RL-XXX **never** goes in the scope.

## Heredoc safety

The human pastes the message via a heredoc. Both `"` and backticks
break the heredoc.

- Use single quotes if quotation is needed.
- Refer to commands as plain words.
- Refer to file paths as plain text (no backticks).

## No AI co-authorship

Never add any of these:

- `Co-Authored-By: Claude …` (any model, any email).
- `Generated with Claude Code` watermark.
- Footer / trailer / signature line attributing to Claude, an LLM,
  or an AI assistant.

This rule is global — applies regardless of past or implicit
permissions. Override only when the user explicitly requests
attribution in the same turn.

## Body structure

1. **Optional first line** — short paragraph summarising the ticket.
   Skip if the subject already says everything.
2. **Bullets** — hyphen bullets enumerating concrete ticket changes,
   citing paths.
3. **`Unrelated fixes applied during review:` block** (only if any) —
   one bullet per fix with path + severity. The implementer's ticket
   bullets stay separate from these.

## Why list unrelated fixes inline

The reviewer applied the fixes; the human stages them via `git add`.
Listing them in the commit body gives reviewers and future
`git log` readers traceability — they can find the unrelated change
without surprise during a future bisect.

## Example

```
feat(licensing): RL-061 Slice 3 — device-pairing UI in Settings

Adds the device list and pairing flow to Settings → License. Fetches
the active devices from the licensing IPC and lets the user remove
stale pairings.

- src/renderer/licensing/DeviceList.tsx — new component, unit-tested
- src/main/licensing/devicesIpc.ts — listDevices and removeDevice handlers
- src/shared/licensing/devices.ts — DeviceSummary type
- en/common.json, es/common.json — pairing copy added with parity
- docs/ROADMAP.md, docs/SPRINT-PLAN.md — RL-061 Slice 3 marked Shipped

Unrelated fixes applied during review:
- src/renderer/licensing/DeviceList.tsx — fixed stale list after revoke;
  invalidated cache on action (severity: HIGH)
- tests/components/commandPaletteModel.test.ts — bumped catalog count to 15
  for the license-status command added this slice (severity: MEDIUM)
```

## Final reminder

Print the message. Do **not** run `git commit`, `git add`, or any
mutating git command — see `references/git-policy.md`.

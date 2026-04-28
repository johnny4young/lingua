# Commit message rules — lingua-ship

The suggested commit message is the agent's last text artefact in
Phase 2. The human pastes or adapts it. Apply these rules verbatim.

## Conventional Commits format

```
<type>(<scope>): <subject>

<short paragraph describing the ticket>

- <bullet for each ticket-relevant change>
- <bullet for each ticket-relevant change>
```

Types observed in this repo: `feat`, `fix`, `refactor`, `docs`,
`test`, `chore`, `perf`, `style`.

## Scopes — match the repo

Use a scope that matches what the diff actually touches. Real scopes
seen in `git log` (April 2026):

- `licensing` — Polar / Ed25519 / entitlements / `src/{renderer,main}/licensing/`.
- `scripts` — anything under `scripts/` (mint, dev runners, validators).
- `devutils` — Pyodide, the snippet catalog, the dev playground surface.
- `theme` — Signal-Slate design system tokens, palette, typography.
- `settings` — Settings panel, sections, forms, IPC for prefs.
- `renderer` — generic UI / store / hooks not covered by a tighter scope.
- `main` — Electron main process, IPC handlers, FS bridge, protocol.
- `ci` — GitHub Actions, release pipelines, Playwright artefacts.
- `security` — hardening, sanitisation, sandbox, CSP.
- `deps` — dependency bumps (use `chore(deps):`).
- `infra` — toolchain, build configs, Vite / Forge / Electron Forge.

Do **not** invent new scopes per ticket. If nothing fits, use the
broader of `renderer` / `main` / `infra`. RL-XXX **never** goes in the
scope — it goes in the body if relevant.

## Heredoc safety — no double quotes, no backticks

The human pastes the message via a heredoc. Both `"` and backticks
break the heredoc.

- Use single quotes if quotation is needed.
- Refer to commands as plain words (`run npm test`, not `` `npm test` ``).
- Refer to file paths as plain text (`src/renderer/foo.ts`, not in
  backticks).

## No AI co-authorship

Never add any of these to the message:

- `Co-Authored-By: Claude …` (any model, any email).
- `Generated with Claude Code` watermark.
- Footer / trailer / signature line that attributes the change to
  Claude, an LLM, or an AI assistant.

This rule is global — it applies regardless of past or implicit
permissions. Override only when the user explicitly requests
attribution in the same turn.

## Body structure

1. **Optional first line** — a short paragraph summarising the
   ticket purpose. Skip if the subject already says everything.
2. **Bullets** — hyphen bullets enumerating concrete changes.
   Mention paths and what changed there.
3. **`Prerequisite fixes` block** (if any) — at the top of the
   bullets, prefix each fix with `- prerequisite:` for traceability.
   This is labelling for review, not a split cue. The commit stays
   single.
4. **`Follow-ups:` block** (if MED reviewer findings were deferred) —
   one bullet per deferred item, terse.

## Example

```
feat(licensing): RL-061 Slice 3 — device-pairing UI in Settings

Adds the device list and pairing flow to Settings → License. Fetches
the active devices from the licensing IPC and lets the user remove
stale pairings.

- prerequisite: tests/web/adapter.test.ts — fix locale-sensitive es
  string for offline status that was failing on a stale baseline
- src/renderer/licensing/DeviceList.tsx — new component, unit-tested
- src/main/licensing/devicesIpc.ts — listDevices and removeDevice handlers
- src/shared/licensing/devices.ts — DeviceSummary type
- en/common.json, es/common.json — pairing copy added with parity
- docs/ROADMAP.md, docs/SPRINT-PLAN.md — RL-061 Slice 3 marked Shipped
```

## Final reminder

Print the message. Do **not** run `git commit`. The human runs the
commit themselves after pasting / adapting.

# Lingua — Sprint Plan

> Tactical, iteration-level execution plan. Each iter here is **one
> `RL-XXX` ticket** in [`docs/ROADMAP.md`](./ROADMAP.md) §4, with the
> extra granularity the roadmap intentionally omits: commit sequencing,
> per-commit file list, edge-case matrix, verification steps, and draft
> commit messages.
>
> ROADMAP is the canonical ticket list + status. This file is the
> execution checklist the agent opens next to it.
>
> **One iter at a time, in the order of §2 "Recommended sequence".**
> Do not interleave commits between iters. The first line of the chat
> when starting an iter is `Executing RL-XXX — <one-liner>`.

---

## 1. Status at a glance (2026-04-22)

Mirrors the authoritative `Status` column in
[`ROADMAP.md`](./ROADMAP.md) §4. **When discrepancies appear, ROADMAP wins.**

| Iter | Ticket | Status | Scope |
|------|--------|:------:|-------|
| Iter 1 | [`RL-068`](./ROADMAP.md) · [`RL-072`](./ROADMAP.md) (QR Code) + [`RL-071`](./ROADMAP.md) (JWT verify+sign) both shipped 2026-04-23 | Shipped | Expand Developer Utilities to DevUtils parity — QR Code generate + JWT Decode/Verify/Sign modes both landed. See §3 for the closing summary. |
| Iter 2 | [`RL-028`](./ROADMAP.md) | Partial (5 of ~7 slices shipped) | Execution history — replay-by-id + comparison. See §4. |
| Iter 3 | [`RL-027`](./ROADMAP.md) | Partial (ADR only) | Debugger MVP — JS/TS first slice. See §5. |
| Iter 4 | [`RL-059`](./ROADMAP.md) | Partial | License-key infrastructure — Polar webhook + email delivery. Gates the 0.3 launch. See §6. |
| Iter 5 | [`RL-038`](./ROADMAP.md) | Partial (Slices A + B shipped) | Language-pack registry Slice C — capability-aware UI. See §7. |

Gated / deferred tickets are NOT in this table — they live exclusively in
`ROADMAP.md` until the gate clears.

## 2. Recommended sequence

Value-per-day priority. The full reasoning is in
[`ROADMAP.md`](./ROADMAP.md) §5; this list only names the next pulls.

1. **Iter 4 / RL-059** — close the licensing story (~1 week, unblocks
   `RL-061` and `RL-063`, which gate the 0.3 launch).
2. **Iter 1 / RL-068 + RL-071 / RL-072** — finish the Developer Utilities
   trailing slices (~2 days each, diverse code, no external risk).
3. **Iter 2 / RL-028** — replay + benchmarking for execution history
   (~1 week, builds on the ring buffer that already shipped).
4. **Iter 3 / RL-027** — debugger JS/TS MVP (~2 weeks, depends on nothing
   but is a bigger scope — schedule it when a longer uninterrupted block
   is available).
5. **Iter 5 / RL-038 Slice C** — capability-aware UI for language packs
   (~1 week, unblocks `RL-042` incremental language adds).

Anything Gated (none currently) stops the flow and raises a question to
the user — do not speculate a workaround.

---

## 3. Iter 1 / RL-068 — Finish Developer Utilities DevUtils parity

**One-liner**: Close the remaining ~2 DevUtils-equivalent panels that
ROADMAP §4e marks as "remaining" plus the JWT verify/sign and Base64
file-upload slices from RL-071.

**Context**: 16 panels shipped (JSON, Base64, URL, UUID, Hash, Timestamp,
JWT, Regex, Color, Diff, Number Base, Beautify/Minify, URL Parser,
String Case, HTML Entity, String Inspector). The remaining work is the
small-scope trailing slices — use them as "warm-up" work when blocked
on a launch ticket.

**3.1 Sequencing (2 commits, ~1.5 days)**:

1. **Commit 1 — QR utility (from `RL-072`)** — Shipped on 2026-04-23. See [`RL-072` in ROADMAP §4e](./ROADMAP.md) for the landed slice (PNG preview + L/M/Q/H levels + Download-as-PNG). Read mode still deferred.

2. **Commit 2 — JWT verify + sign (from `RL-071`)** — Shipped on 2026-04-23. See [`RL-071` in ROADMAP §4e](./ROADMAP.md) for the landed slice (HS256/384/512 + RS256 via Web Crypto, `src/renderer/utils/jwt.ts` extraction, panel mode toggle). ES/PS algorithms + regex replace + Base64 file upload still pending.

**3.2 Edge cases**:
- QR: empty payload → empty placeholder, not a broken SVG. Payload
  longer than QR capacity (~4000 chars at level L) → inline error, not
  exception. Unicode + emoji round-trip.
- JWT: invalid JWK → translated error. HS256 with a short key → library
  warning surfaces as a "weak key" notice. Missing `alg` claim in
  header → rejected with a pointer to the spec.

**3.3 Draft commit messages**:

```
feat(devutils): add QR Code utility panel with payload and error level selector

- new src/renderer/utils/qrCode.ts wraps the qrcode library
- new QrCodePanel renders an inline SVG preview and a Download as PNG action
- register qr-code in DeveloperUtilities catalog and lazy router
- add utilities.tool.qrCode.* keys in en and es
- unit + component tests plus a Playwright assertion in overlays.spec.ts
- bump the catalog-count assertion in commandPaletteModel test
```

```
feat(devutils): jwt verify and sign modes with Web Crypto

- extend src/renderer/utils/jwt.ts with verifyJwt and signJwt covering HS and RS
- extend JwtUtilityPanel with a decode verify sign mode toggle
- copy buttons on every produced field mirror the rest of the utilities
- add utilities.tool.jwt.verify and utilities.tool.jwt.sign keys in en and es
- unit round trip plus component + Playwright tests for mode switching
```

---

## 4. Iter 2 / RL-028 — Execution history replay + comparison

**One-liner**: Extend the ring-buffer store with per-entry replay that
re-runs the original tab content (captured snapshot), plus a
"compare two runs" view that shows a side-by-side diff of outputs.

**Context**: The ring buffer (metadata-only today) needs an opt-in
snapshot mode for replay. A Pro-gated entitlement already exists for
execution history, so we layer this on top without a new gate.

**4.1 Sequencing (3 commits, ~1 week)**:

1. **Commit 1 — snapshot mode for the ring buffer** (~2 days)
   - Add `snapshot: { code: string, language: Language } | null` to the
     store entry. Default off; a Settings toggle under Execution History
     section flips the opt-in (UI copy: "Keep a copy of the code for
     replay — off by default, stays on your machine").
   - On each `record()` call, if opt-in is on, snapshot the tab's
     current content. Otherwise `snapshot: null`.
   - Persistence contract unchanged: the store stays in-memory only
     (RL-028 §Privacy posture).
   - Tests: record with opt-in off stores null; opt-in on captures code
     + language; flipping off mid-session stops snapshots going forward
     but does not wipe existing ones.

2. **Commit 2 — replay action** (~2 days)
   - Add `Replay` button next to `Re-run` in the popover entry row.
     Replay opens a NEW tab with the snapshot code and triggers run.
     Disabled + tooltip "Opt in to snapshots to enable replay" when the
     entry has `snapshot: null`.
   - Wire a new palette action `executionHistory.palette.replay.label`.
   - Tests: click replay → new tab opened with matching code, run
     dispatched exactly once; replay on a null-snapshot entry is
     a no-op with notice.

3. **Commit 3 — compare two runs** (~2 days)
   - Add a `Compare` affordance when the user selects exactly two
     entries in the popover (checkbox UI). Opens a dedicated
     `ExecutionComparisonModal` with two side-by-side output panes and
     a summary strip (language, duration delta, exit status).
   - Reuse `diffLines` from `src/renderer/utils/diff.ts` for the
     output diff.
   - i18n keys: `executionHistory.compare.*`.
   - Tests: select 2 → Compare button enables; modal renders diffed
     output; one + two + three selections update enable state cleanly.

**4.2 Edge cases**:
- Two entries of different languages → comparison still renders but
  the summary strip notes the mismatch.
- Replay while a run is in progress → refused with a translated notice,
  no tab leakage.
- Snapshot opt-in flipped off while the popover is open → existing
  entries with snapshots stay replay-eligible.

**4.3 Draft commit messages**:

```
feat(execution-history): opt in snapshot capture for future replay

- add snapshot field to ring buffer entries gated by a Settings toggle
- persistence still in memory only to respect the existing privacy posture
- record captures code and language when the opt in is active
- cover toggle on off plus round trip tests
```

```
feat(execution-history): replay a recorded run in a new tab

- add Replay action in the history popover and the command palette
- open a new tab preloaded with the snapshot code then dispatch run
- disabled state with translated tooltip when the entry has no snapshot
- cover replay dispatch single fire and the no snapshot no op path
```

```
feat(execution-history): compare two runs with inline output diff

- add a Compare action when exactly two entries are selected
- render an ExecutionComparisonModal with side by side output panes
- reuse diffLines from utils diff for the output delta
- add executionHistory compare keys in en and es
- cover selection gating and cross language comparison
```

---

## 5. Iter 3 / RL-027 — Debugger MVP (JS/TS first slice)

**One-liner**: Minimal breakpoint + step-over debugger for JS and TS
tabs in the worker runtime. Desktop-first; web build gets a deferred
"available in desktop" notice.

**Context**: The ADR (`docs/DEBUGGER_ADR.md`) picked a V8 inspector
approach piped over IPC for desktop. No production code yet. This iter
lands the smallest end-to-end slice so the debugger surface is live and
can be iterated.

**5.1 Sequencing (5 commits, ~2 weeks)**:

Detailed sequencing to be filled in when this iter is picked. At
minimum: (a) IPC surface + main-process inspector connection; (b)
breakpoint column gutter in Monaco; (c) paused-execution side panel
with call stack + variables; (d) step over / continue / stop controls;
(e) i18n + tests + desktop smoke.

**Open questions before starting** (must be answered by the user):
- Pyodide debugger parity — in or out of the MVP?
- Source-map support for TypeScript — V8 inspector reads the transpiled
  code; do we re-map column markers to the user's TS source?

---

## 6. Iter 4 / RL-059 — License-key infrastructure (closing slices)

**One-liner**: Polar.sh webhook handler + email delivery so the full
buy-verify-activate loop is live. The verifier, Settings UI, and tier
gates are already shipped.

**Context**: RL-059 shipped the offline Ed25519 verifier, the Settings
License section, the pasted-token apply flow, and `useEntitlement()`
everywhere. The remaining gap is the server-side delivery path that
issues signed tokens after a Polar checkout completes.

**Full detail to land when this iter is picked.** Must sequence with
`RL-061` (Polar product setup) since they share the contract.

---

## 7. Iter 5 / RL-038 — Language-pack registry Slice C

**One-liner**: Make the UI capability-aware so new languages added via
`src/shared/languagePacks.ts` automatically show up in the toolbar,
file tree, tooltips, and run-button disabled states without per-call-site
code.

**Context**: Slice A (declarative registry) and Slice B (runner dispatch)
shipped. Slice C moves the remaining consumers — toolbar language menu,
file tree capability badge, Run button proOnly/desktopOnly tooltips,
and the Settings capability matrix — off their per-language switch
statements and onto `getLanguagePackById()`.

**Sequencing to be filled in when this iter is picked.**

---

## 8. Cross-iteration concerns

- **i18n parity** must stay green after each iter — both locales bump
  in the same commit that introduces a new key.
- **Coupled invariants** that frequently drift: `commandPaletteModel`
  catalog count, `appInfo.test.ts` + `adapter.test.ts` version pins.
  Update them in the same commit that bumps the corresponding source.
- **Electron boundary** — any peripheral, filesystem, or process call
  goes through `ipcMain.handle` → `preload` → `window.lingua.*`. Never
  `require('fs')` in the renderer.
- **Playwright** — every iter that adds a renderer surface extends
  `tests/e2e/overlays.spec.ts` (or a sibling) with the smallest
  assertion that would fail on regression.

## 9. Verification matrix (per iter, before the closing commit)

| Check | Command | Must pass |
|-------|---------|-----------|
| Lint | `npm run lint` | zero warnings |
| Typecheck | `npx tsc --noEmit` | zero errors |
| i18n parity | `npm run check:i18n` | both locales green |
| Renderer copy guard | `npm run check:i18n:copy` | no hardcoded user strings |
| Unit + component | `npm test -- --run` | all green |
| Playwright (web) | `npm run test:e2e:web` | when the iter touches renderer |
| Desktop smoke | `npm run smoke:desktop` | when the iter touches desktop-only IPC |
| Review skills | `typescript-react-reviewer` + `node` on the diff | zero HIGH blockers |

## 10. Closure protocol

When an iter closes, do three things in the final commit:

1. **Update this file** — move the iter row in §1 from `Partial` /
   `Planned` to `Shipped (<date>)`; shrink the iter's detailed §N
   section to a one-line "Shipped on `<date>` — see
   [`RL-XXX`](./ROADMAP.md)" reference.
2. **Update the matching row in [`docs/ROADMAP.md`](./ROADMAP.md) §4**
   — flip `Status` to `Done` (or keep `Partial` with updated
   `Readiness` if only a subset of slices shipped).
3. **If the iter introduced new docs (ADR, runbook, spec)** — register
   them in the [`docs/README.md`](./README.md) index.

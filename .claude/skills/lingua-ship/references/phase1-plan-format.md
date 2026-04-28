# Phase 1 plan format — lingua-ship

The exact structure of the plan emitted in Phase 1 step 3. Print
verbatim with all bullets present. Mark sections `n/a` when genuinely
absent — never silently drop them.

## Header

```
Proposed: RL-XXX — <one-liner copied from ROADMAP § 4 scope cell>
Status: <Partial|Planned> · Priority: <P0|P1|P2>
```

## Concrete scope

- For `Partial`: copy the pending fragment from the `Readiness` column
  in ROADMAP § 4 and mark exactly what this slice attacks now.
- For `Planned`: summarise PLAN.md scope into 4-8 bullets. Cite the
  exact `### RL-XXX` section grepped (path + heading).

## Logical-units sequence

If the ticket has more than one unit in staging, call out the order.
If `docs/SPRINT-PLAN.md § N` already lists a sequence for this ticket,
copy it verbatim. If it's one coherent unit, say so explicitly:
`Single unit, single staged diff.`

## Files to create / modify

Concrete paths grouped by directory:

- `src/renderer/...` — components / hooks / stores touched.
- `src/main/...` — IPC handlers, FS bridges, preload exports.
- `src/shared/...` — schemas, types, constants shared across boundaries.
- `tests/...` — unit / integration / smoke / e2e.
- `docs/...` — ROADMAP / SPRINT-PLAN / PLAN updates expected.
- `scripts/...` — toolchain or licensing helpers if relevant.

If a path doesn't exist yet, prefix it `[new]`.

## Entitlement decision

One of: `free`, `pro`, `pro_lifetime`, `team`, `trial`, `education`.
Flag cross-cutting if the ticket introduces a new entitlement key or
changes how an existing entitlement is checked.

## i18n keys

List per locale, both `en` and `es`. Plurals explicit with `_one` /
`_other` suffixes. Spanish copy follows tuteo Latin American
(`Pega`, `Copia`, `puedes`, `quieres` — never `Pegá`, `Copiá`,
`podés`, `querés`).

Format example:

```
en/common.json
  + license.expired.title: "Your license has expired"
  + license.expired.cta: "Renew now"
es/common.json
  + license.expired.title: "Tu licencia ha expirado"
  + license.expired.cta: "Renueva ahora"
```

## Edge cases the tests must cover

Concrete enumeration — at minimum consider:

- Empty input.
- Loading state (suspense / spinner).
- Network failure (timeout, 5xx, offline).
- Offline mode (Electron — no network at all).
- Invalid input (malformed payload, oversize, encoding issues).
- Tier-gated denial (free user hits a pro feature).
- i18n fallback (key missing in current locale).
- Reload persistence (state survives reload from localStorage / disk).
- Truncation boundaries (long strings, unicode grapheme clusters).

## Coupled invariants likely to break

Call them out by file. Common pins:

- `tests/components/commandPaletteModel.test.ts` — catalog count and
  per-id presence; bumps when a command is added or renamed.
- `tests/shared/appInfo.test.ts` — version pin (`'0.2.1'` at time of
  writing), license type, repository URL, license URL.
- `tests/web/adapter.test.ts` — web stub surface (`window.lingua.fs`
  shape, `platform === 'web'`, locale-specific message strings).

Add others the scope mentions — never assume the list above is
exhaustive.

## UI verification plan

Reference Phase 2 step 7 gates. State explicitly:

- Smoke target: `web` (preview), `electron` (smoke:desktop), or both.
- Pro-mode required? If yes, mention `npm run dev:web:pro` /
  `npm run dev:desktop:pro` and the dev token paste flow.
- Concrete testids / routes / interactions to exercise.

## PLAN.md citation

State explicitly: `Read PLAN.md § RL-XXX at <line range>` — citing the
range proves the deep reference was actually loaded, not assumed.

## Risks / open questions

List anything blocking implementation or that could pivot mid-flight.
Include the carve-out triggers from `references/inline-fix-policy.md`
if relevant (design / AC / security ambiguities you suspect).

## Time estimate

A range, not a point. Example: `30-90 min implementation, +20 min
gates and review.` Honest estimate — if uncertain, say so.

## Constraints understood

A trailing block listing the rules from AGENTS.md, the ticket's ACs,
and the constraints in `SKILL.md` that are specifically load-bearing
for this ticket. Examples:

- No `require('fs')` in renderer (main vs renderer boundary).
- New copy lands in both `en` and `es` with parity.
- Coupled-invariant tests bumped intentionally and the bump is
  justified by the ticket scope.
- Pro features remain unreachable without a verified license token.

## Wait state

After printing the plan, do not write code. Do not run mutating
commands. Wait for one of:

- `approved` → execute as-is.
- `approved with these changes: …` → fold the changes in, re-confirm
  mentally, then execute.
- `change to RL-YYY` → restart Phase 1 with the new ticket.

Without explicit input, do not assume permission to proceed.

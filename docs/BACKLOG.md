# Lingua — Backlog

> Raw capture for work that **is not yet a commitment**. Anything here
> has no acceptance criteria, no priority, or no sized scope. It is
> the buffer between "somebody had an idea" and the formal engineering
> backlog in [`docs/ROADMAP.md`](./ROADMAP.md) §4.
>
> **Promotion flow**: when an item here matures — acceptance criteria
> clear, scope sized, priority agreed — move it to `ROADMAP.md` §4 as
> a new `RL-NNN` row with `Status: Planned`, and delete it from here.
> That is the single migration direction. Items do not demote back.
>
> **What does NOT belong here**: work that already has acceptance
> criteria (that's a ROADMAP `RL-NNN` ticket), shipped work (stays in
> ROADMAP §6 archive or inside its `Partial` row's `Readiness` field),
> or deferred tickets (they keep their row in ROADMAP with the
> `Deferred study` / `Research-backed spike` / `Superseded` status).

## Conventions

- One bullet per item. Keep it short; if it needs more than two lines,
  it is already mature enough to graduate to ROADMAP as a new `RL-NNN`.
- Tag items with `[domain]` so the list is scannable. Common tags for
  Lingua: `[editor]`, `[runtime]`, `[ui]`, `[devutils]`, `[licensing]`,
  `[i18n]`, `[perf]`, `[docs]`, `[infra]`, `[bug]`, `[research]`.
- Dated captures welcome (`— 2026-04-22 (jy)`) so decay is visible.
- When you promote an item to ROADMAP, **delete the bullet here** in
  the same commit. Do not leave stale duplicates — git history is the
  audit trail.

## 1. Ideas without acceptance criteria

Product / strategic ideas that have not been sized. A human decides
whether they graduate to ROADMAP, die here, or stay pending more
research.

- _(none captured yet — add new items as short bullets with a domain tag and date)_

## 2. Small bugs / polish

Cosmetic or low-severity issues that do not warrant a dedicated
`RL-NNN` ticket. Group into a single `RL-NNN` when you have ~5 and
want to batch them into one sprint.

- [tests] Clean up the recurring React act(...) warnings across component suites so green runs are warning-free again — 2026-04-23

## 3. Spikes and research

Time-boxed exploration to decide something. Not implementation work.
Outcome is a recommendation or an ADR, not shipped feature code.

- _(none captured yet — candidates worth capturing here: service
  worker / offline cache hardening follow-up to the deferred study in
  `PLAN.md`, pt-BR locale bundle effort estimate, WebGPU-accelerated
  Monaco diff renderer feasibility)_

## 4. Parked feature requests

Requests from users, operators, or stakeholders that are real but not
currently prioritized. Note who asked and when so decay is visible.

- _(none captured yet)_

# Status Notice Priority — ADR

> Decision record for the `priority` field added to
> `StatusNotice` in RL-101 Slice 1.5. Lives under `docs/` next to
> the other ADRs so the reasoning stays close to the surface it
> changed.

## Context

`useUIStore.pushStatusNotice` is a single-slot replacement queue —
every call to `pushStatusNotice` overwrites whatever notice is
currently visible, the displaced notice's `onDismiss('auto')` fires
for telemetry attribution, and the new notice starts its 6 s TTL
fresh. This "last writer wins" contract has been the renderer
convention since RL-070 and 134 call sites depend on it.

The contract broke for RL-101's onboarding choreography. The Slice 1
reviewer pass observed the first-run toast (`onboarding.firstRun.
message` with the Save-as-snippet CTA) being clobbered within ~600 ms
of being pushed, even though `hasCompletedOnboardingFirstRun`
flipped to `true` (proving `pushStatusNotice` was invoked). A
boot-time notice from one of the 134 callers was overwriting the
onboarding toast before the user could read it. Fresh-install users
never reached the CTA, so the viral path (open a share link → see
seed → run → save snippet → browse library) was silently dead.

Two options surfaced in the Slice 1.5 plan:

1. **Pad-inicial.** Wrap the first-run toast push in
   `setTimeout(..., 800 ms)` so any boot notice ages out first.
   Mínima superficie, no schema change. Trade-off: visible latency
   between run completion and toast appearance.
2. **Priority field on `StatusNotice`.** Default `'normal'` for the
   134 legacy callers (no behavior change), `'high'` for the two
   onboarding toasts. `pushStatusNotice` refuses to swap a `'high'`
   for a `'normal'` push. Trade-off: schema change to a primitive
   that's been stable since RL-070.

## Decision

Ship option 2 (priority field). Rationale:

- **Semantically correct.** Onboarding is the only surface in the
  codebase that *cannot afford* to be replaced. Encoding that as
  data (a priority tier) is honest; baking it into a timer is a
  workaround that hides the assumption.
- **Backwards-compatible.** `priority?: 'low' | 'normal' | 'high'`
  with default `'normal'` preserves the contract every existing
  caller relies on. `pushStatusNotice` falls back to the legacy
  "last writer wins" path whenever the incoming priority is
  greater than or equal to the outstanding one.
- **Errors override priority.** A real error (`tone: 'error'`)
  bypasses the priority check unconditionally. The user always
  reaches errors, even if an onboarding toast is up.
- **Discoverable for the future.** Slice 2 of RL-101 ships the
  intro video + per-language seed variants; those choreographed
  surfaces will reuse the `'high'` tier without further plumbing.
- **Telemetry-attributed.** `onboarding.toast_clobbered { outstandingStage }`
  fires every time `'high'` saves a toast from being replaced, so
  we can measure how often the priority actually does work in the
  wild.

## Consequences

### What changes

- `src/renderer/stores/uiStore.ts` exports a new
  `StatusNoticePriority` type and adds `priority?` +
  `onSurvived?` fields on `StatusNotice`.
- `pushStatusNotice` gains a priority check before the
  replacement. The check is short-circuit: errors win, equal-tier
  pushes follow the legacy contract, lower-tier pushes are
  silently dropped (their own `onDismiss('auto')` fires so the
  pusher's telemetry stays honest).
- `useOnboardingChoreography` annotates both onboarding pushes
  with `priority: 'high'` and an `onSurvived` callback that emits
  `onboarding.toast_clobbered`.

### What doesn't change

- The 134 existing `pushStatusNotice` callers are unmodified. They
  read as `'normal'` priority by default and keep their
  last-writer-wins behaviour against other `'normal'` pushes.
- The 6 s auto-dismiss TTL stays. Error notices still require manual
  dismissal in the banner.
- The single-slot store shape stays. Notices do NOT queue.

### Migration path

Future surfaces that need to survive replacement should claim
`'high'` priority explicitly. The Slice 1.5 commit adds a single
helper pattern (the two onboarding pushes) that future code can
mirror.

### Reversal criteria

If `onboarding.toast_clobbered` never fires in production over a
30-day window, the priority field stopped earning its keep — the
underlying clobbering caller would have been fixed elsewhere, or
the scenario stopped existing. Remove the field, drop the priority
check in `pushStatusNotice`, and revert the two onboarding annotations.
The 134 legacy callers are unaffected by the removal.

## Coupled invariants

- `tests/components/StatusNoticeBanner.test.tsx` — covers the
  banner render with and without `actions`; the priority field is
  transparent to the banner.
- `tests/renderer/hooks/useOnboardingChoreography.test.tsx` —
  covers the choreography stages firing in the correct order.
- `tests/shared/telemetry.test.ts` — allow-list includes
  `onboarding.toast_clobbered`; parity test asserts renderer +
  update-server agree on the event shape.
- `tests/e2e/onboardingChoreography.spec.ts` — end-to-end smoke
  proves the toast survives boot and is interactable.

## Status

Accepted. Shipped in RL-101 Slice 1.5 (2026-05-22).

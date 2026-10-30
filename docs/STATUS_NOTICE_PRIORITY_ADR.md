# Status Notice Priority — ADR

> Decision record for the `priority` field added to
> `StatusNotice`. Lives under `docs/` next to
> the other ADRs so the reasoning stays close to the surface it
> changed.

## Context

`useUIStore.pushStatusNotice` is a single-slot replacement queue —
every call to `pushStatusNotice` overwrites whatever notice is
currently visible, the displaced notice's `onDismiss('auto')` fires
for telemetry attribution, and the new notice starts its 6 s TTL
fresh. This "last writer wins" contract has been the renderer
convention since the status notice shipped, and 134 call sites depend on it.

The contract broke for the onboarding choreography. A review
pass observed the first-run toast (`onboarding.firstRun.
message` with the Save-as-snippet CTA) being clobbered within ~600 ms
of being pushed, even though `hasCompletedOnboardingFirstRun`
flipped to `true` (proving `pushStatusNotice` was invoked). A
boot-time notice from one of the 134 callers was overwriting the
onboarding toast before the user could read it. Fresh-install users
never reached the CTA, so the viral path (open a share link → see
seed → run → save snippet → browse library) was silently dead.

Two options surfaced during planning:

1. **Pad-inicial.** Wrap the first-run toast push in
   `setTimeout(..., 800 ms)` so any boot notice ages out first.
   Mínima superficie, no schema change. Trade-off: visible latency
   between run completion and toast appearance.
2. **Priority field on `StatusNotice`.** Default `'normal'` for the
   134 legacy callers (no behavior change), `'high'` for the two
   onboarding toasts. `pushStatusNotice` refuses to swap a `'high'`
   for a `'normal'` push. Trade-off: schema change to a primitive
   that has been stable since it shipped.

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
- **Discoverable for the future.** Later onboarding work (an
  intro video + per-language seed variants) and other choreographed
  surfaces can reuse the `'high'` tier without further plumbing.
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
  dismissal in the banner. *(Superseded by the 2026-10-30 amendment: 8 s,
  sticky decisions.)*
- The single-slot store shape stays. Notices do NOT queue. *(Superseded by
  the 2026-10-30 amendment: notices queue.)*

### Migration path

Future surfaces that need to survive replacement should claim
`'high'` priority explicitly. The initial change adds a single
helper pattern (the two onboarding pushes) that future code can
mirror.

### Reversal criteria

If `onboarding.toast_clobbered` never fires in production over a
30-day window, the priority field stopped earning its keep — the
underlying clobbering caller would have been fixed elsewhere, or
the scenario stopped existing. Remove the field, drop the priority
check in `pushStatusNotice`, and revert the two onboarding annotations.
The 134 legacy callers are unaffected by the removal. *(Since the
2026-10-30 amendment, priority also sets queue order, so removing it
flattens the queue, and `onboarding.toast_clobbered` counts
lower-priority pushes that waited rather than refused swaps.)*

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

Accepted. Shipped 2026-05-22. Amended 2026-10-30: notices now queue (below).

## Amendment: one notice at a time, queued (2026-10-30)

The single slot let a later push silently replace a notice that still needed
an answer, and the bottom-right toast covered the templates on the welcome
screen and the debugger's Watches card. The replacement, TTL and single-slot
rules above are superseded by these:

- **One visible, in its own row.** The notice docks in a row above the status
  bar (at the bottom of the window when the status bar is off), so it covers
  no content. It stays above an open dialog and the compact sidebar drawer so
  a notice pushed from inside one is still reachable, and dialogs end above
  the row (`--notice-row-offset`).
- **Queued by priority.** Waiting notices show `'high'` before `'normal'`
  before `'low'`, oldest first within a tier, at most five; past that the
  least important waiting notice that is not a decision is dropped with
  `onDismiss('auto')`.
- **Sticky decisions.** Errors and notices with `sticky: true` (the session
  restore prompt, toolchain recovery, an external file change, an HTTP chain
  confirmation) stay until acted on; everything else leaves after 8 s,
  paused while hovered or focused.
- **Who takes the screen.** A new notice of equal or higher priority replaces
  a visible notice that is not sticky, so the latest thing the user did
  answers first; a replaced notice that offers an action returns to the front
  of the queue. Errors and warnings replace even a sticky notice, which comes
  back after. A lower-priority push waits, and the visible notice's
  `onSurvived` still fires.
- **Plain feedback does not pile up.** A notice with no action, no stickiness
  and normal or low priority is superseded by the next one, as before; only
  the newest waits in the queue. A repeat of a visible or waiting notice
  (same key and values) refreshes it in place.
- **Upsells pitch once per feature.** `pushUpsellNotice` shows the full
  message with *See what Pro includes* the first time a feature is blocked in
  a session; later blocks of that feature show the same message without the
  call to action.

Coverage: `tests/stores/statusNoticeQueue.test.ts`,
`tests/stores/uiStore.test.ts`, `tests/components/StatusNoticeBanner.test.tsx`,
`tests/utils/upsellNotice.test.ts`.

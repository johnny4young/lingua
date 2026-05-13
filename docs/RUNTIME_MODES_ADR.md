# ADR — JS/TS runtime modes (RL-019)

| Field   | Value      |
|---------|------------|
| Status  | Accepted   |
| Date    | 2026-05-12 |
| Slice   | 1 of 3     |

## Context

Lingua's JS/TS execution today is a single sandboxed Web Worker
(`src/renderer/runners/javascript.ts`,
`src/renderer/runners/typescript.ts`). The Worker isolation is
deliberate — it gives every tab a predictable, fast, side-effect-free
scratchpad. But it costs reach:

| User intent                       | Today with Worker | Why it fails |
|-----------------------------------|-------------------|--------------|
| `document.querySelector('h1')`    | ❌ ReferenceError | No DOM inside Workers |
| `const fs = require('fs')`        | ❌ ReferenceError | No CommonJS / Node built-ins |
| `import axios from 'axios'`       | ❌ Unresolved import | No npm resolver inside the Worker |
| `JSON.parse(big).reduce(...)`     | ✅ Fastest path | Worker isolation is ideal here |

Users hitting any of the failing cases bail out to external
scratchpads, browser playgrounds, or terminal `node script.js`.
RL-019 closes that gap
**without** losing the Worker speed for pure language work, by making
the runtime an explicit per-tab choice instead of one-size-fits-all.

The ticket also unlocks two downstream stories:

- The debugger surface (RL-027) can specialise breakpoint semantics
  per mode (Worker-only today; Node-mode breakpoints would land via
  the Node inspector protocol in a future debugger slice).
- RL-020 (best-in-class REPL) depends on the per-tab runtime model
  to offer language-aware auto-run hints (Worker: instant; Node:
  warn on long-running fs operations; Browser preview: detect when
  to flush DOM mutations).

## Decisions

### 1. Three runtime modes, JS/TS only

| Mode               | Surface           | Status (Slice 1) |
|--------------------|-------------------|------------------|
| `worker`           | Sandboxed Web Worker — no DOM, no Node built-ins | **Shipping** |
| `node`             | Desktop child-process Node with built-ins (`fs`, `path`, `http`) | Planned (Slice 2) |
| `browser-preview`  | Iframe-isolated context with DOM access + preview pane | Planned (Slice 3) |

Other languages keep their existing single-runtime model. Adding
`runtimeMode` to a Python / Go / Rust tab is out of scope here; the
language-pack capability contract from RL-038 already covers their
runner identity. The shared helper `languageHasRuntimeModes()` gates
both the UI surface and the editor-store action.

### 2. Worker stays the default

Existing JS/TS tabs continue to run in the Worker. A user who never
touches the selector experiences zero behaviour change. The default
is enforced at three layers so a regression in any one of them
leaves the other two intact:

- `defaultRuntimeModeFor('javascript' | 'typescript') === 'worker'`
  in the pure helper.
- `createDefaultTab` consults the per-app `defaultRuntimeMode` from
  Settings but coerces to `'worker'` when the setting names an
  unimplemented mode.
- Session-store rehydrate (`coerceRuntimeMode`) snaps any unknown
  or unimplemented persisted value back to `'worker'` for JS/TS.

### 3. Disabled-with-tooltip vs hidden for the unimplemented two

Slice 1 ships only `worker`. Two alternatives for `node` and
`browser-preview` were considered:

a. **Hide the unimplemented options entirely.** Cleanest UX
   today; defers discoverability until Slice 2 / Slice 3. Risk:
   users keep falling back to external scratchpads, terminal runs,
   or browser playgrounds because
   Lingua doesn't telegraph the roadmap.

b. **Render disabled with a clear "Coming soon" tooltip.**
   Slightly noisier UX; gives users a concrete schedule for the
   missing modes.

**Decision: option (b).** The audience is senior dev. They prefer
to see the roadmap and self-route to the right tool, even when the
"right tool" is "wait for the next runtime backend." The tooltip uses
plain product copy, while this ADR and the release plan keep the Slice
2 / Slice 3 delivery detail.

### 4. No silent fallback to Worker

When a user tries to switch to an unimplemented mode (via shortcut,
palette, or programmatic call), the editor store rejects the write
and pushes a status notice naming the slice that will land it
(`runtimeMode.notice.notImplementedNode` /
`runtimeMode.notice.notImplementedBrowserPreview`). We do NOT
silently fall back to `worker` because that would (a) lie about
the user's intent and (b) make Slice 2's debut surprising — users
who clicked Node yesterday and got Worker silently would, the day
Slice 2 lands, suddenly get a different runtime without their
consent.

### 5. Telemetry: closed enum, no expression content

`runtime.mode_changed` joins the `TELEMETRY_EVENTS` allowlist with a
strictly typed payload `{ mode, language }`. Both are closed enums
already on the allowlist. No file path, no source, no tab id, no
session id beyond the per-launch coarse identifier already attached
by the redactor.

Adoption metrics from this event drive prioritisation once additional
runtime backends are implemented. Slice 1 validates the allowlist and
payload contract, but rejected attempts to select unimplemented modes
remain local status notices rather than telemetry so the event name
stays literal.

The closed-enum payload contract is the same shape used by the
debugger telemetry (RL-027 Slice 1.5) and the update funnel (`update.checked`
from RL-065). The pattern is now
load-bearing — see `docs/SERVER_OBSERVABILITY.md` for the worker
log-line envelope.

### 6. Runner dispatch stays language-keyed for Slice 1

The runner registry in `src/renderer/runners/manager.ts` continues
to dispatch by `language`. Slice 1 routes `(language: 'javascript',
runtimeMode: 'worker')` to the existing JavaScript runner; the
contract surface for routing `(language: 'javascript', runtimeMode:
'node')` to a future NodeRunner ships in Slice 2 by extending the
registry — not by hijacking the language dispatch.

The reason: per-language plugin registration (RL-038) is the canon;
introducing a per-runtime registry now would double the surface
without payoff. Slice 2 can subclass `JavaScriptRunner` (or build a
sibling `NodeRunner`) and the dispatcher gains a small switch.

## Consequences

**Positive:**

- Senior-dev users see Lingua's runtime ambition without us
  shipping half-functional modes.
- The telemetry contract is ready before Slice 2 / Slice 3 add
  additional successful runtime transitions.
- The contract surface is locked: `RuntimeMode` is a closed enum,
  the editor store and session store both coerce defensively, and
  the new helper `cycleRuntimeMode()` future-proofs the keyboard
  shortcut so Slice 2 / Slice 3 land without re-wiring the
  shortcut catalog.

**Negative:**

- Two of three dropdown items are disabled in Slice 1. Some users
  will misread this as "Lingua shipped a broken feature." Mitigated
  by the explicit "Coming soon" tooltip + the ADR-grade
  rationale in this doc, which the runbook + release notes link to.
- The Settings → Editor default mode selector renders the disabled
  options too. Today it's effectively a one-option dropdown; the
  affordance is intentional to surface the future modes.

**Neutral:**

- Adding a runtime mode to other languages later (Python in a
  notebook context? Go in a desktop-only mode?) is structurally
  possible. The shared helper would extend its `JS_TS_LANGUAGES`
  set; everything else stays the same. Not in this ADR's scope.

## Implementation surface (Slice 1)

| File                                                  | Purpose                                              |
|-------------------------------------------------------|------------------------------------------------------|
| `src/shared/runtimeModes.ts`                          | Pure helpers + closed enum                           |
| `src/renderer/types/index.ts`                         | `FileTab.runtimeMode?` + `SettingsState.defaultRuntimeMode` |
| `src/renderer/stores/editorStore.ts`                  | `createDefaultTab` + `setTabRuntimeMode` action      |
| `src/renderer/stores/sessionStore.ts`                 | Persist + rehydrate with `coerceRuntimeMode`         |
| `src/renderer/stores/settingsStore.ts`                | `defaultRuntimeMode` + `setDefaultRuntimeMode`       |
| `src/renderer/components/Toolbar/RuntimeModeSelector.tsx` | JS/TS-only dropdown                              |
| `src/renderer/components/Toolbar/Toolbar.tsx`         | Mount the selector behind a JS/TS guard              |
| `src/renderer/components/Settings/EditorSection.tsx`  | Default mode select                                  |
| `src/renderer/components/CommandPalette/commandPaletteModel.ts` | Three palette entries (fold E)            |
| `src/renderer/runners/manager.ts`                     | **No Slice 1 changes** — registry stays language-keyed per Decision 6. Slice 2 extends this file with a `NodeRunner` branch. |
| `src/renderer/data/keyboardShortcuts.ts`              | `Mod+Alt+M` shortcut entry                           |
| `src/renderer/hooks/useGlobalShortcuts.ts`            | Cycle dispatcher                                     |
| `src/renderer/App.tsx`                                | Cycle implementation                                 |
| `src/shared/telemetry.ts` + `update-server/src/telemetry.ts` | `runtime.mode_changed` event (fold A)         |

## Cross-references

- `PLAN.md` § RL-019 — ticket scope and per-slice acceptance.
- `CAPABILITY_MATRIX.md` — three new rows tracking per-mode
  availability per execution class.
- `ROADMAP.md` § 4b — RL-019 flips from `Planned` to `Partial` once
  this slice lands.
- `SPRINT-PLAN.md` § N — Iter 24 / RL-019 per-commit detail.
- `DEBUGGER_ADR.md` § Coupled invariants — the debugger surface
  consumes `tab.runtimeMode` once Slice 2 lands a Node debugger
  backend.
- `RL-078` — child-process timeouts + resource limits; Slice 2's
  Node backend rides this contract.

## Reviewers

- First recorded decision: 2026-05-12.
- Slice 1 implementation: 2026-05-12, same day as the decision.
- Slice 2 / Slice 3 owner: maintainer (TBD per upstream Node-sandbox
  scheduling).

## Rollback

If the selector turns out to confuse users more than it helps:

1. Revert the Toolbar mount (`Toolbar.tsx` JS/TS guard) to hide the
   selector. The editor store, session store, telemetry, and
   command-palette entries can stay — they're inert without a UI
   entry point.
2. The `runtimeMode` field persisted on existing FileTabs remains
   harmless; the runner registry still dispatches by language so
   stale `runtimeMode: 'worker'` does nothing.
3. If we need to drop the data too: bump the session-store version
   and skip `runtimeMode` in the `merge`. Coverage in
   `tests/stores/sessionStore.test.ts` would need an entry for the
   version bump.

Full revert by `git revert <slice-1-commit>` is supported — the
slice is contained.

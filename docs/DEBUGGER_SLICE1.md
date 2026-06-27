# Debugger MVP — Slice 1 + 1.5 runbook (RL-027)

> Operator-oriented walkthrough of the JS/TS debugger that ships in
> Slice 1 (instrument + worker protocol) and Slice 1.5 (user-facing
> surface). Read alongside [`DEBUGGER_ADR.md`](./DEBUGGER_ADR.md) for
> the design rationale; RL-027 in the internal plan owns the
> ticket-level scope and status.

## What the user sees

After Slice 1.5 ships:

- A red dot in the Monaco gutter whenever a breakpoint is set on the
  current tab. Click an empty gutter cell to add a breakpoint; click
  an existing dot to remove it. The keyboard path is `Mod+Shift+B`
  (Cmd+Shift+B on macOS / Ctrl+Shift+B elsewhere) — toggles the
  breakpoint at the cursor line without leaving the editor.
- A **Debugger** tab inside the existing resizable bottom panel. It
  becomes available when the panel is open and the active tab has at
  least one breakpoint, and Debug opens it automatically when a
  session attaches. It shares the same bottom-panel splitter as
  Console. The header carries Continue (F5), Step Over (F10), Step
  Into (F11), Step Out (Shift+F11), and Run to end buttons. The
  chevron at the top-left collapses/expands the debugger body; the
  choice persists across reloads.
- A Run/Debug split dropdown for JavaScript and TypeScript tabs. The
  primary side executes the selected mode and the chevron opens the
  alternate actions. **Run** always executes normally and ignores
  breakpoints; **Debug** attaches the pause protocol and runs until
  the first enabled breakpoint.
- Breakpoint status lives in the **Debugger** tab, not the top
  toolbar. The tab shows the active file count; the panel header shows
  enabled/total status plus **Disable all / Enable all** and **Clear**
  actions.
- **Settings → Editor** keeps only the stable **Debugger** preference:
  the master switch (`debuggerEnabled`). Breakpoint session actions
  stay in the Debugger panel.

## Enabling the debugger

`debuggerEnabled` defaults to `true`. If a user has flipped it off,
they re-enable it from Settings → Editor. The flag persists across
sessions via `lingua-settings` localStorage.

When the flag is off:

- Gutter clicks are no-ops.
- The Debugger tab never mounts.
- The keyboard shortcut is silently ignored.

## Setting a breakpoint

1. Open or create a JavaScript or TypeScript tab.
2. Click the gutter to the LEFT of the line number, OR move the
   cursor to the line and press `Mod+Shift+B`.
3. The red dot appears in the gutter. Opening the bottom panel exposes
   the Debugger tab, and pressing Debug switches to it automatically.

Breakpoints are capped at 100 global (FIFO eviction of the oldest).
A user who hits the cap sees the oldest breakpoint silently drop —
this is intentional so a misclick spam can't blow the localStorage
budget. The cap is enforced at the store level; the UI does not
warn.

## Pausing a run

1. With at least one enabled breakpoint set, open the Run dropdown and
   choose **Debug**. `Mod+Enter` / **Run** remains a normal execution
   path and does not pause on breakpoints.
2. The runner sees the explicit debug intent, `debuggerEnabled`, and
   the active tab's enabled breakpoint set, then switches into debug
   mode:
   - Loop protection is disabled for the run (the ADR §4 mandates this
     so a paused breakpoint inside a loop doesn't get killed).
   - The JS source (or post-esbuild TS-as-JS) is instrumented with
     `await __lingua_dbg_yield(line, () => locals)` before each
     statement.
   - The session is attached and the bridge is registered.
3. When the worker hits a yield matching an enabled breakpoint, the
   `paused` message is posted; the Debugger tab flips to the paused state
   with locals + call stack + watch placeholders, Monaco highlights
   the entire paused line in the danger color, and any console output
   emitted before the pause is already visible in the result panel.
   The parent timeout is suspended until Continue / Step resumes the
   worker, so an intentional pause does not surface as a 30 s timeout.

## Stepping

- **Continue (F5)** — resumes until the next breakpoint or the run
  finishes.
- **Step Over (F10)** — runs the current line and pauses on the next
  line in the same or shallower frame.
- **Step Into (F11)** — pauses on the next yielded line anywhere,
  including inside local synchronous JS / TS functions. Debug mode
  promotes those local functions and awaits direct calls so entering
  `llamar(i)` works without changing normal Run semantics.
- **Step Out (Shift+F11)** — runs until the current frame returns.
  The control is disabled while paused at top level because there is
  no active function frame to exit.
- **Run to end** — clears the active debug breakpoints for this
  worker and resumes, so execution finishes without stopping again.

The shortcut gate (`canDispatchDebuggerShortcut` in
`useGlobalShortcuts`) requires the worker to be paused before F5 /
F10 / F11 / Shift+F11 fire, so they never compete with normal-mode
keystrokes. `Mod+Shift+B` is exempt from the paused-worker gate, but
still requires a debugger-capable JS / TS tab plus an editor cursor.

## TS source-map composition (Slice 1.5 fold G)

When the active tab is TypeScript, the runner asks esbuild for an
external source map and passes it to `instrumentForDebugger` via the
`inputMap` option. The instrumenter wraps the map in
`@jridgewell/trace-mapping` and translates every AST line from the
post-transpile JS coordinate to the original TS line via
`originalPositionFor`. The yield helper therefore fires with the TS
line number, which matches the user's breakpoint coordinates 1:1.

For pure JS the translator is a passthrough — the AST's lines are
already in the user's coordinate space.

When the input map is malformed or missing, the translator falls
back to the JS line. This is strictly less surprising than dropping
the yield: the user still pauses, just at the post-transpile
coordinate instead of the original.

## Telemetry

Three events join the allowlist per [ADR §4](./DEBUGGER_ADR.md):

| Event | When it fires | Payload |
|-------|---------------|---------|
| `debugger.attached` | Runner attaches a session before posting `execute` | `{ language: 'js', reasonBucket: 'attach' }` |
| `debugger.paused` | Worker yields and the renderer posts a paused frame | `{ language: 'js', reasonBucket: 'user-breakpoint' \| 'step' \| 'exception' }` |
| `debugger.detached` | Session ends (run complete / crash / stop / user detach) | `{ language: 'js', reasonBucket: 'run-complete' \| 'crash' \| 'stop' \| 'user-detach' }` |

Every payload is closed-enum. The redactor in `src/shared/telemetry.ts`
drops any key that isn't on the per-event allowlist. No source, no
breakpoint coordinates, no expression content.

## Limitations carried over to Slice 1.5b

- **Conditional-breakpoint predicate evaluation** is not yet wired —
  the store accepts a `condition` string but the worker treats it as
  always-true. Slice 1.5b will land the eval pass behind a dedicated
  security note (the dynamic-Function-constructor pattern triggered
  the security_reminder hook during Slice 1, and the carve-out in the
  inline-fix policy keeps this deferred until the review).
- **Watch-expression evaluation** has the same gate. The UI renders
  watches as `pending` markers until the eval pass lands.
- **Python / Go / Rust** adapters are still `'planned'` in
  `LANGUAGE_PACKS`. The capability matrix row (this section's
  sibling entry in [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md))
  marks them desktop-only per the ADR.

## Recovering a wedged session

If the Debugger tab is stuck in paused mode:

1. Click **Run to end** in the Debugger header (fires
   `debugger.detached` with `reasonBucket='user-detach'`, clears this
   worker's breakpoint set, and resumes it).
2. If the button doesn't respond, refresh the renderer; the
   `session` and `pausedFrame` fields are NOT persisted, so a
   reload always returns the Debugger tab to its idle state.
3. The breakpoints themselves DO persist; they survive the reload
   unchanged.

## Layout safety

The Debugger surface is mounted by `BottomPanel`, as a sibling tab to
Console. The bottom panel is already resizable through
`react-resizable-panels`, so debugger height is adjustable without a
second custom splitter. This placement keeps the editor/results group
intact while paused and avoids the earlier drawer competing with the
inline output column.

## Related files

- `src/renderer/stores/debuggerStore.ts` — the runtime-agnostic
  state machine (breakpoints, watches, session, pausedFrame,
  drawerCollapsed).
- `src/renderer/runtime/debuggerInstrument.ts` — acorn + magic-string
  AST instrumentation with trace-mapping composition for TS.
- `src/renderer/runtime/debuggerWorkerBridge.ts` — postMessage shim
  between the UI and the worker.
- `src/renderer/runtime/editorAccess.ts` — module-level Monaco
  editor ref so the shortcut bus can read the cursor line.
- `src/renderer/hooks/useBreakpointGutter.ts` — Monaco glyph-margin
  decorations + click-handler binding.
- `src/renderer/components/Debugger/DebuggerDrawer.tsx` — paused-frame
  panel with locals / call stack / watches.
- `src/renderer/workers/js-worker.ts` — yield helper + pause loop.
- `src/renderer/runners/javascript.ts` + `typescript.ts` — debug-mode
  resolution + telemetry call-sites.

# Debugger operator guide

> Operator-oriented walkthrough of the JavaScript, TypeScript, and desktop
> Python debugger.
> Read alongside [`DEBUGGER_ADR.md`](./DEBUGGER_ADR.md) for its design
> rationale and [`CAPABILITY_MATRIX.md`](./CAPABILITY_MATRIX.md) for the
> current language and platform boundaries.

## What the user sees

The current implementation provides:

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
- A Run/Debug split dropdown for JavaScript, TypeScript, and desktop Python
  tabs. The
  primary side executes the selected mode and the chevron opens the
  alternate actions. **Run** always executes normally and ignores
  breakpoints; **Debug** attaches the pause protocol and runs until
  the first enabled breakpoint.
- Breakpoint status lives in the **Debugger** tab, not the top
  toolbar. The tab shows the active file count; the panel header shows
  enabled/total status plus **Disable all / Enable all** and **Clear**
  actions. Each breakpoint row can be enabled, removed, or changed between a
  normal pause, conditional pause, and logpoint.
- A **Watches** section remains available before and during a session. Add a
  bounded expression once; its value or evaluation error refreshes at every
  pause.
- **Settings → Editor** does not contain a debugger master switch or
  breakpoint-management actions. Debugging is baseline for JavaScript and
  TypeScript in both shells and Python on desktop, while normal **Run** ignores
  all breakpoint state.

## Setting a breakpoint

1. Open or create a JavaScript, TypeScript, or (on desktop) Python tab.
2. Click the gutter to the LEFT of the line number, OR move the
   cursor to the line and press `Mod+Shift+B`.
3. The red dot appears in the gutter. Opening the bottom panel exposes
   the Debugger tab, and pressing Debug switches to it automatically.

Breakpoints are capped at 100 global (FIFO eviction of the oldest).
A user who hits the cap sees the oldest breakpoint silently drop —
this is intentional so a misclick spam can't blow the localStorage
budget. The cap is enforced at the store level; the UI does not
warn.

## Configuring breakpoint modes

Open the bottom panel's **Debugger** tab after creating a breakpoint. Every
active-file row has three modes:

- **Pause** — stop whenever execution reaches the line.
- **Conditional** — evaluate one bounded expression over the current locals
  snapshot. A false result skips the breakpoint. An invalid expression pauses
  fail-safe and shows why it could not be evaluated.
- **Logpoint** — write a message and continue without pausing. Use
  `{expression}` placeholders to include safe local values; use `{{` and `}}`
  for literal braces.

The gutter distinguishes these modes: pause uses a circle, conditional uses a
diamond in the danger color, and logpoint uses an amber diamond. Disabled
markers retain their shape at lower opacity. Mode, condition, log message, and
enabled state persist with the breakpoint.

Python supports standard **Pause** breakpoints only. Existing conditional or
logpoint metadata remains persisted if a tab changes language, but Python
treats every enabled breakpoint as a pause and hides the advanced editors.

## Watching values

Enter a data expression in **Watches** and choose **Add**. Lingua evaluates the
list at every pause and when a watch changes during an active pause. Results
are session-only; the expression list persists across reloads.

The evaluator supports literals, local identifiers, arrays and object
literals, own-property access, optional chaining, templates, arithmetic,
strict equality, relational and logical operators, and conditional
expressions. It intentionally rejects calls, constructors, assignments,
updates, accessors, inherited properties, prototype traversal, `await`,
`yield`, and loose equality. Expressions are capped at 512 characters.

That bounded, side-effect-free evaluator is the JavaScript/TypeScript path.
Python sends each watch to `pdb` in the current native frame, so an expression
can call Python code or otherwise have side effects. The panel warns about this
and caps the list and expression length, but users must evaluate only
expressions they trust.

## Pausing a run

1. With at least one enabled breakpoint set, open the Run dropdown and
   choose **Debug**. `Mod+Enter` / **Run** remains a normal execution
   path and does not pause on breakpoints.
2. The runner sees the explicit debug intent and the active tab's enabled
   breakpoint set, then switches into debug
   mode:
   - Loop protection is disabled for the run (the ADR §4 mandates this
     so a paused breakpoint inside a loop doesn't get killed).
   - The JS source (or post-esbuild TS-as-JS) is instrumented with
     `await __lingua_dbg_yield(line, () => locals)` before each
     statement.
   - The session is attached and the bridge is registered.
3. When the worker hits a yield matching an enabled breakpoint, the
   `paused` message is posted; the Debugger tab flips to the paused state
   with locals + call stack + evaluated watches, Monaco highlights
   the entire paused line in the danger color, and any console output
   emitted before the pause is already visible in the result panel.
   The parent timeout is suspended until Continue / Step resumes the
   worker, so an intentional pause does not surface as a 30 s timeout.

### Python desktop path

Python **Debug** never changes normal Python **Run**. Run continues to use
Pyodide in the browser worker. On desktop, Debug instead:

1. shows the native-execution acknowledgement the first time because the code
   runs as a normal local process, not in a sandbox;
2. sends the current in-memory buffer, enabled line breakpoints, watches, argv,
   user environment, and optional project capability to the typed preload
   bridge;
3. writes a private temporary `.py` source, derives only the approved project
   cwd, and selects `.venv`/`venv` Python before `python3`/`python` on `PATH`;
4. drives `python -u -m pdb` with serialized commands and returns locals,
   source-local stack frames, watches, program output, and pause reasons to the
   shared Debugger panel.

Each command retains at most 1 MB of combined debugger/program output and
surfaces a truncation warning. One owner can have one active Python debugger;
starting a replacement, Stop, Run to end completion, command failure, renderer
destruction, or app quit terminates the process tree and removes the temporary
source. Web omits this bridge and disables Python Debug with desktop guidance.

### Go desktop path

Go **Debug** leaves normal Go **Run** unchanged. On desktop, Debug instead:

1. reuses the native-execution acknowledgement because the buffer becomes a
   host process with the user's local permissions;
2. writes the current buffer and a minimal `go.mod` into a private temporary
   module, while an optional approved project capability supplies only the cwd;
3. resolves `dlv` from `PATH`, `GOPATH/bin`, or the conventional `~/go/bin`,
   then starts `dlv dap` on an ephemeral loopback port without a shell;
4. drives standard DAP requests for verified breakpoints, stepping, locals,
   source-local stack frames, watches, and bounded program output.

Install Delve with `go install github.com/go-delve/delve/cmd/dlv@latest` and
ensure the resulting binary is on `PATH` (or under `GOPATH/bin`). On macOS,
Delve also needs Developer Tools access; if the OS blocks launch, Lingua stops
the session and surfaces permission guidance rather than leaving a spinner.
The current-buffer temporary module intentionally does not become a full
project debugger: local multi-file/module debug remains outside this slice.
Web omits the bridge and disables Go Debug with desktop guidance.

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
still requires a debugger-capable JS / TS tab or desktop Python/Go tab plus an
editor cursor.

## TypeScript source-map composition

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
| `debugger.attached` | Runtime attaches a session before execution continues | `{ language: 'js' \| 'python' \| 'go', reasonBucket: 'attach' }` |
| `debugger.paused` | Worker or native adapter publishes a paused frame | `{ language: 'js' \| 'python' \| 'go', reasonBucket: 'user-breakpoint' \| 'step' \| 'exception' }` |
| `debugger.detached` | Session ends (run complete / crash / stop / user detach) | `{ language: 'js' \| 'python' \| 'go', reasonBucket: 'run-complete' \| 'crash' \| 'stop' \| 'user-detach' }` |

Every payload is closed-enum. The redactor in
`src/shared/telemetry/redaction.ts` drops any key that isn't on the per-event
allowlist. No source, no breakpoint coordinates, no expression content.

## Current limitations

- **Rust** debugging remains planned in `LANGUAGE_PACKS`.
- **Go Debug is desktop-only** and requires local Go plus Delve. It debugs the
  current buffer in a temporary single-file module, not an entire saved module.
  Watches run inside the native process and standard pause breakpoints are the
  only supported breakpoint mode.
- **Python Debug is desktop-only** and requires a working host interpreter.
  It supports standard pause breakpoints, not conditional breakpoints or
  logpoints, and its watches run inside the native process.
- Python call-stack display intentionally includes frames from the temporary
  current-buffer script; imported-library frames are not presented as editable
  Lingua source.

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
- `src/renderer/runtime/debuggerControlBridge.ts` — shared control router for
  the JS worker and native adapters.
- `src/renderer/runtime/nativeDebuggerBridge.ts` — runtime-neutral renderer
  execution/session lifecycle used by Python and Go.
- `src/renderer/runtime/pythonDebuggerBridge.ts` — lazy desktop renderer
  adapter that joins native responses to the shared execution lifecycle.
- `src/shared/pythonDebugger.ts` — bounded typed preload/IPC contract.
- `src/main/ipc/pythonDebugger.ts` — capability-aware owner lifecycle,
  interpreter selection, inspection, and cleanup.
- `src/main/pythonDebugger.ts` — serialized, output-bounded `pdb` protocol
  engine.
- `src/renderer/runtime/goDebuggerBridge.ts` — lazy Go wrapper for the shared
  native lifecycle.
- `src/shared/goDebugger.ts` — bounded typed Go preload/IPC contract.
- `src/main/ipc/goDebugger.ts` — capability-aware owner lifecycle, temporary
  module preparation, Delve resolution, and cleanup.
- `src/main/goDebugger.ts` + `src/main/debugger/dapClient.ts` — Delve process,
  bounded DAP transport, inspection, and transition engine.
- `src/renderer/runtime/editorAccess.ts` — module-level Monaco
  editor ref so the shortcut bus can read the cursor line.
- `src/renderer/hooks/useBreakpointGutter.ts` — Monaco glyph-margin
  decorations + click-handler binding.
- `src/renderer/components/Debugger/DebuggerDrawer.tsx` — breakpoint,
  watch, paused-frame, locals, and call-stack orchestration.
- `src/renderer/components/Debugger/DebuggerBreakpointList.tsx` — active-file
  mode, condition, logpoint, enabled-state, and removal controls.
- `src/renderer/components/Debugger/DebuggerWatchList.tsx` — persistent watch
  expressions and per-pause results.
- `src/renderer/workers/debuggerExpression.ts` — detached scope snapshots,
  allowlisted expression interpreter, and bounded logpoint templates.
- `src/renderer/workers/js-worker.ts` — stable worker entrypoint; protocol,
  execution, debugger state, and serialization live in focused sibling modules.
- `src/renderer/runners/javascript.ts` + `typescript.ts` — debug-mode
  resolution + telemetry call-sites.

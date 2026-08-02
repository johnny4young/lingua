# ADR — Debugger MVP

| Status | Accepted — implemented for JavaScript / TypeScript and desktop Python, Go, and Rust |
| ------ | ----------------- |
| Decision | Ship a focused debugger MVP targeting JavaScript / TypeScript first via a Monaco-integrated custom breakpoint panel, then Python via a `pdb` IPC bridge, then Go via Delve, then Rust via lldb. Every runtime after JS/TS is desktop-only. |
| Date | 2026-04-20 |
| Implementation start | JavaScript / TypeScript plus desktop Python, Go, and Rust are shipping. |

## Context

internal sat at `Planned` with no decision on which debugger
primitives Lingua ships, which runtimes get them, and in what order.
The acceptance line asks for a debugger MVP without prescribing the
shape. This ADR picks a shape that:

1. Works in **both** the web build (JavaScript / TypeScript only)
   and the Electron shell (all runtimes).
2. Stays aligned with `CAPABILITY_MATRIX.md` — Go, Rust, Python
   debuggers require subprocess-level access and are explicitly
   desktop-only. The JS/TS debugger runs in-browser on top of
   Monaco.
3. Does not commit Lingua to maintaining a Rust shell or to
   importing a heavyweight DevTools frontend.

## Decisions

### 1. Runtime matrix

| Runtime | Strategy | Target | Status |
|---------|----------|--------|--------|
| JavaScript / TypeScript | Monaco-integrated breakpoint panel driven by source maps; step, bounded watches, conditional breakpoints, and logpoints via worker-side debugger hooks | web + Electron | Shipping |
| Python | `pdb` bridge via IPC — spawn a headless `python -u` with the `pdb` module attached; renderer sends breakpoint / step / continue commands, main streams stdout and stop events | Electron only | Shipping |
| Go | `dlv` (Delve) bridge via IPC — start Delve in headless DAP mode and drive it over loopback TCP | Electron only | Shipping |
| Rust | compile the current buffer with debug symbols, then drive host `lldb-dap` over stdio DAP | Electron only | Shipping |

### 2. Feature budget

The MVP ships exactly:

- **Breakpoints** — set / remove in the gutter; persist across
  reloads per tab.
- **Step over / into / out / continue** — standard semantics.
- **Watch expressions** — user-defined expressions evaluated at
  every pause; results displayed in a side panel.
- **Call stack view** — read-only, per pause.
- **Variable inspection** — top-level locals + args at the current
  frame.

Out of scope for the MVP:

- Time-travel debugging.
- Remote / distributed tracing hooks.
- Edit-and-continue.

### 3. UI shape

Debugger content lives as a tab in the existing resizable bottom
panel, alongside Console. This keeps the inline-results column
visible while a run is paused and gives the user the same splitter
to allocate vertical space. Keyboard shortcuts mirror VS Code defaults
(`F5` continue, `F10` step over, `F11` step into, `Shift+F11` step
out). The shortcuts bus already lives in
`src/renderer/data/keyboardShortcuts.ts` so they plug in via the
existing internal editable shortcut mapper.

### 4. Cross-cutting concerns

- **Source maps** — esbuild-wasm already ships source maps in the
  TS runner; the JS runner must emit source maps too for the
  breakpoint positions to map correctly.
- **Env vars** — the implementation env merger already hands user
  env to Go / Rust / Python subprocesses. The debugger slices
  reuse that plumbing; nothing new.
- **Loop protection** — the existing internal loop protection must
  be disabled while the debugger is attached (it would kill any
  paused execution). Gate via a store flag the debugger sets on
  attach.
- **Telemetry** — emit `debugger.attached`, `debugger.paused`, and
  `debugger.detached` as new events. All three are `P1` additions to
  `TELEMETRY_EVENTS`; payload stays to `language` + a coarse
  `reasonBucket` (`attach` for attached; `user-breakpoint` / `step` /
  `exception` for paused; `user-detach` / `run-complete` / `crash` /
  `stop` for detached). No source, no code, no expression content. The
  third event (`debugger.detached`) was added in implementation note so
  dashboards can compute median session length from the attach→detach
  pair.

### 5. Expression-evaluation boundary

Watch expressions, conditional breakpoints, and logpoint placeholders are a
separate input surface from the program being debugged. Lingua does not pass
them to `eval`, `Function`, or the runtime's global scope.

The worker instead:

1. copies current locals into a detached, bounded snapshot containing only own
   data properties;
2. parses one expression with Acorn;
3. interprets an allowlisted data-oriented syntax with step and depth budgets;
4. returns only bounded values or a stable error.

Calls, constructors, assignments, updates, accessors, inherited properties,
prototype traversal, `await`, and `yield` are rejected. Loose equality is also
rejected rather than approximated; use `===` or `!==`. A malformed condition
pauses fail-safe and explains the error instead of silently skipping the line.
Logpoints interpolate bounded `{expression}` placeholders, publish their text
through normal debugger output, and continue without pausing.

This bounded interpreter applies to JavaScript and TypeScript. Python, Go, and Rust
watches are evaluated inside their native debugged processes, so they can
invoke runtime behavior and have side effects. The native UI says so explicitly
and ships only standard pause breakpoints; conditional breakpoints and logpoints
remain JS/TS-only until a separate native-expression policy is accepted.

## Implementation sketch (for the follow-up work)

- **JS/TS slice (shipping)**: Monaco `IEditor` decorations for pause,
  conditional, and logpoint markers; one renderer debugger session that hooks
  into the existing JS worker; a bounded worker-side expression interpreter;
  and one worker lifetime per attached tab. The session is torn down on tab
  close or detach.
- **Python slice (shipping)**: typed `debugger:python:*` IPC and preload bridge,
  an owner-bound main session that drives `python -u -m pdb <tempfile>`, and a
  lazy renderer adapter that reuses the breakpoint gutter, Debugger panel,
  shared run lifecycle, and shortcuts. Main prefers project `.venv`/`venv`,
  filters the environment, caps output, and cleans up on every owner lifecycle.
- **Go slice (shipping)**: typed `debugger:go:*` IPC and preload bridge,
  owner-bound `dlv dap --listen=127.0.0.1:0` process, bounded DAP framing in
  main, and a lazy renderer adapter that reuses the shared native lifecycle,
  breakpoint gutter, Debugger panel, and shortcuts. Main resolves Delve from
  the filtered Go environment and cleans up the process tree plus private
  temporary module on every owner lifecycle.
- **Rust slice (shipping)**: typed `debugger:rust:*` IPC and preload bridge,
  private Rust 2021 compilation with debug symbols, and owner-bound
  `lldb-dap` over stdio. Rust and Go share bounded DAP framing, request/event
  correlation, stepping, inspection, output, and teardown through
  `debugger/nativeDapSession.ts`; their transport, launch, tool discovery, and
  failure taxonomy remain runtime-specific.

## Rollback

- Debugging is a baseline JS/TS capability rather than a Settings opt-in. The
  user can disable individual breakpoints, disable all breakpoints, clear the
  list, or choose normal Run, which ignores debugger state.
- Each runtime implementation ships behind its own capability gate so a
  broken Delve or LLDB install does not affect another debugger.
- Telemetry events use the existing allowlist mechanism — no
  payload can leak code without the redactor deliberately ignoring
  the deny list, which the guard tests pin.

## When to revisit

1. Chrome DevTools Protocol or monaco APIs change enough that
   our breakpoint integration regresses — re-evaluate the
   JS/TS strategy.
2. Delve or lldb-dap become hostile to DAP embedding
   (license, protocol break) — move that runtime to `pdb`-style
   stdout-parsing if cheaper.
3. A community-maintained DevTools overlay emerges with a stable
   API — reconsider whether the custom panel is still the right
   call.
4. The feature budget above no longer matches user demand — graduate to a
   post-MVP ADR rather than expanding scope implicitly.
5. Edit-and-continue becomes possible in Monaco for free —
   revisit the "out of scope" list.

## Adjacent ADRs

- `BUILD_SYSTEM_ADR.md` — the bundler + source-map pipeline that
  the JS/TS debugger relies on lives here.
- `LANGUAGE_PACK_ADR.md` — future LanguagePacks that declare
  `capabilities.debugger: 'available' | 'planned'` gate the
  Debugger tab per language.
- `CAPABILITY_MATRIX.md` — codifies Python, Go, and Rust debugging as shipping
  desktop-only capabilities.
- `ENV_VARS_ADR.md` — implementation env merger is the plumbing the
  debugger subprocess slices inherit for free.

## Cross-links

- internal in the implementation notes — this ADR flips it from `Planned` to
  `Partial` with the note "MVP design accepted; initial implementation still
  to ship".
- implementation and implementation are hard dependencies for the
  Go / Rust / Python slices.
- `DEBUGGER.md` — operator runbook for implementation + 1.5
  (gutter UX, Debugger tab mount, Settings rows, telemetry events,
  TS source-map composition).

## Delivery notes (added 2026-05-11)

- **Debugger foundation shipped 2026-05-09.** Store + acorn instrumenter
  + worker pause protocol + JS/TS runner wiring + unmounted debug surface +
  4 keyboard shortcuts. Three items were explicitly deferred to a
  follow-up: BreakpointGutter Monaco UI, mounted debug surface, visible
  Settings toggle.
- **User-facing debugger shipped 2026-05-11.** Closes the user-facing surface
  by mounting the breakpoint gutter, the Debugger panel, and the
  Settings master toggle. Adds three telemetry events
  (`debugger.attached` / `debugger.paused` / `debugger.detached`),
  flips JS+TS language-pack `capabilities.debugger` from `'planned'`
  to `'available'`, and composes esbuild's TS→JS source map with
  the instrumenter's JS→JS map via `@jridgewell/trace-mapping` so
  breakpoints in `.ts` files pause at the user's TS line number.
- **Debugger controls.** The Debugger panel owns
  Clear-all-breakpoints (A), Disable all / Enable all (F), and the
  active file breakpoint count (D). The Debugger header carries a
  chevron that persists the collapsed state (B); the
  `debugger.detached` event joins the ADR-named pair so dashboards
  can compute median session length (E).
- **UX refinement shipped 2026-05-12.** The toolbar now groups
  **Run** and **Debug** into one split dropdown for JS/TS. Run ignores
  breakpoints; Debug is explicit, requires an enabled breakpoint,
  attaches the pause protocol, streams console output while paused,
  suspends the parent timeout during the pause, maps instrumented
  console lines back to the user's source, highlights the paused
  source line, and renders the debugger as a tab in the existing
  resizable bottom panel instead of a separate drawer below the
  editor/results area. The same refinement promotes local JS/TS
  functions during Debug so Step Into can enter normal functions
  while Run remains byte-for-byte normal execution.
- **Bounded expressions shipped 2026-08-01.** Watches evaluate at every pause,
  conditional breakpoints skip only when their safe expression is false, and
  logpoints interpolate safe placeholders without pausing. The implementation
  deliberately replaced the proposed dynamic-Function path with the bounded
  data-only interpreter described in Decision 5. Breakpoint modes and their
  inputs persist through a schema migration; watch results and errors remain
  session-only.
- **Desktop Python debugger shipped 2026-08-01.** Python tabs can select Debug,
  pause on enabled gutter breakpoints, continue or step over/into/out, inspect
  locals and the source-local call stack, and refresh watches through host
  CPython/pdb. The bridge is capability-aware, owner-bound, output-bounded, and
  lazy in the renderer. Normal Python Run remains Pyodide; web disables Python
  Debug, and the native watch/advanced-breakpoint limitations remain explicit.
- **Desktop Go debugger shipped 2026-08-01.** Go tabs use owner-bound Delve
  DAP sessions with filtered toolchain environment data, private temporary
  modules, bounded traffic/output, source-local inspection, and actionable
  missing-binary or Developer Tools guidance.
- **Desktop Rust debugger shipped 2026-08-01.** Rust tabs compile the current
  buffer with Rust 2021 debug symbols and drive host `lldb-dap` over stdio.
  The bridge distinguishes compiler, adapter, compilation, protocol, and
  macOS permission failures; reuses the native renderer lifecycle; and removes
  every temporary source, binary, adapter, and debuggee process on teardown.
- **Desktop Go debugger shipped 2026-08-01.** Go tabs can select Debug and
  drive Delve through the standard DAP transport for breakpoints, stepping,
  locals, source-local call stack, watches, output, and stop. The bridge is
  loopback-only, owner-bound, message/output-bounded, and lazy in the renderer.
  Normal Go Run remains unchanged; web disables Go Debug, missing Delve and
  macOS Developer Tools permission are actionable failures, and native watch
  side effects plus pause-only breakpoint limits remain explicit.

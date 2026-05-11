# ADR — Debugger MVP (RL-027)

| Status | Accepted — design |
| ------ | ----------------- |
| Decision | Ship a focused debugger MVP targeting JavaScript / TypeScript first via a Monaco-integrated custom breakpoint panel, then Python via a `pdb` IPC bridge, then Go via Delve, then Rust via lldb. Every runtime after JS/TS is desktop-only. |
| Date | 2026-04-20 |
| Implementation start | Unblocked by this ADR. The first code slice targets the JS/TS layer (breakpoints + step + watch). Each subsequent language is its own slice. |

## Context

RL-027 sat at `Planned` with no decision on which debugger
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
| JavaScript / TypeScript | Monaco-integrated breakpoint panel driven by source maps; step + watch via worker-side debugger hooks | web + Electron | First slice |
| Python | `pdb` bridge via IPC — spawn a headless `python -u` with the `pdb` module attached; renderer sends breakpoint / step / continue commands, main streams stdout and stop events | Electron only | Second slice |
| Go | `dlv` (Delve) bridge via IPC — start Delve in headless mode and pipe JSON-RPC commands | Electron only | Third slice |
| Rust | `lldb` (macOS / Linux) or `lldb-mi` via IPC — same IPC shape as Go once the JSON layer exists | Electron only | Fourth slice |

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
- Conditional breakpoints (can land as a post-MVP slice).
- Logpoints / tracepoints.
- Remote / distributed tracing hooks.
- Edit-and-continue.

### 3. UI shape

Single collapsible drawer below the editor (same footprint as the
console panel). When active it replaces the inline-results column
on narrow layouts. Keyboard shortcuts mirror VS Code defaults
(`F5` continue, `F10` step over, `F11` step into, `Shift+F11` step
out). The shortcuts bus already lives in
`src/renderer/data/keyboardShortcuts.ts` so they plug in via the
existing RL-037 editable shortcut mapper.

### 4. Cross-cutting concerns

- **Source maps** — esbuild-wasm already ships source maps in the
  TS runner; the JS runner must emit source maps too for the
  breakpoint positions to map correctly.
- **Env vars** — the RL-011 Slice D env merger already hands user
  env to Go / Rust / Python subprocesses. The debugger slices
  reuse that plumbing; nothing new.
- **Loop protection** — the existing RL-003 loop protection must
  be disabled while the debugger is attached (it would kill any
  paused execution). Gate via a store flag the debugger sets on
  attach.
- **Telemetry** — emit `debugger.attached`, `debugger.paused`, and
  `debugger.detached` as new events. All three are `P1` additions to
  `TELEMETRY_EVENTS`; payload stays to `language` + a coarse
  `reasonBucket` (`attach` for attached; `user-breakpoint` / `step` /
  `exception` for paused; `user-detach` / `run-complete` / `crash` /
  `stop` for detached). No source, no code, no expression content. The
  third event (`debugger.detached`) was added in Slice 1.5 fold E so
  dashboards can compute median session length from the attach→detach
  pair.

## Implementation sketch (for the follow-up slices)

- **JS/TS slice (first)**: Monaco `IEditor` decorations for the
  gutter; a `DebuggerSession` service in the renderer that hooks
  into the existing JS worker via a new message type (`pause`,
  `step`, `evaluate`). Single worker lifetime per attached tab;
  session is torn down on tab close or detach.
- **Python slice (second)**: new IPC channel `debugger:python:*`.
  Main spawns `python -u -m pdb <tempfile>`, pipes stdin / stdout,
  translates commands. The existing `rust-compiler.ts` + `go-
  compiler.ts` subprocess plumbing is the reference.
- **Go slice (third)**: `dlv --headless --listen=:0` subprocess;
  renderer speaks Delve's JSON-RPC protocol directly (small
  adapter module in `src/main/debug/delve.ts`).
- **Rust slice (fourth)**: `lldb -b -s <script>` or `lldb-mi` as
  the adapter, same JSON translation layer pattern.

## Rollback

- Feature is opt-in behind a `settings.debuggerEnabled` flag
  (future work). Flipping off removes the drawer and detaches any
  active session.
- Each runtime slice ships behind its own capability gate so a
  broken Delve install does not affect JS/TS debugging.
- Telemetry events use the existing allowlist mechanism — no
  payload can leak code without the redactor deliberately ignoring
  the deny list, which the guard tests pin.

## When to revisit

1. Chrome DevTools Protocol or monaco APIs change enough that
   our breakpoint integration regresses — re-evaluate the
   JS/TS strategy.
2. Delve or lldb become hostile to embedded JSON-RPC usage
   (license, protocol break) — move that runtime to `pdb`-style
   stdout-parsing if cheaper.
3. A community-maintained DevTools overlay emerges with a stable
   API — reconsider whether the custom panel is still the right
   call.
4. The feature budget above no longer matches user demand (e.g.
   conditional breakpoints become table stakes) — graduate to
   a post-MVP ADR rather than expanding scope implicitly.
5. Edit-and-continue becomes possible in Monaco for free —
   revisit the "out of scope" list.

## Adjacent ADRs

- `BUILD_SYSTEM_ADR.md` — the bundler + source-map pipeline that
  the JS/TS debugger relies on lives here.
- `LANGUAGE_PACK_ADR.md` — future LanguagePacks that declare
  `capabilities.debugger: 'available' | 'planned'` gate the
  debugger drawer per language.
- `CAPABILITY_MATRIX.md` — codifies "Go/Rust/Python debugger is
  desktop only" as a matrix row.
- `ENV_VARS_ADR.md` — Slice D env merger is the plumbing the
  debugger subprocess slices inherit for free.

## Cross-links

- RL-027 in `PLAN.md` — this ADR flips it from `Planned` to
  `Partial` with the note "MVP design accepted; first slice still
  to ship".
- RL-011 Slice D and RL-038 Slice B are hard dependencies for the
  Go / Rust / Python slices.
- `DEBUGGER_SLICE1.md` — operator runbook for Slice 1 + 1.5
  (gutter UX, drawer mount, Settings rows, telemetry events,
  TS source-map composition).

## Slice 1 + 1.5 delivery notes (added 2026-05-11)

- **Slice 1 partial shipped 2026-05-09.** Store + acorn instrumenter
  + worker pause protocol + JS/TS runner wiring + unmounted drawer +
  4 keyboard shortcuts. Three items were explicitly deferred to a
  follow-up: BreakpointGutter Monaco UI, mounted drawer, visible
  Settings toggle.
- **Slice 1.5 shipped 2026-05-11.** Closes the user-facing surface
  by mounting the breakpoint gutter, the drawer (inside `EditorArea`
  rather than `ConsolePanel` to keep the existing console-area
  e2e specs byte-identical until the user engages the debugger),
  and the Settings master toggle. Adds three telemetry events
  (`debugger.attached` / `debugger.paused` / `debugger.detached`),
  flips JS+TS language-pack `capabilities.debugger` from `'planned'`
  to `'available'`, and composes esbuild's TS→JS source map with
  the instrumenter's JS→JS map via `@jridgewell/trace-mapping` so
  breakpoints in `.ts` files pause at the user's TS line number.
- **Folds A / B / D / E / F (Slice 1.5).** Settings adds a
  Clear-all-breakpoints button (A) and a Pause-disabled toggle (F);
  the drawer header carries a chevron that persists the collapsed
  state (B); the toolbar shows a per-tab breakpoint pill (D); the
  `debugger.detached` event joins the ADR-named pair so dashboards
  can compute median session length (E).
- **Slice 1.5b (still deferred).** Conditional-breakpoint predicate
  evaluation and watch-expression evaluation. Both require the
  worker eval pattern to clear a dedicated security review — the
  dynamic-Function constructor pattern triggered the security
  reminder during Slice 1 and the carve-out in the inline-fix
  policy keeps the eval pass out of Slice 1.5.

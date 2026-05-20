# Lingua — Roadmap

> **Updated:** 2026-05-20
> Canonical status board. Single source of truth for the `Status` column
> on every `RL-XXX` ticket. When any other doc disagrees, this one wins.
>
> **For quick lookup:** read this file. It's cheap — one compact table,
> no deep-dives.
>
> **For full scope + acceptance criteria:** each ticket links back to
> `docs/PLAN.md#RL-XXX`. Load PLAN.md only when a ticket genuinely needs
> its deep context.
>
> **For currently-active per-commit execution detail:** see
> [`docs/SPRINT-PLAN.md`](./SPRINT-PLAN.md).
>
> **For pre-commitment raw ideas:** see [`docs/BACKLOG.md`](./BACKLOG.md).

---

## 1. Status legend

A closed enum. Every `RL-XXX` ticket sits in exactly one bucket.

| Value | Meaning | Eligible for next step? |
|-------|---------|-------------------------|
| `Done` | Fully shipped and validated. | No |
| `Partial` | Started — one or more slices landed. `Readiness` names which, and what's left. | **Yes** — pick the smallest unshipped slice |
| `Planned` | Spec'd but no code. | **Yes** — only after Partial pool is exhausted |
| `Research-backed spike` | ADR filed, no production code. Parked on purpose. | No (unless explicitly promoted) |
| `Deferred study` | Parked for a later revisit window. | No |
| `Superseded` | Original scoping replaced by newer `RL-XXX`. `Readiness` names the successor. | No — pick the successor instead |
| `Gated` | External dependency (contract, hardware, credentials) blocks start. `Readiness` names the gate. | No — waiting on external |

New tickets start as `Planned`. Tickets close to `Done` only when every
acceptance item is green in the test suite and the slice is behind at
least one Playwright or desktop smoke assertion.

## 2. Priority tiers

| Priority | Meaning |
|----------|---------|
| `P0` | Unblocks other work or launch — pick first. |
| `P1` | Scheduled next. Most of the active backlog lives here. |
| `P2` | Scheduled but not urgent. |
| `P3` | Nice-to-have. Don't pick unless P0-P2 are empty in the adjacent theme. |
| `Future` | Explicit parking lot. Do not pick without a promotion decision. |

## 3. Picking the next ticket

1. **Pool** = all rows in §4 whose `Status ∈ {Partial, Planned}`.
2. Exclude anything marked `Gated`, `Deferred study`, `Research-backed spike`, or `Superseded`.
3. For `Partial` rows, the implementable scope is whatever `Readiness`
   names as unshipped. Prefer these over `Planned` — scaffolding exists.
4. Respect `Dependencies` — if any dep is not `Done`, the ticket is not
   implementable yet.
5. Follow the sequencing recommendation in §5 when two tickets are both
   eligible.

**Never invent new RL ids.** If a slice needs finer granularity, add a
sub-section inside the existing ticket's `docs/PLAN.md` entry. New
inbound work goes to `docs/BACKLOG.md` first and graduates to ROADMAP
only once it has acceptance criteria.

## 4. Active backlog

All tickets with `Status ∈ {Partial, Planned, Research-backed spike}`. The
`Scope` cell is a one-line summary; follow the link for deep detail.

### 4a. Launch-blocking (P0)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|

_All rows in this section are closed; see §6 archive. RL-059 closed 2026-05-12 as docs-sync — the Ed25519 verifier + Settings section + main-side IPC bridge with device id (Slice 0, 2026-04-25) plus the named remaining scope (Polar webhook + email delivery) all shipped historically; the latter lives entirely under [`RL-061`](./PLAN.md#rl-061-polarsh-integration) (closed 2026-04-30). RL-059's runtime descendants stay in production at `src/main/license.ts`, `src/renderer/stores/licenseStore.ts`, and `src/shared/license.ts`._

### 4b. Editor, runtime and workflow (P1)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-019`](./PLAN.md#rl-019-add-explicit-jsts-runtime-modes-worker-scratchpad-desktop-node-and-browser-preview) | Explicit JS/TS runtime modes | `Done` | **Closed in full 2026-05-14 — Slice 2 (desktop Node child-spawn backend) shipped**: new `src/main/node-runner.ts` invokes `spawn('node', ...)` only (no shell-evaluating sibling, no string interpolation into shell args); parent-owned timeout with SIGTERM → 200 ms → SIGKILL escalation; `buildNativeRunnerEnv(NODE_TOOLCHAIN_KEYS)` allowlist for the subprocess env; per-call detection cache via `detectNode()`; renderer-side `NodeRunner` (`src/renderer/runners/nodeRunner.ts`) registered in `RunnerManager.runtimeModeRunners`; TS pre-transpiles through `esbuild-wasm` before IPC; `isRuntimeModeImplemented('node')` flipped to `true` so the toolbar selector ships the Node option; new `runtime.node_runner_used { language, status }` telemetry mirrored on update-server with parity test (closed-enum status bucket `'success'` / `'error'` / `'timeout'` / `'stopped'` / `'missing-binary'`); first-run trust notice toast (`runtimeMode.notice.firstRunDangerous`) surfaced once per session per the `Settings.nodeRunnerFirstRunNoticeShown` flag (fold E); `resolveNodeCwd()` walks for a `node_modules/` neighbor so `require('lodash')` resolves naturally (fold F); `package.json#type === 'module'` flips `-e` to `--input-type=module` (fold G); fold H (`action-runtime-mode-node` command-palette entry) already existed from Slice 1 and now actually succeeds because the implementation gate cleared. Slice 1 + Slice 3 shipped 2026-05-12 (selector contract + BrowserPreview iframe sandbox). Folds B (Settings → Native Toolchains row), C (version pinning), D (Node 22 permission flags) are deferred follow-ups — store fields and i18n copy are in place; UI plumbing is the only gap.
| [`RL-020`](./PLAN.md#rl-020-make-the-scratchpad-and-repl-experience-best-in-class) | Scratchpad / REPL excellence | `Done` | **Closed in full 2026-05-14 — Slice 9 (variable inspector) shipped**: new `<VariableInspectorPanel>` + `<VariableInspectorToggleButton>` in the result-panel header (mutually exclusive with Compare); JS worker captures `globalThis` post-execute (boot-time globals snapshot subtracted); Python worker captures `globals()` via a `repr()`-based JSON snippet on the first capture-enabled run (boot-time globals stored on `__lingua_boot_globals` once); new shared `src/shared/scopeSnapshot.ts` with `ScopeValue` types + `serializeScopeValue` recursive walker (1-level default, `MAX_SCOPE_DEPTH = 4` cap) + filter sets + payload caps (200 top-level / 100 per object / 100 array entries / 256 KB total); `ExecutionContext.captureScope` + `scopeDepth` threaded through JS / TS / Python runners; `ExecutionResult.scopeSnapshot` written by `executeTabManually` + `useAutoRun` on clean success; per-tab `FileTab.variableInspectorEnabled` cleared on language change to an unsupported target. Folds shipped: A `runtime.variable_inspector_opened` adoption telemetry (closed-enum `language` + `variableCount` bucket, mirrored on update-server with parity test); B command-palette `Toggle variable inspector` entry; C `Mod+Shift+I` keyboard shortcut with `variableInspector.toggle.shortcutUnavailable` notice fallback; D inline type-icon prefix per row kind (`{}` / `[]` / `ƒ` / `!` / `·`); E recursive expansion via `Settings.variableInspectorScopeDepth` (`1`–`4`); F per-row diff badges (`+ / − / ~`) infrastructure in place (Day 1 comparator is the empty set so a fresh capture badges every row as `added` — visible feedback that the capture worked); G `Settings.showVariableInspectorByDefault` + `variableInspectorScopeDepth` fields (Settings UI surface deferred to a light follow-up); H case-insensitive name filter input inside the panel. Slices 1–3 shipped 2026-05-13/14 (auto-run gate, per-tab workflow mode, `@watch` magic-comment pin). **Slice 8 shipped 2026-05-14** — last-stable compare: new `Compare` button-secondary toggle in the result-panel header next to `hideUndefined`; per-tab `FileTab.compareWithSnapshotEnabled` flag dropped on language change (rename + Save-As); `ResultSnapshot.language` + `capturedAt` + `pinned` fields gate the comparator against language drift; manual Run now captures the snapshot too (Slice 1 was scratchpad-only); new `<CompareResultsPanel>` body swaps in for the inline-results region — three columns `Line / Previous / Current` for dynamic, unified diff for compiled — reusing the existing `computeDiff` helper from `DiffUtilityPanel`; new pure module `src/renderer/utils/snapshotDiff.ts`; fold A `runtime.compare_view_toggled` adoption telemetry mirrored on update-server; fold B multi-snapshot ring (cap=3) with a target dropdown in the panel; fold C palette `Toggle compare with last stable run`; fold D `Mod+Shift+D` keyboard shortcut with a notice fallback when there is no snapshot; fold E granularity selector (Line / Word / Character) inside the compare panel; fold F pin / freeze so the next run does not overwrite a known-good snapshot; fold G inline diff badges `+ / − / ~` per line in non-compare mode, memoized via `useMemo` so the auto-run stream does not recompute the diff per keystroke. Remaining: Slice 9 (variable inspector). **Slice 7 shipped 2026-05-14** — per-language execution timeout presets + clearer abort state: new `src/shared/runtimeTimeoutPresets.ts` closed-enum `RuntimeTimeoutPreset` (`quick` / `normal` / `long` / `extended`); Settings → Editor → "Execution timeout" section with per-language dropdowns (JS / TS / Python / Go; Rust intentionally out — desktop kill path lives in main); five runners (`javascript`, `typescript`, `python`, `go`, `browserPreview`) drop their literal `DEFAULT_TIMEOUT` and resolve via `useSettingsStore.getState()` on every `execute()`; `<RunStatusPill>` ambient pill in the result-panel header with four variants (`timeout`, `stopped`, `error`, `countdown`) — italic low-contrast chrome mirroring `<AutoLogStatusPill>` / `<StdinStatusPill>`; `ExecutionResult.kind` field so the pill self-gates without regexing the error message; fold A `runtime.timeout_preset_changed` adoption telemetry with closed-enum `{ language, preset }`; fold B `// @timeout 60s` magic-comment directive (JS / TS / Python — caps at 10 min, parsed by `extractTimeoutMagicComment`); fold C command-palette `Set execution timeout: Quick / Normal / Long / Extended` entries; fold D one-shot `Run with extended timeout (one shot)` palette command driven by per-tab `FileTab.nextRunTimeoutOverrideMs`, consumed once by both manual-run AND auto-run paths and cleared on language change (rename + Save-As); fold E `showTimeoutCountdown` Settings toggle (default OFF) + `mm:ss` countdown variant on the pill; fold F actionable "open Settings" hint appended to the timed-out result message (skipped on caller overrides); fold G widened `RUNNER_STATUS_VALUES` enum (`['ok', 'error']` → `['ok', 'error', 'timeout', 'stopped']`) mirrored on update-server with parity test. Remaining: scope items 8–9 (last-stable compare, variable inspector). **Slice 6 shipped 2026-05-14** — pre-set stdin buffer for JS / TS / Python Scratchpad runners: per-tab `FileTab.stdinBuffer`, new bottom-panel `Input` tab + `<StdinInputPanel>` UI, JS worker patches `prompt()` / `readline()`, Pyodide worker uses `setStdin` (≥ 0.24 API), `runtime.stdin_used` adoption telemetry (fold C), sessionStore persistence so the buffer survives reloads (fold A), Settings → Editor "Show stdin input tab" master toggle (fold D), command-palette focus action (fold E), `<StdinStatusPill>` in the result-panel header (fold F), fold G "Used N of M line(s)" pill driven by a new `stdin-consumed` worker reply + `ExecutionContext.stdin` thread + `ExecutionResult.stdinConsumed` field. Fold B (desktop Go / Rust child-process stdin) descoped — the desktop runners compile through WASM / host-spawned pipelines rather than a child-process pipe, so threading stdin into them requires its own architectural slice. Remaining: scope items 7–9 (timeout presets, last-stable compare, variable inspector). **Slice 5 shipped 2026-05-14** — JS / TS bare-expression auto-log mode: opt-in via Settings → Editor (`scratchpadAutoLogByLanguage`, default OFF), per-tab override via `FileTab.autoLogEnabled` (fold C), command-palette toggle (fold D), distinct `MoveRight` icon + low-contrast italic chrome with `data-result-kind="autoLog"` (fold B), Auto-log status pill in the result-panel header (fold E), splice-back through `restoreLastSuccessfulSnapshot` so auto-log rows survive transient incomplete-buffer windows (fold G), bucketed `runtime.auto_log_emitted { language, countBucket }` per-run telemetry alongside the toggle event (fold A), and a 5 000-iteration / 750 ms detector bench lock (fold F). Worker / runner protocol unchanged — the auto-log transform produces additional `__mc(line, value)` calls that ride the existing magic-comment side-table the runner already understands. **Slice 4 shipped 2026-05-14** — per-tab execution history with one-click rerun: `ExecutionHistoryEntry` gains `tabId?` + `pinned?` fields, new `byTabId` selector + `togglePin` action + pin-aware FIFO eviction (drops oldest UNPINNED first); `tabId` threaded through `executeTabManually.record()` on both success + error paths; new `<RecentRunsPill>` in the result-panel header listing up to 8 newest-first runs for the active tab with Replay + Pin affordances per row (Pro-gated via `EXECUTION_HISTORY`; Free tier sees an upsell variant — fold E); new `recentRunsPopoverBridge` module exposes a `Mod+Shift+H` keyboard toggle (fold B); `ExecutionHistoryPopover` gains a "This tab only" filter (fold C); command palette surfaces a parallel "Recent runs (this tab)" group ranked above the legacy global one (fold G); relative-time strings refresh every minute while the popover is open (fold F); new `runtime.history_replay { language, status, surface }` closed-enum telemetry mirrored on update-server with `HISTORY_REPLAY_SURFACES` parity test (fold A); `clearVisibleResults`-style discipline preserved (auto-run still does not record history; replay still does not append a second entry). |
| [`RL-023`](./PLAN.md#rl-023-build-snippet-lab-and-algorithm-practice-mode) | Snippet Lab + algorithm practice | `Planned` | Tagged snippet collections + "compare two snippets" + saved assertions. |
| [`RL-024`](./PLAN.md#rl-024-support-multi-file-playgrounds-assets-and-starter-galleries) | Multi-file playgrounds + starter galleries | `Planned` | Multi-file workspaces, static assets, per-language starter templates. |
| [`RL-025`](./PLAN.md#rl-025-add-package-and-dependency-management-in-a-language-aware-way) | Package / dependency management | `Planned` | Explicit, adapter-driven dependency management: detect imports, require user confirmation, ship JS/TS desktop installs first, then Pyodide `micropip`; no silent/global installs. |
| [`RL-031`](./PLAN.md#rl-031-add-a-local-ai-code-assistant-focused-on-algorithms-and-cross-language-generation) | Local AI code assistant | `Planned` | Desktop-local Ollama MVP first through `window.lingua.ai.*`; WebGPU, BYO keys, and hosted credits stay later phases under `AI_BRIDGE_ADR.md`. |
| [`RL-032`](./PLAN.md#rl-032-build-a-dedicated-marketing-website-and-docsdownload-hub) | Marketing website + docs hub | `Planned` | Separate marketing site at linguacode.dev with docs/download/pricing. |
| [`RL-033`](./PLAN.md#rl-033-upgrade-to-the-latest-vite-major-and-harden-the-bundling-surface) | Vite major upgrade | `Done` | Closed 2026-05-17 — Vite 5 → 8 bump landed in one hop (the ADR's "skip Vite 7, go straight to Vite 8" trigger fired). Full 10-step verification matrix green incl. packaged macOS build. See §6 archive. |
| [`RL-036`](./PLAN.md#rl-036-add-sharing-collaboration-and-publish-flows) | Sharing, collaboration, publish flows | `Planned` | Phase A1: no-backend single-tab URL-fragment share links; Phase A2: `.linguashare` multi-file artifacts after `RL-024`; Phase B: cloud links/collab/publish. |

### 4c. Language platform (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-027`](./PLAN.md#rl-027-add-debugger-mvp) | Debugger MVP | `Partial` | ADR landed 2026-04-20. Slice 1 partial-staged 2026-05-09. **Slice 1.5 shipped 2026-05-11** — BreakpointGutter Monaco glyph-margin (red dots + click → toggle, `Mod+Shift+B` keyboard path), mounted debugger surface with chevron collapse + persisted state, visible Settings → Editor → Debugger master toggle, three telemetry events (`debugger.attached` / `debugger.paused` / `debugger.detached` with closed-enum payloads), JS+TS `capabilities.debugger` flipped to `'available'`, esbuild TS→JS source-map composition via `@jridgewell/trace-mapping` so TS breakpoints pause at user line, `docs/DEBUGGER_SLICE1.md` runbook, ADR amendment, CAPABILITY_MATRIX rows for JS/TS/Python/Go/Rust debuggers, and blocking e2e smoke in `tests/e2e/debuggerJs.spec.ts`. **2026-05-12 UX refinement**: JS/TS Run and Debug now live in one split dropdown; Run ignores breakpoints, Debug requires an enabled breakpoint, highlights the paused line, streams prior console output while paused, suspends the parent timeout until Continue / Step resumes execution, moves Debugger into the resizable bottom panel as a Console sibling tab, moves breakpoint count / Disable all / Clear actions into that Debugger panel instead of the toolbar or Settings, and supports Step Into / Step Out for local synchronous functions during Debug. **Remaining for Slice 1.5b**: conditional-breakpoint predicate evaluation + watch-expression evaluation (deferred behind a dedicated security review of the worker eval pattern — the dynamic-Function constructor pattern hit the security_reminder hook during Slice 1, and the inline-fix policy carve-out keeps it out of 1.5). |
| [`RL-042`](./PLAN.md#rl-042-expand-language-support-toward-15-languages) | Expand languages toward 15+ | `Partial` | **Slice 6 shipped 2026-05-20 — Ruby desktop native subprocess (hybrid dispatcher).** New `src/main/ruby-runner.ts` spawns `ruby` via the same IPC pattern as Rust + Go (`ruby:detect` / `ruby:run` / `ruby:stop`), with `mkdtemp` tmpfile + 1 MiB stdout/stderr caps + SIGTERM→SIGKILL escalation (1.5 s grace, fold E). `RUBY_TOOLCHAIN_KEYS` allowlist extended in `nativeEnv.ts` (`GEM_HOME` / `GEM_PATH` / `BUNDLE_GEMFILE` / `RBENV_VERSION` / `RBENV_ROOT` / `RBENV_DIR` / `ASDF_RUBY_VERSION` / `ASDF_DIR` / `ASDF_DATA_DIR`); `RUBYOPT` / `RUBYLIB` remain user-env-only to avoid silently injecting host flags into every run. Renderer `src/renderer/runners/ruby.ts` refactored into a hybrid dispatcher (`RubyRunner` outer + `WasmRubyRunner` + `DesktopRubySubprocessRunner` inner) with per-session detection cache; Settings → Editor → "Ruby runtime" select (`auto` / `system` / `wasm`) with status line "System Ruby detected: 3.3.6" (fold A `parseRubyVersion`). `.ruby-version` discovery walks up to 8 dirs and threads `RBENV_VERSION` (fold D). 2 closed-enum telemetry events (`runtime.ruby_runner_dispatched { mode, bucketedSpawnMs }` + `runtime.ruby_runtime_preference_changed { preference }`) mirrored on update-server with parity test. Ruby `LanguagePack.capabilities.runtimeDependencies = ['ruby']` as an optional desktop preference, not a web-blocking hard requirement. Bench guard `tests/perf/rubySpawn.bench.test.ts` (fold B) locks cold spawn under 1.5 s; skipped when ruby absent on CI. Settings docs link to ruby-lang.org (fold G). 16 MockedSpawn main-runner tests + 5 dispatcher routing tests added. **Slice 5 shipped 2026-05-19 — Ruby web runtime via `@ruby/wasm-wasi`.** Java, Kotlin, Scala, Swift, C, C++ still validate-only — each is its own slice. |

### 4d. Execution deepening and tooling (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-012`](./PLAN.md#rl-012-package-management) | Package management | `Planned` | Superseded in scope by `RL-025`. Keep open for reference until `RL-025` ships Slice A. |
| [`RL-043`](./PLAN.md#rl-043-add-notebook--cell-based-execution-mode) | Notebook / cell-based execution | `Planned` | Schema/session foundation first: versioned `.linguanb`, notebook tab kind, JS/TS/Python runner-owned sessions, markdown/code cells, then UI/reactive/export slices. |
| [`RL-044`](./PLAN.md#rl-044-add-inline-data-visualization-and-rich-output-rendering) | Inline data visualization + rich output | `Partial` | **Slice 2a shipped 2026-05-20** — `RichOutputPayload` widens with `RichOutputHtml`; `ScopeValueError.stack?` extension; new `src/shared/errorStack.ts` (`parseJsErrorStack` covering V8 named/bare + SpiderMonkey, `parsePythonTraceback`, `isClickable`); new `<RichValueHtml>` (sandboxed iframe `allow-scripts` only, NO `allow-same-origin`, height clamped to 800 px via `clampHtmlHeight`), `<RichValueImage>` (`validateImageSrc` whitelist: `data:image/...` / `blob:` / `https://`, rejects `javascript:` / `http:` / `file:`), `<RichValueError>` with clickable stack frames (`lingua-open-file` CustomEvent) + fold F right-click context menu (Copy file:line / Open in tab / Copy frame text); `ConsoleEntryRenderer` dispatch widened for html/image/error; `richConsoleFormat.payloadHasRichSurface` activates for html/image and for error WITH stack; new closed-enum telemetry `runtime.error_stack_frame_clicked { language }` + `runtime.rich_media_payload_rejected { kind, reason }` mirrored on update-server with parity tests; `CONSOLE_RICH_KIND_BUCKETS` widens with `'html'` (both renderer + update-server, parity lockstep test updated); `isSafeToken` exported from shared/telemetry for renderer-side validation. **Slice 2b-α shipped 2026-05-20** — Worker integration. JS worker injects `lingua.{chart,image,html}` as the 6th `AsyncFunction` parameter (closure-scoped, no `globalThis` pollution); each helper validates via shared whitelists (`validateChartSpec` rejecting `data.url`/`data.name` per anti-feature §A-008, `validateImageSrc`, `validateHtmlPayload`) and posts a `console` log with text fallback + typed payload, OR a `richMediaRejected: { kind, reason }` flag on reject. JS worker `parseError()` now also returns `frames: ClickableStackFrame[]` via `parseJsErrorStack(err.stack)`; `ExecutionError.frames?` threaded through `ExecutionResult`; `formatExecutionError()` builds a `kind:'error'` payload with `stack` so user `throw` → automatic Sub-slice F clickable rendering (no explicit emit). Python worker error path includes `stack: traceback_text` + parsed `frames: ClickableStackFrame[]`. New `MAX_CHART_DATA_VALUES = 5000` cap. `MagicCommentDirective` widens to `'table' | 'chart' | 'image' | 'html'` (KNOWN_DIRECTIVES set extended). `'chart'` added to `RICH_MEDIA_REJECTED_KINDS` (renderer + update-server with parity test). **Slice 2b-β deferred** — vega-embed `<RichValueChart>` component, folds A (Vite manual chunk for vega lazy-load) / B (Pro-gated PNG/SVG export) / C (Settings sub-toggles per kind) / D (image-paste resize toast) / E (magic-comment runner consumption + Python `__lingua.chart/image/html` preamble helpers) / F (Error.cause chain) / G (`//=> figure` alias + ConsolePanel image clipboard paste handler) / H (default `lingua-open-file` consumer with toast fallback until RL-024 lands). |
| [`RL-048`](./PLAN.md#rl-048-add-integrated-terminal-for-desktop-mode) | Integrated terminal (desktop) | `Planned` | Embed xterm.js + node-pty panel in the desktop build. |

_RL-011 closed 2026-05-12 — Slice A/B/C shipped the merger + store + Settings UI; Slice D shipped Go/Rust/Python subprocess env threading. JS/TS Workers and the web build are explicitly out of ADR scope (see [`ENV_VARS_ADR.md`](./ENV_VARS_ADR.md) capability table). Any future JS/TS desktop env-var support belongs in [`RL-019`](#4b-editor-runtime-and-workflow-p1) (explicit JS/TS runtime modes — desktop Node mode would carry env threading), NOT a reopen of this ticket._

### 4e. Developer Utilities (`RL-045` parent is `Done`)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-069`](./PLAN.md#rl-069-devutils-class-productivity-layer-for-the-utilities-workspace) | DevUtils-class productivity layer | `Done` | Slice 1 shipped 2026-05-05 (Cmd/Ctrl+K + Cmd+Shift+C/Cmd+Alt+R + fuzzy search + 5 output providers). Slice 2 shipped 2026-05-09 (`detect()` on 27 panels + `<UtilityToolbar>` + Mod+Shift+A + 29-panel coverage). Slice 3 shipped 2026-05-09 — `utilityHistoryStore` with isolated `lingua-utility-state` localStorage key + 10-entry FIFO cap + 16KB-per-entry truncation + 256KB total budget; `<UtilityHistoryDrawer>` rendered inside the toolbar so every non-generator panel inherits Recent runs + per-tool persist toggle + Clear; `<FavoritesRow>` + `<FavoriteToggleButton>` with `@dnd-kit/sortable` (mouse + keyboard a11y); `useClipboardOnFocus` hook with `utilitiesClipboardOnFocusConsent` three-state (RL-065 pattern); new `UtilitiesSection` Settings entry under the Editor tab (toggle + Clear-all-history with confirmation); 3 new RL-065 telemetry events (`utility.favorite.pinned`, `utility.history.cleared`, `utility.clipboard.applied`); 10 Playwright assertions in `tests/e2e/utilitiesPersonalize.spec.ts` cover pin/reorder/reload, history Apply + persist + Clear, Settings clipboard toggle, JWT + CRON + 6 more panels in the Apply rotation, Spanish locale, and console-clean. |
| [`RL-072`](./PLAN.md#rl-072-specialty-utilities--qr--string-inspector) | Specialty utilities — QR + inspector | `Done` | String Inspector + QR generate shipped earlier. Final slice on 2026-05-08 added QR decode (drag-drop image), Copy-as-PNG, FG/BG color pickers with WCAG-AA contrast guard, high-contrast preset, SVG download alongside PNG, and `utilityOutputStore` wiring (Cmd+Shift+C / Cmd+Alt+R). Camera capture remains explicitly deferred per the original scope decision. |

### 4f. Launch operations (P1)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|

_All rows in this section are closed; see §6 archive. RL-065 closed 2026-05-12 with Slice 5 — telemetry export endpoint on `update-server` (POST /telemetry, allowlist+deny-pass+rate-limit, Workers Observability persistence, web-only env wiring, update.checked callsite, URL validation, Playwright consent-gate assertion, telemetry-pipeline.md runbook with the D1 promotion path)._

### 4g. Personalization and surface polish (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-039`](./PLAN.md#rl-039-add-guided-lessons-docs-and-app-galleries-for-students) | Guided lessons + app galleries | `Partial` | Built-in guided tour + seeded lesson drafts in `docs/lessons`. Remaining: in-app lesson browser + progression. |
| [`RL-041`](./PLAN.md#rl-041-add-static-site-export-and-one-click-publish-for-web-projects) | Static site export + publish | `Planned` | Export JS/TS/HTML projects as self-contained static ZIP; one-click publish to GitHub Pages. |
| [`RL-046`](./PLAN.md#rl-046-add-gamification-achievements-and-progress-tracking-for-students) | Gamification + achievements | `Planned` | Achievement catalog, per-user progress, streaks. |
| [`RL-093`](./PLAN.md#rl-093-signal-slate-v2-main-ui-refactor) | Signal-Slate v2 — Main UI + Utilities body refactor | `Done` | Closed 2026-05-17 — Slice 3 shipped the chrome v2 row + bottom Variables tab + chip-shortcut pairing. See §6 archive. |

### 4h. Documentation and repo hygiene (P2)

_All rows in this section are closed; see §6 archive. RL-082 closed 2026-05-05 (README slimmed to ~130 lines, `DEVELOPMENT.md` + `USAGE.md` introduced)._

### 4i. Security, resilience, and product quality (P2)

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|

### 4j. Research-backed spikes and future

These rows are NOT candidates for the next step. They live here for
discoverability only.

| ID | Title | Status | Note |
|----|-------|:------:|------|
| [`RL-029`](./PLAN.md#rl-029-pilot-webcontainers-for-jsts-web-projects-only) | WebContainers pilot | `Research-backed spike` | ADR filed; no production code. Promotion gated on a distinct product decision. |
| [`RL-035`](./PLAN.md#rl-035-run-a-tauri-2-feasibility-spike-without-committing-to-migration) | Tauri 2 feasibility spike | `Partial` | Spike ADR (`TAURI_SPIKE_ADR.md`) shipped. No decision to migrate. |
| [`RL-047`](./PLAN.md#rl-047-add-algorithm-visualization-and-step-through-animation) | Algorithm visualization | `Planned` | Priority `Future` — waits for `RL-027`, `RL-044`, and `RL-043`; first slice uses explicit `lingua.visualize.*` calls, not regex instrumentation. |
| [`RL-049`](./PLAN.md#rl-049-add-macro-recording-and-playback) | Macro recording | `Planned` | Priority `Future` — not in the next two quarters. |
| [`RL-050`](./PLAN.md#rl-050-add-real-time-collaboration-for-shared-sessions) | Real-time collaboration | `Planned` | Phase A (LAN-only, ADR spike) lifted to active world-class lane. Phase B (cross-internet pair) deferred until Phase A ships. See `RL-050` extension in PLAN.md. |

### 4k. World-class lane (P1/P2/P3 — promoted 2026-05-20 from WORLD_CLASS_PLAN.md)

Fourteen new tickets graduated from `WORLD_CLASS_PLAN.md` candidate IDs
(`WC-001` .. `WC-010`) plus a second-pass review documented in
`WORLD_CLASS_TO_RL_PROPOSAL.md`. Each row links to a deep section in
`PLAN.md`. They are sequenced in §5 below.

| ID | Title | Status | Scope one-liner |
|----|-------|:------:|-----------------|
| [`RL-094`](./PLAN.md#rl-094-run-capsules) | Run Capsules | `Planned` | Versioned `RunCapsuleV1` artifact (export + import + redaction registry). Spine for share / CLI / AI / HTTP / pipelines / lessons / importers. |
| [`RL-095`](./PLAN.md#rl-095-language-support-scorecard) | Language Support Scorecard | `Planned` | Typed `LanguageSupportProfile` matrix per-language across 9 axes (syntax / autocomplete / LSP / runtimes / packages / stdin / rich output / debugger). |
| [`RL-096`](./PLAN.md#rl-096-privacy--trust-dashboard) | Privacy + Trust Dashboard | `Planned` | New Settings tab with redaction preview, local stores audit, network activity summary, run-history timeline. |
| [`RL-097`](./PLAN.md#rl-097-http--sql-workspace) | HTTP + SQL Workspace | `Planned` | Bottom-panel HTTP collections (Slice 1) + DuckDB-WASM SQL scratchpad (Slice 2). Sensitive headers redacted; responses are capsules. |
| [`RL-098`](./PLAN.md#rl-098-cli-companion) | CLI Companion | `Planned` | `lingua` CLI: utility runner + capsule validation (Slice 1); replay (Slice 2). Pure shared/main; no renderer imports. |
| [`RL-099`](./PLAN.md#rl-099-utility-pipelines) | Utility Pipelines | `Planned` | `UtilityPipelineV1` engine that chains deterministic utility adapters. JSON / Base64 / URL / regex / diff in Slice 1. |
| [`RL-100`](./PLAN.md#rl-100-importers) | Importers | `Planned` | Importer registry + cURL → HTTP request (Slice 1); `.ipynb` (Slice 2); Bruno/Postman (Slice 3). Preview-then-confirm flow. |
| [`RL-101`](./PLAN.md#rl-101-onboarding-choreography) | Onboarding Choreography | `Planned` | Pre-seeded scratchpad + post-first-run toast + post-first-snippet toast. Once per stage; Settings reset to re-arm. |
| [`RL-102`](./PLAN.md#rl-102-git-read-only-layer) | Git Read-Only Layer | `Planned` | Desktop-only `git:detect` / `:status` / `:diff` IPC. Git status pill on tabs, Git diff bottom-panel tab. No write surface. |
| [`RL-103`](./PLAN.md#rl-103-project-templates) | Project Templates | `Planned` | 5 curated `ProjectTemplateV1` JSONs (Express, FastAPI, Node CLI, React, Python data). Welcome-screen panel + palette entry. |
| [`RL-104`](./PLAN.md#rl-104-webgpu-ai-inference-web--spike) | WebGPU AI inference (web) | `Research-backed spike` | Phase A: ADR + 50-prompt quality test. Implementation gated until ADR approved. Constrained tasks only (no chat). |
| [`RL-105`](./PLAN.md#rl-105-mobile-companion-pwa-read-only) | Mobile Companion (PWA) | `Planned` | Separate repo `lingua-mobile` + `m.linguacode.dev`. Read-only Shiki-rendered share-link viewer. No mobile authoring (`ANTI_FEATURES.md` §A-011). |
| [`RL-106`](./PLAN.md#rl-106-curated-community-snippets) | Curated Community Snippets | `Planned` | 50 starter snippets bundled in-app. PR-only contribution path. No marketplace (`ANTI_FEATURES.md` §A-004). |
| [`RL-107`](./PLAN.md#rl-107-vscode-theme-import) | VSCode Theme Import | `Planned` | `themeImport.ts` converter that maps VSCode `themes/*.json` to Lingua `ThemePack`. Settings → Appearance → "Import VSCode theme...". |
| [`RL-108`](./PLAN.md#rl-108-inline-lint--quick-fixes-in-monaco) | Inline lint + quick-fixes (Monaco) | `Planned` | JS/TS lint worker + Monaco markers + 5 deterministic quick-fixes (Cmd+.). Settings toggle. Python deferred to Slice 2. |
| [`RL-109`](./PLAN.md#rl-109-project-scoped-environment-isolation) | Project-scoped env isolation | `Planned` | `ProjectEnvScopeV1` schema + per-project env store + Settings "Project" tab. Prevents env-var bleed across open folders. |
| [`RL-110`](./PLAN.md#rl-110-smart-paste-detection) | Smart paste detection | `Planned` | Clipboard handler registry: share-links / capsules / cURL / stack traces / large JSON. Toast offers correct intent; Cmd+Shift+V escapes. |
| [`RL-111`](./PLAN.md#rl-111-workspace-session-restore) | Workspace session restore | `Planned` | `SessionSnapshotV1` schema + before-quit capture + "Restaurar sesión" toast on boot. Three modes (never/ask/always). License tokens never exported. |
| [`RL-112`](./PLAN.md#rl-112-persistent-status-bar) | Persistent status bar | `Planned` | Fixed 24px bottom bar with language / lint counts / cursor pos / encoding / indent / git branch / run status. Toggleable. |
| [`RL-113`](./PLAN.md#rl-113-cmd-recent-commands-stack) | Cmd+; Recent commands stack | `Planned` | Per-session ring buffer of 20 commands. Cmd+; opens popover with 8 most-recent + 1-8 keyboard shortcuts. |
| [`RL-114`](./PLAN.md#rl-114-test-runner-auto-detect) | Test runner auto-detect | `Planned` | Detect jest/vitest/pytest/cargo-test/go-test from manifest files; bottom-panel "Tests" tab + palette "Run project tests". |
| [`RL-115`](./PLAN.md#rl-115-inline-per-line-timing) | Inline per-line timing | `Planned` | `// @time` magic-comment + Monaco gutter decorations (`▸ 320 ms`); slowest line highlighted red. JS/TS only Slice 1. |
| [`RL-116`](./PLAN.md#rl-116-focus--presenter-mode) | Focus / Presenter mode | `Planned` | Cmd+K F toggles zen+: hide chrome, +4 font editor, +2 console, optional gradient overlay. Layout-restore on exit. |
| [`RL-117`](./PLAN.md#rl-117-personal-cloud-sync-via-user-owned-storage-extensión-rl-089--needs-adr) | Personal cloud sync via user-owned storage | `Research-backed spike` | Phase A: ADR (Dropbox vs Drive vs Gist, threat model). Phase B gated on ADR + ANTI_FEATURES §A-006 reversal note. |

Extensions to existing rows (also part of the world-class lane, sequenced in §5):

- `RL-024` Multi-file projects — promoted to top-priority foundation slice (slot 3). New "Slice 1 reframe" in PLAN.md. Slice 2 (cross-project search + replace, Cmd+Shift+H) added under "Tier 2 polish" in PLAN.md.
- `RL-031` Slice 2 Local Docs + AI citations — extends existing RL-031 ticket. New "Slice 2 scope" in PLAN.md.
- `RL-039` Slice B Recipes — reframes "lessons" as fuzzy-searchable recipe cards. New "Slice B scope" in PLAN.md.
- `RL-044` Sub-slice F clickable error stacks — extends the next RL-044 slice. New "Sub-slice F" in PLAN.md.
- `RL-050` Phase A spike + Phase B cross-internet — promotes the LAN ADR spike to active; Phase B (cross-internet pair) gated until Phase A ships.

### 4l. Sugerencias Tier 1/2/3 (promoción 2026-05-20)

Análisis post-promoción world-class lane. Diez tickets nuevos (RL-108 a
RL-117) + 1 extensión a RL-024 (Slice 2 cross-project replace) + 6 items
conscientemente fuera de scope (T3-001..T3-006). Cada uno con AC firmes
en `PLAN.md`.

| Tier | Total | Inicio | Estado |
|------|-------|--------|--------|
| Tier 1 (P1/P2) | RL-108, RL-109, RL-110, RL-111 | slot 27.5 (tras RL-031 Slice 2 + RL-107) | sequenciado abajo |
| Tier 2 (P2/P3) | RL-112, RL-113, RL-114, RL-115, RL-024 Slice 2, RL-116, RL-117 | tras Tier 1 | sequenciado abajo |
| Tier 3 (out of scope) | T3-001..T3-006 | n/a | documentados en PLAN.md como reverse-allowed-if |

## 5. Recommended sequence

Value-per-day priority, skipping parked tickets. This is the order an
agent should follow when §3's tiebreakers don't resolve.

1. **Security launch hardening.** `RL-077`, `RL-078`, `RL-079`, and `RL-083` are all closed. 2026-05-08 follow-up hardening moved web Pyodide from cache-first CDN loading to same-origin copied runtime assets, tightened filesystem re-open approvals, and extended Go/formatter/parser caps. The launch-blocker set is clear.
2. **Launch blockers.** Closed. `RL-063` shipped 2026-05-05 — site live at https://linguacode.dev from the separate `lingua-marketing` repo (see `MARKETING_SITE_ADR.md`). `RL-061` shipped 2026-04-30. `RL-059` closed 2026-05-12 as docs-sync — its named remaining scope (Polar webhook + email delivery) shipped under `RL-061`; the verifier + bridge scaffolding lives in production at `src/main/license.ts`, `src/renderer/stores/licenseStore.ts`, and `src/shared/license.ts`.
3. **Release, legal, and compliance readiness.** Closed. `RL-080`, `RL-085`, `RL-092`, and `RL-081` are all `Done` (RL-081 closed 2026-05-05 once the live `linguacode.dev` surface aligned with the desktop entitlement copy). The launch-readiness bucket has no outstanding blockers in this repo.
4. **Runtime/platform surface hardening.** `RL-091` closed 2026-05-06 (structured logging + redaction + metrics catalog + readiness probes across both Cloudflare Workers + 5 incident runbooks + observability spec). `RL-084` closed 2026-05-06 (shared validator + path-traversal guard + bundled-runtime allowlist + new `unknown` status + UI test coverage). `RL-087` closed 2026-05-06 (watcher lifecycle audit + typed failure diagnostics surfaced via status notice + `IGNORED_PATH_PREFIXES` shared module + `before-quit` cleanup + USAGE.md platform-limitations section). The §5 #4 hardening lane is now closed in full.
5. **Product quality and supportability.** Closed in full. `RL-088` closed 2026-05-06 (axe-core gate via `tests/e2e/a11y.spec.ts`, keyboard-only flows, OverlayBackdrop focus restoration, plus the `docs/A11Y.md` manual checklist). `RL-086` closed 2026-05-07 (bundle/runtime performance budgets, baseline report, CI logs, desktop smoke runtime/memory metrics, and `runtimeObservability` folded into the central performance report). `RL-089` closed 2026-05-07 (versioned profile export/import with three conflict policies, replace-confirm modal, file picker + paste fallback, and explicit machine-bound exclusion list). `RL-090` closed 2026-05-07 (top-level error boundaries with redacted error report + clipboard fallback, global error listeners, safe-mode boot via `?safe-mode=1`, boot-loop counter escalating to factory mode after 3 crashes in 60s, RecoverySection with five scoped resets + reveal-folder, and `docs/RECOVERY.md` support documentation).
6. **Utilities polish.** Closed in full. `RL-072` closed 2026-05-08 (QR decode + Copy-as-PNG + colors + SVG + utilityOutputStore wiring). `RL-069` closed 2026-05-09 — Slice 1 (productivity foundation), Slice 2 (detect + Apply + 29-panel coverage), and Slice 3 (clipboard-on-focus + history + favorites with `@dnd-kit` drag-reorder + new `UtilitiesSection` Settings + RL-065 telemetry events) all shipped same day window. The lane is empty.
7. **Debugger + language intelligence.** `RL-026` closed 2026-05-11 — Slice 4 (Go via gopls — diagnostics + completions + hover + signature help) shipped alongside Slice 3 (Rust via rust-analyzer) earlier the same day; both run on the shared LSP scaffold (`src/main/lsp/lspProcess.ts`, `src/main/ipc/lsp.ts` allowlist) and the renderer lifecycle is owned by a shared `useLspLifecycle`. `RL-027` Slice 1.5 is shipped; only Slice 1.5b (conditional breakpoints + watch expressions behind security review) remains. These unblock `RL-042` and `RL-047`.
8. **Runtime mode expansion.** `RL-019` + `RL-020` are closed. Their contracts now unblock the next REPL/runtime slices.
9. **World-class foundation (slots 9-14, 2026-05-20 promotion).** The world-class lane promoted on 2026-05-20 (see `WORLD_CLASS_TO_RL_PROPOSAL.md`) takes the next six slots in this order:
   - **9.** `RL-027` Slice 1.5b conditional breakpoints + watch expressions — security carve-out gate; either land it or formally re-defer per ADR.
   - **10.** `RL-044` next slice — rich-media (chart / image / sandboxed HTML) + Sub-slice F clickable error stacks. Stabilises the payload contract `RL-094` capsules embed.
   - **11.** `RL-024` Multi-file projects Slice 1 — sidebar tree + open folder + find-in-files. Promoted to top-priority foundation; converts the scratchpad into a workspace.
   - **12.** `RL-094` Run Capsules Slice 1 — schema + export + redaction registry. Spine artifact for every downstream world-class ticket.
   - **13.** `RL-095` Language Support Scorecard Slice 1 — typed support matrix. Cheap defensive lock for future language flips.
   - **14.** `RL-036` Phase A1 — no-backend share links. First consumer of the capsule format.
10. **Trust + growth (slots 15-20).**
    - **15.** `RL-101` Onboarding Choreography Slice 1 — pre-seeded scratchpad + post-first-run toast.
    - **16.** `RL-096` Privacy + Trust Dashboard Slice 1 — Settings tab with redaction preview + run-history timeline.
    - **17.** `RL-025` Slice A/B — dependency detection + explicit installs (existing ticket; pick after trust surface).
    - **18.** `RL-102` Git Read-Only Layer Slice 1 — `git:detect` / `:status` / `:diff` IPC + status pill + diff panel.
    - **19.** `RL-103` Project Templates Slice 1 — 5 curated `ProjectTemplateV1` templates.
    - **20.** `RL-097` HTTP + SQL Workspace Slice 1 — HTTP collections bottom-panel tab.
11. **Compositional + AI (slots 21-26).**
    - **21.** `RL-099` Utility Pipelines Slice 1 — pipeline engine + JSON pipeline.
    - **22.** `RL-031` Slice 0/1 — local Ollama bridge MVP.
    - **23.** `RL-098` CLI Companion Slice 1 — `lingua utility` + `lingua capsule validate`.
    - **24.** `RL-100` Importers Slice 1 — cURL → HTTP request.
    - **25.** `RL-039` Slice B Recipes — fuzzy-searchable recipe cards with assertion runner.
    - **26.** `RL-043` Slice A — `.linguanb` schema + notebook sessions.
12. **Polish + research (slots 27+).** `RL-031` Slice 2 (Local Docs + AI citations) → `RL-107` (VSCode theme import) → `RL-047` (visualization API) → `RL-050` Phase A spike (LAN ADR) → `RL-104` (WebGPU AI spike) → `RL-105` (mobile PWA Phase A) → `RL-106` (curated community snippets Phase A) → `RL-050` Phase B (cross-internet pair, gated on Phase A).
13. **Tier 1 sugerencias (slots 35-38, promoción 2026-05-20).** Cuatro tickets nuevos del análisis post-promoción del world-class lane. Sequenciados tras polish + research:
    - **35.** `RL-108` Inline lint + quick-fixes (Monaco) Slice 1 — JS/TS lint worker + 5 quick-fixes. Cierre del gap perceptual contra VSCode.
    - **36.** `RL-111` Workspace session restore Slice 1 — `SessionSnapshotV1` + restore toast on boot.
    - **37.** `RL-109` Project-scoped env isolation Slice 1 — per-project env scope (depende RL-024 Slice 1).
    - **38.** `RL-110` Smart paste detection Slice 1 — clipboard handler registry (depende RL-036 + RL-097 + RL-044 Sub-slice F).
14. **Tier 2 polish (slots 39-45).** Siete items menores; orden por dependencia + costo/valor:
    - **39.** `RL-113` Cmd+; Recent commands stack — sin dependencias, valor inmediato.
    - **40.** `RL-112` Persistent status bar — depende parcialmente de RL-108 (segmento lint) y RL-102 (segmento git); degrada graceful.
    - **41.** `RL-115` Inline per-line timing — extiende RL-020 Slice 5 auto-log.
    - **42.** `RL-116` Focus / Presenter mode — sin dependencias.
    - **43.** `RL-114` Test runner auto-detect — depende RL-024 Slice 1.
    - **44.** `RL-024` Slice 2 search + replace cross-project — extensión de RL-024 Slice 1.
    - **45.** `RL-117` Personal cloud sync — Phase A (ADR only). Phase B gated on ADR + ANTI_FEATURES §A-006 reversal note.
15. **Tier 3 conscientemente fuera de scope.** Seis items NO se planean: plugin/extension API real (T3-001), cross-language refactoring (T3-002), profiling / flame graphs (T3-003), DB clients embedded (T3-004), Docker integration (T3-005), snippet auto-save versioning (T3-006). Razón + reverse-allowed-if documentado por item en `PLAN.md` Tier 3.
16. **Growth / SEO / marketing / docs IA.** `RL-066` closed 2026-05-05. `RL-082` closed 2026-05-05. `RL-032` continues as the remaining polish ticket in this lane after the core launch ships.

Never start a row tagged `Gated` until its gate clears. When the top of
this list is blocked, drop down the list rather than improvise.

## 6. Closed tickets (historical reference)

This section is intentionally compact — `Done` tickets are listed once,
without scope, so agents don't waste tokens scanning them. Deep
implementation detail lives in `docs/PLAN.md#RL-XXX`.

<details>
<summary><strong>67 `Done` tickets</strong> — expand for the list</summary>

`RL-001`, `RL-002`, `RL-003`, `RL-004`, `RL-005`, `RL-006`, `RL-007`,
`RL-008`, `RL-009`, `RL-010`, `RL-011`, `RL-016`, `RL-017`, `RL-018`,
`RL-021`, `RL-022`, `RL-026`, `RL-028`, `RL-030`, `RL-034`, `RL-037`,
`RL-038`, `RL-040`, `RL-045`, `RL-051`, `RL-052`, `RL-053`, `RL-054`,
`RL-055`, `RL-056`, `RL-057`, `RL-058`, `RL-059`, `RL-060`, `RL-061`,
`RL-062`, `RL-063`, `RL-064`, `RL-065`, `RL-066`, `RL-067`, `RL-068`,
`RL-069`, `RL-070`, `RL-071`, `RL-073`, `RL-074`, `RL-075`, `RL-076`,
`RL-033`, `RL-077`, `RL-078`, `RL-079`, `RL-080`, `RL-081`, `RL-082`,
`RL-083`, `RL-084`, `RL-085`, `RL-086`, `RL-087`, `RL-088`, `RL-089`,
`RL-090`, `RL-091`, `RL-092`, `RL-093`.

</details>

<details>
<summary><strong>3 `Superseded` tickets</strong> — expand for the list</summary>

- `RL-013` — Hybrid JS/TS runtime modes → superseded by `RL-019`, `RL-020`, `RL-029`.
- `RL-014` — AI assistance → superseded by `RL-031`.
- `RL-015` — i18n, custom theming, and shortcut customization → superseded by `RL-018`, `RL-037`.

</details>

## 7. Status-update protocol (when closing a ticket)

The last commit of a ticket must do all three:

1. Flip `Status` in the matching row of §4 to `Done` and append a
   2-3 line "Shipped: …" summary to the scope cell. Move the row into
   the §6 archive if the ticket is fully closed.
2. If the ticket had a corresponding entry in `docs/SPRINT-PLAN.md` §1
   (Status-at-a-glance) or a detailed §N section, shrink that section
   to a one-line "Shipped on <date> — see RL-XXX" reference.
3. If the ticket's original scope claims in `docs/PLAN.md` now drift
   from reality, add an "### §X Status Update" block inside that
   RL-XXX section with the new state — do not rewrite history.

If the ticket introduced new docs (ADR, runbook, spec), register them
in `docs/README.md` under the appropriate index row.

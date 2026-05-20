/**
 * Privacy-respecting telemetry payload shape + redactor (RL-065).
 *
 * The product is local-first; telemetry only fires when the user has
 * explicitly opted in and the build honors the `VITE_LINGUA_TELEMETRY_DISABLED=1`
 * kill switch. This module owns the TypeScript surface for telemetry events
 * and, critically, the `TELEMETRY_EVENTS` allowlist that prevents drift
 * into "just this one field" expansions that creep toward user code capture.
 *
 * `redactForTelemetry` is exported so both the renderer emitter and the
 * CI payload grep live on the same single redaction pass.
 */

export const TELEMETRY_EVENTS = [
  'app.launched',
  'runner.executed',
  'overlay.opened',
  'feature.blocked',
  'update.checked',
  // RL-069 Slice 3 — Developer Utilities productivity layer adoption.
  // Counts only; no content, no input/output payloads, no tool ids
  // beyond a fixed enum bucket already on the catalog.
  'utility.favorite.pinned',
  'utility.history.cleared',
  'utility.clipboard.applied',
  // RL-027 Slice 1.5 — debugger session lifecycle. Payload is locked to
  // `{ language, reasonBucket }` per DEBUGGER_ADR §4. No source, no code,
  // no expression content, no breakpoint coordinates.
  'debugger.attached',
  'debugger.paused',
  'debugger.detached',
  // RL-019 Slice 1 — per-tab JS/TS runtime mode change. Closed enum
  // payload `{ mode, language }`; no source, no tab id, no content.
  // See `docs/RUNTIME_MODES_ADR.md` for the policy.
  'runtime.mode_changed',
  // RL-020 Slice 1 — auto-run completion gate fired. Closed enum
  // payload `{ language, reason }`; no source, no tab id, no content.
  // Today only `reason: 'incomplete'` ships; the validator is locked
  // to that single value so a future expansion of the gate must
  // amend this allowlist + the mirror in update-server.
  'runtime.auto_run_gated',
  // RL-020 Slice 8 — Compare-with-last-stable adoption signal.
  // Closed-enum payload `{ language, enabled }`; no source code,
  // no tab id, no diff content. Fires on user-driven toggles (the
  // header button, the palette action, the Mod+Shift+D shortcut).
  // The flag flips both ways so dashboards can see enable vs.
  // disable separately.
  'runtime.compare_view_toggled',
  // RL-020 Slice 2 — per-tab workflow mode change. Closed enum
  // payload `{ language, from, to, trigger }`; no source code, no
  // tab id, no content. `from` + `to` are the WorkflowMode enum;
  // `trigger` tags what caused the change (toolbar click vs. the
  // language-change auto-correction in renameTab). Property is
  // named `trigger` (not `source`) so the DENY_SUBSTRINGS pass
  // does not strip it on the way out.
  'runtime.workflow_mode_changed',
  // RL-020 Slice 3 — magic-comment results emitted. Closed enum
  // payload `{ language, hasArrow, hasWatch }`; no expression
  // content, no line numbers, no values. Fired at most once per
  // debounced auto-run when at least one magic result reached the
  // panel, so adoption of `//=>` vs `// @watch` is observable
  // without per-comment noise.
  'runtime.magic_comment_emitted',
  // RL-020 Slice 4 — execution-history replay dispatched. Closed
  // enum payload `{ language, status, surface }`; no source code,
  // no expression content, no timestamp. `surface` tags WHICH UI
  // surface drove the replay (`tab_pill`, `palette`, `popover`) so
  // adoption per affordance is observable. Fired once per replay
  // dispatch, gated by the same EXECUTION_HISTORY entitlement that
  // controls the replay surfaces.
  'runtime.history_replay',
  // RL-020 Slice 5 — bare-expression auto-log mode adoption.
  // `runtime.auto_log_enabled` fires when the user toggles the
  // per-language Settings default (`{ language, enabled }`). The
  // event ALSO fires from the per-tab override path so adoption is
  // observable regardless of which surface the user used to flip
  // the bit. `enabled` is a boolean.
  'runtime.auto_log_enabled',
  // RL-020 Slice 5 fold A — per-run auto-log emission signal. Fires
  // at most once per clean auto-run that produced ≥1 auto-log
  // result. `countBucket` is a closed enum (`1`, `2-5`, `6-20`,
  // `20-plus`) so the redactor never has to accept raw counts.
  'runtime.auto_log_emitted',
  // RL-020 Slice 6 — bare-stdin adoption signal. Fires once per
  // run whose worker consumed ≥1 line from the pre-set stdin
  // buffer. Closed-enum payload: `{ language }`; no buffer
  // content, no consumed count, no source. The countBucket lives
  // on the panel only, not on the wire.
  'runtime.stdin_used',
  // RL-019 Slice 2 — desktop Node child-spawn runner adoption.
  // Fires once per `node` mode execute() with the final status
  // bucket. Closed-enum payload `{ language, status }`; no source,
  // no exit code, no error message. `status` is the closed enum
  // `'success'` / `'error'` / `'timeout'` / `'stopped'` /
  // `'missing-binary'`.
  'runtime.node_runner_used',
  // RL-020 Slice 7 — per-language timeout-preset change. Fires
  // when the user sets a new preset via Settings → Editor or via
  // the command palette. Closed-enum payload `{ language, preset }`;
  // no source code, no tab id, no content. `preset` is the
  // `RuntimeTimeoutPreset` closed enum.
  'runtime.timeout_preset_changed',
  // RL-020 Slice 9 — variable inspector adoption signal. Fires
  // when the user opens the inspector via any surface (header
  // toggle, palette action, keyboard shortcut). Closed-enum
  // payload `{ language, variableCount }`; `variableCount` is a
  // bucket string from `VARIABLE_COUNT_BUCKETS` (`'0'` / `'1-5'`
  // / `'6-20'` / `'21-50'` / `'51+'`).
  'runtime.variable_inspector_opened',
  // RL-093 Slice 3 fold F — adoption signal for the floating ↔ bottom
  // surface choice. Closed-enum payload `{ surface }` where `surface`
  // is `'floating'` or `'bottom'`. Mirrored on update-server (deferred
  // to a follow-up — see RL-093 Slice 3 Status Update in PLAN.md).
  'runtime.variable_inspector_surface_changed',
  // RL-044 Slice 1B — rich console payload rendered. Fires at most once
  // per console entry first-render so adoption per payload kind is
  // observable. Closed-enum payload `{ kind }` from
  // `CONSOLE_RICH_KIND_BUCKETS`. No source code, no expression
  // content, no per-entry counts. Mirrored on update-server with a
  // parity test.
  'runtime.console_rich_rendered',
  // RL-044 Slice 1B fold F — `console.table()` shim adoption signal.
  // Separate from `runtime.console_rich_rendered` so a dashboard can
  // count discovery of the explicit shim (vs. auto-detection of
  // tabular arrays by `serializeRichValue`). Closed-enum payload
  // `{ language }` only.
  'runtime.console_table_called',
  // RL-044 Slice 1C fold B — Python (Pyodide) console payload adoption
  // signal. Separate from the renderer-side
  // `runtime.console_rich_rendered` so dashboards can isolate
  // Python-runner-produced payloads from the renderer's render
  // dispatch. Closed-enum `{ kind }` mirrors `CONSOLE_RICH_KIND_BUCKETS`.
  'runtime.python_console_payload_emitted',
  // RL-044 Slice 2a — Sub-slice F adoption signal. Fires once per
  // click on a clickable stack frame. Closed-enum `{ language }`
  // only; no file, no line, no column, no function name. Mirrored on
  // update-server.
  'runtime.error_stack_frame_clicked',
  // RL-044 Slice 2a — rich-media payload rejection signal. Useful for
  // security dashboards: counts how often workers (or user-emitted
  // payloads) get bounced by the renderer-side validators. Closed
  // enum `{ kind, reason }`: `kind` ∈ `{'image','html'}`, `reason`
  // ∈ `{'invalid-src','size-limit','validation-failed'}`. No source,
  // no payload content. Mirrored on update-server.
  'runtime.rich_media_payload_rejected',
  // RL-042 Slice 6 — Ruby runtime dispatch signal. Fires on every
  // `RubyRunner.execute()` so dashboards can isolate the WASM-only
  // path from the system-binary path. Closed-enum payload
  // `{ mode, bucketedSpawnMs }` — `mode` is `'system'` / `'wasm'` /
  // `'missing'` (system requested but not detected), `bucketedSpawnMs`
  // is `'<100ms'` / `'<300ms'` / `'<1s'` / `'<3s'` / `'>=3s'`. No
  // source code, no file path, no IPC payload content. Mirrored on
  // update-server with a parity test.
  'runtime.ruby_runner_dispatched',
  // RL-042 Slice 6 — adoption signal for the Settings → Editor
  // "Ruby runtime" select. Closed-enum payload `{ preference }`
  // matching the persisted `rubyRuntimePreference` enum.
  'runtime.ruby_runtime_preference_changed',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[number];

export interface TelemetryBaseFields {
  appVersion: string;
  osBucket: string;
  /** `pro` / `free` / `grace` / `invalid` — never the raw token. */
  licenseStatus: string;
  /** Coarse session id generated per-launch — not a user identifier. */
  sessionId: string;
}

export interface TelemetryEvent extends TelemetryBaseFields {
  event: TelemetryEventName;
  /**
   * Allowed per-event properties. Keys listed here are the only ones that
   * survive the redactor. Any key not in this map is dropped, not sent.
   */
  properties: Record<string, string | number | boolean>;
  /** Milliseconds since epoch — rounded to the minute to reduce fingerprintability. */
  timestamp: number;
}

/**
 * Allowlist of properties we intentionally collect per event. Any other key
 * is dropped by the redactor. Keep this list short and reviewed — any
 * expansion should come with a matching copy block in the consent UI.
 */
const EVENT_PROPERTY_ALLOWLIST: Record<TelemetryEventName, readonly string[]> = {
  'app.launched': ['platform', 'build', 'locale'],
  'runner.executed': ['language', 'status', 'durationBucketMs'],
  'overlay.opened': ['overlayId'],
  'feature.blocked': ['entitlement', 'tier'],
  // RL-065 Slice 5 — `status` is a closed enum:
  //   `available`  → autoupdater reported an update is ready/downloading.
  //   `no-update`  → autoupdater reported the build is already current.
  //   `failure`    → autoupdater raised an error during the check.
  // No version strings, no release notes, no error messages — those
  // would be free-form text and risk leaking host detail. Fired by
  // `src/renderer/stores/updateStore.ts` on every transition out of
  // the `checking` state.
  'update.checked': ['status'],
  // RL-069 Slice 3 — `utilityId` is the catalog enum value (a fixed
  // string set, not user data). `count` is the post-action favorites
  // length so we can see adoption without tracking per-tool.
  'utility.favorite.pinned': ['utilityId', 'count'],
  'utility.history.cleared': ['utilityId', 'scope'],
  'utility.clipboard.applied': ['utilityId'],
  // RL-027 Slice 1.5 — `language` is the runtime adapter id (a closed
  // enum: `js` / `python` / `go` / `rust`). `reasonBucket` is a closed
  // set partitioned by event:
  //   `debugger.attached` → `attach` (the only valid value today; if a
  //     future slice adds a reattach path it MUST update this comment
  //     and the runbook in `docs/DEBUGGER_SLICE1.md`).
  //   `debugger.paused`   → `user-breakpoint` / `step` / `exception`.
  //   `debugger.detached` → `user-detach` / `run-complete` / `crash` / `stop`.
  // No expression content, no breakpoint line, no source snippet.
  'debugger.attached': ['language', 'reasonBucket'],
  'debugger.paused': ['language', 'reasonBucket'],
  'debugger.detached': ['language', 'reasonBucket'],
  // RL-019 Slice 1 — `mode` is the closed `RuntimeMode` enum
  // (`worker` / `node` / `browser-preview`). `language` is the
  // language-pack id; today only `javascript` / `typescript` ever
  // fires this event but the value-validator stays generic so
  // future slices can extend the runtime-mode surface to other
  // languages without an allowlist churn.
  'runtime.mode_changed': ['mode', 'language'],
  // RL-020 Slice 1 — `language` is the language-pack id (today only
  // `javascript` / `typescript`). `reason` is a closed enum locked
  // to `'incomplete'` for Slice 1.
  'runtime.auto_run_gated': ['language', 'reason'],
  // RL-020 Slice 8 — `language` is the language-pack id
  // (`isSafeToken`); `enabled` is a boolean flipping with the
  // user's toggle direction. Mirrored on update-server.
  'runtime.compare_view_toggled': ['language', 'enabled'],
  // RL-020 Slice 2 — `language` is the language-pack id (any
  // string passing `isSafeToken`). `from` + `to` are the
  // `WorkflowMode` closed enum (`run` / `debug` / `scratchpad`).
  // `trigger` is a closed enum tagging what caused the change:
  // `'toolbar'` — explicit segmented-control click; `'language_change'`
  // — the user renamed a tab and the previous mode is no longer
  // supported, so the store auto-corrected to a valid default. The
  // field is named `trigger` (not `source`) because the DENY_SUBSTRINGS
  // pass below treats `source` as a code-bearing flag and would strip
  // it even though the value is a closed enum.
  'runtime.workflow_mode_changed': ['language', 'from', 'to', 'trigger'],
  // RL-020 Slice 3 — `language` is the language-pack id (any
  // `isSafeToken` string). `hasArrow` and `hasWatch` are booleans
  // surfacing which magic-comment shapes fired this run. The
  // validator allows only true / false values; integers or strings
  // are dropped silently.
  'runtime.magic_comment_emitted': ['language', 'hasArrow', 'hasWatch'],
  // RL-020 Slice 4 — `language` is the language-pack id; `status`
  // is the closed `ExecutionStatus` enum (`ok` / `error`);
  // `surface` is the closed `HistoryReplaySurface` enum (see
  // `HISTORY_REPLAY_SURFACES` below).
  'runtime.history_replay': ['language', 'status', 'surface'],
  // RL-020 Slice 5 — `language` is the language-pack id (JS / TS
  // for the Slice 5 surfaces; the validator stays generic so a
  // future widening to Python does not require an allowlist
  // change). `enabled` is a boolean.
  'runtime.auto_log_enabled': ['language', 'enabled'],
  // RL-020 Slice 5 fold A — `countBucket` is the closed enum
  // (`1`, `2-5`, `6-20`, `20-plus`) emitted by `bucketAutoLogCount`
  // in `useAutoRun.ts`. The renderer / worker validators reject
  // anything else.
  'runtime.auto_log_emitted': ['language', 'countBucket'],
  // RL-020 Slice 6 — language-only payload. Bucketed counts would
  // give the consumed-line distribution but also risk fingerprinting
  // a small population by per-run shape; Slice 6 stays at adoption
  // level only.
  'runtime.stdin_used': ['language'],
  // RL-019 Slice 2 — `language` is the language-pack id
  // (`'javascript'` / `'typescript'`); `status` is the closed enum
  // (`'ok'` / `'error'` / `'timeout'` / `'stopped'` /
  // `'missing-binary'`). Mirrored on update-server.
  'runtime.node_runner_used': ['language', 'status'],
  // RL-020 Slice 7 — `language` is the language-pack id (`isSafeToken`);
  // `preset` is the closed `RuntimeTimeoutPreset` enum
  // (`quick` / `normal` / `long` / `extended`). Mirrored on
  // update-server; the parity test asserts both sets stay aligned.
  'runtime.timeout_preset_changed': ['language', 'preset'],
  // RL-020 Slice 9 — `language` is the language-pack id (`isSafeToken`);
  // `variableCount` is a closed enum bucket
  // (`'0'` / `'1-5'` / `'6-20'` / `'21-50'` / `'51+'`).
  'runtime.variable_inspector_opened': ['language', 'variableCount'],
  // RL-093 Slice 3 fold F — `surface` is the closed `'floating' | 'bottom'`
  // enum.
  'runtime.variable_inspector_surface_changed': ['surface'],
  // RL-044 Slice 1B — `kind` is the closed `ConsolePayloadKindBucket`
  // enum (`table` / `object` / `array` / `mapSet` / `date` / `promise`
  // / `text` / `rawText` / `image` / `chart`). Mirrored on
  // update-server.
  'runtime.console_rich_rendered': ['kind'],
  // RL-044 Slice 1B fold F — `language` is the language-pack id.
  // Mirrored on update-server.
  'runtime.console_table_called': ['language'],
  // RL-044 Slice 1C fold B — `kind` is the closed `ConsolePayloadKindBucket`
  // enum (same set as `runtime.console_rich_rendered`).
  'runtime.python_console_payload_emitted': ['kind'],
  // RL-044 Slice 2a — `language` is the language-pack id
  // (`isSafeToken`). No file, no line, no column.
  'runtime.error_stack_frame_clicked': ['language'],
  // RL-044 Slice 2a — `kind` ∈ `RICH_MEDIA_REJECTED_KINDS`,
  // `reason` ∈ `RICH_MEDIA_REJECTED_REASONS`. Both closed enums
  // mirrored on update-server with a parity test.
  'runtime.rich_media_payload_rejected': ['kind', 'reason'],
  // RL-042 Slice 6 — `mode` is the closed `RubyDispatchedMode`
  // (`system` / `wasm` / `missing`); `bucketedSpawnMs` is the closed
  // bucket enum (`<100ms` / `<300ms` / `<1s` / `<3s` / `>=3s`).
  // Mirrored on update-server with a parity test.
  'runtime.ruby_runner_dispatched': ['mode', 'bucketedSpawnMs'],
  // RL-042 Slice 6 — `preference` is the closed
  // `rubyRuntimePreference` enum (`auto` / `system` / `wasm`).
  // Mirrored on update-server.
  'runtime.ruby_runtime_preference_changed': ['preference'],
};

const DENY_SUBSTRINGS = [
  'content',
  'code',
  'source',
  'snippet',
  'file',
  'path',
  'token',
  'password',
  'email',
  'name',
  'project',
];

const SAFE_TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
// RL-020 Slice 7 — widened from `['ok', 'error']` to include the
// two distinct termination kinds the renderer now distinguishes:
// `'timeout'` (the worker hit the preset deadline) and `'stopped'`
// (the user clicked Stop). Dashboards that already accepted only
// `'ok'` / `'error'` keep working — the new values are rejected by
// the old validator, so an old worker silently drops them, and the
// parity test enforces the renderer + update-server stay in sync.
const RUNNER_STATUS_VALUES = new Set([
  'ok',
  'error',
  'timeout',
  'stopped',
]);
// RL-020 Slice 7 — closed enum mirroring `RuntimeTimeoutPreset` in
// `src/shared/runtimeTimeoutPresets.ts`. Duplicated here so the
// redactor stays a pure module without an import cycle; a parity
// test asserts both sides stay in sync.
const RUNTIME_TIMEOUT_PRESET_VALUES = new Set([
  'quick',
  'normal',
  'long',
  'extended',
]);
// RL-019 Slice 2 — closed enum mirror of `NodeRunKind` exported
// from `src/main/node-runner.ts`. Duplicated here so the redactor
// stays a pure module without an import cycle; the parity test
// asserts both sides stay in sync.
const NODE_RUNNER_STATUS_VALUES = new Set([
  'success',
  'error',
  'timeout',
  'stopped',
  'missing-binary',
]);
// RL-020 Slice 9 — variable inspector adoption bucket enum. Source
// of truth in `src/shared/scopeSnapshot.ts` (`VARIABLE_COUNT_BUCKETS`);
// duplicated here so the redactor stays a pure module without an
// import cycle.
const VARIABLE_INSPECTOR_COUNT_BUCKETS = new Set([
  '0',
  '1-5',
  '6-20',
  '21-50',
  '51+',
]);
// RL-044 Slice 1B — closed enum mirroring `ConsolePayloadKindBucket`
// in `src/renderer/types/index.ts`. Duplicated here so the redactor
// stays a pure module without an import cycle; a parity test asserts
// both sides stay in sync (the union of `ScopeValue` discriminants the
// renderer maps to `'object' | 'array' | 'text'` + the additional
// `RichOutputPayload` kinds reserved in `src/shared/richOutput.ts`).
export const CONSOLE_RICH_KIND_BUCKETS = new Set([
  'table',
  'object',
  'array',
  'mapSet',
  'date',
  'promise',
  'text',
  'rawText',
  'image',
  'chart',
  // RL-044 Slice 1C fold F — Python BaseException payloads ship the
  // error kind from __lingua_console_serialize. The renderer paints
  // them via the same chip + popover chain as other payloads, but
  // the redactor would silently drop the kind without an explicit
  // bucket. Added so the telemetry survives the closed-enum gate.
  'error',
  // RL-044 Slice 2a — sandboxed HTML payloads. The renderer paints
  // them via `<RichValueHtml>`; the bucket lets dashboards isolate
  // HTML rendering adoption from chart / image.
  'html',
]);
// RL-044 Slice 2a — closed enums backing
// `runtime.rich_media_payload_rejected`. Duplicated here for the
// same reason as `CONSOLE_RICH_KIND_BUCKETS`; the parity test in
// `update-server/test/telemetry.test.ts` keeps both sides in sync.
export const RICH_MEDIA_REJECTED_KINDS = new Set(['image', 'html', 'chart']);
export const RICH_MEDIA_REJECTED_REASONS = new Set([
  'invalid-src',
  'size-limit',
  'validation-failed',
]);
// RL-042 Slice 6 — closed enums for the Ruby dispatcher telemetry.
// Duplicated here for the same reason as CONSOLE_RICH_KIND_BUCKETS;
// the parity test in `update-server/tests/telemetry.parity.test.ts`
// keeps both sides in sync.
export const RUBY_DISPATCHED_MODE_VALUES = new Set([
  'system',
  'wasm',
  'missing',
]);
export const RUBY_SPAWN_BUCKETS = new Set([
  '<100ms',
  '<300ms',
  '<1s',
  '<3s',
  '>=3s',
]);
export const RUBY_RUNTIME_PREFERENCE_VALUES = new Set([
  'auto',
  'system',
  'wasm',
]);
const DURATION_BUCKETS = new Set([0, 50, 250, 1000, 5000, 30_000, 60_000]);
const UPDATE_CHECKED_STATUS_VALUES = new Set([
  'available',
  'no-update',
  'failure',
]);
const HISTORY_CLEAR_SCOPES = new Set(['session', 'persisted', 'all']);
// RL-019 Slice 1 — closed enum mirroring `RuntimeMode`. The
// shared `runtimeModes.ts` module is the source of truth for the
// production code; this Set is duplicated here so the redactor
// stays a pure module without an import cycle. A parity test
// asserts both stay in sync.
const RUNTIME_MODE_VALUES = new Set(['worker', 'node', 'browser-preview']);
// RL-020 Slice 1 — closed enum for the auto-run gate reason. Today
// only the renderer's `useAutoRun` emits `'incomplete'`; the validator
// rejects anything else so a future heuristic-expansion has to amend
// this Set + its mirror in `update-server/src/telemetry.ts`.
const AUTO_RUN_GATE_REASONS = new Set(['incomplete']);
// RL-020 Slice 2 — closed enum mirroring `WorkflowMode` in
// `src/shared/workflowMode.ts`. Duplicated here so this redactor
// stays a pure module without an import cycle; a parity test
// asserts both stay in sync.
const WORKFLOW_MODE_VALUES = new Set(['run', 'debug', 'scratchpad']);
// RL-020 Slice 2 — closed enum for the `trigger` property on
// `runtime.workflow_mode_changed`. `toolbar` is an explicit user
// gesture; `language_change` is the auto-correction emitted by
// `renameTab` when the new language no longer supports the previous
// mode. A future slice that adds Settings-driven retroactive
// propagation would extend this Set + the mirror in
// `update-server/src/telemetry.ts` in the same commit (the parity
// test enforces both sides at CI time).
const WORKFLOW_MODE_CHANGE_TRIGGERS = new Set([
  'toolbar',
  'language_change',
]);
// RL-020 Slice 4 — closed enum for the `surface` property on
// `runtime.history_replay`. `tab_pill` is the per-tab RecentRunsPill
// shipped this slice; `palette` is the command-palette Replay
// action shipped in RL-028 Slice 6; `popover` is the
// ExecutionHistoryPopover Replay button. Mirrored on the worker.
const HISTORY_REPLAY_SURFACES = new Set([
  'tab_pill',
  'palette',
  'popover',
]);
// RL-020 Slice 5 fold A — closed enum for the `countBucket`
// property on `runtime.auto_log_emitted`. `bucketAutoLogCount` in
// `src/renderer/hooks/useAutoRun.ts` is the only producer; the
// renderer + worker validators reject every other value. Mirrored
// in `update-server/src/telemetry.ts`; a parity test enforces
// both copies stay aligned.
const AUTO_LOG_COUNT_BUCKETS = new Set([
  '1',
  '2-5',
  '6-20',
  '20-plus',
]);
const DEBUGGER_REASON_BUCKETS: Record<
  Extract<
    TelemetryEventName,
    'debugger.attached' | 'debugger.paused' | 'debugger.detached'
  >,
  ReadonlySet<string>
> = {
  'debugger.attached': new Set(['attach']),
  'debugger.paused': new Set(['user-breakpoint', 'step', 'exception']),
  'debugger.detached': new Set(['user-detach', 'run-complete', 'crash', 'stop']),
};

function keyLooksSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return DENY_SUBSTRINGS.some((deny) => lower.includes(deny));
}

function valueLooksSensitive(value: unknown): boolean {
  // Everything except primitives is stripped — we never transmit objects,
  // arrays, buffers, or anything that could structurally carry user data.
  if (value === null) return false;
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return false;
  return true;
}

export function isSafeToken(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TOKEN_RE.test(value);
}

function isSafeCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 1000
  );
}

function isAllowedValue(
  event: TelemetryEventName,
  key: string,
  value: unknown
): value is string | number | boolean {
  switch (event) {
    case 'app.launched':
      return isSafeToken(value);
    case 'runner.executed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status') return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'durationBucketMs') return typeof value === 'number' && DURATION_BUCKETS.has(value);
      return false;
    case 'overlay.opened':
      return key === 'overlayId' && isSafeToken(value);
    case 'feature.blocked':
      return (key === 'entitlement' || key === 'tier') && isSafeToken(value);
    case 'update.checked':
      return typeof value === 'string' && UPDATE_CHECKED_STATUS_VALUES.has(value);
    case 'utility.favorite.pinned':
      if (key === 'utilityId') return isSafeToken(value);
      if (key === 'count') return isSafeCount(value);
      return false;
    case 'utility.history.cleared':
      if (key === 'utilityId') return isSafeToken(value);
      if (key === 'scope') return typeof value === 'string' && HISTORY_CLEAR_SCOPES.has(value);
      return false;
    case 'utility.clipboard.applied':
      return key === 'utilityId' && isSafeToken(value);
    case 'debugger.attached':
    case 'debugger.paused':
    case 'debugger.detached':
      if (key === 'language') return isSafeToken(value);
      return (
        key === 'reasonBucket' &&
        typeof value === 'string' &&
        DEBUGGER_REASON_BUCKETS[event].has(value)
      );
    case 'runtime.mode_changed':
      if (key === 'mode') return typeof value === 'string' && RUNTIME_MODE_VALUES.has(value);
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.auto_run_gated':
      if (key === 'language') return isSafeToken(value);
      if (key === 'reason')
        return typeof value === 'string' && AUTO_RUN_GATE_REASONS.has(value);
      return false;
    case 'runtime.compare_view_toggled':
      if (key === 'language') return isSafeToken(value);
      if (key === 'enabled') return typeof value === 'boolean';
      return false;
    case 'runtime.workflow_mode_changed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'from' || key === 'to')
        return typeof value === 'string' && WORKFLOW_MODE_VALUES.has(value);
      if (key === 'trigger')
        return (
          typeof value === 'string' && WORKFLOW_MODE_CHANGE_TRIGGERS.has(value)
        );
      return false;
    case 'runtime.magic_comment_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'hasArrow' || key === 'hasWatch')
        return typeof value === 'boolean';
      return false;
    case 'runtime.history_replay':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status')
        return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'surface')
        return typeof value === 'string' && HISTORY_REPLAY_SURFACES.has(value);
      return false;
    case 'runtime.auto_log_enabled':
      if (key === 'language') return isSafeToken(value);
      if (key === 'enabled') return typeof value === 'boolean';
      return false;
    case 'runtime.auto_log_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return typeof value === 'string' && AUTO_LOG_COUNT_BUCKETS.has(value);
      return false;
    case 'runtime.stdin_used':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.timeout_preset_changed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'preset')
        return (
          typeof value === 'string' &&
          RUNTIME_TIMEOUT_PRESET_VALUES.has(value)
        );
      return false;
    case 'runtime.node_runner_used':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status')
        return (
          typeof value === 'string' &&
          NODE_RUNNER_STATUS_VALUES.has(value)
        );
      return false;
    case 'runtime.variable_inspector_opened':
      if (key === 'language') return isSafeToken(value);
      if (key === 'variableCount')
        return (
          typeof value === 'string' &&
          VARIABLE_INSPECTOR_COUNT_BUCKETS.has(value)
        );
      return false;
    case 'runtime.variable_inspector_surface_changed':
      if (key === 'surface') return value === 'floating' || value === 'bottom';
      return false;
    case 'runtime.console_rich_rendered':
      if (key === 'kind')
        return (
          typeof value === 'string' && CONSOLE_RICH_KIND_BUCKETS.has(value)
        );
      return false;
    case 'runtime.console_table_called':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.python_console_payload_emitted':
      if (key === 'kind')
        return (
          typeof value === 'string' && CONSOLE_RICH_KIND_BUCKETS.has(value)
        );
      return false;
    case 'runtime.error_stack_frame_clicked':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.rich_media_payload_rejected':
      if (key === 'kind')
        return (
          typeof value === 'string' && RICH_MEDIA_REJECTED_KINDS.has(value)
        );
      if (key === 'reason')
        return (
          typeof value === 'string' &&
          RICH_MEDIA_REJECTED_REASONS.has(value)
        );
      return false;
    case 'runtime.ruby_runner_dispatched':
      if (key === 'mode')
        return (
          typeof value === 'string' &&
          RUBY_DISPATCHED_MODE_VALUES.has(value)
        );
      if (key === 'bucketedSpawnMs')
        return (
          typeof value === 'string' &&
          RUBY_SPAWN_BUCKETS.has(value)
        );
      return false;
    case 'runtime.ruby_runtime_preference_changed':
      if (key === 'preference')
        return (
          typeof value === 'string' &&
          RUBY_RUNTIME_PREFERENCE_VALUES.has(value)
        );
      return false;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export interface RedactionResult {
  event: TelemetryEvent;
  droppedKeys: string[];
}

/**
 * Strip everything not in the per-event allowlist, then defensively drop
 * anything whose key or value shape looks like user data slipped through.
 * The returned event is safe to send — the caller must still honor the
 * consent flag before calling this.
 */
export function redactForTelemetry(event: TelemetryEvent): RedactionResult {
  const allowed = EVENT_PROPERTY_ALLOWLIST[event.event];
  const allowedSet = new Set(allowed);
  const droppedKeys: string[] = [];
  const properties: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(event.properties)) {
    if (!allowedSet.has(key)) {
      droppedKeys.push(key);
      continue;
    }
    if (keyLooksSensitive(key) || valueLooksSensitive(value)) {
      droppedKeys.push(key);
      continue;
    }
    if (!isAllowedValue(event.event, key, value)) {
      droppedKeys.push(key);
      continue;
    }
    properties[key] = value as string | number | boolean;
  }

  return {
    event: {
      ...event,
      properties,
      // Round to the minute so nothing fingerprintable sneaks through the
      // timestamp field (helpful for users on small populations).
      timestamp: Math.floor(event.timestamp / 60_000) * 60_000,
    },
    droppedKeys,
  };
}

/** Bucket an OS version string into a coarse "platform/major" form. */
export function bucketOs(platform: string, version: string): string {
  if (!platform) return 'unknown';
  const major = version.match(/^\d+/u)?.[0] ?? 'unknown';
  return `${platform}/${major}`;
}

/**
 * Generate a coarse, non-persistent session id (32 hex chars). Used as a
 * fingerprint-resistant grouping key for events inside a single launch.
 * Deliberately module-agnostic so renderer + tests + any future main
 * emitter call through the same helper.
 */
export function createSessionId(): string {
  const source =
    typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function'
      ? crypto
      : globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    // Worst case (no Web Crypto): return a time-based fallback. Still
    // single-launch scoped — it never leaves memory and is only used to
    // group events, never to identify a user.
    return `t${Date.now().toString(16)}${Math.floor(Math.random() * 0xffffff).toString(16)}`.padEnd(32, '0');
  }
  const bytes = new Uint8Array(16);
  source.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Simple duration bucketer so we never transmit raw run times. */
export function bucketDurationMs(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  if (ms < 50) return 50;
  if (ms < 250) return 250;
  if (ms < 1000) return 1000;
  if (ms < 5000) return 5000;
  if (ms < 30_000) return 30_000;
  return 60_000;
}

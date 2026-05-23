/**
 * RL-065 Slice 5 — telemetry export endpoint.
 *
 * Accepts privacy-respecting events POSTed from the renderer (only
 * after the user has granted consent in Settings → Privacy). Every
 * payload is validated against the same allowlist + property
 * constraints the renderer redactor enforces in
 * `src/shared/telemetry.ts`, mirrored here verbatim for defense
 * in depth: a server that re-validates means a malicious or
 * misconfigured client cannot smuggle user-code through the wire.
 *
 * Persistence is Workers Observability `console.log` (already
 * `enabled = true` in `wrangler.toml`). Retention is ~3 days on
 * the standard plan; `docs/runbooks/telemetry-pipeline.md`
 * documents the promote-to-D1 follow-up when that becomes
 * load-bearing.
 *
 * Mirror discipline: when `TELEMETRY_EVENTS` or
 * `EVENT_PROPERTY_ALLOWLIST` change in `src/shared/telemetry.ts`,
 * update the copies below in the SAME commit. The parity test in
 * `test/telemetry.test.ts` enforces this at CI time — a forgotten
 * mirror fails the build.
 */

import { log } from './lib/observability';

// Mirror of TELEMETRY_EVENTS in src/shared/telemetry.ts. The parity
// test imports both arrays and asserts equality.
export const TELEMETRY_EVENT_NAMES = [
  'app.launched',
  'runner.executed',
  'overlay.opened',
  'feature.blocked',
  'update.checked',
  'utility.favorite.pinned',
  'utility.history.cleared',
  'utility.clipboard.applied',
  'debugger.attached',
  'debugger.paused',
  'debugger.detached',
  'runtime.mode_changed',
  'runtime.auto_run_gated',
  // RL-020 Slice 8 — mirror of `runtime.compare_view_toggled`.
  'runtime.compare_view_toggled',
  'runtime.workflow_mode_changed',
  'runtime.magic_comment_emitted',
  'runtime.history_replay',
  // RL-020 Slice 5 — mirror of `runtime.auto_log_enabled` /
  // `runtime.auto_log_emitted` in `src/shared/telemetry.ts`. The
  // parity test enforces both arrays stay aligned at CI time.
  'runtime.auto_log_enabled',
  'runtime.auto_log_emitted',
  // RL-020 Slice 6 — mirror of `runtime.stdin_used` in
  // `src/shared/telemetry.ts`. The parity test enforces drift.
  'runtime.stdin_used',
  // RL-019 Slice 2 — mirror of `runtime.node_runner_used`.
  'runtime.node_runner_used',
  // RL-020 Slice 7 — mirror of `runtime.timeout_preset_changed`.
  'runtime.timeout_preset_changed',
  // RL-020 Slice 9 — mirror of `runtime.variable_inspector_opened`.
  'runtime.variable_inspector_opened',
  // RL-093 Slice 3 fold F — mirror of
  // `runtime.variable_inspector_surface_changed`. Closed-enum payload
  // `{ surface }` where `surface` is `'floating'` or `'bottom'`.
  'runtime.variable_inspector_surface_changed',
  // RL-044 Slice 1B — mirror of `runtime.console_rich_rendered`.
  // Closed-enum payload `{ kind }` from `CONSOLE_RICH_KIND_BUCKETS`.
  'runtime.console_rich_rendered',
  // RL-044 Slice 1B fold F — mirror of `runtime.console_table_called`.
  // Closed-enum payload `{ language }` only.
  'runtime.console_table_called',
  // RL-044 Sub-slice G.1 Fold D — mirror of
  // `runtime.cursor_pulse_emitted`. Closed-enum `{ language }` only.
  'runtime.cursor_pulse_emitted',
  // RL-044 Slice 1C fold B — mirror of
  // `runtime.python_console_payload_emitted`. Closed-enum
  // `{ kind }` from `CONSOLE_RICH_KIND_BUCKETS`.
  'runtime.python_console_payload_emitted',
  // RL-044 Slice 2a — mirror of `runtime.error_stack_frame_clicked`.
  // Closed-enum `{ language }` only.
  'runtime.error_stack_frame_clicked',
  // RL-044 Slice 2a — mirror of `runtime.rich_media_payload_rejected`.
  // Closed-enum `{ kind, reason }`.
  'runtime.rich_media_payload_rejected',
  // RL-044 Slice 2b-β-β-α fold E — mirror of
  // `runtime.python_rich_media_used`. Closed-enum `{ kind }` from
  // `RICH_MEDIA_REJECTED_KINDS` (chart / image / html).
  'runtime.python_rich_media_used',
  // RL-042 Slice 6 — mirror of `runtime.ruby_runner_dispatched`.
  // Closed-enum `{ mode, bucketedSpawnMs }`.
  'runtime.ruby_runner_dispatched',
  // RL-042 Slice 6 — mirror of `runtime.ruby_runtime_preference_changed`.
  // Closed-enum `{ preference }`.
  'runtime.ruby_runtime_preference_changed',
  // RL-024 Slice 1 — mirror of
  // `runtime.fs_directory_picker_unsupported`. Closed-enum
  // `{ userAgentBucket }`.
  'runtime.fs_directory_picker_unsupported',
  // RL-094 Slice 1 fold A — mirror of `capsule.exported`. Closed-enum
  // `{ trigger, sizeBucket }` from `CAPSULE_EXPORT_TRIGGERS` /
  // `CAPSULE_SIZE_BUCKETS`.
  'capsule.exported',
  // RL-095 Slice 1 fold A — mirror of `language_scorecard_viewed`.
  // Closed-enum `{ surface }` from `LANGUAGE_SCORECARD_SURFACES`. The
  // property is named `surface` (not `source`) because the redactor
  // strips any key whose lowercased name contains 'source'.
  'language_scorecard_viewed',
  // RL-036 Phase A1 fold B + G — mirror of `share.created`. Closed-
  // enum `{ trigger, status, sizeBucket }` from
  // `SHARE_CREATE_TRIGGERS` / `SHARE_CREATE_STATUSES` /
  // `SHARE_SIZE_BUCKETS`.
  'share.created',
  // RL-036 Phase A1 fold B + G — mirror of `share.opened`. Closed-
  // enum `{ status, sizeBucket }` from `SHARE_OPEN_STATUSES` /
  // `SHARE_SIZE_BUCKETS`.
  'share.opened',
  // RL-101 Slice 1 — mirrors of the onboarding choreography events.
  // Closed-enum payloads match the renderer side: `language` ∈
  // `ONBOARDING_LANGUAGE_IDS`, `stage` ∈ `ONBOARDING_TOAST_STAGES`,
  // `dismissMode` ∈ `ONBOARDING_DISMISS_MODES` (fold B).
  'onboarding.first_run_completed',
  'onboarding.first_snippet_saved',
  'onboarding.toast_dismissed',
  // RL-101 Slice 1.5 fold A — mirror of `onboarding.toast_clobbered`.
  // Closed-enum `{ outstandingStage }` from `ONBOARDING_TOAST_STAGES`.
  'onboarding.toast_clobbered',
  // RL-096 Slice 1 fold A — mirror of `privacy.dashboard_opened`.
  // Closed-enum `{ surface }` from `PRIVACY_DASHBOARD_SURFACES`.
  'privacy.dashboard_opened',
  // RL-025 Slice A — mirrors of the dependency detection events.
  // Closed-enum `{ language, countBucket }` for per-cycle detection;
  // `{ language }` for the once-per-(tab, language) banner; bucketed
  // rollup for fold F. `language` is validated by the renderer-side
  // `isSafeToken`; both sides drop unknown property keys silently.
  'dependency.detected_in_tab',
  'dependency.banner_shown',
  'dependency.classifications_summary',
  // RL-044 Sub-slice G — mirror of `runtime.output_origin_clicked`.
  // Closed-enum `{ language, surface }` where `surface` ∈
  // `OUTPUT_ORIGIN_SURFACES` (`'badge'` only today). Hover path
  // intentionally does not emit; widening would require a paired
  // edit here + in `src/shared/telemetry.ts`.
  'runtime.output_origin_clicked',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

const EVENT_NAME_SET: ReadonlySet<string> = new Set(TELEMETRY_EVENT_NAMES);

// Mirror of EVENT_PROPERTY_ALLOWLIST in src/shared/telemetry.ts.
// Worker side ALWAYS drops unknown property keys silently; renderer
// side drops them in `redactForTelemetry`. The parity test asserts
// per-event key parity.
export const EVENT_PROPERTY_ALLOWLIST: Record<TelemetryEventName, readonly string[]> = {
  'app.launched': ['platform', 'build', 'locale'],
  'runner.executed': ['language', 'status', 'durationBucketMs'],
  'overlay.opened': ['overlayId'],
  'feature.blocked': ['entitlement', 'tier'],
  'update.checked': ['status'],
  'utility.favorite.pinned': ['utilityId', 'count'],
  'utility.history.cleared': ['utilityId', 'scope'],
  'utility.clipboard.applied': ['utilityId'],
  'debugger.attached': ['language', 'reasonBucket'],
  'debugger.paused': ['language', 'reasonBucket'],
  'debugger.detached': ['language', 'reasonBucket'],
  'runtime.mode_changed': ['mode', 'language'],
  'runtime.auto_run_gated': ['language', 'reason'],
  // RL-020 Slice 8 — mirror of `runtime.compare_view_toggled`.
  'runtime.compare_view_toggled': ['language', 'enabled'],
  'runtime.workflow_mode_changed': ['language', 'from', 'to', 'trigger'],
  'runtime.magic_comment_emitted': ['language', 'hasArrow', 'hasWatch'],
  'runtime.history_replay': ['language', 'status', 'surface'],
  'runtime.auto_log_enabled': ['language', 'enabled'],
  'runtime.auto_log_emitted': ['language', 'countBucket'],
  'runtime.stdin_used': ['language'],
  // RL-019 Slice 2 — mirror of `runtime.node_runner_used`.
  'runtime.node_runner_used': ['language', 'status'],
  // RL-020 Slice 7 — mirror of `runtime.timeout_preset_changed`.
  'runtime.timeout_preset_changed': ['language', 'preset'],
  // RL-020 Slice 9 — mirror of `runtime.variable_inspector_opened`.
  'runtime.variable_inspector_opened': ['language', 'variableCount'],
  // RL-093 Slice 3 fold F — mirror of
  // `runtime.variable_inspector_surface_changed`.
  'runtime.variable_inspector_surface_changed': ['surface'],
  // RL-044 Slice 1B — mirror of `runtime.console_rich_rendered`.
  'runtime.console_rich_rendered': ['kind'],
  // RL-044 Slice 1B fold F — mirror of `runtime.console_table_called`.
  'runtime.console_table_called': ['language'],
  // RL-044 Sub-slice G.1 Fold D — mirror of `runtime.cursor_pulse_emitted`.
  'runtime.cursor_pulse_emitted': ['language'],
  // RL-044 Slice 1C fold B — mirror of
  // `runtime.python_console_payload_emitted`.
  'runtime.python_console_payload_emitted': ['kind'],
  // RL-044 Slice 2a — mirror of `runtime.error_stack_frame_clicked`.
  'runtime.error_stack_frame_clicked': ['language'],
  // RL-044 Slice 2a — mirror of `runtime.rich_media_payload_rejected`.
  'runtime.rich_media_payload_rejected': ['kind', 'reason'],
  // RL-044 Slice 2b-β-β-α fold E — mirror of `runtime.python_rich_media_used`.
  'runtime.python_rich_media_used': ['kind'],
  // RL-042 Slice 6 — mirror of `runtime.ruby_runner_dispatched`.
  'runtime.ruby_runner_dispatched': ['mode', 'bucketedSpawnMs'],
  // RL-042 Slice 6 — mirror of `runtime.ruby_runtime_preference_changed`.
  'runtime.ruby_runtime_preference_changed': ['preference'],
  // RL-024 Slice 1 — mirror of
  // `runtime.fs_directory_picker_unsupported`. Closed-enum
  // `{ userAgentBucket }`.
  'runtime.fs_directory_picker_unsupported': ['userAgentBucket'],
  // RL-094 Slice 1 fold A — mirror of `capsule.exported`.
  'capsule.exported': ['trigger', 'sizeBucket'],
  // RL-095 Slice 1 fold A — mirror of `language_scorecard_viewed`.
  'language_scorecard_viewed': ['surface'],
  // RL-036 Phase A1 fold B + G — mirror of `share.created`.
  'share.created': ['trigger', 'status', 'sizeBucket'],
  // RL-036 Phase A1 fold B + G — mirror of `share.opened`.
  'share.opened': ['status', 'sizeBucket'],
  // RL-101 Slice 1 — mirrors of the onboarding events.
  'onboarding.first_run_completed': ['language'],
  'onboarding.first_snippet_saved': [],
  'onboarding.toast_dismissed': ['stage', 'dismissMode'],
  // RL-101 Slice 1.5 fold A — mirror.
  'onboarding.toast_clobbered': ['outstandingStage'],
  // RL-096 Slice 1 fold A — mirror.
  'privacy.dashboard_opened': ['surface'],
  // RL-025 Slice A — mirrors of dependency detection allow-lists.
  'dependency.detected_in_tab': ['language', 'countBucket'],
  'dependency.banner_shown': ['language'],
  // RL-025 Slice A fold F — bucketed rollup; four `${status}Bucket`
  // keys validated against `DEPENDENCY_COUNT_BUCKETS`.
  'dependency.classifications_summary': [
    'language',
    'detectedBucket',
    'installedBucket',
    'needsDesktopBucket',
    'unsupportedBucket',
  ],
  // RL-044 Sub-slice G — `language` is the language-pack id
  // (`isSafeToken`); `surface` ∈ `OUTPUT_ORIGIN_SURFACES`. Mirror of
  // src/shared/telemetry.ts entry.
  'runtime.output_origin_clicked': ['language', 'surface'],
};

// (Fold A) Substring deny pass — mirror of `DENY_SUBSTRINGS` in
// `src/shared/redaction.ts` (canonical home post-RL-094 extract;
// the renderer's `src/shared/telemetry.ts` re-exports from there).
// Defense in depth: even if the renderer redactor regressed and a
// sneaky key slipped through, the worker drops it on the wire.
// Mirror discipline matches the allowlist — changes go in the same
// commit and the parity test asserts both.
//
// RL-096 Slice 1.x prerequisite fix: the renderer expanded this set
// to catch apiKey / secret / credential / authorization / privateKey
// / accessKey / licenseKey patterns (plus snake_case variants) for
// the Privacy + Trust dashboard's redaction preview. This server
// mirror was originally left stale; the parity test below now
// cross-imports the renderer source so the two cannot drift again.
export const DENY_SUBSTRINGS = [
  'content',
  'code',
  'source',
  'snippet',
  'file',
  'path',
  'apikey',
  'api_key',
  'secret',
  'credential',
  'authorization',
  'privatekey',
  'private_key',
  'accesskey',
  'access_key',
  'licensekey',
  'license_key',
  'token',
  'password',
  'email',
  'name',
  'project',
] as const;

const SAFE_TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
// RL-020 Slice 7 — widened to mirror the renderer (`'timeout'` and
// `'stopped'` are the two distinct termination kinds the renderer
// now reports). The parity test asserts both Sets stay in lockstep.
const RUNNER_STATUS_VALUES = new Set([
  'ok',
  'error',
  'timeout',
  'stopped',
]);
// RL-020 Slice 7 — closed-enum mirror of
// `RUNTIME_TIMEOUT_PRESET_VALUES` in `src/shared/telemetry.ts`.
// The parity test asserts both Sets stay aligned.
const RUNTIME_TIMEOUT_PRESET_VALUES = new Set([
  'quick',
  'normal',
  'long',
  'extended',
]);
// RL-019 Slice 2 — closed-enum mirror of `NODE_RUNNER_STATUS_VALUES`
// in `src/shared/telemetry.ts`. Parity test enforces lockstep.
const NODE_RUNNER_STATUS_VALUES = new Set([
  'success',
  'error',
  'timeout',
  'stopped',
  'missing-binary',
]);
// RL-020 Slice 9 — closed-enum mirror of
// `VARIABLE_INSPECTOR_COUNT_BUCKETS` in `src/shared/telemetry.ts`.
const VARIABLE_INSPECTOR_COUNT_BUCKETS = new Set([
  '0',
  '1-5',
  '6-20',
  '21-50',
  '51+',
]);
// RL-044 Slice 1B — closed-enum mirror of
// `CONSOLE_RICH_KIND_BUCKETS` in `src/shared/telemetry.ts`. Parity
// test asserts both Sets stay aligned.
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
  // error kind. Mirrors the renderer addition.
  'error',
  // RL-044 Slice 2a — sandboxed HTML payloads. Mirrors the renderer
  // addition.
  'html',
]);
// RL-044 Slice 2a — closed-enum mirrors of
// `RICH_MEDIA_REJECTED_KINDS` / `RICH_MEDIA_REJECTED_REASONS` in
// `src/shared/telemetry.ts`. Parity test asserts alignment.
export const RICH_MEDIA_REJECTED_KINDS = new Set(['image', 'html', 'chart']);
export const RICH_MEDIA_REJECTED_REASONS = new Set([
  'invalid-src',
  'size-limit',
  'validation-failed',
]);
// RL-042 Slice 6 — mirrors of the Ruby dispatcher enums in
// `src/shared/telemetry.ts`. Parity test asserts alignment.
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
// RL-024 Slice 1 — mirror of `FS_DIRECTORY_PICKER_UA_BUCKETS` in
// `src/shared/telemetry.ts`. Parity test asserts alignment.
export const FS_DIRECTORY_PICKER_UA_BUCKETS = new Set([
  'safari',
  'firefox',
  'edge-old',
  'other',
]);
// RL-094 Slice 1 fold A — mirror of `CAPSULE_EXPORT_TRIGGERS` /
// `CAPSULE_SIZE_BUCKETS` in `src/shared/telemetry.ts`. Parity test
// asserts alignment for both Sets.
export const CAPSULE_EXPORT_TRIGGERS = new Set([
  'settings-export',
  'palette-export',
  // RL-094 Slice 1.5 — mirror of the result-panel-export trigger.
  'result-panel-export',
]);
export const CAPSULE_SIZE_BUCKETS = new Set([
  '<10kb',
  '<100kb',
  '<1mb',
  '<4mb',
  '>=4mb',
]);
// RL-095 Slice 1 fold A — mirror of `LANGUAGE_SCORECARD_SURFACES`.
export const LANGUAGE_SCORECARD_SURFACES = new Set([
  'settings',
  'palette',
]);
// RL-036 Phase A1 fold B + G — mirrors of the share-link enums.
// `cancelled` currently covers user dismissal and clipboard-write failure.
export const SHARE_CREATE_TRIGGERS = new Set([
  'button',
  'palette',
  'shortcut',
]);
export const SHARE_CREATE_STATUSES = new Set([
  'success',
  'too-large',
  'unknown-language',
  'cancelled',
]);
export const SHARE_OPEN_STATUSES = new Set([
  'success',
  'decode-fail',
  'unknown-language',
  'unknown-version',
  'oversized',
]);
export const SHARE_SIZE_BUCKETS = new Set([
  '<1kb',
  '<2kb',
  '<4kb',
  '<6kb',
  '>=6kb',
]);
// RL-101 Slice 1 — mirrors of the onboarding closed enums. The
// language id set is intentionally duplicated verbatim from
// `src/shared/languagePacks.ts` because the update-server cannot
// import from the renderer tree; the parity test asserts both
// sides stay aligned via a runtime cross-import.
export const ONBOARDING_TOAST_STAGES = new Set([
  'first_run',
  'first_snippet',
]);
export const ONBOARDING_DISMISS_MODES = new Set([
  'cta',
  'manual',
  'auto',
]);
// RL-096 Slice 1 fold A — mirror of PRIVACY_DASHBOARD_SURFACES.
export const PRIVACY_DASHBOARD_SURFACES = new Set([
  'settings',
  'palette',
]);
// RL-044 Sub-slice G — mirror of OUTPUT_ORIGIN_SURFACES. Closed enum
// for the discovery surface of `runtime.output_origin_clicked`. Only
// badge clicks emit telemetry today; hover is intentionally silent.
export const OUTPUT_ORIGIN_SURFACES = new Set(['badge']);
// RL-025 Slice A — mirror of DEPENDENCY_COUNT_BUCKETS_SET from
// `src/shared/telemetry.ts` (canonical home in
// `src/shared/dependencies/types.ts`). Parity test keeps both copies
// aligned.
export const DEPENDENCY_COUNT_BUCKETS = new Set([
  '0',
  '1',
  '2-5',
  '6-10',
  '>10',
]);
export const ONBOARDING_LANGUAGE_IDS = new Set([
  'javascript',
  'typescript',
  'go',
  'python',
  'rust',
  'lua',
  'ruby',
  'c',
  'cpp',
  'swift',
  'kotlin',
  'java',
  'scala',
  'json',
  'yaml',
  'dotenv',
  'toml',
  'ini',
  'csv',
  'dockerfile',
  'makefile',
  'gitignore',
  'editorconfig',
  'shellscript',
]);
const DURATION_BUCKETS = new Set([0, 50, 250, 1000, 5000, 30_000, 60_000]);
const UPDATE_CHECKED_STATUS_VALUES = new Set([
  'available',
  'no-update',
  'failure',
]);
const HISTORY_CLEAR_SCOPES = new Set(['session', 'persisted', 'all']);
// RL-019 Slice 1 — closed enum mirroring `RuntimeMode` in
// `src/shared/runtimeModes.ts`. The parity test asserts the worker
// + renderer copies stay in sync.
const RUNTIME_MODE_VALUES = new Set(['worker', 'node', 'browser-preview']);
// RL-020 Slice 1 — closed enum mirror of `AUTO_RUN_GATE_REASONS` in
// `src/shared/telemetry.ts`. Locked to `'incomplete'` for Slice 1.
const AUTO_RUN_GATE_REASONS = new Set(['incomplete']);
// RL-020 Slice 2 — closed enum mirror of `WORKFLOW_MODE_VALUES` in
// `src/shared/telemetry.ts`. The parity test asserts the worker +
// renderer copies stay in sync.
const WORKFLOW_MODE_VALUES = new Set(['run', 'debug', 'scratchpad']);
// RL-020 Slice 2 — closed enum mirror of `WORKFLOW_MODE_CHANGE_TRIGGERS`
// in `src/shared/telemetry.ts`. Mirrors the trigger taxonomy so the
// worker drops events whose `trigger` field is unknown to either side.
const WORKFLOW_MODE_CHANGE_TRIGGERS = new Set([
  'toolbar',
  'language_change',
]);
// RL-020 Slice 4 — closed enum mirror of `HISTORY_REPLAY_SURFACES`
// in `src/shared/telemetry.ts`. Adding a new replay surface in the
// renderer must amend both this Set + the renderer copy in the same
// commit; the parity test enforces it at CI time.
const HISTORY_REPLAY_SURFACES = new Set([
  'tab_pill',
  'palette',
  'popover',
]);
// RL-020 Slice 5 fold A — closed enum mirror of
// `AUTO_LOG_COUNT_BUCKETS` in `src/shared/telemetry.ts`.
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

const MAX_PAYLOAD_BYTES = 8 * 1024;

// (Fold B) Per-IP rate limit. Renderer emits at most ~6 events per
// launch under normal use; a 5-req/sec ceiling caps a runaway tab
// without blocking legitimate traffic. CF Cache API is the only
// durable storage available without standing up KV/D1.
const RATE_LIMIT_PER_SECOND = 5;

const STANDARD_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
  Vary: 'Origin',
} as const;

export type ValidationResult =
  | {
      ok: true;
      event: TelemetryEventName;
      properties: Record<string, string | number | boolean>;
    }
  | {
      ok: false;
      reason: 'missing-event' | 'unknown-event' | 'invalid-properties';
    };

/**
 * Validate a parsed JSON body against the telemetry contract.
 *
 * Unknown property keys are silently dropped, NOT reflected as a
 * rejection. The privacy contract says we never signal "we saw your
 * sneaky key" — that signal alone is information leakage. Only the
 * structural violations the renderer would never produce surface as
 * 400s: missing/unknown event names, non-object property bag.
 */
export function validateTelemetryPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== 'object') {
    return { ok: false, reason: 'missing-event' };
  }
  const event = (body as { event?: unknown }).event;
  if (typeof event !== 'string' || event.length === 0) {
    return { ok: false, reason: 'missing-event' };
  }
  if (!EVENT_NAME_SET.has(event)) {
    return { ok: false, reason: 'unknown-event' };
  }
  const properties = (body as { properties?: unknown }).properties;
  if (properties === undefined) {
    return {
      ok: true,
      event: event as TelemetryEventName,
      properties: {},
    };
  }
  if (
    properties === null ||
    typeof properties !== 'object' ||
    Array.isArray(properties)
  ) {
    return { ok: false, reason: 'invalid-properties' };
  }
  const allowed = new Set(EVENT_PROPERTY_ALLOWLIST[event as TelemetryEventName]);
  const sanitized: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(
    properties as Record<string, unknown>
  )) {
    if (!allowed.has(key)) continue;
    if (keyLooksSensitive(key)) continue;
    if (!valueIsPrimitive(value)) continue;
    if (!isAllowedValue(event as TelemetryEventName, key, value)) continue;
    sanitized[key] = value as string | number | boolean;
  }
  return {
    ok: true,
    event: event as TelemetryEventName,
    properties: sanitized,
  };
}

/**
 * Exported only for the fold-A unit test — the privacy contract
 * requires that `keyLooksSensitive` actually filters keys that pass
 * the allowlist, which is currently impossible to demonstrate
 * indirectly because every allowed property name is benign. The
 * test calls this helper directly to lock the substring guard
 * behavior so a future allowlist regression that ever permitted a
 * sensitive key would still see the substring guard strip it.
 */
export function keyLooksSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return DENY_SUBSTRINGS.some(deny => lower.includes(deny));
}

function valueIsPrimitive(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function isSafeToken(value: unknown): value is string {
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
      if (key === 'mode')
        return typeof value === 'string' && RUNTIME_MODE_VALUES.has(value);
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
    case 'runtime.cursor_pulse_emitted':
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
    case 'runtime.python_rich_media_used':
      if (key === 'kind')
        return (
          typeof value === 'string' && RICH_MEDIA_REJECTED_KINDS.has(value)
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
    case 'runtime.fs_directory_picker_unsupported':
      if (key === 'userAgentBucket')
        return (
          typeof value === 'string' &&
          FS_DIRECTORY_PICKER_UA_BUCKETS.has(value)
        );
      return false;
    case 'capsule.exported':
      if (key === 'trigger')
        return typeof value === 'string' && CAPSULE_EXPORT_TRIGGERS.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'language_scorecard_viewed':
      if (key === 'surface')
        return typeof value === 'string' && LANGUAGE_SCORECARD_SURFACES.has(value);
      return false;
    case 'share.created':
      if (key === 'trigger')
        return typeof value === 'string' && SHARE_CREATE_TRIGGERS.has(value);
      if (key === 'status')
        return typeof value === 'string' && SHARE_CREATE_STATUSES.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && SHARE_SIZE_BUCKETS.has(value);
      return false;
    case 'share.opened':
      if (key === 'status')
        return typeof value === 'string' && SHARE_OPEN_STATUSES.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && SHARE_SIZE_BUCKETS.has(value);
      return false;
    case 'onboarding.first_run_completed':
      if (key === 'language')
        return typeof value === 'string' && ONBOARDING_LANGUAGE_IDS.has(value);
      return false;
    case 'onboarding.first_snippet_saved':
      return false;
    case 'onboarding.toast_dismissed':
      if (key === 'stage')
        return typeof value === 'string' && ONBOARDING_TOAST_STAGES.has(value);
      if (key === 'dismissMode')
        return typeof value === 'string' && ONBOARDING_DISMISS_MODES.has(value);
      return false;
    case 'onboarding.toast_clobbered':
      if (key === 'outstandingStage')
        return typeof value === 'string' && ONBOARDING_TOAST_STAGES.has(value);
      return false;
    case 'privacy.dashboard_opened':
      if (key === 'surface')
        return (
          typeof value === 'string' && PRIVACY_DASHBOARD_SURFACES.has(value)
        );
      return false;
    case 'dependency.detected_in_tab':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      return false;
    case 'dependency.banner_shown':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'dependency.classifications_summary':
      if (key === 'language') return isSafeToken(value);
      if (
        key === 'detectedBucket' ||
        key === 'installedBucket' ||
        key === 'needsDesktopBucket' ||
        key === 'unsupportedBucket'
      ) {
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      }
      return false;
    case 'runtime.output_origin_clicked':
      if (key === 'language') return isSafeToken(value);
      if (key === 'surface')
        return typeof value === 'string' && OUTPUT_ORIGIN_SURFACES.has(value);
      return false;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export interface RateLimitInput {
  ip: string;
  now: number; // seconds since epoch
  perSecond?: number;
}

/**
 * Per-IP rate limiter (fold B). Uses the CF Cache API as a poor-man
 * KV: a counter keyed on `(ip, now-second)` with a 1s TTL so the
 * bucket auto-expires. Race conditions are tolerated — under
 * contention the worst case is a near-doubling of the effective
 * ceiling, still well below the abuse threshold.
 *
 * Returns `true` for `ip === 'unknown'` without consuming any
 * budget. The unknown-IP case is reachable only in tests / non-CF
 * runtimes; pooling every such caller into a single shared bucket
 * would cause cross-request rate-limit interference in CI.
 *
 * The cache key uses a synthetic non-routable origin so the entry
 * is purely a key-value store; nothing is ever fetched against it.
 */
export async function checkRateLimit(input: RateLimitInput): Promise<boolean> {
  if (input.ip === 'unknown') return true;
  const ceiling = input.perSecond ?? RATE_LIMIT_PER_SECOND;
  const cache = caches.default;
  const cacheKey = new Request(
    `https://lingua-telemetry-rate-limit.internal/${encodeURIComponent(input.ip)}/${input.now}`
  );
  const cached = await cache.match(cacheKey);
  let count = 0;
  if (cached) {
    const body = await cached.text();
    const parsed = Number.parseInt(body, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      count = parsed;
    }
  }
  const next = count + 1;
  // Stop writing once we breach the ceiling — the cached value is
  // already at-or-over the limit so further reads will already
  // deny, and avoiding extra `cache.put` calls under abuse cuts
  // the per-request CF Worker cost.
  if (next <= ceiling) {
    await cache.put(
      cacheKey,
      new Response(String(next), {
        headers: { 'Cache-Control': 'max-age=1' },
      })
    );
    return true;
  }
  return false;
}

/**
 * Dispatch a request to the telemetry handler. Owns method
 * negotiation, CORS preflight, payload size cap, rate limit, JSON
 * parse, validation, and the persistence log line.
 */
export async function handleTelemetry(request: Request): Promise<Response> {
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { ...STANDARD_CORS_HEADERS, Allow: 'POST, OPTIONS' },
    });
  }

  // Pre-read size guard — when Content-Length is present we can
  // reject without ever reading the body. Chunked POSTs fall through
  // to the post-read length check below.
  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader) {
    const declared = Number.parseInt(contentLengthHeader, 10);
    if (Number.isFinite(declared) && declared > MAX_PAYLOAD_BYTES) {
      return new Response('Payload Too Large', {
        status: 413,
        headers: STANDARD_CORS_HEADERS,
      });
    }
  }

  const ip = resolveClientIp(request);
  const allowed = await checkRateLimit({
    ip,
    now: Math.floor(Date.now() / 1000),
  });
  if (!allowed) {
    log('telemetry.rate_limited', { ipBucket: ipBucket(ip) });
    return new Response('Too Many Requests', {
      status: 429,
      headers: { ...STANDARD_CORS_HEADERS, 'Retry-After': '1' },
    });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return new Response('Bad Request', {
      status: 400,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_PAYLOAD_BYTES) {
    return new Response('Payload Too Large', {
      status: 413,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return new Response('Bad Request', {
      status: 400,
      headers: STANDARD_CORS_HEADERS,
    });
  }
  const result = validateTelemetryPayload(parsed);
  if (!result.ok) {
    return new Response('Bad Request', {
      status: 400,
      headers: STANDARD_CORS_HEADERS,
    });
  }

  // Persist via structured logging. Workers Observability picks up
  // `console.log` JSON lines automatically. Retention on the
  // standard plan is ~3 days — sufficient for launch-window
  // analytics. See `docs/runbooks/telemetry-pipeline.md` for the
  // promote-to-D1 plan.
  log('telemetry.event', {
    eventName: result.event,
    properties: result.properties,
  });

  return new Response(null, { status: 204, headers: STANDARD_CORS_HEADERS });
}

function resolveClientIp(request: Request): string {
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return 'unknown';
}

/**
 * Coarse IP bucket used only when we log a rate-limit event — the
 * last IPv4 octet (or trailing IPv6 hextets) is truncated so the
 * structured log line never contains a full address. We still need
 * an identifier coarse enough to spot patterns but not so fine that
 * it identifies a single user.
 */
export function ipBucket(ip: string): string {
  if (!ip || ip === 'unknown') return 'unknown';
  if (ip.includes(':')) {
    const parts = ip.split(':');
    return `${parts.slice(0, 3).join(':')}::*`;
  }
  const parts = ip.split('.');
  if (parts.length === 4) return `${parts[0]}.${parts[1]}.${parts[2]}.*`;
  return 'unknown';
}

/**
 * Closed value registries used by telemetry property validation.
 *
 * Public registries remain available through ../telemetry.ts. Private
 * registries are exported only inside this directory so redaction has one
 * dependency and Worker parity tests can inspect one authoritative source.
 */

import { BOOT_DURATION_BUCKETS, BOOT_PHASES } from '../bootTelemetry';
import { LANGUAGE_PACKS as ONBOARDING_LANGUAGE_PACKS } from '../languagePacks';
import type { TelemetryEventName } from './catalog';

const BOOT_PHASES_SET: ReadonlySet<string> = new Set(BOOT_PHASES);

const BOOT_DURATION_BUCKETS_SET: ReadonlySet<string> = new Set(BOOT_DURATION_BUCKETS);

// internal — closed enum of bootstrap failure kinds. Free-form error
// text never rides along; the console already shows the honest local
// message.
export const BOOTSTRAP_FAILURE_REASONS: ReadonlySet<string> = new Set(['prepare-error']);

const SAFE_TOKEN_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
// implementation — widened from `['ok', 'error']` to include the
// two distinct termination kinds the renderer now distinguishes:
// `'timeout'` (the worker hit the preset deadline) and `'stopped'`
// (the user clicked Stop). Dashboards that already accepted only
// `'ok'` / `'error'` keep working — the new values are rejected by
// the old validator, so an old worker silently drops them, and the
// parity test enforces the renderer + update-server stay in sync.
const RUNNER_STATUS_VALUES = new Set(['ok', 'error', 'timeout', 'stopped']);
// implementation — closed enum mirroring `RuntimeTimeoutPreset` in
// `src/shared/runtimeTimeoutPresets.ts`. Duplicated here so the
// redactor stays a pure module without an import cycle; a parity
// test asserts both sides stay in sync.
const RUNTIME_TIMEOUT_PRESET_VALUES = new Set(['quick', 'normal', 'long', 'extended']);
// implementation — closed enum mirror of `NodeRunKind` exported
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
// implementation — variable inspector adoption bucket enum. Source
// of truth in `src/shared/scopeSnapshot.ts` (`VARIABLE_COUNT_BUCKETS`);
// duplicated here so the redactor stays a pure module without an
// import cycle.
const VARIABLE_INSPECTOR_COUNT_BUCKETS = new Set(['0', '1-5', '6-20', '21-50', '51+']);
// implementation — closed enum mirroring `ConsolePayloadKindBucket`
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
  // implementation note — Python BaseException payloads ship the
  // error kind from __lingua_console_serialize. The renderer paints
  // them via the same chip + popover chain as other payloads, but
  // the redactor would silently drop the kind without an explicit
  // bucket. Added so the telemetry survives the closed-enum gate.
  'error',
  // implementation — sandboxed HTML payloads. The renderer paints
  // them via `<RichValueHtml>`; the bucket lets dashboards isolate
  // HTML rendering adoption from chart / image.
  'html',
]);
// implementation — closed enums backing
// `runtime.rich_media_payload_rejected`. Duplicated here for the
// same reason as `CONSOLE_RICH_KIND_BUCKETS`; the parity test in
// `update-server/test/telemetry.test.ts` keeps both sides in sync.
export const RICH_MEDIA_REJECTED_KINDS = new Set(['image', 'html', 'chart']);
export const RICH_MEDIA_REJECTED_REASONS = new Set([
  'invalid-src',
  'size-limit',
  'validation-failed',
]);
// implementation — closed enums for the Ruby dispatcher telemetry.
// Duplicated here for the same reason as CONSOLE_RICH_KIND_BUCKETS;
// the parity test in `update-server/tests/telemetry.parity.test.ts`
// keeps both sides in sync.
export const RUBY_DISPATCHED_MODE_VALUES = new Set(['system', 'wasm', 'missing']);
export const RUBY_SPAWN_BUCKETS = new Set(['<100ms', '<300ms', '<1s', '<3s', '>=3s']);
export const RUBY_RUNTIME_PREFERENCE_VALUES = new Set(['auto', 'system', 'wasm']);
// implementation — closed enum bucketing the navigator userAgent for
// `runtime.fs_directory_picker_unsupported`. Browsers that lack
// File System Access API today: Safari (`'safari'`), Firefox
// (`'firefox'`), older Edge (`'edge-old'`). Anything else falls to
// `'other'` so adoption stays bucketable even if a new browser
// joins the list. Mirrored on update-server with a parity test.
export const FS_DIRECTORY_PICKER_UA_BUCKETS = new Set(['safari', 'firefox', 'edge-old', 'other']);
// implementation note — closed enums backing the
// `capsule.exported` event. Duplicated here (vs. importing from the
// renderer-side `RunCapsulesSection`) for the same reason as
// `CONSOLE_RICH_KIND_BUCKETS`: the redactor stays a pure module
// without renderer-side import cycles. Parity test in
// `update-server/test/telemetry.test.ts` keeps both copies aligned.
export const CAPSULE_EXPORT_TRIGGERS = new Set([
  'settings-export',
  'palette-export',
  // implementation — primary surface: icon button in the result
  // panel header. Tagged distinctly so the dashboard can measure
  // adoption of the in-context surface vs the audit (Settings) and
  // power-user (palette) entries.
  'result-panel-export',
  // implementation — per-row export from the Pro-gated capsule browse
  // overlay. Distinct so the dashboard can attribute exports that
  // originate from browsing history vs the latest-run surfaces.
  'list-export',
  // implementation — explicit "Save run as capsule" from the utility
  // pipeline panel. Distinct so the dashboard can measure how often a
  // pipeline run is promoted into the capsule ring.
  'pipeline-run',
  // internal — self-contained HTML export. Tagged per surface (Settings
  // latest-run button vs browse-overlay row) so the dashboard can
  // compare HTML-share adoption against the JSON/clipboard flows.
  'settings-export-html',
  'list-export-html',
  // Multi-file Capsule Workspace export from the browse overlay. The event
  // carries only this trigger and a coarse artifact-size bucket.
  'list-export-workspace',
]);
// implementation note — closed enum of surfaces that can open the
// capsule browse overlay. Mirrored in `update-server/src/telemetry.ts`
// with a parity test. The order is the render/discovery order of the
// entry points (keyboard, palette, Settings button, floating pill).
export const CAPSULE_BROWSE_SURFACES = new Set(['palette', 'shortcut', 'settings', 'action-pill']);
export const CAPSULE_SIZE_BUCKETS = new Set(['<10kb', '<100kb', '<1mb', '<4mb', '>=4mb']);
// internal — closed enum backing the `runtime.image_clipboard_pasted`
// event. `'pasted'` = an image was read from the clipboard and appended
// as a rich console entry; `'resized'` = the image exceeded
// `MAX_PASTED_IMAGE_BYTES` (2 MiB) and was downscaled to fit before
// appending; `'rejected-oversized'` = it exceeded the cap AND the
// downscale could not get it under; `'rejected-unreadable'` = the File
// read failed or the resulting data URI failed `validateImageSrc`.
// Mirrored in `update-server/src/telemetry.ts` with a parity test.
export const IMAGE_CLIPBOARD_PASTE_STATUSES = new Set([
  'pasted',
  'resized',
  'rejected-oversized',
  'rejected-unreadable',
]);
// implementation note — closed enums backing the
// `capsule.imported` event. Mirrored in `update-server/src/telemetry.ts`
// with parity tests.
//
//   - `sourceSurface` distinguishes which affordance the user picked
//     to load the capsule. `paste` covers both the textarea AND the
//     clipboard auto-detect (implementation note); they're indistinguishable
//     beyond a one-shot consent flow that lives in Settings.
//   - `status` walks the funnel: `decoded` (valid capsule rendered in
//     preview), `open-confirmed` (user clicked "Open as new tab"),
//     `cancelled` (user dismissed without confirming), `rejected`
//     (decode failed — see overlay UI for the qualitative reject
//     reason which is NOT sent here; only the closed status bucket).
//
// Reject reasons themselves stay client-side because they could leak
// information about the user's capsule contents (e.g. wrong-version
// hints at the version field). The dashboard only learns the
// qualitative funnel position.
export const CAPSULE_IMPORT_SOURCES = new Set(['paste', 'file-picker', 'drag-drop']);
export const CAPSULE_IMPORT_STATUSES = new Set([
  'decoded',
  'open-confirmed',
  'cancelled',
  'rejected',
]);
// implementation note — closed enum of importer ids. Source of
// truth lives in `src/shared/importers/types.ts` (`IMPORTER_IDS`);
// duplicated here so the telemetry validator stays import-cycle-free.
// Parity test in `update-server/test/telemetry.test.ts` cross-imports
// the renderer source of truth to keep the two copies in sync.
// implementation widens with `'ipynb-notebook'`; implementation widens with
// `'postman-collection'` + `'bruno-collection'`; implementation widens
// with `'linguanb-notebook'`.
export const IMPORTER_IDS_SET = new Set([
  'curl-http',
  'ipynb-notebook',
  'postman-collection',
  'bruno-collection',
  'linguanb-notebook',
  'playground-url',
]);
// implementation note — closed enum of import outcomes.
export const IMPORT_STATUSES_SET = new Set(['ok', 'rejected', 'cancelled']);
// implementation note — closed enum of `.ipynb` warning kinds
// surfaced by the `import.notebook_warnings_surfaced` event when an
// ipynb import succeeds WITH warnings. Source of truth lives in
// `src/shared/importers/types.ts` (`NOTEBOOK_WARNING_KINDS`);
// duplicated here for the import-cycle-free validator. Parity test
// in `update-server/test/telemetry.test.ts`.
export const NOTEBOOK_WARNING_KINDS_SET = new Set([
  'raw-cell-dropped',
  'rich-output-dropped',
  'unknown-language',
  'execute-result-stripped',
]);
// implementation Slice B implementation note — closed enum of recipe run statuses. Source
// of truth lives in `src/shared/lessonRunner.ts`
// (`RECIPE_RUN_STATUSES`). Duplicated here so the telemetry
// validator stays import-cycle-free. Parity test in
// `update-server/test/telemetry.test.ts` cross-imports the renderer
// source of truth.
export const RECIPE_RUN_STATUSES_SET = new Set([
  'all-passed',
  'some-failed',
  'all-failed',
  'execution-error',
  'sentinel-missing',
]);
// implementation Slice A implementation note — closed enum of notebook cell run statuses.
// Source of truth lives in `src/renderer/runtime/notebookSession.ts`
// (`NOTEBOOK_CELL_STATUSES`). Duplicated here so the telemetry
// validator stays import-cycle-free. Parity test in
// `update-server/test/telemetry.test.ts` cross-imports the renderer
// source of truth.
export const NOTEBOOK_CELL_STATUSES_SET = new Set(['ok', 'error', 'stopped']);
// implementation Slice A implementation note — closed enum of code-cell languages. Source
// of truth in `src/shared/notebook.ts` (`NOTEBOOK_CELL_LANGUAGES`).
// implementation runs JavaScript + TypeScript; Python remains schema-only and
// runner-rejected. The telemetry validator accepts all three so future
// Python wiring doesn't have to revisit this Set.
export const NOTEBOOK_CELL_LANGUAGES_SET = new Set(['javascript', 'typescript', 'python']);
// implementation Slice D implementation note — closed enum of notebook export formats. Mirror
// on update-server with a parity test. `script` is the language-aware
// `.js`/`.ts`/`.py`/`.txt` export; `ipynb` is the Jupyter nbformat v4
// export; `linguanb`  is the native lossless export.
export const NOTEBOOK_EXPORT_FORMATS_SET = new Set(['script', 'ipynb', 'linguanb']);
// implementation note — closed enum for the surface that drove a
// Language Support Scorecard view. Mirrored on update-server with
// parity test. The property name is `surface` (not `source`) because
// `source` is in `DENY_SUBSTRINGS` and would be stripped before the
// closed-enum validator could run.
export const LANGUAGE_SCORECARD_SURFACES = new Set(['settings', 'palette']);
// implementation — `platform` ∈ the scorecard's Web/Desktop filter. Mirror
// of `SCORECARD_PLATFORMS` in `src/shared/languageSupport.ts` (kept as a
// local Set so update-server can mirror it without importing the renderer
// scorecard module); the parity test asserts all three stay aligned.
export const LANGUAGE_SCORECARD_PLATFORMS = new Set(['all', 'web', 'desktop']);
// implementation Phase A1 implementation note — `trigger` ∈ surface that initiated the
// share-link copy. Mirrored on update-server.
export const SHARE_CREATE_TRIGGERS = new Set(['button', 'palette', 'shortcut']);
// implementation Phase A1 implementation note — `status` ∈ outcome of the encode pass.
// `cancelled` currently covers user dismissal and clipboard-write
// failure. Mirrored on update-server.
export const SHARE_CREATE_STATUSES = new Set([
  'success',
  'too-large',
  'unknown-language',
  'cancelled',
]);
// implementation Phase A1 implementation note — `status` ∈ outcome of the decode pass
// (`useShareLinkBoot` hook). Mirrored on update-server.
export const SHARE_OPEN_STATUSES = new Set([
  'success',
  'decode-fail',
  'unknown-language',
  'unknown-version',
  'oversized',
]);
// implementation Phase A1 implementation note — bucketed fragment size. Mirrored on
// update-server. Lives here in `Set` form for `isAllowedValue`; the
// canonical list lives in `src/shared/sharePayload.ts` as
// `SHARE_SIZE_BUCKETS` (readonly tuple).
export const SHARE_SIZE_BUCKETS_SET = new Set(['<1kb', '<2kb', '<4kb', '<6kb', '>=6kb']);
// implementation — closed-enum stage label for the
// `onboarding.toast_dismissed` event. Mirrors the two interactive
// toast stages from the choreography (welcome seed has no toast).
export const ONBOARDING_TOAST_STAGES = new Set(['first_run', 'first_snippet']);
// implementation — closed-enum dismiss attribution. `cta` is a CTA
// button click, `manual` is the X dismiss, `auto` is the 6s timeout.
export const ONBOARDING_DISMISS_MODES = new Set(['cta', 'manual', 'auto']);
// implementation note — closed enum for the surface that opened
// the Privacy + Trust dashboard. `'settings'` is the rail click (the
// user navigated via Settings UI); `'palette'` is the command-palette
// entry. Once-per-mount tag so the metric reflects discovery routes.
export const PRIVACY_DASHBOARD_SURFACES = new Set(['settings', 'palette']);
// implementation — closed enum for the discovery surface of the
// `runtime.output_origin_clicked` event. Only badge clicks emit
// telemetry today; the symmetric hover direction is intentionally
// silent (hover would create burst noise indistinguishable from
// passive mouse movement). A future widening to `'hover'` requires
// an explicit allowlist comment update + a matching change on
// update-server (the parity test catches drift). Mirrored on
// update-server.
export const OUTPUT_ORIGIN_SURFACES = new Set(['badge']);
// implementation note — closed enum for the `repoState` property
// on `git.layer_attached`. `'git-repo'` means the opened folder
// resolved to a real `.git` root via `git rev-parse --show-toplevel`;
// `'no-git'` means git is installed but the folder is not a repo
// (single-file scratchpad with no parent .git); `'no-binary'` means
// the `git` binary itself wasn't found on PATH so the renderer
// suppressed the pill + panel entirely. Mirrored on update-server
// with parity test.
export const GIT_LAYER_REPO_STATES = new Set(['git-repo', 'no-git', 'no-binary']);
// implementation — closed enum for the `target` property on
// `git.reveal_in_source_control_clicked`. Single value today; the
// closed set lets future implementation extensions (e.g. `'commit-hash'`
// jumping to a specific commit in an external SC GUI) layer in
// without rewriting the validator.
export const REVEAL_IN_SC_TARGETS = new Set(['repo-root']);
// implementation note — closed enum for the `mode` property on
// `git.external_modification_reload`. Mirrored on update-server
// with parity test. The `'auto-applied'` slot is reserved for a
// future auto-reload-clean-tabs surface that today is intentionally
// out of scope ("no silent file mutation" per AGENTS.md).
export const EXTERNAL_RELOAD_MODES = new Set(['user-accepted', 'user-rejected', 'auto-applied']);
// implementation note — closed enum for the `templateId` property
// on `template_project_applied`. Source of truth lives in the
// renderer-side catalog at `src/renderer/data/projectTemplates/index.ts`;
// duplicated here because `src/shared/` must not import from
// `src/renderer/`. The parity test in
// `update-server/test/telemetry.test.ts` enforces byte-for-byte
// equality across both copies + the server mirror.
export const TEMPLATE_PROJECT_IDS = new Set([
  'express-api-hello',
  'fastapi-hello',
  'node-cli-argparse',
  'react-component-sandbox',
  'python-data-explorer',
]);
// implementation — closed bucket enum mirroring
// `DEPENDENCY_COUNT_BUCKETS` from `src/shared/dependencies/types.ts`.
// Duplicated here for the same reason as `CONSOLE_RICH_KIND_BUCKETS`
// (this module stays pure with no renderer-side import cycles); the
// parity test in `update-server/test/telemetry.test.ts` keeps both
// copies aligned.
export const DEPENDENCY_COUNT_BUCKETS_SET = new Set(['0', '1', '2-5', '6-10', '>10']);
// implementation — closed enums backing the project zip bundle events.
// Export funnel: `cancelled` (save dialog dismissed), `empty` (no
// visible files), `exported` (zip written), `failed` (pack / write
// error). Import funnel: `cancelled` (folder picker dismissed),
// `imported` (extracted), `non-empty-dir` (target had files),
// `rejected` (structural archive failure — the qualitative reason rides
// the separate `project.bundle_rejected` event). Mirrored on
// update-server with a parity test.
export const PROJECT_BUNDLE_EXPORT_STATUSES = new Set(['cancelled', 'empty', 'exported', 'failed']);
export const PROJECT_BUNDLE_IMPORT_STATUSES = new Set([
  'cancelled',
  'imported',
  'non-empty-dir',
  'rejected',
]);
// Mirror of `BUNDLE_REJECT_REASONS` in `src/shared/projectBundle.ts`,
// duplicated here (not imported) so this redactor stays a pure module
// free of the `fflate` import that `projectBundle` pulls in. The parity
// test in `update-server/test/telemetry.test.ts` cross-imports the
// canonical tuple to keep both copies aligned.
export const PROJECT_BUNDLE_REJECT_REASONS = new Set([
  'empty',
  'entry-too-large',
  'malformed-zip',
  'no-files',
  'path-traversal',
  'too-large',
  'too-many-files',
  'zip-bomb',
]);
// implementation — closed enums backing the install lifecycle events.
// Canonical home is `src/shared/dependencies/types.ts`; duplicated here
// for the same reason as `CONSOLE_RICH_KIND_BUCKETS` (this redactor
// stays a pure module without renderer-side import cycles). The parity
// test in `update-server/test/telemetry.test.ts` keeps both copies
// aligned with the canonical const-tuple source of truth.
export const DEPENDENCY_INSTALL_OUTCOMES_SET = new Set([
  'success',
  'partial',
  'failed',
  'cancelled',
  'timed-out',
]);
// implementation — `unsupported-wheel` mirrors the canonical
// DEPENDENCY_INSTALL_FAILURE_REASONS in `src/shared/dependencies/types.ts`.
// Kept outside the literal so the regex parity test stays
// single-quote clean (apostrophes inside array literals break the
// extraction).
// implementation — closed enum for the `scope` property on
// `editor.replace_in_files_applied`. Source of truth on the renderer
// side; mirrored on update-server with parity test.
export const REPLACE_IN_FILES_SCOPES = new Set(['single-file', 'all-files']);
// implementation note — closed enum for the `method` property on
// `http.request_executed`. Mirrored on update-server with parity test.
// The renderer-side source of truth is `HTTP_METHODS` in
// `src/shared/httpWorkspaceSchema.ts` — this Set is duplicated here so the
// telemetry validator can live in shared code without importing the
// workspace schema.
export const HTTP_METHODS_SET = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
// implementation note — closed enum for `statusBucket` on
// `http.request_executed`. `'2xx' / '3xx' / '4xx' / '5xx'` cover
// fetch responses; `'network-error' / 'timeout' / 'cors-error'`
// cover the typed runtime failures the renderer surfaces with
// distinct copy. Mirrored on update-server with parity test.
export const HTTP_STATUS_BUCKETS_SET = new Set([
  '2xx',
  '3xx',
  '4xx',
  '5xx',
  'network-error',
  'timeout',
  'cors-error',
]);
// implementation note — closed enum for `status` on
// `sql.query_executed`. `'success'` for DuckDB-returned rows;
// `'sql-error'` for DuckDB-thrown user errors; `'timeout'` for
// soft-timeout via Promise.race; `'too-large'` for results that
// exceed MAX_RESULT_ROWS / MAX_RESULT_PREVIEW_BYTES; and
// `'engine-load-failed'` for the rare case where DuckDB-WASM
// itself can't boot (offline / CSP / blocked WASM). The renderer-
// side source of truth is `SQL_QUERY_STATUSES` in
// `src/shared/sqlWorkspace.ts` — this Set is duplicated here so the
// telemetry validator can live in shared code without importing
// the workspace module. Mirrored on update-server with parity test.
export const SQL_QUERY_STATUSES_SET = new Set([
  'success',
  'sql-error',
  'timeout',
  'too-large',
  'engine-load-failed',
]);
// implementation (SQL OPFS) implementation note — closed enum for `mode` +
// `requested` on `sql.storage_mode`. The renderer-side source of truth
// is `SQL_STORAGE_MODES` in `src/shared/sqlWorkspace.ts`; duplicated
// here so the validator stays in shared code without importing the
// workspace module. Mirrored on update-server with parity test.
export const SQL_STORAGE_MODES_SET = new Set(['opfs', 'memory']);
// implementation note — closed enum for `durationBucket` on
// `sql.query_executed`. Coarse-grained classes so dashboards group
// by shape (fast / slow / very-slow) without leaking the exact
// timing. Mirrored on update-server with parity test.
export const SQL_DURATION_BUCKETS_SET = new Set(['<10ms', '<100ms', '<1s', '<5s', '<30s', '>=30s']);
// implementation (SQL import) implementation note — closed enum for `format` on
// `sql.table_imported`. The renderer-side source of truth is
// `SUPPORTED_IMPORT_FORMATS` in `src/shared/sqlWorkspace.ts`; duplicated
// here so the validator stays in shared code without importing the
// workspace module. Mirrored on update-server with parity test.
export const SQL_IMPORT_FORMATS_SET = new Set(['csv', 'json', 'parquet']);
// implementation (SQL import) implementation note — closed enum for `source` on
// `sql.table_imported`: `'drop'` (drag-drop) vs `'picker'` (the
// keyboard-accessible Import button → native file dialog). Mirrored on
// update-server with parity test.
export const SQL_IMPORT_SOURCES_SET = new Set(['drop', 'picker']);
// implementation note — closed enum for `status` on
// `utility.pipeline_executed`. Source of truth lives in
// `src/shared/utilityPipeline.ts` (`PIPELINE_RUN_STATUSES`);
// duplicated here so the telemetry validator can stay free of
// renderer-only imports. Parity test cross-imports the shared set.
export const PIPELINE_RUN_STATUSES_SET = new Set([
  'all-ok',
  'partial',
  'all-failed',
  'incompatible',
]);
// implementation note — closed enum for `templateId` on
// `utility.pipeline_template_used`. Source of truth is
// `PIPELINE_TEMPLATE_IDS` in `src/shared/utilityPipelineTemplates.ts`;
// duplicated here so the validator stays free of renderer-only imports.
// Mirrored on update-server with a 3-way parity test.
export const PIPELINE_TEMPLATE_IDS_SET = new Set([
  'decode-jwt',
  'hash-base64',
  'url-decode-json',
  'html-decode',
  'slugify',
  'base64-decode-json',
  'humanize-timestamp',
  'convert-color',
  // implementation — string-inspect template gallery starter.
  'inspect-hidden-chars',
]);
export const DEPENDENCY_INSTALL_FAILURE_REASONS_SET = new Set([
  'invalid-specifier',
  'no-package-json',
  'binary-missing',
  'exit-nonzero',
  'timeout',
  'cancelled',
  'unsupported-wheel',
  'unknown',
]);
// implementation — language ids that the `language` property on
// `onboarding.first_run_completed` is validated against. Pulled
// from `LANGUAGE_PACKS` so a new pack does not require a manual
// edit here — this module derives from the existing source of
// truth so renderer and update-server stay in lock-step (the
// server mirror duplicates the set verbatim since it cannot import
// from `src/`).
const ONBOARDING_LANGUAGE_IDS = new Set(ONBOARDING_LANGUAGE_PACKS.map(pack => pack.id));
const DURATION_BUCKETS = new Set([0, 50, 250, 1000, 5000, 30_000, 60_000]);
const UPDATE_CHECKED_STATUS_VALUES = new Set(['available', 'no-update', 'failure']);
const HISTORY_CLEAR_SCOPES = new Set(['session', 'persisted', 'all']);
// implementation — closed enum mirroring `RuntimeMode`. The
// shared `runtimeModes.ts` module is the source of truth for the
// production code; this Set is duplicated here so the redactor
// stays a pure module without an import cycle. A parity test
// asserts both stay in sync.
const RUNTIME_MODE_VALUES = new Set([
  'worker',
  'node',
  'browser-preview',
  // implementation — Deno / Bun desktop runtimes.
  'deno',
  'bun',
]);
// implementation — closed enum for the auto-run gate reason. Today
// only the renderer's `useAutoRun` emits `'incomplete'`; the validator
// rejects anything else so a future heuristic-expansion has to amend
// this Set + its mirror in `update-server/src/telemetry.ts`.
const AUTO_RUN_GATE_REASONS = new Set(['incomplete']);
const BROWSER_PREVIEW_AUTO_REFRESH_INTERVALS = new Set([300, 1_000]);
// implementation — closed enum mirroring `WorkflowMode` in
// `src/shared/workflowMode.ts`. Duplicated here so this redactor
// stays a pure module without an import cycle; a parity test
// asserts both stay in sync.
const WORKFLOW_MODE_VALUES = new Set(['run', 'debug', 'scratchpad']);
// implementation — closed enum for the `trigger` property on
// `runtime.workflow_mode_changed`. `toolbar` is an explicit user
// gesture; `language_change` is the auto-correction emitted by
// `renameTab` when the new language no longer supports the previous
// mode. A future work that adds Settings-driven retroactive
// propagation would extend this Set + the mirror in
// `update-server/src/telemetry.ts` in the same commit (the parity
// test enforces both sides at CI time).
const WORKFLOW_MODE_CHANGE_TRIGGERS = new Set(['toolbar', 'language_change']);
// implementation — closed enum for the `surface` property on
// `runtime.history_replay`. `tab_pill` is the per-tab RecentRunsPill
// shipped this change; `palette` is the command-palette Replay
// action shipped in implementation; `popover` is the
// ExecutionHistoryPopover Replay button. Mirrored on the worker.
const HISTORY_REPLAY_SURFACES = new Set(['tab_pill', 'palette', 'popover']);
// implementation note — closed enum for the `countBucket`
// property on `runtime.auto_log_emitted`. `bucketAutoLogCount` in
// `src/renderer/hooks/useAutoRun.ts` is the only producer; the
// renderer + worker validators reject every other value. Mirrored
// in `update-server/src/telemetry.ts`; a parity test enforces
// both copies stay aligned.
const AUTO_LOG_COUNT_BUCKETS = new Set(['1', '2-5', '6-20', '20-plus']);
const DEBUGGER_REASON_BUCKETS: Record<
  Extract<TelemetryEventName, 'debugger.attached' | 'debugger.paused' | 'debugger.detached'>,
  ReadonlySet<string>
> = {
  'debugger.attached': new Set(['attach']),
  'debugger.paused': new Set(['user-breakpoint', 'step', 'exception']),
  'debugger.detached': new Set(['user-detach', 'run-complete', 'crash', 'stop']),
};

// implementation detail — closed enum of filesystem-denylist families. Duplicated
// here (vs importing from `src/main/ipc/permissions.ts`) so the redactor stays
// a pure, node-free shared module. `update-server/test/telemetry.test.ts` and a
// renderer-side parity test cross-import `BLOCKED_PATH_FAMILIES` to keep this
// copy and the worker mirror aligned with the main-process source of truth.
export const FS_BLOCKED_FAMILIES = new Set([
  'system',
  'credentials',
  'app-data',
  'browser-profile',
  'lingua-data',
]);

// internal — closed enum for the `session.restored` source property.
// `auto` = `always`-mode silent restore; `prompt` = user clicked the
// `ask`-mode restore toast.
export const SESSION_RESTORE_SOURCES = new Set(['auto', 'prompt']);

// internal — closed enums for `editor.lint_diagnostic_emitted`. `ruleId`
// covers the custom `'lingua-lint'` rules plus `ts-native` (Monaco's
// built-in TS worker diagnostics). `severity` is the marker severity bucket.
export const LINT_RULE_IDS = new Set(['strict-equality', 'ts-native']);
export const LINT_SEVERITIES = new Set(['error', 'warning', 'info']);

// internal — closed enum for the `handler` property of the smart-paste events.
// One token per paste-intent kind (mirrors `PasteIntentKind` in
// src/renderer/clipboard/pasteHandlers.ts). internal utility suggestions
// report per-format as `utility-<utilityId>` so the dashboard can rank
// which formats users actually hand to the Developer Utilities.
export const SMART_PASTE_HANDLERS = new Set([
  'share-link',
  'capsule',
  'curl',
  'stack-trace',
  'large-json',
  'utility-jwt',
  'utility-uuid',
  'utility-color',
  'utility-timestamp',
  'utility-cron-parser',
  'utility-base64',
  'utility-json',
]);

export function isSafeToken(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TOKEN_RE.test(value);
}

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1000;
}

export {
  BOOT_PHASES_SET,
  BOOT_DURATION_BUCKETS_SET,
  RUNNER_STATUS_VALUES,
  RUNTIME_TIMEOUT_PRESET_VALUES,
  NODE_RUNNER_STATUS_VALUES,
  VARIABLE_INSPECTOR_COUNT_BUCKETS,
  ONBOARDING_LANGUAGE_IDS,
  DURATION_BUCKETS,
  UPDATE_CHECKED_STATUS_VALUES,
  HISTORY_CLEAR_SCOPES,
  RUNTIME_MODE_VALUES,
  AUTO_RUN_GATE_REASONS,
  BROWSER_PREVIEW_AUTO_REFRESH_INTERVALS,
  WORKFLOW_MODE_VALUES,
  WORKFLOW_MODE_CHANGE_TRIGGERS,
  HISTORY_REPLAY_SURFACES,
  AUTO_LOG_COUNT_BUCKETS,
  DEBUGGER_REASON_BUCKETS,
  isSafeCount,
};

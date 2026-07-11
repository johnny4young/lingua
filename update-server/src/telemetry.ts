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
  'app.boot_phase',
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
  // RL-044 next slice — mirror of `runtime.image_clipboard_pasted`.
  // The parity test enforces both event arrays + the status set stay
  // aligned at CI time.
  'runtime.image_clipboard_pasted',
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
  // RL-094 Slice 3 fold G — mirror of `capsule.browse_opened`.
  // Closed-enum `{ surface, tier }` where `surface ∈
  // CAPSULE_BROWSE_SURFACES` and `tier` is an open safe-token.
  'capsule.browse_opened',
  // RL-094 Slice 4 — mirror of `capsule.compared`. Closed-enum
  // `{ sameLanguage }` boolean. Sorts after `capsule.browse_opened`,
  // before `capsule.exported`.
  'capsule.compared',
  // RL-094 Slice 1 fold A — mirror of `capsule.exported`. Closed-enum
  // `{ trigger, sizeBucket }` from `CAPSULE_EXPORT_TRIGGERS` /
  // `CAPSULE_SIZE_BUCKETS`.
  'capsule.exported',
  // RL-094 Slice 2 fold D — mirror of `capsule.imported`. Closed-
  // enum `{ surface, status, sizeBucket }` from
  // `CAPSULE_IMPORT_SOURCES` / `CAPSULE_IMPORT_STATUSES` /
  // `CAPSULE_SIZE_BUCKETS`. Property is named `surface` (not
  // `sourceSurface`) because `source` is in DENY_SUBSTRINGS —
  // same precedent as `language_scorecard_viewed` from RL-095.
  // Parity test below extracts the literal arrays from both files
  // so an edit on the renderer side that forgets the server side
  // fails CI.
  'capsule.imported',
  // RL-095 Slice 1 fold A — mirror of `language_scorecard_viewed`.
  // Closed-enum `{ surface }` from `LANGUAGE_SCORECARD_SURFACES`. The
  // property is named `surface` (not `source`) because the redactor
  // strips any key whose lowercased name contains 'source'.
  // RL-095 Slice 2 — scorecard Web/Desktop toggle adoption signal.
  'language_scorecard_platform_toggled',
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
  // RL-024 Slice 3 — mirrors of the project zip bundle events.
  'project.bundle_exported',
  'project.bundle_imported',
  'project.bundle_rejected',
  // RL-025 Slice A — mirrors of the dependency detection events.
  // Closed-enum `{ language, countBucket }` for per-cycle detection;
  // `{ language }` for the once-per-(tab, language) banner; bucketed
  // rollup for fold F. `language` is validated by the renderer-side
  // `isSafeToken`; both sides drop unknown property keys silently.
  'dependency.detected_in_tab',
  'dependency.banner_shown',
  'dependency.classifications_summary',
  // RL-025 Slice B — mirrors of the install lifecycle events. Closed
  // enums DEPENDENCY_INSTALL_OUTCOMES / DEPENDENCY_INSTALL_FAILURE_REASONS
  // duplicated below; the parity test cross-imports the renderer source
  // of truth so the two copies cannot drift.
  'dependency.install_started',
  'dependency.install_completed',
  'dependency.install_failed_reason',
  // RL-044 Sub-slice G — mirror of `runtime.output_origin_clicked`.
  // Closed-enum `{ language, surface }` where `surface` ∈
  // `OUTPUT_ORIGIN_SURFACES` (`'badge'` only today). Hover path
  // intentionally does not emit; widening would require a paired
  // edit here + in `src/shared/telemetry.ts`.
  'runtime.output_origin_clicked',
  // RL-102 Slice 1 fold D — Git read-only layer attachment signal.
  // Closed-enum `{ repoState }` ∈ `GIT_LAYER_REPO_STATES`.
  'git.layer_attached',
  // RL-102 Slice 1 fold D — Git diff panel discovery signal. Pure
  // counter; no payload.
  'git.diff_panel_opened',
  // RL-102 Slice 2 — `.git/HEAD` change signal. Closed-enum
  // `{ repoState, branchChanged }` mirrored from src/shared/telemetry.ts.
  // Renderer only emits when the branch actually changed; the
  // boolean field stays as future-proofing for commit-only signal.
  'git.head_changed',
  // RL-102 Slice 2 — Reveal-in-Source-Control click. Closed-enum
  // `{ target }` ∈ REVEAL_IN_SC_TARGETS.
  'git.reveal_in_source_control_clicked',
  // RL-102 Slice 2 fold E — external-modification reload outcome.
  // Closed-enum `{ mode }` ∈ EXTERNAL_RELOAD_MODES. The
  // `'auto-applied'` slot is reserved; renderer never emits it
  // today.
  'git.external_modification_reload',
  // RL-103 Slice 1 fold B — Curated project template applied. Mirror
  // of src/shared/telemetry.ts. Closed-enum
  // `{ templateId, language }` where `templateId` ∈
  // `TEMPLATE_PROJECT_IDS` and `language` ∈ language pack ids.
  'template_project_applied',
  // RL-024 Slice 2 — Replace in files applied. Closed-enum
  // `{ scope, countBucket, regex }` mirrored from
  // src/shared/telemetry.ts. Parity test cross-imports the renderer
  // REPLACE_IN_FILES_SCOPES set.
  'editor.replace_in_files_applied',
  // RL-097 Slice 1 fold F — HTTP workspace request execution. Closed-enum
  // `{ method, statusBucket, redactedHeadersBucket }` mirrored from
  // src/shared/telemetry.ts. Parity test cross-imports HTTP_METHODS_SET
  // and HTTP_STATUS_BUCKETS_SET.
  'http.request_executed',
  // RL-100 Slice 1 fold E — Importer registry commit. Closed-enum
  // `{ importerId, status, sizeBucket }` mirrored from
  // src/shared/telemetry.ts. Parity test cross-imports
  // IMPORTER_IDS_SET and IMPORT_STATUSES_SET.
  'import.applied',
  // RL-100 Slice 2 fold E — `.ipynb` warning band. Closed-enum
  // `{ warningKindCount, dominantKind }` mirrored from
  // src/shared/telemetry.ts. Parity test cross-imports
  // NOTEBOOK_WARNING_KINDS_SET.
  'import.notebook_warnings_surfaced',
  // RL-100 Slice 3.5 (Postman vars) fold B — collection-variable
  // resolution outcome. Closed-enum `{ resolvedBucket, unresolvedBucket }`
  // (both ∈ DEPENDENCY_COUNT_BUCKETS) mirrored from
  // src/shared/telemetry.ts. NO variable names / values / URLs on the wire.
  'import.postman_variables_resolved',
  // RL-097 Slice 2 fold F — SQL workspace query execution. Closed-enum
  // `{ status, rowCountBucket, durationBucket }` mirrored from
  // src/shared/telemetry.ts. Parity test cross-imports
  // SQL_QUERY_STATUSES_SET and SQL_DURATION_BUCKETS_SET.
  'sql.query_executed',
  // IT2-F3 — Column Explorer opened. Deliberately has no payload.
  'sql.profile_opened',
  // RL-097 Slice 3 (SQL OPFS) fold F — SQL workspace storage backing.
  // Closed-enum `{ mode, requested }` (both ∈ SQL_STORAGE_MODES_SET)
  // mirrored from src/shared/telemetry.ts. Parity test cross-imports
  // SQL_STORAGE_MODES_SET.
  'sql.storage_mode',
  // RL-097 (SQL import) fold B — file imported as a DuckDB table.
  // Closed-enum `{ format, source }` where `format` ∈
  // SQL_IMPORT_FORMATS_SET and `source` ∈ SQL_IMPORT_SOURCES_SET,
  // mirrored from src/shared/telemetry.ts. Parity test cross-imports
  // both sets. NO file name / column names / row values on the wire.
  'sql.table_imported',
  // RL-099 Slice 1 fold F — utility pipeline execution. Closed-enum
  // `{ stepCount, status }` mirrored from src/shared/telemetry.ts.
  // Parity test cross-imports PIPELINE_RUN_STATUSES_SET.
  'utility.pipeline_executed',
  // RL-099 Slice 5 fold A — pipeline template gallery adoption.
  // Closed-enum `{ templateId }` (∈ PIPELINE_TEMPLATE_IDS_SET) mirrored
  // from src/shared/telemetry.ts. Parity test cross-imports the set.
  'utility.pipeline_template_used',
  // RL-039 Slice B fold B — Recipes overlay open + Run + Test
  // settle. Closed-enum `{ language }` + `{ language, status }`
  // mirrored from src/shared/telemetry.ts. Parity test cross-imports
  // RECIPE_RUN_STATUSES_SET.
  'recipe.opened',
  'recipe.test_run',
  // RL-043 Slice A fold B — notebook cell execution. Closed-enum
  // `{ language, status }` mirrored from src/shared/telemetry.ts.
  // 3-way parity test cross-imports the canonical
  // NOTEBOOK_CELL_STATUSES tuple from
  // src/renderer/runtime/notebookSession.ts.
  // RL-043 Slice (Monaco cells) fold E — cell editor mounted. Closed-enum
  // `{ language }` mirrored from src/shared/telemetry.ts. Sorts before
  // `cell_executed`.
  'notebook.cell_editor_mounted',
  'notebook.cell_executed',
  // RL-043 Slice C fold E — notebook cell language switch. Closed-enum
  // `{ to }` mirrored from src/shared/telemetry.ts.
  'notebook.cell_language_changed',
  // RL-043 Slice D fold D — notebook export. Closed-enum `{ format }`
  // mirrored from src/shared/telemetry.ts.
  'notebook.exported',
  // RL-126 — persisted-store schema migration. Mirror of
  // src/shared/telemetry.ts; `store` is a safe localStorage key token
  // (closed-enum at the renderer call site).
  'persistence.migrated',
  // RL-137 / AUDIT-17 — mirror of src/shared/telemetry.ts. Closed payload
  // `{ family }` ∈ FS_BLOCKED_FAMILIES; no path reaches the wire.
  'fs.blocked',
  // RL-111 — mirror of src/shared/telemetry.ts. `session.restored`
  // `{ tabCount, source∈{auto,prompt} }`; `session.snapshotDiscarded`
  // `{ tabCount }`. Count only; no tab names/paths/content.
  'session.restored',
  'session.snapshotDiscarded',
  // RL-108 — mirror of src/shared/telemetry.ts. `{ language, severity, ruleId }`;
  // counts/enums only, no code or positions.
  'editor.lint_diagnostic_emitted',
  // RL-110 — mirror of src/shared/telemetry.ts. `{ handler }` and
  // `{ handler, accepted }`; enums/boolean only, no pasted content.
  'editor.smart_paste_shown',
  'editor.smart_paste_applied',
  // RL-112 — mirror of src/shared/telemetry.ts. `{ enabled }`; boolean only.
  'editor.status_bar_toggled',
  // IT2-C1 — mirror of src/shared/telemetry.ts. The Run Ledger opt-in
  // carries only `{ enabled }`; clearing it intentionally carries no data.
  'ledger.toggled',
  'ledger.cleared',
  // RL-109 close-out — mirror of src/shared/telemetry.ts. `{ hasProjectVars }`;
  // boolean only, no env keys/values/paths.
  'env.project_scope_used',
] as const;
export type TelemetryEventName = (typeof TELEMETRY_EVENT_NAMES)[number];

const EVENT_NAME_SET: ReadonlySet<string> = new Set(TELEMETRY_EVENT_NAMES);

// Mirror of EVENT_PROPERTY_ALLOWLIST in src/shared/telemetry.ts.
// Worker side ALWAYS drops unknown property keys silently; renderer
// side drops them in `redactForTelemetry`. The parity test asserts
// per-event key parity.
export const EVENT_PROPERTY_ALLOWLIST: Record<TelemetryEventName, readonly string[]> = {
  'app.launched': ['platform', 'build', 'locale'],
  'app.boot_phase': ['phase', 'durationBucket'],
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
  // RL-044 next slice — mirror of `runtime.image_clipboard_pasted`.
  'runtime.image_clipboard_pasted': ['status', 'sizeBucket'],
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
  // RL-094 Slice 3 fold G — mirror of `capsule.browse_opened`.
  'capsule.browse_opened': ['surface', 'tier'],
  // RL-094 Slice 4 — mirror of `capsule.compared`. Boolean `sameLanguage`.
  'capsule.compared': ['sameLanguage'],
  // RL-094 Slice 1 fold A — mirror of `capsule.exported`.
  'capsule.exported': ['trigger', 'sizeBucket'],
  // RL-094 Slice 2 fold D — mirror of `capsule.imported`. All three
  // values come from closed enums; the validator below enforces.
  'capsule.imported': ['surface', 'status', 'sizeBucket'],
  // RL-095 Slice 2 — `platform` ∈ `LANGUAGE_SCORECARD_PLATFORMS`.
  'language_scorecard_platform_toggled': ['platform'],
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
  // RL-024 Slice 3 — mirror of the project zip bundle allow-lists.
  'project.bundle_exported': ['status', 'fileCountBucket'],
  'project.bundle_imported': ['status', 'fileCountBucket'],
  'project.bundle_rejected': ['reason'],
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
  // RL-025 Slice B — install lifecycle mirrors. `language` ∈
  // isSafeToken; `countBucket` ∈ DEPENDENCY_COUNT_BUCKETS; `outcome`
  // ∈ DEPENDENCY_INSTALL_OUTCOMES; `reason` ∈
  // DEPENDENCY_INSTALL_FAILURE_REASONS.
  'dependency.install_started': ['language', 'countBucket'],
  'dependency.install_completed': ['language', 'outcome'],
  'dependency.install_failed_reason': ['language', 'reason'],
  // RL-044 Sub-slice G — `language` is the language-pack id
  // (`isSafeToken`); `surface` ∈ `OUTPUT_ORIGIN_SURFACES`. Mirror of
  // src/shared/telemetry.ts entry.
  'runtime.output_origin_clicked': ['language', 'surface'],
  // RL-102 Slice 1 fold D — mirror of src/shared/telemetry.ts.
  'git.layer_attached': ['repoState'],
  'git.diff_panel_opened': [],
  // RL-102 Slice 2 — mirror of src/shared/telemetry.ts.
  'git.head_changed': ['repoState', 'branchChanged'],
  'git.reveal_in_source_control_clicked': ['target'],
  'git.external_modification_reload': ['mode'],
  // RL-103 Slice 1 fold B — mirror of src/shared/telemetry.ts.
  'template_project_applied': ['templateId', 'language'],
  // RL-024 Slice 2 — mirror.
  'editor.replace_in_files_applied': ['scope', 'countBucket', 'regex'],
  // RL-097 Slice 1 fold F + Slice 3a fold D — mirror of src/shared/telemetry.ts.
  'http.request_executed': [
    'method',
    'statusBucket',
    'redactedHeadersBucket',
    'resolvedVarsBucket',
  ],
  // RL-100 Slice 1 fold E — mirror of src/shared/telemetry.ts.
  'import.applied': ['importerId', 'status', 'sizeBucket'],
  'import.notebook_warnings_surfaced': ['warningKindCount', 'dominantKind'],
  'import.postman_variables_resolved': ['resolvedBucket', 'unresolvedBucket'],
  // RL-097 Slice 2 fold F — mirror of src/shared/telemetry.ts.
  'sql.query_executed': ['status', 'rowCountBucket', 'durationBucket'],
  'sql.profile_opened': [],
  // RL-097 Slice 3 (SQL OPFS) fold F — mirror of src/shared/telemetry.ts.
  'sql.storage_mode': ['mode', 'requested'],
  // RL-097 (SQL import) fold B — mirror of src/shared/telemetry.ts.
  'sql.table_imported': ['format', 'source'],
  // RL-099 Slice 1 fold F — mirror of src/shared/telemetry.ts.
  'utility.pipeline_executed': ['stepCount', 'status'],
  // RL-099 Slice 5 fold A — mirror of src/shared/telemetry.ts.
  'utility.pipeline_template_used': ['templateId'],
  // RL-039 Slice B fold B — mirror of src/shared/telemetry.ts.
  'recipe.opened': ['language'],
  'recipe.test_run': ['language', 'status'],
  // RL-043 Slice (Monaco cells) fold E — mirror of src/shared/telemetry.ts.
  'notebook.cell_editor_mounted': ['language'],
  // RL-043 Slice A fold B — mirror of src/shared/telemetry.ts.
  'notebook.cell_executed': ['language', 'status'],
  // RL-043 Slice C fold E — mirror of src/shared/telemetry.ts.
  'notebook.cell_language_changed': ['to'],
  // RL-043 Slice D fold D — mirror of src/shared/telemetry.ts.
  'notebook.exported': ['format'],
  // RL-126 — mirror of src/shared/telemetry.ts.
  'persistence.migrated': ['store'],
  // RL-137 / AUDIT-17 — mirror of src/shared/telemetry.ts.
  'fs.blocked': ['family'],
  // RL-111 — mirror of src/shared/telemetry.ts.
  'session.restored': ['tabCount', 'source'],
  'session.snapshotDiscarded': ['tabCount'],
  // RL-108 — mirror of src/shared/telemetry.ts.
  'editor.lint_diagnostic_emitted': ['language', 'severity', 'ruleId'],
  // RL-110 — mirror of src/shared/telemetry.ts.
  'editor.smart_paste_shown': ['handler'],
  'editor.smart_paste_applied': ['handler', 'accepted'],
  // RL-112 — mirror of src/shared/telemetry.ts.
  'editor.status_bar_toggled': ['enabled'],
  // IT2-C1 — mirror of src/shared/telemetry.ts.
  'ledger.toggled': ['enabled'],
  'ledger.cleared': [],
  // RL-109 close-out — mirror of src/shared/telemetry.ts.
  'env.project_scope_used': ['hasProjectVars'],
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

// RL-137 / AUDIT-17 — mirror of FS_BLOCKED_FAMILIES in src/shared/telemetry.ts
// (itself a mirror of BLOCKED_PATH_FAMILIES in src/main/ipc/permissions.ts). A
// parity test cross-imports the renderer source of truth to keep both aligned.
export const FS_BLOCKED_FAMILIES = new Set([
  'system',
  'credentials',
  'app-data',
  'browser-profile',
  'lingua-data',
]);
// RL-111 — mirror of SESSION_RESTORE_SOURCES in src/shared/telemetry.ts.
export const SESSION_RESTORE_SOURCES = new Set(['auto', 'prompt']);

// RL-108 — mirror of LINT_RULE_IDS / LINT_SEVERITIES in src/shared/telemetry.ts.
export const LINT_RULE_IDS = new Set(['strict-equality', 'ts-native']);
export const LINT_SEVERITIES = new Set(['error', 'warning', 'info']);
// RL-110 — mirror of SMART_PASTE_HANDLERS in src/shared/telemetry.ts.
export const SMART_PASTE_HANDLERS = new Set([
  'share-link',
  'capsule',
  'curl',
  'stack-trace',
  'large-json',
]);
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
  // RL-094 Slice 3 — mirror of the list-export trigger.
  'list-export',
  // RL-099 Slice 3 — mirror of the pipeline-run trigger.
  'pipeline-run',
]);
// RL-094 Slice 3 fold G — mirror of `CAPSULE_BROWSE_SURFACES` in
// `src/shared/telemetry.ts`. Parity test asserts alignment.
export const CAPSULE_BROWSE_SURFACES = new Set([
  'palette',
  'shortcut',
  'settings',
  'action-pill',
]);
export const CAPSULE_SIZE_BUCKETS = new Set([
  '<10kb',
  '<100kb',
  '<1mb',
  '<4mb',
  '>=4mb',
]);
// RL-044 — mirror of `IMAGE_CLIPBOARD_PASTE_STATUSES` in
// `src/shared/telemetry.ts`. Parity test asserts alignment. `'resized'`
// = an over-cap image was downscaled to fit before appending.
export const IMAGE_CLIPBOARD_PASTE_STATUSES = new Set([
  'pasted',
  'resized',
  'rejected-oversized',
  'rejected-unreadable',
]);
// RL-094 Slice 2 fold D — mirrors of `CAPSULE_IMPORT_SOURCES` /
// `CAPSULE_IMPORT_STATUSES` in `src/shared/telemetry.ts`. Parity
// test asserts alignment for both Sets.
export const CAPSULE_IMPORT_SOURCES = new Set([
  'paste',
  'file-picker',
  'drag-drop',
]);
export const CAPSULE_IMPORT_STATUSES = new Set([
  'decoded',
  'open-confirmed',
  'cancelled',
  'rejected',
]);
// RL-100 Slice 1 fold E — mirrors of `IMPORTER_IDS_SET` /
// `IMPORT_STATUSES_SET` in `src/shared/telemetry.ts`. Parity test
// cross-imports the renderer source-of-truth `IMPORTER_IDS` from
// `src/shared/importers/types.ts` to keep them in sync.
export const IMPORTER_IDS_SET = new Set([
  'curl-http',
  'ipynb-notebook',
  'postman-collection',
  'bruno-collection',
  'linguanb-notebook',
]);
export const IMPORT_STATUSES_SET = new Set(['ok', 'rejected', 'cancelled']);
// RL-100 Slice 2 fold E — mirrors `NOTEBOOK_WARNING_KINDS_SET` in
// `src/shared/telemetry.ts`. Parity test cross-imports the renderer
// source of truth from `src/shared/importers/types.ts`.
export const NOTEBOOK_WARNING_KINDS_SET = new Set([
  'raw-cell-dropped',
  'rich-output-dropped',
  'unknown-language',
  'execute-result-stripped',
]);
// RL-039 Slice B fold B — mirror of `RECIPE_RUN_STATUSES_SET` in
// `src/shared/telemetry.ts`. Parity test cross-imports the renderer
// source-of-truth `RECIPE_RUN_STATUSES` from
// `src/shared/lessonRunner.ts` so a future widening (e.g. adding a
// `'cancelled'` user-stop bucket) lands on both sides at once.
export const RECIPE_RUN_STATUSES_SET = new Set([
  'all-passed',
  'some-failed',
  'all-failed',
  'execution-error',
  'sentinel-missing',
]);
// RL-043 Slice A fold B — mirror of `NOTEBOOK_CELL_STATUSES_SET` in
// `src/shared/telemetry.ts`. 3-way parity test cross-imports the
// canonical `NOTEBOOK_CELL_STATUSES` tuple from
// `src/renderer/runtime/notebookSession.ts`.
export const NOTEBOOK_CELL_STATUSES_SET = new Set([
  'ok',
  'error',
  'stopped',
]);
export const NOTEBOOK_CELL_LANGUAGES_SET = new Set([
  'javascript',
  'typescript',
  'python',
]);
// RL-043 Slice D fold D — mirror of src/shared/telemetry.ts.
export const NOTEBOOK_EXPORT_FORMATS_SET = new Set([
  'script',
  'ipynb',
  'linguanb',
]);
// RL-095 Slice 1 fold A — mirror of `LANGUAGE_SCORECARD_SURFACES`.
export const LANGUAGE_SCORECARD_SURFACES = new Set([
  'settings',
  'palette',
]);
// RL-095 Slice 2 — mirror of `LANGUAGE_SCORECARD_PLATFORMS` /
// `SCORECARD_PLATFORMS`. Parity test asserts alignment.
export const LANGUAGE_SCORECARD_PLATFORMS = new Set([
  'all',
  'web',
  'desktop',
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
// RL-102 Slice 1 fold D — mirror of GIT_LAYER_REPO_STATES. Closed
// enum for the `repoState` property on `git.layer_attached`.
export const GIT_LAYER_REPO_STATES = new Set([
  'git-repo',
  'no-git',
  'no-binary',
]);
// RL-102 Slice 2 — mirror of REVEAL_IN_SC_TARGETS. Closed enum for
// the `target` property on `git.reveal_in_source_control_clicked`.
// Single value today; closed set stays future-proof for Slice 3+.
export const REVEAL_IN_SC_TARGETS = new Set(['repo-root']);
// RL-102 Slice 2 fold E — mirror of EXTERNAL_RELOAD_MODES. Closed
// enum for the `mode` property on `git.external_modification_reload`.
// The `'auto-applied'` slot is reserved; renderer never emits it
// today (no silent file mutation per AGENTS.md).
export const EXTERNAL_RELOAD_MODES = new Set([
  'user-accepted',
  'user-rejected',
  'auto-applied',
]);
// RL-103 Slice 1 fold B — mirror of TEMPLATE_PROJECT_IDS. Closed
// enum for the `templateId` property on `template_project_applied`.
// Source of truth duplicated from src/shared/telemetry.ts because
// update-server cannot import from src/. The parity test asserts
// byte-for-byte equality.
export const TEMPLATE_PROJECT_IDS = new Set([
  'express-api-hello',
  'fastapi-hello',
  'node-cli-argparse',
  'react-component-sandbox',
  'python-data-explorer',
]);
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
// RL-024 Slice 2 — mirror of REPLACE_IN_FILES_SCOPES in
// `src/shared/telemetry.ts`. Parity test enforces both copies stay
// aligned.
export const REPLACE_IN_FILES_SCOPES = new Set([
  'single-file',
  'all-files',
]);
// RL-024 Slice 3 — mirrors of the project zip bundle enums in
// `src/shared/telemetry.ts`. `PROJECT_BUNDLE_REJECT_REASONS` also
// mirrors `BUNDLE_REJECT_REASONS` in `src/shared/projectBundle.ts`; the
// parity test cross-imports that canonical tuple.
export const PROJECT_BUNDLE_EXPORT_STATUSES = new Set([
  'cancelled',
  'empty',
  'exported',
  'failed',
]);
export const PROJECT_BUNDLE_IMPORT_STATUSES = new Set([
  'cancelled',
  'imported',
  'non-empty-dir',
  'rejected',
]);
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
// RL-097 Slice 1 fold F — mirror of HTTP_METHODS_SET. Source of
// truth on the renderer side at `src/shared/httpWorkspace.ts`;
// duplicated here so the worker validator does not import a
// renderer-only module. Parity test cross-imports the renderer set
// and asserts byte-for-byte equality.
export const HTTP_METHODS_SET = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);
// RL-097 Slice 1 fold F — mirror of HTTP_STATUS_BUCKETS_SET.
export const HTTP_STATUS_BUCKETS_SET = new Set([
  '2xx',
  '3xx',
  '4xx',
  '5xx',
  'network-error',
  'timeout',
  'cors-error',
]);
// RL-097 Slice 2 fold F — mirror of SQL_QUERY_STATUSES_SET. Source
// of truth is `SQL_QUERY_STATUSES` in `src/shared/sqlWorkspace.ts`;
// duplicated here so the worker validator can live without an
// import that would drag renderer-only modules into the worker.
// Parity test cross-imports the renderer set so the two copies
// cannot drift.
export const SQL_QUERY_STATUSES_SET = new Set([
  'success',
  'sql-error',
  'timeout',
  'too-large',
  'engine-load-failed',
]);
// RL-097 Slice 2 fold F — mirror of SQL_DURATION_BUCKETS_SET.
export const SQL_DURATION_BUCKETS_SET = new Set([
  '<10ms',
  '<100ms',
  '<1s',
  '<5s',
  '<30s',
  '>=30s',
]);
// RL-097 Slice 3 (SQL OPFS) fold F — mirror of SQL_STORAGE_MODES_SET.
// Source of truth is `SQL_STORAGE_MODES` in
// `src/shared/sqlWorkspace.ts`; parity test cross-imports it.
export const SQL_STORAGE_MODES_SET = new Set(['opfs', 'memory']);
// RL-097 (SQL import) fold B — mirror of SQL_IMPORT_FORMATS_SET. Source
// of truth is `SUPPORTED_IMPORT_FORMATS` in
// `src/shared/sqlWorkspace.ts`; parity test cross-imports it.
export const SQL_IMPORT_FORMATS_SET = new Set(['csv', 'json', 'parquet']);
// RL-097 (SQL import) fold B — mirror of SQL_IMPORT_SOURCES_SET. Parity
// test cross-imports the shared set.
export const SQL_IMPORT_SOURCES_SET = new Set(['drop', 'picker']);
// RL-099 Slice 1 fold F — mirror of PIPELINE_RUN_STATUSES_SET. Source
// of truth lives in `src/shared/utilityPipeline.ts`; duplicated here
// so the worker validator can stay free of renderer-only imports.
// Parity test cross-imports the renderer set.
export const PIPELINE_RUN_STATUSES_SET = new Set([
  'all-ok',
  'partial',
  'all-failed',
  'incompatible',
]);
// RL-099 Slice 5 fold A — mirror of PIPELINE_TEMPLATE_IDS. Source of
// truth is `src/shared/utilityPipelineTemplates.ts`; parity test
// cross-imports it.
export const PIPELINE_TEMPLATE_IDS_SET = new Set([
  'decode-jwt',
  'hash-base64',
  'url-decode-json',
  'html-decode',
  'slugify',
  'base64-decode-json',
  'humanize-timestamp',
  'convert-color',
  // RL-099 Slice 7 — string-inspect template gallery starter.
  'inspect-hidden-chars',
]);
// RL-025 Slice B — mirrors of DEPENDENCY_INSTALL_OUTCOMES and
// DEPENDENCY_INSTALL_FAILURE_REASONS from
// `src/shared/dependencies/types.ts`. Parity test cross-imports the
// renderer authority so the two copies cannot drift.
export const DEPENDENCY_INSTALL_OUTCOMES = new Set([
  'success',
  'partial',
  'failed',
  'cancelled',
  'timed-out',
]);
// RL-025 Slice C — `unsupported-wheel` mirrors the canonical
// DEPENDENCY_INSTALL_FAILURE_REASONS in
// `src/shared/dependencies/types.ts`. Kept outside the literal so
// the regex parity test below stays single-quote clean.
export const DEPENDENCY_INSTALL_FAILURE_REASONS = new Set([
  'invalid-specifier',
  'no-package-json',
  'binary-missing',
  'exit-nonzero',
  'timeout',
  'cancelled',
  'unsupported-wheel',
  'unknown',
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
const BOOT_PHASES = new Set([
  'system-language',
  'i18n',
  'react-mount',
  'first-paint',
  'rehydration',
]);
const BOOT_DURATION_BUCKETS = new Set([
  '<50ms',
  '50-249ms',
  '250-999ms',
  '1-4.9s',
  '5-29.9s',
  '>=30s',
]);
const UPDATE_CHECKED_STATUS_VALUES = new Set([
  'available',
  'no-update',
  'failure',
]);
const HISTORY_CLEAR_SCOPES = new Set(['session', 'persisted', 'all']);
// RL-019 Slice 1 — closed enum mirroring `RuntimeMode` in
// `src/shared/runtimeModes.ts`. The parity test asserts the worker
// + renderer copies stay in sync.
const RUNTIME_MODE_VALUES = new Set(['worker', 'node', 'browser-preview', 'deno', 'bun']);
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
    case 'app.boot_phase':
      if (key === 'phase') return typeof value === 'string' && BOOT_PHASES.has(value);
      if (key === 'durationBucket') {
        return typeof value === 'string' && BOOT_DURATION_BUCKETS.has(value);
      }
      return false;
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
    case 'capsule.browse_opened':
      if (key === 'surface')
        return typeof value === 'string' && CAPSULE_BROWSE_SURFACES.has(value);
      // `tier` is an open safe-token, same as `feature.blocked.tier`.
      if (key === 'tier') return isSafeToken(value);
      return false;
    case 'capsule.compared':
      return key === 'sameLanguage' && typeof value === 'boolean';
    case 'capsule.exported':
      if (key === 'trigger')
        return typeof value === 'string' && CAPSULE_EXPORT_TRIGGERS.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'capsule.imported':
      if (key === 'surface')
        return typeof value === 'string' && CAPSULE_IMPORT_SOURCES.has(value);
      if (key === 'status')
        return typeof value === 'string' && CAPSULE_IMPORT_STATUSES.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'runtime.image_clipboard_pasted':
      if (key === 'status')
        return (
          typeof value === 'string' && IMAGE_CLIPBOARD_PASTE_STATUSES.has(value)
        );
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'language_scorecard_platform_toggled':
      if (key === 'platform')
        return typeof value === 'string' && LANGUAGE_SCORECARD_PLATFORMS.has(value);
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
    case 'project.bundle_exported':
      if (key === 'status')
        return (
          typeof value === 'string' && PROJECT_BUNDLE_EXPORT_STATUSES.has(value)
        );
      if (key === 'fileCountBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value);
      return false;
    case 'project.bundle_imported':
      if (key === 'status')
        return (
          typeof value === 'string' && PROJECT_BUNDLE_IMPORT_STATUSES.has(value)
        );
      if (key === 'fileCountBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value);
      return false;
    case 'project.bundle_rejected':
      return (
        key === 'reason' &&
        typeof value === 'string' &&
        PROJECT_BUNDLE_REJECT_REASONS.has(value)
      );
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
    case 'dependency.install_started':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      return false;
    case 'dependency.install_completed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'outcome')
        return (
          typeof value === 'string' && DEPENDENCY_INSTALL_OUTCOMES.has(value)
        );
      return false;
    case 'dependency.install_failed_reason':
      if (key === 'language') return isSafeToken(value);
      if (key === 'reason')
        return (
          typeof value === 'string' &&
          DEPENDENCY_INSTALL_FAILURE_REASONS.has(value)
        );
      return false;
    case 'runtime.output_origin_clicked':
      if (key === 'language') return isSafeToken(value);
      if (key === 'surface')
        return typeof value === 'string' && OUTPUT_ORIGIN_SURFACES.has(value);
      return false;
    case 'git.layer_attached':
      if (key === 'repoState')
        return typeof value === 'string' && GIT_LAYER_REPO_STATES.has(value);
      return false;
    case 'git.diff_panel_opened':
      // Pure counter — no whitelisted properties.
      return false;
    case 'git.head_changed':
      if (key === 'repoState')
        return typeof value === 'string' && GIT_LAYER_REPO_STATES.has(value);
      if (key === 'branchChanged') return typeof value === 'boolean';
      return false;
    case 'git.reveal_in_source_control_clicked':
      if (key === 'target')
        return typeof value === 'string' && REVEAL_IN_SC_TARGETS.has(value);
      return false;
    case 'git.external_modification_reload':
      if (key === 'mode')
        return typeof value === 'string' && EXTERNAL_RELOAD_MODES.has(value);
      return false;
    case 'template_project_applied':
      if (key === 'templateId')
        return typeof value === 'string' && TEMPLATE_PROJECT_IDS.has(value);
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'editor.replace_in_files_applied':
      if (key === 'scope')
        return (
          typeof value === 'string' && REPLACE_IN_FILES_SCOPES.has(value)
        );
      if (key === 'countBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      if (key === 'regex') return typeof value === 'boolean';
      return false;
    case 'http.request_executed':
      if (key === 'method')
        return typeof value === 'string' && HTTP_METHODS_SET.has(value);
      if (key === 'statusBucket')
        return (
          typeof value === 'string' && HTTP_STATUS_BUCKETS_SET.has(value)
        );
      if (key === 'redactedHeadersBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      // RL-097 Slice 3a fold D — bucketed count of resolved env vars.
      if (key === 'resolvedVarsBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      return false;
    case 'import.applied':
      if (key === 'importerId')
        return typeof value === 'string' && IMPORTER_IDS_SET.has(value);
      if (key === 'status')
        return typeof value === 'string' && IMPORT_STATUSES_SET.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'import.notebook_warnings_surfaced':
      if (key === 'warningKindCount')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      if (key === 'dominantKind')
        return (
          typeof value === 'string' && NOTEBOOK_WARNING_KINDS_SET.has(value)
        );
      return false;
    case 'import.postman_variables_resolved':
      if (key === 'resolvedBucket' || key === 'unresolvedBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      return false;
    case 'sql.query_executed':
      if (key === 'status')
        return (
          typeof value === 'string' && SQL_QUERY_STATUSES_SET.has(value)
        );
      if (key === 'rowCountBucket')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      if (key === 'durationBucket')
        return (
          typeof value === 'string' && SQL_DURATION_BUCKETS_SET.has(value)
        );
      return false;
    case 'sql.profile_opened':
      return false;
    case 'sql.storage_mode':
      return (
        (key === 'mode' || key === 'requested') &&
        typeof value === 'string' &&
        SQL_STORAGE_MODES_SET.has(value)
      );
    case 'sql.table_imported':
      if (key === 'format')
        return typeof value === 'string' && SQL_IMPORT_FORMATS_SET.has(value);
      if (key === 'source')
        return typeof value === 'string' && SQL_IMPORT_SOURCES_SET.has(value);
      return false;
    case 'utility.pipeline_executed':
      if (key === 'stepCount')
        return (
          typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS.has(value)
        );
      if (key === 'status')
        return (
          typeof value === 'string' && PIPELINE_RUN_STATUSES_SET.has(value)
        );
      return false;
    case 'utility.pipeline_template_used':
      return (
        key === 'templateId' &&
        typeof value === 'string' &&
        PIPELINE_TEMPLATE_IDS_SET.has(value)
      );
    case 'recipe.opened':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'recipe.test_run':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status')
        return typeof value === 'string' && RECIPE_RUN_STATUSES_SET.has(value);
      return false;
    case 'notebook.cell_editor_mounted':
      return (
        key === 'language' &&
        typeof value === 'string' &&
        NOTEBOOK_CELL_LANGUAGES_SET.has(value)
      );
    case 'notebook.cell_executed':
      if (key === 'language')
        return typeof value === 'string' && NOTEBOOK_CELL_LANGUAGES_SET.has(value);
      if (key === 'status')
        return typeof value === 'string' && NOTEBOOK_CELL_STATUSES_SET.has(value);
      return false;
    case 'notebook.cell_language_changed':
      return (
        key === 'to' &&
        typeof value === 'string' &&
        NOTEBOOK_CELL_LANGUAGES_SET.has(value)
      );
    case 'notebook.exported':
      return (
        key === 'format' &&
        typeof value === 'string' &&
        NOTEBOOK_EXPORT_FORMATS_SET.has(value)
      );
    case 'persistence.migrated':
      // RL-126 — `store` is a localStorage key (a safe token like
      // `lingua-settings`); the closed-enum membership is enforced at the
      // renderer call site, the token shape is enough on the wire.
      if (key === 'store') return isSafeToken(value);
      return false;
    case 'fs.blocked':
      return (
        key === 'family' && typeof value === 'string' && FS_BLOCKED_FAMILIES.has(value)
      );
    case 'session.restored':
      if (key === 'tabCount') return isSafeCount(value);
      if (key === 'source')
        return typeof value === 'string' && SESSION_RESTORE_SOURCES.has(value);
      return false;
    case 'session.snapshotDiscarded':
      return key === 'tabCount' && isSafeCount(value);
    case 'editor.lint_diagnostic_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'severity') return typeof value === 'string' && LINT_SEVERITIES.has(value);
      if (key === 'ruleId') return typeof value === 'string' && LINT_RULE_IDS.has(value);
      return false;
    case 'editor.smart_paste_shown':
      return key === 'handler' && typeof value === 'string' && SMART_PASTE_HANDLERS.has(value);
    case 'editor.smart_paste_applied':
      if (key === 'handler') return typeof value === 'string' && SMART_PASTE_HANDLERS.has(value);
      if (key === 'accepted') return typeof value === 'boolean';
      return false;
    case 'editor.status_bar_toggled':
      return key === 'enabled' && typeof value === 'boolean';
    case 'ledger.toggled':
      return key === 'enabled' && typeof value === 'boolean';
    case 'ledger.cleared':
      return false;
    case 'env.project_scope_used':
      return key === 'hasProjectVars' && typeof value === 'boolean';
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

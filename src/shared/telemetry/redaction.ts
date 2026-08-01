/**
 * Telemetry value validation and privacy redaction.
 *
 * No delivery policy lives here: callers receive a safe payload and still
 * must honor consent and endpoint configuration before transport.
 */

import { DENY_SUBSTRINGS, keyLooksSensitive, valueLooksSensitive } from '../redaction';
import { EVENT_PROPERTY_ALLOWLIST, type TelemetryEventName } from './catalog';
import type { TelemetryEvent } from './transport';
import {
  AUTO_LOG_COUNT_BUCKETS,
  AUTO_RUN_GATE_REASONS,
  BOOTSTRAP_FAILURE_REASONS,
  BOOT_DURATION_BUCKETS_SET,
  BOOT_PHASES_SET,
  BROWSER_PREVIEW_AUTO_REFRESH_INTERVALS,
  CAPSULE_BROWSE_SURFACES,
  CAPSULE_EXPORT_TRIGGERS,
  CAPSULE_IMPORT_SOURCES,
  CAPSULE_IMPORT_STATUSES,
  CAPSULE_SIZE_BUCKETS,
  CONSOLE_RICH_KIND_BUCKETS,
  DEBUGGER_REASON_BUCKETS,
  DEPENDENCY_COUNT_BUCKETS_SET,
  DEPENDENCY_INSTALL_FAILURE_REASONS_SET,
  DEPENDENCY_INSTALL_OUTCOMES_SET,
  DURATION_BUCKETS,
  EXTERNAL_RELOAD_MODES,
  FS_BLOCKED_FAMILIES,
  FS_DIRECTORY_PICKER_UA_BUCKETS,
  GIT_LAYER_REPO_STATES,
  HISTORY_CLEAR_SCOPES,
  HISTORY_REPLAY_SURFACES,
  HTTP_METHODS_SET,
  HTTP_STATUS_BUCKETS_SET,
  IMAGE_CLIPBOARD_PASTE_STATUSES,
  IMPORTER_IDS_SET,
  IMPORT_STATUSES_SET,
  LANGUAGE_SCORECARD_PLATFORMS,
  LANGUAGE_SCORECARD_SURFACES,
  LINT_RULE_IDS,
  LINT_SEVERITIES,
  NODE_RUNNER_STATUS_VALUES,
  NOTEBOOK_CELL_LANGUAGES_SET,
  NOTEBOOK_CELL_STATUSES_SET,
  NOTEBOOK_EXPORT_FORMATS_SET,
  NOTEBOOK_WARNING_KINDS_SET,
  ONBOARDING_DISMISS_MODES,
  ONBOARDING_LANGUAGE_IDS,
  ONBOARDING_TOAST_STAGES,
  OUTPUT_ORIGIN_SURFACES,
  PIPELINE_RUN_STATUSES_SET,
  PIPELINE_TEMPLATE_IDS_SET,
  PRIVACY_DASHBOARD_SURFACES,
  PROJECT_BUNDLE_EXPORT_STATUSES,
  PROJECT_BUNDLE_IMPORT_STATUSES,
  PROJECT_BUNDLE_REJECT_REASONS,
  RECIPE_RUN_STATUSES_SET,
  REPLACE_IN_FILES_SCOPES,
  REVEAL_IN_SC_TARGETS,
  RICH_MEDIA_REJECTED_KINDS,
  RICH_MEDIA_REJECTED_REASONS,
  RUBY_DISPATCHED_MODE_VALUES,
  RUBY_RUNTIME_PREFERENCE_VALUES,
  RUBY_SPAWN_BUCKETS,
  RUNNER_STATUS_VALUES,
  RUNTIME_MODE_VALUES,
  RUNTIME_TIMEOUT_PRESET_VALUES,
  SESSION_RESTORE_SOURCES,
  SHARE_CREATE_STATUSES,
  SHARE_CREATE_TRIGGERS,
  SHARE_OPEN_STATUSES,
  SHARE_SIZE_BUCKETS_SET,
  SMART_PASTE_HANDLERS,
  SQL_DURATION_BUCKETS_SET,
  SQL_IMPORT_FORMATS_SET,
  SQL_IMPORT_SOURCES_SET,
  SQL_QUERY_STATUSES_SET,
  SQL_STORAGE_MODES_SET,
  TEMPLATE_PROJECT_IDS,
  UPDATE_CHECKED_STATUS_VALUES,
  VARIABLE_INSPECTOR_COUNT_BUCKETS,
  WORKFLOW_MODE_CHANGE_TRIGGERS,
  WORKFLOW_MODE_VALUES,
  isSafeCount,
  isSafeToken,
} from './valueCatalog';

export { DENY_SUBSTRINGS };

function isAllowedValue(
  event: TelemetryEventName,
  key: string,
  value: unknown
): value is string | number | boolean {
  switch (event) {
    case 'app.launched':
      return isSafeToken(value);
    case 'app.boot_phase':
      if (key === 'phase') return typeof value === 'string' && BOOT_PHASES_SET.has(value);
      if (key === 'durationBucket') {
        return typeof value === 'string' && BOOT_DURATION_BUCKETS_SET.has(value);
      }
      return false;
    case 'runtime.bootstrap_completed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'durationBucket') {
        return typeof value === 'string' && BOOT_DURATION_BUCKETS_SET.has(value);
      }
      return false;
    case 'runtime.bootstrap_failed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'reason') {
        return typeof value === 'string' && BOOTSTRAP_FAILURE_REASONS.has(value);
      }
      return false;
    case 'runner.executed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status') return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'durationBucketMs')
        return typeof value === 'number' && DURATION_BUCKETS.has(value);
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
      if (key === 'reason') return typeof value === 'string' && AUTO_RUN_GATE_REASONS.has(value);
      return false;
    case 'runtime.browser_preview_auto_refresh':
      if (key === 'language') return isSafeToken(value);
      if (key === 'intervalMs') {
        return typeof value === 'number' && BROWSER_PREVIEW_AUTO_REFRESH_INTERVALS.has(value);
      }
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
        return typeof value === 'string' && WORKFLOW_MODE_CHANGE_TRIGGERS.has(value);
      return false;
    case 'runtime.magic_comment_emitted':
      if (key === 'language') return isSafeToken(value);
      if (key === 'hasArrow' || key === 'hasWatch') return typeof value === 'boolean';
      return false;
    case 'runtime.history_replay':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status') return typeof value === 'string' && RUNNER_STATUS_VALUES.has(value);
      if (key === 'surface') return typeof value === 'string' && HISTORY_REPLAY_SURFACES.has(value);
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
        return typeof value === 'string' && RUNTIME_TIMEOUT_PRESET_VALUES.has(value);
      return false;
    case 'runtime.node_runner_used':
      if (key === 'language') return isSafeToken(value);
      if (key === 'status')
        return typeof value === 'string' && NODE_RUNNER_STATUS_VALUES.has(value);
      return false;
    case 'runtime.variable_inspector_opened':
      if (key === 'language') return isSafeToken(value);
      if (key === 'variableCount')
        return typeof value === 'string' && VARIABLE_INSPECTOR_COUNT_BUCKETS.has(value);
      return false;
    case 'runtime.variable_inspector_surface_changed':
      if (key === 'surface') return value === 'floating' || value === 'bottom';
      return false;
    case 'runtime.console_rich_rendered':
      if (key === 'kind') return typeof value === 'string' && CONSOLE_RICH_KIND_BUCKETS.has(value);
      return false;
    case 'runtime.console_table_called':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.cursor_pulse_emitted':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.python_console_payload_emitted':
      if (key === 'kind') return typeof value === 'string' && CONSOLE_RICH_KIND_BUCKETS.has(value);
      return false;
    case 'runtime.error_stack_frame_clicked':
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'runtime.rich_media_payload_rejected':
      if (key === 'kind') return typeof value === 'string' && RICH_MEDIA_REJECTED_KINDS.has(value);
      if (key === 'reason')
        return typeof value === 'string' && RICH_MEDIA_REJECTED_REASONS.has(value);
      return false;
    case 'runtime.python_rich_media_used':
      if (key === 'kind') return typeof value === 'string' && RICH_MEDIA_REJECTED_KINDS.has(value);
      return false;
    case 'runtime.ruby_runner_dispatched':
      if (key === 'mode')
        return typeof value === 'string' && RUBY_DISPATCHED_MODE_VALUES.has(value);
      if (key === 'bucketedSpawnMs')
        return typeof value === 'string' && RUBY_SPAWN_BUCKETS.has(value);
      return false;
    case 'runtime.ruby_runtime_preference_changed':
      if (key === 'preference')
        return typeof value === 'string' && RUBY_RUNTIME_PREFERENCE_VALUES.has(value);
      return false;
    case 'runtime.fs_directory_picker_unsupported':
      if (key === 'userAgentBucket')
        return typeof value === 'string' && FS_DIRECTORY_PICKER_UA_BUCKETS.has(value);
      return false;
    case 'capsule.browse_opened':
      if (key === 'surface') return typeof value === 'string' && CAPSULE_BROWSE_SURFACES.has(value);
      // `tier` is an open safe-token (free / pro / pro_lifetime / team /
      // trial / education) — same treatment as `feature.blocked.tier`.
      if (key === 'tier') return isSafeToken(value);
      return false;
    case 'capsule.compared':
      return key === 'sameLanguage' && typeof value === 'boolean';
    case 'capsule.exported':
      if (key === 'trigger') return typeof value === 'string' && CAPSULE_EXPORT_TRIGGERS.has(value);
      if (key === 'sizeBucket') return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'capsule.imported':
      if (key === 'surface') return typeof value === 'string' && CAPSULE_IMPORT_SOURCES.has(value);
      if (key === 'status') return typeof value === 'string' && CAPSULE_IMPORT_STATUSES.has(value);
      if (key === 'sizeBucket') return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'runtime.image_clipboard_pasted':
      if (key === 'status')
        return typeof value === 'string' && IMAGE_CLIPBOARD_PASTE_STATUSES.has(value);
      if (key === 'sizeBucket') return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
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
      if (key === 'trigger') return typeof value === 'string' && SHARE_CREATE_TRIGGERS.has(value);
      if (key === 'status') return typeof value === 'string' && SHARE_CREATE_STATUSES.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && SHARE_SIZE_BUCKETS_SET.has(value);
      return false;
    case 'share.opened':
      if (key === 'status') return typeof value === 'string' && SHARE_OPEN_STATUSES.has(value);
      if (key === 'sizeBucket')
        return typeof value === 'string' && SHARE_SIZE_BUCKETS_SET.has(value);
      return false;
    case 'onboarding.first_run_completed':
      if (key === 'language')
        return (
          typeof value === 'string' && (ONBOARDING_LANGUAGE_IDS as ReadonlySet<string>).has(value)
        );
      return false;
    case 'onboarding.first_snippet_saved':
      // Event carries no whitelisted properties; redactor drops
      // anything that arrives anyway.
      return false;
    case 'onboarding.toast_dismissed':
      if (key === 'stage') return typeof value === 'string' && ONBOARDING_TOAST_STAGES.has(value);
      if (key === 'dismissMode')
        return typeof value === 'string' && ONBOARDING_DISMISS_MODES.has(value);
      return false;
    case 'onboarding.toast_clobbered':
      if (key === 'outstandingStage')
        return typeof value === 'string' && ONBOARDING_TOAST_STAGES.has(value);
      return false;
    case 'project.bundle_exported':
      if (key === 'status')
        return typeof value === 'string' && PROJECT_BUNDLE_EXPORT_STATUSES.has(value);
      if (key === 'fileCountBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      return false;
    case 'project.bundle_imported':
      if (key === 'status')
        return typeof value === 'string' && PROJECT_BUNDLE_IMPORT_STATUSES.has(value);
      if (key === 'fileCountBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      return false;
    case 'project.bundle_rejected':
      return (
        key === 'reason' && typeof value === 'string' && PROJECT_BUNDLE_REJECT_REASONS.has(value)
      );
    case 'privacy.dashboard_opened':
      if (key === 'surface')
        return typeof value === 'string' && PRIVACY_DASHBOARD_SURFACES.has(value);
      return false;
    case 'dependency.detected_in_tab':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
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
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      }
      return false;
    case 'dependency.install_started':
      if (key === 'language') return isSafeToken(value);
      if (key === 'countBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      return false;
    case 'dependency.install_completed':
      if (key === 'language') return isSafeToken(value);
      if (key === 'outcome')
        return typeof value === 'string' && DEPENDENCY_INSTALL_OUTCOMES_SET.has(value);
      return false;
    case 'dependency.install_failed_reason':
      if (key === 'language') return isSafeToken(value);
      if (key === 'reason')
        return typeof value === 'string' && DEPENDENCY_INSTALL_FAILURE_REASONS_SET.has(value);
      return false;
    case 'runtime.output_origin_clicked':
      if (key === 'language') return isSafeToken(value);
      if (key === 'surface') return typeof value === 'string' && OUTPUT_ORIGIN_SURFACES.has(value);
      return false;
    case 'git.layer_attached':
      if (key === 'repoState') return typeof value === 'string' && GIT_LAYER_REPO_STATES.has(value);
      return false;
    case 'git.diff_panel_opened':
      // Pure counter — no whitelisted properties. Any key that
      // arrives is dropped by the closed-enum validator falling
      // through to false.
      return false;
    case 'git.head_changed':
      if (key === 'repoState') return typeof value === 'string' && GIT_LAYER_REPO_STATES.has(value);
      if (key === 'branchChanged') return typeof value === 'boolean';
      return false;
    case 'git.reveal_in_source_control_clicked':
      if (key === 'target') return typeof value === 'string' && REVEAL_IN_SC_TARGETS.has(value);
      return false;
    case 'git.external_modification_reload':
      if (key === 'mode') return typeof value === 'string' && EXTERNAL_RELOAD_MODES.has(value);
      return false;
    case 'template_project_applied':
      if (key === 'templateId') return typeof value === 'string' && TEMPLATE_PROJECT_IDS.has(value);
      if (key === 'language') return isSafeToken(value);
      return false;
    case 'editor.replace_in_files_applied':
      if (key === 'scope') return typeof value === 'string' && REPLACE_IN_FILES_SCOPES.has(value);
      if (key === 'countBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      if (key === 'regex') return typeof value === 'boolean';
      return false;
    case 'http.request_executed':
      if (key === 'method') return typeof value === 'string' && HTTP_METHODS_SET.has(value);
      if (key === 'statusBucket')
        return typeof value === 'string' && HTTP_STATUS_BUCKETS_SET.has(value);
      if (key === 'redactedHeadersBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      // implementation note — bucketed count of resolved env vars.
      if (key === 'resolvedVarsBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      return false;
    case 'import.applied':
      if (key === 'importerId') return typeof value === 'string' && IMPORTER_IDS_SET.has(value);
      if (key === 'status') return typeof value === 'string' && IMPORT_STATUSES_SET.has(value);
      if (key === 'sizeBucket') return typeof value === 'string' && CAPSULE_SIZE_BUCKETS.has(value);
      return false;
    case 'import.notebook_warnings_surfaced':
      if (key === 'warningKindCount')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      if (key === 'dominantKind')
        return typeof value === 'string' && NOTEBOOK_WARNING_KINDS_SET.has(value);
      return false;
    case 'import.postman_variables_resolved':
      if (key === 'resolvedBucket' || key === 'unresolvedBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      return false;
    case 'recipe.opened':
      if (key === 'language') return typeof value === 'string' && isSafeToken(value);
      return false;
    case 'recipe.test_run':
      if (key === 'language') return typeof value === 'string' && isSafeToken(value);
      if (key === 'status') return typeof value === 'string' && RECIPE_RUN_STATUSES_SET.has(value);
      return false;
    case 'notebook.cell_editor_mounted':
      return (
        key === 'language' && typeof value === 'string' && NOTEBOOK_CELL_LANGUAGES_SET.has(value)
      );
    case 'notebook.cell_executed':
      if (key === 'language')
        return typeof value === 'string' && NOTEBOOK_CELL_LANGUAGES_SET.has(value);
      if (key === 'status')
        return typeof value === 'string' && NOTEBOOK_CELL_STATUSES_SET.has(value);
      return false;
    case 'notebook.cell_language_changed':
      return key === 'to' && typeof value === 'string' && NOTEBOOK_CELL_LANGUAGES_SET.has(value);
    case 'notebook.exported':
      return (
        key === 'format' && typeof value === 'string' && NOTEBOOK_EXPORT_FORMATS_SET.has(value)
      );
    case 'persistence.migrated':
      // internal — `store` is a localStorage key (a safe token like
      // `lingua-settings`); the closed-enum membership is enforced at the call
      // site by the `PersistedStoreName` union, and the token shape is enough
      // here (no PII, no version numbers, no payload).
      return key === 'store' && isSafeToken(value);
    case 'sql.query_executed':
      if (key === 'status') return typeof value === 'string' && SQL_QUERY_STATUSES_SET.has(value);
      if (key === 'rowCountBucket')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      if (key === 'durationBucket')
        return typeof value === 'string' && SQL_DURATION_BUCKETS_SET.has(value);
      return false;
    case 'sql.profile_opened':
      return false;
    case 'sql.storage_mode':
      // Both keys share the same closed enum.
      return (
        (key === 'mode' || key === 'requested') &&
        typeof value === 'string' &&
        SQL_STORAGE_MODES_SET.has(value)
      );
    case 'sql.table_imported':
      if (key === 'format') return typeof value === 'string' && SQL_IMPORT_FORMATS_SET.has(value);
      if (key === 'source') return typeof value === 'string' && SQL_IMPORT_SOURCES_SET.has(value);
      return false;
    case 'utility.pipeline_executed':
      if (key === 'stepCount')
        return typeof value === 'string' && DEPENDENCY_COUNT_BUCKETS_SET.has(value);
      if (key === 'status')
        return typeof value === 'string' && PIPELINE_RUN_STATUSES_SET.has(value);
      return false;
    case 'utility.pipeline_template_used':
      return (
        key === 'templateId' && typeof value === 'string' && PIPELINE_TEMPLATE_IDS_SET.has(value)
      );
    case 'fs.blocked':
      return key === 'family' && typeof value === 'string' && FS_BLOCKED_FAMILIES.has(value);
    case 'session.restored':
      if (key === 'tabCount') return isSafeCount(value);
      if (key === 'source') return typeof value === 'string' && SESSION_RESTORE_SOURCES.has(value);
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

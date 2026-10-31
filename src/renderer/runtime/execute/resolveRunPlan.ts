/**
 * Decisions for one manual run, derived from the tab, the caller's lifecycle
 * options and the settings snapshot. Nothing here reads a store or writes
 * state: the orchestrator reads settings, and applies the one-shot timeout
 * consumption this module only reports. The execution mode comes from the
 * language metadata, which also consults the plugin registry for languages
 * outside the built-in packs.
 */

import { canRecordTimeline } from '../../../shared/timeline';
import {
  isRuntimeTimeoutSupportedLanguage,
  resolveTimeoutMs,
} from '../../../shared/runtimeTimeoutPresets';
import type { FileTab } from '../../types/editor';
import type { ExecutionContext } from '../../types/execution';
import type { SettingsState } from '../../types/settings';
import { executionModeForLanguage } from '../../utils/languageMeta';
import { extractTimeoutMagicComment } from '../../utils/magicComments';
import { supportsRunRegions, type RunRegion } from '../../utils/runRegions';
import type { ManualExecutionLifecycle } from './types';

/** Debug runs in these languages go through a native debugger session, not the runner. */
const NATIVE_DEBUGGER_LANGUAGES: ReadonlySet<string> = new Set(['python', 'go', 'rust']);

/**
 * Capture the post-execute scope when the active language
 * supports the inspector. `captureScope` is passed eagerly (not gated on the
 * toggle being on) so the toggle can light up after the first clean run; the
 * worker cost is bounded by the shared payload caps.
 */
const VARIABLE_INSPECTOR_LANGUAGES: ReadonlySet<string> = new Set([
  'javascript',
  'typescript',
  'python',
]);

export interface RunPlan {
  mode: 'run' | 'validate' | 'view';
  debugRequested: boolean;
  /** Record run on a JS / TS Worker tab; Debug wins when both are asked. */
  recordRequested: boolean;
  usesNativeDebugger: boolean;
  recordHistory: boolean;
  /** The region a Run regions run stops after; null for a whole-file run. */
  region: RunRegion | null;
}

export interface RunExecution {
  /** Everything `runner.execute` receives except the streaming callback. */
  context: ExecutionContext;
  /** Deadline the countdown pill shows, or undefined when nothing bounds the run. */
  deadlineTimeoutMs: number | undefined;
  /** The tab carries a one-shot timeout override that this run consumes. */
  clearsTimeoutOverride: boolean;
}

export function resolveRunPlan(
  tab: Pick<FileTab, 'language' | 'runtimeMode'>,
  lifecycle: Pick<ManualExecutionLifecycle, 'debug' | 'recordHistory' | 'record' | 'region'>
): RunPlan {
  const debugRequested = lifecycle.debug === true;
  const recordRequested = lifecycle.record === true && !debugRequested && canRecordTimeline(tab);
  const region = lifecycle.region && !debugRequested && !recordRequested && supportsRunRegions(tab.language) ? lifecycle.region : null;
  return {
    mode: executionModeForLanguage(tab.language),
    debugRequested,
    recordRequested,
    usesNativeDebugger: debugRequested && NATIVE_DEBUGGER_LANGUAGES.has(tab.language),
    // A region run saw part of the file, so it is not a run to restore or compare.
    recordHistory: lifecycle.recordHistory !== false && region === null,
    region,
  };
}

export function resolveRunExecution(
  tab: FileTab,
  plan: RunPlan,
  lifecycle: Pick<ManualExecutionLifecycle, 'executionTimeoutMs'>,
  settings: Pick<
    SettingsState,
    'showLineTiming' | 'variableInspectorScopeDepth' | 'runtimeTimeoutPresetByLanguage'
  >
): RunExecution {
  const { language } = tab;
  // Resolve the per-run timeout in priority order:
  // lifecycle override (desktop smoke / test) → one-shot tab override
  // (palette "Run with extended timeout") → magic comment `// @timeout 60s`
  // → undefined, which lets the runner read the Settings preset.
  const magicTimeoutMs = extractTimeoutMagicComment(language, tab.content);
  const resolvedTimeoutMs =
    lifecycle.executionTimeoutMs ?? tab.nextRunTimeoutOverrideMs ?? magicTimeoutMs ?? undefined;
  const wantsScopeCapture = VARIABLE_INSPECTOR_LANGUAGES.has(language) && !plan.debugRequested && !plan.recordRequested;
  const scopeDepth = settings.variableInspectorScopeDepth;
  const settingsTimeoutMs =
    !plan.usesNativeDebugger && isRuntimeTimeoutSupportedLanguage(language)
      ? resolveTimeoutMs(language, settings.runtimeTimeoutPresetByLanguage?.[language])
      : undefined;

  return {
    context: {
      language,
      ...(tab.filePath ? { filePath: tab.filePath } : {}),
      ...(resolvedTimeoutMs !== undefined ? { timeout: resolvedTimeoutMs } : {}),
      tabId: tab.id,
      ...(plan.debugRequested ? { debug: true } : {}),
      ...(plan.recordRequested ? { record: true } : {}),
      // A region shows the value of each bare expression, like Scratchpad's auto-log.
      ...(plan.region ? { autoLog: true } : {}),
      // Manual Run feeds the same pre-set buffer that
      // auto-run uses. Runners that do not consume stdin ignore the field.
      ...(tab.stdinBuffer ? { stdin: tab.stdinBuffer } : {}),
      ...(tab.inputArgs && tab.inputArgs.length > 0 ? { args: tab.inputArgs } : {}),
      // per-line timing toggle; the runner also honors an
      // in-buffer // @time directive on its own.
      ...(settings.showLineTiming ? { lineTiming: true } : {}),
      ...(wantsScopeCapture ? { captureScope: true } : {}),
      ...(wantsScopeCapture && typeof scopeDepth === 'number' ? { scopeDepth } : {}),
    },
    // The countdown pill shows either the explicit
    // override or the active Settings preset for the language.
    deadlineTimeoutMs: resolvedTimeoutMs ?? settingsTimeoutMs,
    clearsTimeoutOverride: tab.nextRunTimeoutOverrideMs !== undefined,
  };
}

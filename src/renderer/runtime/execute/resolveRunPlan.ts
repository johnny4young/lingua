/**
 * Decisions for one manual run, derived from the tab, the caller's lifecycle
 * options and the settings snapshot. Nothing here reads a store or writes
 * state: the orchestrator reads settings, and applies the one-shot timeout
 * consumption this module only reports. The execution mode comes from the
 * language metadata, which also consults the plugin registry for languages
 * outside the built-in packs.
 */

import {
  isRuntimeTimeoutSupportedLanguage,
  resolveTimeoutMs,
} from '../../../shared/runtimeTimeoutPresets';
import type { FileTab } from '../../types/editor';
import type { ExecutionContext } from '../../types/execution';
import type { SettingsState } from '../../types/settings';
import { executionModeForLanguage } from '../../utils/languageMeta';
import { extractTimeoutMagicComment } from '../../utils/magicComments';
import type { ManualExecutionLifecycle } from './types';

/** Debug runs in these languages go through a native debugger session, not the runner. */
const NATIVE_DEBUGGER_LANGUAGES: ReadonlySet<string> = new Set(['python', 'go', 'rust']);

/**
 * implementation — capture the post-execute scope when the active language
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
  usesNativeDebugger: boolean;
  recordHistory: boolean;
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
  tab: Pick<FileTab, 'language'>,
  lifecycle: Pick<ManualExecutionLifecycle, 'debug' | 'recordHistory'>
): RunPlan {
  const debugRequested = lifecycle.debug === true;
  return {
    mode: executionModeForLanguage(tab.language),
    debugRequested,
    usesNativeDebugger: debugRequested && NATIVE_DEBUGGER_LANGUAGES.has(tab.language),
    recordHistory: lifecycle.recordHistory !== false,
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
  // implementation — resolve the per-run timeout in priority order:
  // lifecycle override (desktop smoke / test) → one-shot tab override
  // (palette "Run with extended timeout") → magic comment `// @timeout 60s`
  // → undefined, which lets the runner read the Settings preset.
  const magicTimeoutMs = extractTimeoutMagicComment(language, tab.content);
  const resolvedTimeoutMs =
    lifecycle.executionTimeoutMs ?? tab.nextRunTimeoutOverrideMs ?? magicTimeoutMs ?? undefined;
  const wantsScopeCapture = VARIABLE_INSPECTOR_LANGUAGES.has(language) && !plan.debugRequested;
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
      // implementation — manual Run feeds the same pre-set buffer that
      // auto-run uses. Runners that do not consume stdin ignore the field.
      ...(tab.stdinBuffer ? { stdin: tab.stdinBuffer } : {}),
      ...(tab.inputArgs && tab.inputArgs.length > 0 ? { args: tab.inputArgs } : {}),
      // internal — per-line timing toggle; the runner also honors an
      // in-buffer // @time directive on its own.
      ...(settings.showLineTiming ? { lineTiming: true } : {}),
      ...(wantsScopeCapture ? { captureScope: true } : {}),
      ...(wantsScopeCapture && typeof scopeDepth === 'number' ? { scopeDepth } : {}),
    },
    // implementation note — the countdown pill shows either the explicit
    // override or the active Settings preset for the language.
    deadlineTimeoutMs: resolvedTimeoutMs ?? settingsTimeoutMs,
    clearsTimeoutOverride: tab.nextRunTimeoutOverrideMs !== undefined,
  };
}

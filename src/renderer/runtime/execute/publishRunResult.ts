/**
 * Everything a manual run shows or records once its outcome is known: the
 * console entries, the result panel, the history record and the
 * `runner.executed` telemetry. Publishers never call lifecycle callbacks,
 * flush the console or report the runtime bootstrap; the orchestrator owns
 * every exit's teardown.
 */

import { orderedConsoleOutputs } from '../../utils/capturedOutput';
import { executionKind, primaryExecutionError } from '../../utils/executionOutcome';
import i18next from 'i18next';
import { bucketDurationMs } from '../../../shared/telemetry';
import { isWorkerRunnerLanguage } from '../../../shared/languageFamilies';
import { formatExecutionSummary, toConsoleEntries, toConsoleEntry } from '../../hooks/runnerOutput';
import { useConsoleStore } from '../../stores/consoleStore';
import { useResultStore } from '../../stores/resultStore';
import type { FileTab } from '../../types/editor';
import type { Language } from '../../types/language';
import { toResultDiagnostics } from '../../utils/executionDiagnostics';
import { toExecutionPresentation } from '../../utils/executionPresentation';
import { trackEvent } from '../../utils/telemetry';
import { validateDocument } from '../../validation';
import { recordCompletedRun, recordFailedRun, type GitSnapshot } from './recordRunHistory';
import type { RunPlan } from './resolveRunPlan';
import type { CollectedRun, RunConsole } from './runAndCollect';
import type { ManualExecutionSummary } from './types';

export function publishViewOnly(
  activeTab: FileTab,
  runConsole: RunConsole
): ManualExecutionSummary {
  const { clear, setDiagnostics, setExecutionSource, setFullOutput, setIsAutoRunning } =
    useResultStore.getState();
  useConsoleStore.getState().clear();
  clear();
  setExecutionSource('manual');
  setIsAutoRunning(false);
  setDiagnostics([]);
  runConsole.add({
    type: 'info',
    content: `${activeTab.name} is editable, but Lingua does not run or lint this file type yet.`,
  });
  setFullOutput('This file type is editable only. Lingua will not execute or validate it yet.');
  return {
    mode: 'view',
    ok: true,
    executionTime: null,
    diagnosticsCount: 0,
    message: 'View-only file type',
  };
}

/** Clears the previous output and marks a validation as started. */
export function publishValidationStart(activeTab: FileTab, runConsole: RunConsole): void {
  const { clear, setExecutionSource, setIsAutoRunning, setIsManualRunning } =
    useResultStore.getState();
  useConsoleStore.getState().clear();
  clear();
  setExecutionSource('manual');
  setIsAutoRunning(false);
  setIsManualRunning(true);
  runConsole.add({ type: 'info', content: `Validating ${activeTab.name}...` });
}

/** Validates the document synchronously and publishes its diagnostics. */
export function publishValidation(
  activeTab: FileTab,
  runConsole: RunConsole
): ManualExecutionSummary {
  const { language, content, name } = activeTab;
  const {
    setDiagnostics,
    setError,
    setExecutionTime,
    setFullOutput,
    setLineResults,
    setLineTimings,
  } = useResultStore.getState();
  const validation = validateDocument(language, content);
  setDiagnostics(validation.diagnostics);
  setLineResults([]);
  setLineTimings([]);
  setFullOutput(validation.fullOutput);
  setError(null);
  setExecutionTime(validation.executionTime);
  const hasErrors = validation.diagnostics.some(item => item.severity === 'error');

  runConsole.add({
    type: hasErrors ? 'error' : 'info',
    content:
      validation.diagnostics.length === 0
        ? `Validation passed for ${name}.`
        : `Validation found ${validation.diagnostics.length} issue${validation.diagnostics.length === 1 ? '' : 's'} in ${name}.`,
    executionTime: validation.executionTime,
  });

  return {
    mode: 'validate',
    ok: !hasErrors,
    executionTime: validation.executionTime,
    diagnosticsCount: validation.diagnostics.length,
    message: hasErrors ? validation.fullOutput : `Validation passed for ${name}.`,
  };
}

export function publishUnsupportedRunner(
  language: Language,
  runConsole: RunConsole
): ManualExecutionSummary {
  runConsole.add({
    type: 'error',
    content: `Runner for ${language} is not available yet. Coming in a future update.`,
  });
  return {
    mode: 'run',
    ok: false,
    executionTime: null,
    diagnosticsCount: 0,
    message: `Runner for ${language} is not available yet.`,
  };
}

/** Clears the previous output and marks the manual run as started. */
export function publishRunStart(activeTab: FileTab, plan: RunPlan, runConsole: RunConsole): void {
  const {
    clearVisibleResults,
    setDiagnostics,
    setExecutionSource,
    setIsAutoRunning,
    setIsManualRunning,
  } = useResultStore.getState();
  const { name } = activeTab;
  useConsoleStore.getState().clear();
  clearVisibleResults();
  setExecutionSource('manual');
  setIsAutoRunning(false);
  setIsManualRunning(true);
  setDiagnostics([]);
  runConsole.add({
    type: 'info',
    content: plan.debugRequested
      ? (i18next.t('runner.debuggingFile', { name }) as string)
      : `Running ${name}...`,
  });
}

export function publishMissingRunner(
  language: Language,
  runConsole: RunConsole
): ManualExecutionSummary {
  runConsole.add({ type: 'error', content: `Failed to initialize ${language} runner.` });
  return {
    mode: 'run',
    ok: false,
    executionTime: null,
    diagnosticsCount: 0,
    message: `Failed to initialize ${language} runner.`,
  };
}

export function publishCancelledRun(
  activeTab: FileTab,
  { result, streamedConsoleCount }: CollectedRun,
  runConsole: RunConsole
): ManualExecutionSummary {
  const { language, content } = activeTab;
  const {
    setDiagnostics,
    setError,
    setExecutionTime,
    setFullOutput,
    setLineResults,
    setLineTimings,
  } = useResultStore.getState();
  const message = result.error?.message ?? (i18next.t('runner.stopped.message') as string);
  const presentation = toExecutionPresentation(language, content, {
    ...result,
    error: undefined,
  });
  setLineResults(presentation.lineResults);
  setLineTimings([]);
  setFullOutput(presentation.fullOutput || message);
  setError(null);
  setDiagnostics([]);
  setExecutionTime(result.executionTime);
  const cancelledOutputs = streamedConsoleCount > 0 ? [] : orderedConsoleOutputs(result);
  for (const output of cancelledOutputs) {
    runConsole.add(toConsoleEntry(output, language));
  }
  runConsole.add({
    type: 'warn',
    content: message,
    executionTime: result.executionTime,
  });
  return {
    mode: 'run',
    ok: false,
    cancelled: true,
    executionTime: result.executionTime,
    diagnosticsCount: 0,
    message,
  };
}

export async function publishCompletedRun(
  activeTab: FileTab,
  plan: RunPlan,
  { result, streamedConsoleCount }: CollectedRun,
  gitSnapshot: GitSnapshot | undefined,
  runConsole: RunConsole,
  isCurrent: () => boolean = () => true
): Promise<ManualExecutionSummary> {
  const { language, content, name } = activeTab;
  const {
    setDiagnostics,
    setError,
    setExecutionTime,
    setFullOutput,
    setLineResults,
    setLineTimings,
    setStdinConsumed,
  } = useResultStore.getState();
  const presentation = toExecutionPresentation(language, content, result);
  const diagnostics = toResultDiagnostics(language, result);
  const kind = executionKind(result);
  const error = primaryExecutionError(result);
  const runStatus = kind === 'success' ? 'ok' : kind;
  if (plan.recordHistory) {
    await recordCompletedRun({
      activeTab,
      result,
      runStatus,
      lineResults: presentation.lineResults,
      diagnostics,
      gitSnapshot,
      isCurrent,
    });
  }

  if (!isCurrent())
    return {
      mode: 'run',
      ok: false,
      cancelled: true,
      executionTime: null,
      diagnosticsCount: 0,
      message: '',
    };
  setLineResults(presentation.lineResults);
  setLineTimings(result.lineTimings ?? []);
  setFullOutput(presentation.fullOutput);
  // implementation note — surface the consumption summary alongside the
  // manual-run results, same as the auto-run path.
  setStdinConsumed(result.stdinConsumed ?? null);
  setError(error);
  setDiagnostics(diagnostics);
  setExecutionTime(result.executionTime);

  // implementation — manual Run captures the snapshot on the clean-success
  // branch too, so Compare is not scratchpad-only. Errors are not a
  // restoration target. Capture happens after the line results and full
  // output are set so the snapshot reflects what the user just saw.
  if (kind === 'success') {
    useResultStore.getState().captureSuccessfulSnapshot(language, content);
    // implementation — surface the variable inspector snapshot if the worker
    // emitted one. `null` clears a stale snapshot from the previous run.
    useResultStore.getState().setScopeSnapshot(result.scopeSnapshot ?? null);
  }

  const entriesToAdd = toConsoleEntries(result, language, { streamed: streamedConsoleCount > 0 });
  for (const entry of entriesToAdd) {
    runConsole.add(entry);
  }

  // internal — emit runner.executed so consenting users' telemetry reflects
  // runtime usage. `durationBucketMs` is already coarse, and the property
  // allowlist rejects anything beyond language/status/durationBucketMs.
  void trackEvent('runner.executed', {
    language,
    status: runStatus,
    durationBucketMs: bucketDurationMs(result.executionTime ?? 0),
  });
  // implementation note — same adoption signal as the auto-run path: both run
  // surfaces share the buffer and worker (≥1 line consumed, JS / TS / Python).
  if (result.stdinConsumed && result.stdinConsumed.count > 0 && isWorkerRunnerLanguage(language)) {
    void trackEvent('runtime.stdin_used', { language });
  }

  return {
    mode: 'run',
    ok: kind === 'success',
    executionTime: result.executionTime,
    diagnosticsCount: diagnostics.length,
    message: error?.message ?? (kind === 'success' ? `Completed ${name}` : formatExecutionSummary(result)),
    consoleEntryCount: runConsole.count(),
  };
}

/**
 * Reports a run that threw before producing a result: the pill, the history
 * record and `runner.executed` telemetry. Resolves with the thrown message.
 */
export async function publishRunFailure(
  activeTab: FileTab,
  plan: RunPlan,
  error: unknown,
  gitSnapshot: GitSnapshot | undefined,
  isCurrent: () => boolean = () => true
): Promise<string> {
  const { setRunDeadlineAt, setRunTermination } = useResultStore.getState();
  const message = error instanceof Error ? error.message : String(error);
  // implementation — surface the failure via the pill too.
  if (plan.recordHistory) {
    await recordFailedRun(activeTab, message, gitSnapshot, isCurrent);
  }
  if (!isCurrent()) return message;
  setRunDeadlineAt(null);
  setRunTermination({ kind: 'error' });

  // internal — mirror the error path in telemetry. `durationBucketMs: 0`
  // because the runner never completed a timed window.
  void trackEvent('runner.executed', {
    language: activeTab.language,
    status: 'error',
    durationBucketMs: 0,
  });
  return message;
}

/** Shows why a thrown run failed: during runner preparation, or after it. */
export function publishFailedRun(
  language: Language,
  message: string,
  runnerPrepared: boolean,
  runConsole: RunConsole
): ManualExecutionSummary {
  const { setDiagnostics, setError } = useResultStore.getState();
  if (!runnerPrepared) {
    setDiagnostics([]);
    setError({
      message: `Failed to initialize ${language} runner: ${message}`,
    });
    runConsole.add({
      type: 'error',
      content: `Failed to initialize ${language} runner: ${message}`,
    });
    return {
      mode: 'run',
      ok: false,
      executionTime: null,
      diagnosticsCount: 0,
      message: `Failed to initialize ${language} runner: ${message}`,
    };
  }

  setDiagnostics([]);
  setError({ message });
  runConsole.add({
    type: 'error',
    content: `Unexpected error: ${message}`,
  });
  return {
    mode: 'run',
    ok: false,
    executionTime: null,
    diagnosticsCount: 0,
    message,
  };
}

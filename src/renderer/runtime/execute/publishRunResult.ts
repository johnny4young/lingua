/**
 * Everything a manual run shows or records once its outcome is known: the
 * console entries, the result panel, the history record and the
 * `runner.executed` telemetry. The view-only, validation and unsupported
 * branches end their own lifecycle; the run path's shared teardown lives in
 * the orchestrator's `finally`.
 */

import i18next from 'i18next';
import { bucketDurationMs } from '../../../shared/telemetry';
import { isWorkerRunnerLanguage } from '../../../shared/languageFamilies';
import { toConsoleEntries } from '../../hooks/runnerOutput';
import { useConsoleStore } from '../../stores/consoleStore';
import { useResultStore } from '../../stores/resultStore';
import type { FileTab } from '../../types/editor';
import type { Language } from '../../types/language';
import { toExecutionDiagnostics } from '../../utils/executionDiagnostics';
import { toExecutionPresentation } from '../../utils/executionPresentation';
import { trackEvent } from '../../utils/telemetry';
import { validateDocument } from '../../validation';
import type { RunnerBootstrap } from './prepareRunner';
import { recordCompletedRun, recordFailedRun, type GitSnapshot } from './recordRunHistory';
import type { RunPlan } from './resolveRunPlan';
import { consoleEntryFromOutput, type CollectedRun, type RunConsole } from './runAndCollect';
import type { ManualExecutionLifecycle, ManualExecutionSummary } from './types';

export function publishViewOnly(
  activeTab: FileTab,
  lifecycle: ManualExecutionLifecycle,
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
  lifecycle.setCurrentLanguage?.(null);
  runConsole.flush();
  return {
    mode: 'view',
    ok: true,
    executionTime: null,
    diagnosticsCount: 0,
    message: 'View-only file type',
  };
}

/** Validates the document synchronously and publishes its diagnostics. */
export function publishValidation(
  activeTab: FileTab,
  lifecycle: ManualExecutionLifecycle,
  runConsole: RunConsole
): ManualExecutionSummary {
  const { language, content, name } = activeTab;
  const {
    clear,
    setDiagnostics,
    setError,
    setExecutionSource,
    setExecutionTime,
    setFullOutput,
    setIsAutoRunning,
    setIsManualRunning,
    setLineResults,
    setLineTimings,
  } = useResultStore.getState();
  useConsoleStore.getState().clear();
  clear();
  setExecutionSource('manual');
  setIsAutoRunning(false);
  setIsManualRunning(true);
  lifecycle.setIsRunning?.(true);
  runConsole.add({ type: 'info', content: `Validating ${name}...` });

  try {
    const validation = validateDocument(language, content);
    setDiagnostics(validation.diagnostics);
    setLineResults([]);
    setLineTimings([]);
    setFullOutput(validation.fullOutput);
    setError(null);
    setExecutionTime(validation.executionTime);
    const hasErrors = validation.diagnostics.some((item) => item.severity === 'error');

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
  } finally {
    runConsole.flush();
    setIsManualRunning(false);
    lifecycle.setIsRunning?.(false);
    lifecycle.setCurrentLanguage?.(null);
  }
}

export function publishUnsupportedRunner(
  language: Language,
  lifecycle: ManualExecutionLifecycle,
  runConsole: RunConsole
): ManualExecutionSummary {
  runConsole.add({
    type: 'error',
    content: `Runner for ${language} is not available yet. Coming in a future update.`,
  });
  lifecycle.setCurrentLanguage?.(null);
  runConsole.flush();
  return {
    mode: 'run',
    ok: false,
    executionTime: null,
    diagnosticsCount: 0,
    message: `Runner for ${language} is not available yet.`,
  };
}

/** Clears the previous output and marks the manual run as started. */
export function publishRunStart(
  activeTab: FileTab,
  plan: RunPlan,
  lifecycle: ManualExecutionLifecycle,
  runConsole: RunConsole
): void {
  const { clearVisibleResults, setDiagnostics, setExecutionSource, setIsAutoRunning, setIsManualRunning } =
    useResultStore.getState();
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
  lifecycle.setIsRunning?.(true);
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
  const { setDiagnostics, setError, setExecutionTime, setFullOutput, setLineResults, setLineTimings } =
    useResultStore.getState();
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
  const cancelledOutputs = streamedConsoleCount > 0 ? [] : [...result.stdout, ...result.stderr];
  for (const output of cancelledOutputs) {
    runConsole.add(consoleEntryFromOutput(output, language));
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
  runConsole: RunConsole
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
  setLineResults(presentation.lineResults);
  setLineTimings(result.lineTimings ?? []);
  setFullOutput(presentation.fullOutput);
  // implementation note — surface the consumption summary alongside the
  // manual-run results, same as the auto-run path.
  setStdinConsumed(result.stdinConsumed ?? null);
  setError(result.error ?? null);
  const diagnostics = toExecutionDiagnostics(language, result.error ?? null);
  setDiagnostics(diagnostics);
  setExecutionTime(result.executionTime);

  // implementation — manual Run captures the snapshot on the clean-success
  // branch too, so Compare is not scratchpad-only. Errors are not a
  // restoration target. Capture happens after the line results and full
  // output are set so the snapshot reflects what the user just saw.
  if (!result.error && !result.cancelled) {
    useResultStore.getState().captureSuccessfulSnapshot(language, content);
    // implementation — surface the variable inspector snapshot if the worker
    // emitted one. `null` clears a stale snapshot from the previous run.
    useResultStore.getState().setScopeSnapshot(result.scopeSnapshot ?? null);
  }

  const consoleEntries = toConsoleEntries(result, language);
  const entriesToAdd =
    streamedConsoleCount > 0
      ? consoleEntries.slice(result.stdout.length + result.stderr.length)
      : consoleEntries;
  for (const entry of entriesToAdd) {
    runConsole.add(entry);
  }

  // implementation note — `runner.executed.status` distinguishes `'timeout'`
  // and `'stopped'` from generic `'error'`. Prefer the explicit `result.kind`
  // set by the runner; fall back to the legacy boolean for runners that never
  // set the field.
  const runStatus: 'ok' | 'error' | 'timeout' | 'stopped' =
    result.kind === 'timeout'
      ? 'timeout'
      : result.kind === 'stopped'
        ? 'stopped'
        : result.error
          ? 'error'
          : 'ok';
  if (plan.recordHistory) {
    await recordCompletedRun({
      activeTab,
      result,
      runStatus,
      lineResults: presentation.lineResults,
      diagnostics,
      gitSnapshot,
    });
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
  if (
    result.stdinConsumed &&
    result.stdinConsumed.count > 0 &&
    isWorkerRunnerLanguage(language)
  ) {
    void trackEvent('runtime.stdin_used', { language });
  }

  return {
    mode: 'run',
    ok: !result.error,
    executionTime: result.executionTime,
    diagnosticsCount: diagnostics.length,
    message: result.error?.message ?? `Completed ${name}`,
    consoleEntryCount: runConsole.count(),
  };
}

export async function publishFailedRun(args: {
  activeTab: FileTab;
  plan: RunPlan;
  error: unknown;
  runnerPrepared: boolean;
  bootstrap: Pick<RunnerBootstrap, 'fail'>;
  gitSnapshot: GitSnapshot | undefined;
  runConsole: RunConsole;
}): Promise<ManualExecutionSummary> {
  const { activeTab, plan, error, runnerPrepared, bootstrap, gitSnapshot, runConsole } = args;
  const { language } = activeTab;
  const { setDiagnostics, setError, setRunDeadlineAt, setRunTermination } =
    useResultStore.getState();
  const message = error instanceof Error ? error.message : String(error);
  // implementation — surface the failure via the pill too.
  setRunDeadlineAt(null);
  setRunTermination({ kind: 'error' });
  if (plan.recordHistory) {
    await recordFailedRun(activeTab, message, gitSnapshot);
  }

  // internal — mirror the error path in telemetry. `durationBucketMs: 0`
  // because the runner never completed a timed window.
  void trackEvent('runner.executed', {
    language,
    status: 'error',
    durationBucketMs: 0,
  });
  if (!runnerPrepared) {
    bootstrap.fail();
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

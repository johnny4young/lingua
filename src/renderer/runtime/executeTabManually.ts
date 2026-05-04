import i18next from 'i18next';
import { runnerManager } from '../runners';
import { useConsoleStore } from '../stores/consoleStore';
import { useExecutionHistoryStore } from '../stores/executionHistoryStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isEntitled } from '../../shared/entitlements';
import { trackEvent } from '../utils/telemetry';
import { bucketDurationMs } from '../../shared/telemetry';
import type { FileTab, Language } from '../types';
import {
  getCompilationLoadingMessage,
  getCompilationMessage,
  getInitializationMessage,
  toConsoleEntries,
} from '../hooks/runnerOutput';
import { toExecutionPresentation } from '../utils/executionPresentation';
import { toExecutionDiagnostics } from '../utils/executionDiagnostics';
import { executionModeForLanguage } from '../utils/languageMeta';
import { validateDocument } from '../validation';

/**
 * RL-028 sixth slice — gate the optional code snapshot for the
 * execution-history ring buffer. The snapshot only attaches when the
 * user opted in via Settings AND the active tier covers
 * `EXECUTION_HISTORY`. The Pro check is a defense-in-depth gate —
 * the toggle UI in Editor settings already disables itself for Free
 * users, but a state-shadowing bug (or a future surface that flips
 * the flag programmatically) must not be able to leak captures. The
 * try/catch hardens against a license-store throw (mocked imports in
 * tests, an unexpected refactor) — fall back to no-snapshot rather
 * than dropping the entire history record on the floor.
 *
 * Caller passes the `code` + `language` it actually executed, not
 * the live `FileTab` reference. The tab's buffer can mutate during
 * the awaited `runner.execute(...)` window (autosave, Format on
 * Save, the user typing into the editor); a snapshot built from
 * the stale tab ref would not match what `runner.execute()` ran,
 * defeating the whole point of replay. Snapshot whatever was passed
 * to the runner — same string the runner saw.
 */
function snapshotPayloadFor(
  code: string,
  language: string
): { code: string; language: string } | null {
  try {
    const enabled = useSettingsStore.getState().executionHistorySnapshotEnabled;
    if (enabled !== true) return null;
    if (!isEntitled(currentEffectiveTier(), 'EXECUTION_HISTORY')) return null;
    return { code, language };
  } catch {
    return null;
  }
}

export interface ManualExecutionLifecycle {
  setIsRunning?: (value: boolean) => void;
  setIsInitializing?: (value: boolean) => void;
  setLoadingMessage?: (value: string | null) => void;
  setCurrentLanguage?: (language: Language | null) => void;
  /**
   * Defaults to true. Replay surfaces pass false so executing a captured
   * history snapshot does not append another entry to the same timeline.
   */
  recordHistory?: boolean;
  /**
   * RL-078 — opt-in override for the runner's deadline (ms). Used by
   * the desktop smoke timeout cases so the parent kill timer fires
   * within a few seconds instead of the language default. End-user
   * surfaces leave this undefined and inherit each runner's default.
   */
  executionTimeoutMs?: number;
}

export interface ManualExecutionSummary {
  mode: 'run' | 'validate' | 'view';
  ok: boolean;
  cancelled?: boolean;
  executionTime: number | null;
  diagnosticsCount: number;
  message: string;
}

export async function executeTabManually(
  activeTab: FileTab,
  lifecycle: ManualExecutionLifecycle = {}
): Promise<ManualExecutionSummary> {
  const { addEntry, clear } = useConsoleStore.getState();
  const {
    clear: clearResults,
    setError,
    setExecutionTime,
    setExecutionSource,
    setFullOutput,
    setIsAutoRunning,
    setIsManualRunning,
    setLineResults,
    setDiagnostics,
  } = useResultStore.getState();

  const { language, content, name } = activeTab;
  const executionMode = executionModeForLanguage(language);
  const shouldRecordHistory = lifecycle.recordHistory !== false;

  lifecycle.setCurrentLanguage?.(language);

  if (executionMode === 'view') {
    clear();
    clearResults();
    setExecutionSource('manual');
    setIsAutoRunning(false);
    setDiagnostics([]);
    addEntry({
      type: 'info',
      content: `${name} is editable, but Lingua does not run or lint this file type yet.`,
    });
    setFullOutput('This file type is editable only. Lingua will not execute or validate it yet.');
    lifecycle.setCurrentLanguage?.(null);
    return {
      mode: 'view',
      ok: true,
      executionTime: null,
      diagnosticsCount: 0,
      message: 'View-only file type',
    };
  }

  if (executionMode === 'validate') {
    clear();
    clearResults();
    setExecutionSource('manual');
    setIsAutoRunning(false);
    setIsManualRunning(true);
    lifecycle.setIsRunning?.(true);
    addEntry({ type: 'info', content: `Validating ${name}...` });

    try {
      const validation = validateDocument(language, content);
      setDiagnostics(validation.diagnostics);
      setLineResults([]);
      setFullOutput(validation.fullOutput);
      setError(null);
      setExecutionTime(validation.executionTime);
      const hasErrors = validation.diagnostics.some((item) => item.severity === 'error');

      addEntry({
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
      setIsManualRunning(false);
      lifecycle.setIsRunning?.(false);
      lifecycle.setCurrentLanguage?.(null);
    }
  }

  if (!runnerManager.isSupported(language)) {
    addEntry({
      type: 'error',
      content: `Runner for ${language} is not available yet. Coming in a future update.`,
    });
    lifecycle.setCurrentLanguage?.(null);
    return {
      mode: 'run',
      ok: false,
      executionTime: null,
      diagnosticsCount: 0,
      message: `Runner for ${language} is not available yet.`,
    };
  }

  clear();
  clearResults();
  setExecutionSource('manual');
  setIsAutoRunning(false);
  setIsManualRunning(true);
  setDiagnostics([]);
  addEntry({ type: 'info', content: `Running ${name}...` });
  lifecycle.setIsRunning?.(true);

  const shouldShowInitialization = runnerManager.needsInitialization(language);
  if (shouldShowInitialization) {
    lifecycle.setIsInitializing?.(true);
    const message = getInitializationMessage(language);
    lifecycle.setLoadingMessage?.(message);
    addEntry({ type: 'info', content: message });
  }

  let runnerPrepared = false;

  try {
    const { runner } = await runnerManager.prepareRunner(language);
    if (!runner) {
      addEntry({ type: 'error', content: `Failed to initialize ${language} runner.` });
      return {
        mode: 'run',
        ok: false,
        executionTime: null,
        diagnosticsCount: 0,
        message: `Failed to initialize ${language} runner.`,
      };
    }
    runnerPrepared = true;

    if (shouldShowInitialization) {
      lifecycle.setIsInitializing?.(false);
      lifecycle.setLoadingMessage?.(null);
    }

    const compilationLoadingMessage = getCompilationLoadingMessage(language);
    const compilationMessage = getCompilationMessage(language);
    if (compilationLoadingMessage && compilationMessage) {
      lifecycle.setLoadingMessage?.(compilationLoadingMessage);
      addEntry(compilationMessage);
    }

    const result = await runner.execute(
      content,
      lifecycle.executionTimeoutMs !== undefined
        ? { timeout: lifecycle.executionTimeoutMs }
        : undefined
    );

    if (result.cancelled) {
      const message =
        result.error?.message ?? (i18next.t('runner.stopped.message') as string);
      const presentation = toExecutionPresentation(language, content, {
        ...result,
        error: undefined,
      });
      setLineResults(presentation.lineResults);
      setFullOutput(presentation.fullOutput || message);
      setError(null);
      setDiagnostics([]);
      setExecutionTime(result.executionTime);
      for (const output of [...result.stdout, ...result.stderr]) {
        addEntry({
          type: output.type,
          content: output.args.join(' '),
          line: output.line,
        });
      }
      addEntry({
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

    const presentation = toExecutionPresentation(language, content, result);
    setLineResults(presentation.lineResults);
    setFullOutput(presentation.fullOutput);
    setError(result.error ?? null);
    const diagnostics = toExecutionDiagnostics(language, result.error ?? null);
    setDiagnostics(diagnostics);
    setExecutionTime(result.executionTime);

    for (const entry of toConsoleEntries(result)) {
      addEntry(entry);
    }

    // RL-028 first slice — record metadata always. RL-028 sixth slice —
    // attach the optional code snapshot when the user opted in AND the
    // active tier covers `EXECUTION_HISTORY`. `snapshotPayloadFor`
    // returns `null` otherwise, preserving the metadata-only contract.
    if (shouldRecordHistory) {
      useExecutionHistoryStore.getState().record({
        language,
        status: result.error ? 'error' : 'ok',
        durationMs: result.executionTime ?? null,
        snapshot: snapshotPayloadFor(content, language),
      });
    }

    // RL-065 — emit runner.executed so consenting users' telemetry
    // reflects runtime usage. `durationBucketMs` is already coarse
    // (from shared/telemetry), and the property allowlist rejects
    // anything beyond language/status/durationBucketMs.
    void trackEvent('runner.executed', {
      language,
      status: result.error ? 'error' : 'ok',
      durationBucketMs: bucketDurationMs(result.executionTime ?? 0),
    });

    return {
      mode: 'run',
      ok: !result.error,
      executionTime: result.executionTime,
      diagnosticsCount: diagnostics.length,
      message: result.error?.message ?? `Completed ${name}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // RL-028 — record the failure so "Recent runs" still reflects the
    // error outcome. `durationMs: null` when timing never ran. The
    // snapshot still attaches when opted-in + Pro: a failure is the
    // case where the user most likely wants to replay.
    if (shouldRecordHistory) {
      useExecutionHistoryStore.getState().record({
        language,
        status: 'error',
        durationMs: null,
        snapshot: snapshotPayloadFor(content, language),
      });
    }

    // RL-065 — mirror the error path in telemetry. `durationBucketMs: 0`
    // because the runner never completed a timed window.
    void trackEvent('runner.executed', {
      language,
      status: 'error',
      durationBucketMs: 0,
    });
    if (!runnerPrepared) {
      setDiagnostics([]);
      setError({
        message: `Failed to initialize ${language} runner: ${message}`,
      });
      addEntry({
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
    addEntry({
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
  } finally {
    setIsManualRunning(false);
    lifecycle.setIsRunning?.(false);
    lifecycle.setIsInitializing?.(false);
    lifecycle.setLoadingMessage?.(null);
    lifecycle.setCurrentLanguage?.(null);
  }
}

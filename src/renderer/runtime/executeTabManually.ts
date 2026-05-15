import i18next from 'i18next';
import { runnerManager } from '../runners';
import { useConsoleStore } from '../stores/consoleStore';
import { useExecutionHistoryStore } from '../stores/executionHistoryStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useEditorStore } from '../stores/editorStore';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isEntitled } from '../../shared/entitlements';
import { trackEvent } from '../utils/telemetry';
import { bucketDurationMs } from '../../shared/telemetry';
import { extractTimeoutMagicComment } from '../utils/magicComments';
import {
  isRuntimeTimeoutSupportedLanguage,
  resolveTimeoutMs,
} from '../../shared/runtimeTimeoutPresets';
import type { ConsoleOutput, FileTab, Language } from '../types';
import { collectBrowserPreviewSiblingSources } from './browserPreviewSiblings';
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
  /**
   * Explicit JS/TS debug intent. Normal manual runs leave this false so
   * breakpoints remain passive editor marks until the user presses Debug.
   */
  debug?: boolean;
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
    clearVisibleResults,
    setError,
    setExecutionTime,
    setExecutionSource,
    setFullOutput,
    setIsAutoRunning,
    setIsManualRunning,
    setLineResults,
    setStdinConsumed,
    setDiagnostics,
    setRunTermination,
    setRunDeadlineAt,
  } = useResultStore.getState();

  const { language, content, name, runtimeMode } = activeTab;
  const executionMode = executionModeForLanguage(language);
  const shouldRecordHistory = lifecycle.recordHistory !== false;
  const debugRequested = lifecycle.debug === true;

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
  clearVisibleResults();
  setExecutionSource('manual');
  setIsAutoRunning(false);
  setIsManualRunning(true);
  setDiagnostics([]);
  addEntry({
    type: 'info',
    content: debugRequested
      ? (i18next.t('runner.debuggingFile', { name }) as string)
      : `Running ${name}...`,
  });
  lifecycle.setIsRunning?.(true);

  const shouldShowInitialization = runnerManager.needsInitialization(language, runtimeMode);
  if (shouldShowInitialization) {
    lifecycle.setIsInitializing?.(true);
    const message = getInitializationMessage(language);
    lifecycle.setLoadingMessage?.(message);
    addEntry({ type: 'info', content: message });
  }

  let runnerPrepared = false;

  try {
    // RL-019 Slice 3 fold A — feed sibling .css / .html tabs to
    // the browser-preview runner BEFORE prepareRunner so the
    // first execute() picks them up. Editor store is already a
    // hard dep elsewhere in this module (other surfaces import
    // it), so the static reference does not change bundle shape.
    if (runtimeMode === 'browser-preview') {
      try {
        const editorState = useEditorStore.getState();
        const siblingSources = collectBrowserPreviewSiblingSources(editorState.tabs, activeTab);
        runnerManager.getBrowserPreviewRunner()?.setSiblingSources(siblingSources);
      } catch {
        /* if the sibling lookup throws, fall back to plain execution */
      }
    }

    const { runner } = await runnerManager.prepareRunner(language, runtimeMode);
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

    const streamedStdout: ConsoleOutput[] = [];
    const streamedStderr: ConsoleOutput[] = [];
    let streamedConsoleCount = 0;
    const streamConsoleOutput = (output: ConsoleOutput) => {
      streamedConsoleCount += 1;
      if (output.type === 'error') {
        streamedStderr.push(output);
      } else {
        streamedStdout.push(output);
      }
      addEntry({
        type: output.type,
        content: output.args.join(' '),
        line: output.line,
      });

      const presentation = toExecutionPresentation(language, content, {
        stdout: streamedStdout,
        stderr: streamedStderr,
        result: undefined,
        executionTime: 0,
      });
      setLineResults(presentation.lineResults);
      setFullOutput(presentation.fullOutput);
      setError(null);
      setExecutionTime(null);
    };

    // RL-020 Slice 7 — resolve the per-run timeout in priority
    // order: lifecycle override (desktop smoke / test) → one-shot
    // tab override (fold D, palette "Run with extended timeout") →
    // magic-comment `// @timeout 60s` (fold B) → undefined, which
    // lets the runner read the Settings preset for the language.
    const magicTimeoutMs = extractTimeoutMagicComment(language, content);
    const resolvedTimeoutMs =
      lifecycle.executionTimeoutMs ??
      activeTab.nextRunTimeoutOverrideMs ??
      magicTimeoutMs ??
      undefined;
    // Consume the one-shot tab override immediately so a subsequent
    // run reverts to the persisted preset (or to a fresh magic
    // comment if the buffer still carries one).
    if (activeTab.nextRunTimeoutOverrideMs !== undefined) {
      useEditorStore.getState().setTabNextRunTimeoutOverride(activeTab.id, null);
    }

    const executionContext = {
      ...(resolvedTimeoutMs !== undefined
        ? { timeout: resolvedTimeoutMs }
        : {}),
      tabId: activeTab.id,
      onConsole: streamConsoleOutput,
      ...(debugRequested ? { debug: true } : {}),
      // RL-020 Slice 6 — manual Run feeds the same pre-set buffer
      // that auto-run uses. Runners that do not consume stdin
      // ignore the field.
      ...(activeTab.stdinBuffer ? { stdin: activeTab.stdinBuffer } : {}),
    };

    const settingsTimeoutMs = isRuntimeTimeoutSupportedLanguage(language)
      ? resolveTimeoutMs(
          language,
          useSettingsStore.getState().runtimeTimeoutPresetByLanguage?.[language]
        )
      : undefined;
    const deadlineTimeoutMs = resolvedTimeoutMs ?? settingsTimeoutMs;

    // RL-020 Slice 7 fold E — set the in-flight deadline so the
    // countdown pill can render `mm:ss` until termination. The
    // resolved timeout the runner armed is either an explicit
    // override or the active Settings preset for the language; the
    // pill reads `useResultStore.runDeadlineAt` to compute the
    // remaining time.
    if (deadlineTimeoutMs !== undefined) {
      setRunDeadlineAt(Date.now() + deadlineTimeoutMs);
    }

    const result = await runner.execute(content, executionContext);
    // Tear down the in-flight deadline immediately; the pill flips
    // to the termination variant on the next render.
    setRunDeadlineAt(null);
    // RL-020 Slice 7 — propagate the termination summary to the
    // result store so `<RunStatusPill>` can render the right
    // variant. Runners that don't set `kind` default to a
    // best-effort guess based on `error` / `cancelled`.
    const terminationKind: 'success' | 'error' | 'timeout' | 'stopped' =
      result.kind ?? (result.cancelled
        ? 'stopped'
        : result.error
          ? 'error'
          : 'success');
    setRunTermination({
      kind: terminationKind,
      timeoutPreset: result.timeoutPreset,
      timeoutMs: result.timeoutMs,
    });

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
      const cancelledOutputs =
        streamedConsoleCount > 0 ? [] : [...result.stdout, ...result.stderr];
      for (const output of cancelledOutputs) {
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
    // RL-020 Slice 6 fold G — surface the consumption summary
    // alongside the manual-run results, same as the auto-run path.
    setStdinConsumed(result.stdinConsumed ?? null);
    setError(result.error ?? null);
    const diagnostics = toExecutionDiagnostics(language, result.error ?? null);
    setDiagnostics(diagnostics);
    setExecutionTime(result.executionTime);

    // RL-020 Slice 8 — manual Run captures the snapshot too on the
    // clean-success branch. Slice 1 only captured on auto-run so
    // Compare was effectively scratchpad-only. Skip on cancelled
    // (already returned above) and on error — neither is a
    // restoration target. Capture happens AFTER setLineResults +
    // setFullOutput so the snapshot reflects what the user just
    // saw.
    if (!result.error && !result.cancelled) {
      useResultStore.getState().captureSuccessfulSnapshot(language);
    }

    const consoleEntries = toConsoleEntries(result);
    const entriesToAdd =
      streamedConsoleCount > 0
        ? consoleEntries.slice(result.stdout.length + result.stderr.length)
        : consoleEntries;
    for (const entry of entriesToAdd) {
      addEntry(entry);
    }

    // RL-020 Slice 7 fold G — `runner.executed.status` enum widens
    // to distinguish `'timeout'` and `'stopped'` from generic
    // `'error'`. Prefer the explicit `result.kind` set by the
    // runner; fall back to the legacy boolean for runners that
    // never set the field.
    const runStatus: 'ok' | 'error' | 'timeout' | 'stopped' =
      result.kind === 'timeout'
        ? 'timeout'
        : result.kind === 'stopped'
          ? 'stopped'
          : result.error
            ? 'error'
            : 'ok';
    const historyStatus: 'ok' | 'error' =
      runStatus === 'ok' ? 'ok' : 'error';
    // RL-028 first slice — record metadata always. RL-028 sixth slice —
    // attach the optional code snapshot when the user opted in AND the
    // active tier covers `EXECUTION_HISTORY`. `snapshotPayloadFor`
    // returns `null` otherwise, preserving the metadata-only contract.
    if (shouldRecordHistory) {
      useExecutionHistoryStore.getState().record({
        language,
        status: historyStatus,
        durationMs: result.executionTime ?? null,
        snapshot: snapshotPayloadFor(content, language),
        // RL-020 Slice 4 — anchor the entry to the source tab so the
        // per-tab pill can filter via `byTabId`.
        tabId: activeTab.id,
      });
    }

    // RL-065 — emit runner.executed so consenting users' telemetry
    // reflects runtime usage. `durationBucketMs` is already coarse
    // (from shared/telemetry), and the property allowlist rejects
    // anything beyond language/status/durationBucketMs.
    void trackEvent('runner.executed', {
      language,
      status: runStatus,
      durationBucketMs: bucketDurationMs(result.executionTime ?? 0),
    });
    // RL-020 Slice 6 fold C — same adoption signal as the auto-run
    // path. Both run surfaces share the same buffer and worker, so
    // the same gate applies (≥1 line consumed, JS / TS / Python).
    if (
      result.stdinConsumed &&
      result.stdinConsumed.count > 0 &&
      (language === 'javascript' ||
        language === 'typescript' ||
        language === 'python')
    ) {
      void trackEvent('runtime.stdin_used', { language });
    }

    return {
      mode: 'run',
      ok: !result.error,
      executionTime: result.executionTime,
      diagnosticsCount: diagnostics.length,
      message: result.error?.message ?? `Completed ${name}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // RL-020 Slice 7 — surface the failure via the pill too.
    setRunDeadlineAt(null);
    setRunTermination({ kind: 'error' });
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
        // RL-020 Slice 4 — same tabId anchor on the error path.
        tabId: activeTab.id,
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

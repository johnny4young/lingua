import { runnerManager } from '../runners';
import { useConsoleStore } from '../stores/consoleStore';
import { useExecutionHistoryStore } from '../stores/executionHistoryStore';
import { useResultStore } from '../stores/resultStore';
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

export interface ManualExecutionLifecycle {
  setIsRunning?: (value: boolean) => void;
  setIsInitializing?: (value: boolean) => void;
  setLoadingMessage?: (value: string | null) => void;
  setCurrentLanguage?: (language: Language | null) => void;
}

export interface ManualExecutionSummary {
  mode: 'run' | 'validate' | 'view';
  ok: boolean;
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
    setLineResults,
    setDiagnostics,
  } = useResultStore.getState();

  const { language, content, name } = activeTab;
  const executionMode = executionModeForLanguage(language);

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

    const result = await runner.execute(content);
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

    // RL-028 first slice — record metadata only (language + status +
    // duration), never the code, stdout, stderr, or file path.
    useExecutionHistoryStore.getState().record({
      language,
      status: result.error ? 'error' : 'ok',
      durationMs: result.executionTime ?? null,
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
    // error outcome. `durationMs: null` when timing never ran.
    useExecutionHistoryStore.getState().record({
      language,
      status: 'error',
      durationMs: null,
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
    lifecycle.setIsRunning?.(false);
    lifecycle.setIsInitializing?.(false);
    lifecycle.setLoadingMessage?.(null);
    lifecycle.setCurrentLanguage?.(null);
  }
}

import { useCallback, useRef, useState } from 'react';
import { runnerManager } from '../runners';
import { useEditorStore } from '../stores/editorStore';
import { useConsoleStore } from '../stores/consoleStore';
import { useResultStore } from '../stores/resultStore';
import type { EditorDiagnostic, Language } from '../types';
import {
  getCompilationLoadingMessage,
  getCompilationMessage,
  getInitializationMessage,
  toConsoleEntries,
} from './runnerOutput';
import { toExecutionPresentation } from '../utils/executionPresentation';
import { executionModeForLanguage } from '../utils/languageMeta';
import { validateDocument } from '../validation';

function toExecutionDiagnostics(language: Language, error: { message: string; line?: number; column?: number } | null): EditorDiagnostic[] {
  if (!error?.line) {
    return [];
  }

  return [
    {
      message: error.message,
      line: error.line,
      column: error.column,
      severity: 'error',
      source: language,
    },
  ];
}

export function useRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const currentLanguageRef = useRef<Language | null>(null);

  const run = useCallback(async () => {
    const { tabs, activeTabId } = useEditorStore.getState();
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

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) {
      addEntry({ type: 'error', content: 'No active file to run.' });
      return;
    }

    const { language, content, name } = activeTab;
    currentLanguageRef.current = language;
    const executionMode = executionModeForLanguage(language);

    if (executionMode === 'view') {
      clear();
      setExecutionSource('manual');
      setIsAutoRunning(false);
      addEntry({
        type: 'info',
        content: `${name} is editable, but Lingua does not run or lint this file type yet.`,
      });
      setFullOutput('This file type is editable only. Lingua will not execute or validate it yet.');
      return;
    }

    if (executionMode === 'validate') {
      clear();
      clearResults();
      setExecutionSource('manual');
      setIsAutoRunning(false);
      setIsRunning(true);
      addEntry({ type: 'info', content: `Validating ${name}...` });

      try {
        const validation = validateDocument(language, content);
        setDiagnostics(validation.diagnostics);
        setLineResults([]);
        setFullOutput(validation.fullOutput);
        setError(null);
        setExecutionTime(validation.executionTime);
        addEntry({
          type: validation.diagnostics.some((item) => item.severity === 'error') ? 'error' : 'info',
          content:
            validation.diagnostics.length === 0
              ? `Validation passed for ${name}.`
              : `Validation found ${validation.diagnostics.length} issue${validation.diagnostics.length === 1 ? '' : 's'} in ${name}.`,
          executionTime: validation.executionTime,
        });
      } finally {
        setIsRunning(false);
        currentLanguageRef.current = null;
      }
      return;
    }

    if (!runnerManager.isSupported(language)) {
      addEntry({
        type: 'error',
        content: `Runner for ${language} is not available yet. Coming in a future update.`,
      });
      return;
    }

    clear();
    clearResults();
    setExecutionSource('manual');
    setIsAutoRunning(false);
    setDiagnostics([]);
    addEntry({ type: 'info', content: `Running ${name}...` });
    setIsRunning(true);

    const shouldShowInitialization = runnerManager.needsInitialization(language);
    if (shouldShowInitialization) {
      setIsInitializing(true);
      const msg = getInitializationMessage(language);
      setLoadingMessage(msg);
      addEntry({ type: 'info', content: msg });
    }

    let runnerPrepared = false;

    try {
      const { runner } = await runnerManager.prepareRunner(language);
      if (!runner) {
        addEntry({ type: 'error', content: `Failed to initialize ${language} runner.` });
        return;
      }
      runnerPrepared = true;

      if (shouldShowInitialization) {
        setIsInitializing(false);
        setLoadingMessage(null);
      }

      const compilationLoadingMessage = getCompilationLoadingMessage(language);
      const compilationMessage = getCompilationMessage(language);
      if (compilationLoadingMessage && compilationMessage) {
        setLoadingMessage(compilationLoadingMessage);
        addEntry(compilationMessage);
      }

      const result = await runner.execute(content);

      const presentation = toExecutionPresentation(language, content, result);
      setLineResults(presentation.lineResults);
      setFullOutput(presentation.fullOutput);
      setError(result.error ?? null);
      setDiagnostics(toExecutionDiagnostics(language, result.error ?? null));
      setExecutionTime(result.executionTime);

      for (const entry of toConsoleEntries(result)) {
        addEntry(entry);
      }
    } catch (err) {
      if (!runnerPrepared) {
        setDiagnostics([]);
        setError({
          message: `Failed to initialize ${language} runner: ${err instanceof Error ? err.message : String(err)}`,
        });
        addEntry({
          type: 'error',
          content: `Failed to initialize ${language} runner: ${err instanceof Error ? err.message : String(err)}`,
        });
        return;
      }
      setDiagnostics([]);
      setError({
        message: err instanceof Error ? err.message : String(err),
      });
      addEntry({
        type: 'error',
        content: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsRunning(false);
      setIsInitializing(false);
      setLoadingMessage(null);
      currentLanguageRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (currentLanguageRef.current) {
      runnerManager.stop(currentLanguageRef.current);
    }
    setIsRunning(false);
    setLoadingMessage(null);
    useConsoleStore.getState().addEntry({
      type: 'warn',
      content: 'Execution stopped by user.',
    });
  }, []);

  return { run, stop, isRunning, isInitializing, loadingMessage };
}

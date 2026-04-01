import { useCallback, useRef, useState } from 'react';
import { runnerManager } from '../runners';
import { useEditorStore } from '../stores/editorStore';
import { useConsoleStore } from '../stores/consoleStore';
import type { Language } from '../types';

export function useRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const currentLanguageRef = useRef<Language | null>(null);

  const run = useCallback(async () => {
    const { tabs, activeTabId } = useEditorStore.getState();
    const { addEntry, clear } = useConsoleStore.getState();

    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) {
      addEntry({ type: 'error', content: 'No active file to run.' });
      return;
    }

    const { language, content, name } = activeTab;
    currentLanguageRef.current = language;

    if (!runnerManager.isSupported(language)) {
      addEntry({
        type: 'error',
        content: `Runner for ${language} is not available yet. Coming in a future update.`,
      });
      return;
    }

    clear();
    addEntry({ type: 'info', content: `Running ${name}...` });
    setIsRunning(true);

    // Initialize runner if needed
    const runner = await runnerManager.getRunner(language);
    if (!runner) {
      addEntry({ type: 'error', content: `Failed to initialize ${language} runner.` });
      setIsRunning(false);
      return;
    }

    if (!runner.isReady()) {
      setIsInitializing(true);
      try {
        await runner.init();
      } catch (err) {
        addEntry({
          type: 'error',
          content: `Failed to initialize ${language} runner: ${err instanceof Error ? err.message : String(err)}`,
        });
        setIsRunning(false);
        setIsInitializing(false);
        return;
      }
      setIsInitializing(false);
    }

    try {
      const result = await runnerManager.execute(language, content);

      // Add stdout entries
      for (const output of result.stdout) {
        addEntry({
          type: output.type,
          content: output.args.join(' '),
          line: output.line,
        });
      }

      // Add stderr entries
      for (const output of result.stderr) {
        addEntry({
          type: output.type,
          content: output.args.join(' '),
          line: output.line,
        });
      }

      // Add return value if present
      if (result.result !== undefined) {
        addEntry({
          type: 'result',
          content: String(result.result),
        });
      }

      // Add error if present
      if (result.error) {
        const location =
          result.error.line !== undefined
            ? ` (line ${result.error.line}${result.error.column !== undefined ? `:${result.error.column}` : ''})`
            : '';
        addEntry({
          type: 'error',
          content: `${result.error.message}${location}`,
        });
      }

      // Add execution time
      addEntry({
        type: 'info',
        content: `Completed in ${result.executionTime.toFixed(1)}ms`,
      });
    } catch (err) {
      addEntry({
        type: 'error',
        content: `Unexpected error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      setIsRunning(false);
      currentLanguageRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    if (currentLanguageRef.current) {
      runnerManager.stop(currentLanguageRef.current);
    }
    setIsRunning(false);
    useConsoleStore.getState().addEntry({
      type: 'warn',
      content: 'Execution stopped by user.',
    });
  }, []);

  return { run, stop, isRunning, isInitializing };
}

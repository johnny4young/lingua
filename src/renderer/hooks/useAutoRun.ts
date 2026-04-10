import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import { runnerManager } from '../runners';
import type { ExecutionResult } from '../types';
import { toExecutionPresentation } from '../utils/executionPresentation';

const DEBOUNCE_MS = 2000;
/**
 * Auto-run the active tab's code after a 2-second pause in typing.
 * For dynamic languages: captures per-line results.
 * For compiled languages: captures full output.
 */
export function useAutoRun() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);
  const lastCodeRef = useRef('');

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const activeTab = useEditorStore((s) => {
    return s.tabs.find((t) => t.id === s.activeTabId) ?? null;
  });

  const code = activeTab?.content ?? '';
  const language = activeTab?.language ?? 'javascript';

  useEffect(() => {
    // Skip if no tab or empty code
    if (!activeTab || !code.trim()) {
      useResultStore.getState().clear();
      return;
    }

    // Skip if code didn't change
    if (code === lastCodeRef.current) return;

    // Cancel any pending execution
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    abortRef.current = true;

    timerRef.current = setTimeout(async () => {
      lastCodeRef.current = code;
      abortRef.current = false;

      const { clear, setLineResults, setFullOutput, setError, setExecutionTime, setIsAutoRunning } =
        useResultStore.getState();

      // Check if language is supported
      if (!runnerManager.isSupported(language)) {
        clear();
        return;
      }

      setIsAutoRunning(true);
      clear();

      try {
        const { runner } = await runnerManager.prepareRunner(language);
        if (!runner || abortRef.current) {
          setIsAutoRunning(false);
          return;
        }

        const result: ExecutionResult = await runner.execute(code);

        // If another execution was triggered while we were running, discard
        if (abortRef.current) {
          setIsAutoRunning(false);
          return;
        }

        const presentation = toExecutionPresentation(language, code, result);
        setLineResults(presentation.lineResults);
        setFullOutput(presentation.fullOutput);

        if (result.error) {
          setError(result.error);
        }
        setExecutionTime(result.executionTime);
      } catch (err) {
        if (!abortRef.current) {
          setError({
            message: err instanceof Error ? err.message : String(err),
          });
        }
      } finally {
        if (!abortRef.current) {
          setIsAutoRunning(false);
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [code, language, activeTab, activeTabId]);

  // Clear results when switching tabs
  useEffect(() => {
    lastCodeRef.current = '';
    useResultStore.getState().clear();
  }, [activeTabId]);
}

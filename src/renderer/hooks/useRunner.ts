import { useCallback, useRef, useState } from 'react';
import { executeTabManually } from '../runtime/executeTabManually';
import { runnerManager } from '../runners';
import { useConsoleStore } from '../stores/consoleStore';
import { useEditorStore } from '../stores/editorStore';
import type { Language } from '../types';

export function useRunner() {
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const currentLanguageRef = useRef<Language | null>(null);

  const run = useCallback(async () => {
    const { tabs, activeTabId } = useEditorStore.getState();
    const activeTab = tabs.find((tab) => tab.id === activeTabId);

    if (!activeTab) {
      useConsoleStore.getState().addEntry({
        type: 'error',
        content: 'No active file to run.',
      });
      return;
    }

    await executeTabManually(activeTab, {
      setIsRunning,
      setIsInitializing,
      setLoadingMessage,
      setCurrentLanguage: (language) => {
        currentLanguageRef.current = language;
      },
    });
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

import { useCallback, useRef, useState } from 'react';
import i18next from 'i18next';
import { executeTabManually } from '../runtime/executeTabManually';
import { runnerManager } from '../runners';
import { useConsoleStore } from '../stores/consoleStore';
import { useEditorStore } from '../stores/editorStore';
import type { Language } from '../types';
import { currentEffectiveTier } from './useEntitlement';
import { isLanguageAllowed } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { trackEvent } from '../utils/telemetry';

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

    if (!isLanguageAllowed(currentEffectiveTier(), activeTab.language)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraLanguages'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'languages-extended',
        tier: currentEffectiveTier(),
      });
      return;
    }

    // RL-070 — flip the per-tab status to running so the EditorTabs
    // dot becomes a spinner. Reset back to success / error / idle in
    // the lifecycle wrapper below.
    const editor = useEditorStore.getState();
    editor.setTabExecutionState(activeTab.id, 'running');

    try {
      const summary = await executeTabManually(activeTab, {
        setIsRunning,
        setIsInitializing,
        setLoadingMessage,
        setCurrentLanguage: (language) => {
          currentLanguageRef.current = language;
        },
      });
      // The execution summary is the canonical run outcome. Avoid
      // scanning the console store here: future console retention or
      // unrelated error entries should not be able to mark this tab red
      // after a successful run.
      if (!summary.ok) {
        editor.setTabExecutionState(activeTab.id, 'error', oneLineTooltip(summary.message));
      } else {
        editor.setTabExecutionState(activeTab.id, 'success');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      editor.setTabExecutionState(activeTab.id, 'error', oneLineTooltip(message));
      throw err;
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

function oneLineTooltip(message: string): string | null {
  const firstLine = message.split('\n')[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine.slice(0, 160) : null;
}

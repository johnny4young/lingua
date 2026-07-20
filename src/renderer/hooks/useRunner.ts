import { useCallback, useRef, useState } from 'react';
import i18next from 'i18next';
import {
  executeTabManually,
  type ManualExecutionSummary,
} from '../runtime/executeTabManually';
import { runnerManager } from '../runners';
import { announce } from '../stores/announcerStore';
import { useConsoleStore } from '../stores/consoleStore';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useNativeExecutionGateStore } from '../stores/nativeExecutionGateStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import type { Language } from '../types';
import type { RuntimeMode } from '../../shared/runtimeModes';
import { currentEffectiveTier } from './useEntitlement';
import { isLanguageAllowed } from '../../shared/entitlements';
import { requiresNativeExecutionAcknowledgement } from '../utils/nativeExecution';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { useTelemetry } from './useTelemetry';

export interface RunOptions {
  recordHistory?: boolean;
  debug?: boolean;
}

export function useRunner() {
  const { track } = useTelemetry();
  const [isRunning, setIsRunning] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState<string | null>(null);
  const [runMode, setRunMode] = useState<'run' | 'debug' | null>(null);
  const currentLanguageRef = useRef<Language | null>(null);
  // implementation — track the runtime mode that started the run so
  // `stop()` can route to the right runner (browser-preview runs
  // through BrowserPreviewRunner, not the language Worker).
  const currentRuntimeModeRef = useRef<RuntimeMode | undefined>(undefined);

  const executeTabById = useCallback(async (tabId: string, options: RunOptions = {}) => {
    const { tabs } = useEditorStore.getState();
    const activeTab = tabs.find((tab) => tab.id === tabId);

    if (!activeTab) {
      useConsoleStore.getState().addEntry({
        type: 'error',
        content: 'No active file to run.',
      });
      return;
    }

    if (activeTab.kind === 'notebook') {
      pushNotebookRunNotice();
      return;
    }

    if (!isLanguageAllowed(currentEffectiveTier(), activeTab.language)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraLanguages'),
      });
      track('feature.blocked', {
        entitlement: 'languages-extended',
        tier: currentEffectiveTier(),
      });
      return;
    }

    // internal — flip the per-tab status to running so the EditorTabs
    // dot becomes a spinner. Reset back to success / error / idle in
    // the lifecycle wrapper below.
    const editor = useEditorStore.getState();
    editor.setTabExecutionState(activeTab.id, 'running');
    setRunMode(options.debug ? 'debug' : 'run');
    if (options.debug) {
      useUIStore.getState().openBottomPanel('debugger');
    }

    try {
      const summary = await executeTabManually(activeTab, {
        setIsRunning,
        setIsInitializing,
        setLoadingMessage,
        setCurrentLanguage: (language) => {
          currentLanguageRef.current = language;
          // implementation — capture the runtime mode at the start
          // of the run so `stop()` can route to the right runner.
          // Reset alongside language on lifecycle teardown.
          currentRuntimeModeRef.current = language ? activeTab.runtimeMode : undefined;
        },
        recordHistory: options.recordHistory,
        debug: options.debug,
      });
      // The execution summary is the canonical run outcome. Avoid
      // scanning the console store here: future console retention or
      // unrelated error entries should not be able to mark this tab red
      // after a successful run.
      if (summary.cancelled) {
        editor.setTabExecutionState(activeTab.id, 'idle');
      } else if (!summary.ok) {
        editor.setTabExecutionState(activeTab.id, 'error', oneLineTooltip(summary.message));
      } else {
        editor.setTabExecutionState(activeTab.id, 'success');
      }
      // accessibility pass — console output is silent to screen readers. Announce a
      // single coalesced run summary (not one message per line) via the shared
      // live region, mirroring the notebook / HTTP / SQL run announcements.
      announceRunSummary(summary);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      editor.setTabExecutionState(activeTab.id, 'error', oneLineTooltip(message));
      announce(i18next.t('console.run.announce.error'));
      throw err;
    } finally {
      setRunMode(null);
    }
  }, [track]);

  const run = useCallback(async (options: RunOptions = {}) => {
    const activeTab = getActiveTab(useEditorStore.getState());

    if (!activeTab) {
      useConsoleStore.getState().addEntry({
        type: 'error',
        content: 'No active file to run.',
      });
      return;
    }

    if (activeTab.kind === 'notebook') {
      pushNotebookRunNotice();
      return;
    }

    if (!isLanguageAllowed(currentEffectiveTier(), activeTab.language)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraLanguages'),
      });
      track('feature.blocked', {
        entitlement: 'languages-extended',
        tier: currentEffectiveTier(),
      });
      return;
    }

    // internal — gate the first Go/Rust/system-Ruby run behind the
    // trust-boundary modal. The gate store opens the modal mounted at
    // App level; the modal flips the persisted flag, then invokes the
    // resume callback registered here for the same tab.
    const settings = useSettingsStore.getState();
    const nativeExecutionNeedsAcknowledgement =
      requiresNativeExecutionAcknowledgement(activeTab.language, {
        rubyRuntimePreference: settings.rubyRuntimePreference,
        rubyBridgeAvailable:
          typeof window !== 'undefined' && window.lingua?.ruby !== undefined,
      });
    if (
      nativeExecutionNeedsAcknowledgement &&
      !settings.nativeExecutionAcknowledged
    ) {
      useNativeExecutionGateStore.getState().request(activeTab.language, () => {
        void executeTabById(activeTab.id, options);
      });
      return;
    }

    await executeTabById(activeTab.id, options);
  }, [executeTabById, track]);

  const stop = useCallback(() => {
    if (currentLanguageRef.current) {
      runnerManager.stop(currentLanguageRef.current, currentRuntimeModeRef.current);
    }
    setIsRunning(false);
    setLoadingMessage(null);
  }, []);

  return { run, stop, isRunning, isInitializing, loadingMessage, runMode };
}

function oneLineTooltip(message: string): string | null {
  const firstLine = message.split('\n')[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine.slice(0, 160) : null;
}

/**
 * accessibility pass — coalesced screen-reader summary for a finished run. Only
 * explicit `run`-mode executions announce, so scratchpad live-eval (`view`)
 * cannot spam the live region. Resolved off the global i18next instance so
 * this stays callable from the non-render run path.
 */
function announceRunSummary(summary: ManualExecutionSummary): void {
  if (summary.mode !== 'run') return;
  if (summary.cancelled) {
    announce(i18next.t('console.run.announce.stopped'));
    return;
  }
  if (!summary.ok) {
    announce(i18next.t('console.run.announce.error'));
    return;
  }
  const outputCount =
    summary.consoleEntryCount ?? useConsoleStore.getState().entries.length;
  announce(i18next.t('console.run.announce.ok', { count: outputCount }));
}

function pushNotebookRunNotice(): void {
  useUIStore.getState().pushStatusNotice({
    tone: 'info',
    messageKey: 'notebook.notice.useNotebookToolbar',
  });
}

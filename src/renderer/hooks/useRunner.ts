import { useCallback } from 'react';
import i18next from 'i18next';
import type { ManualExecutionSummary } from '../runtime/executeTabManually';
import { announce } from '../stores/announcerStore';
import { useConsoleStore } from '../stores/consoleStore';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useNativeExecutionGateStore } from '../stores/nativeExecutionGateStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
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
  const isRunning = useResultStore((state) => state.isManualRunning);
  const isInitializing = useResultStore(
    (state) => state.isManualInitializing
  );
  const loadingMessage = useResultStore(
    (state) => state.manualLoadingMessage
  );
  const runMode = useResultStore((state) => state.manualRunMode);

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

    // Every shell control shares this store. Refuse a second dispatch while
    // another surface already owns the active manual execution.
    if (useResultStore.getState().isManualRunning) {
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
    const resultState = useResultStore.getState();
    editor.setTabExecutionState(activeTab.id, 'running');
    resultState.setIsManualRunning(true);
    resultState.setManualRunMode(options.debug ? 'debug' : 'run');
    resultState.setManualExecutionTarget({
      language: activeTab.language,
      ...(activeTab.runtimeMode
        ? { runtimeMode: activeTab.runtimeMode }
        : {}),
    });
    if (options.debug) {
      useUIStore.getState().openBottomPanel('debugger');
    }

    try {
      const { executeTabManually } = await import(
        '../runtime/executeTabManually'
      );
      // Stop can be pressed while this on-demand chunk is still loading.
      // Honor that intent before runner preparation starts.
      if (!useResultStore.getState().isManualRunning) {
        editor.setTabExecutionState(activeTab.id, 'idle');
        return;
      }
      const summary = await executeTabManually(activeTab, {
        setIsRunning: resultState.setIsManualRunning,
        setIsInitializing: resultState.setIsManualInitializing,
        setLoadingMessage: resultState.setManualLoadingMessage,
        setCurrentLanguage: (language) => {
          resultState.setManualExecutionTarget(
            language
              ? {
                  language,
                  ...(activeTab.runtimeMode
                    ? { runtimeMode: activeTab.runtimeMode }
                    : {}),
                }
              : null
          );
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
      const currentResultState = useResultStore.getState();
      currentResultState.setIsManualRunning(false);
      currentResultState.setManualRunMode(null);
      currentResultState.setManualExecutionTarget(null);
      currentResultState.setIsManualInitializing(false);
      currentResultState.setManualLoadingMessage(null);
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
    const resultState = useResultStore.getState();
    const target = resultState.manualExecutionTarget;
    if (target) {
      void import('../runners')
        .then(({ runnerManager }) => {
          runnerManager.stop(target.language, target.runtimeMode);
        })
        .catch(() => {
          // Best-effort while the execution chunk itself is still loading.
          // The local lifecycle is cleared below even if loading failed.
        });
    }
    resultState.setIsManualRunning(false);
    resultState.setIsManualInitializing(false);
    resultState.setManualLoadingMessage(null);
    resultState.setManualRunMode(null);
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

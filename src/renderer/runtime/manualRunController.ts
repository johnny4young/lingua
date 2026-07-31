import i18next from 'i18next';
import { isLanguageAllowed } from '../../shared/entitlements';
import { announce } from '../stores/announcerStore';
import { useConsoleStore } from '../stores/consoleStore';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { currentEffectiveTier } from '../stores/licenseSelectors';
import { useNativeExecutionGateStore } from '../stores/nativeExecutionGateStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useUIStore } from '../stores/uiStore';
import type { RunOptions } from '../hooks/useRunner';
import type { TelemetryTrack } from '../hooks/useTelemetry';
import { requiresNativeExecutionAcknowledgement } from '../utils/nativeExecution';
import { pushUpsellNotice } from '../utils/upsellNotice';
import type { ManualExecutionSummary } from './executeTabManually';

export async function runActiveTab(track: TelemetryTrack, options: RunOptions = {}): Promise<void> {
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

  const tier = currentEffectiveTier();
  if (!isLanguageAllowed(tier, activeTab.language)) {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: i18next.t('upsell.feature.extraLanguages'),
    });
    track('feature.blocked', {
      entitlement: 'languages-extended',
      tier,
    });
    return;
  }

  // Gate the first Go/Rust/system-Ruby run behind the trust-boundary
  // modal. The resume callback targets the same tab even if the user
  // changes selection while acknowledging.
  const settings = useSettingsStore.getState();
  const needsAcknowledgement = requiresNativeExecutionAcknowledgement(activeTab.language, {
    rubyRuntimePreference: settings.rubyRuntimePreference,
    rubyBridgeAvailable: typeof window !== 'undefined' && window.lingua?.ruby !== undefined,
  });
  if (needsAcknowledgement && !settings.nativeExecutionAcknowledged) {
    useNativeExecutionGateStore.getState().request(activeTab.language, () => {
      void executeTabById(activeTab.id, options, track);
    });
    return;
  }

  await executeTabById(activeTab.id, options, track);
}

async function executeTabById(
  tabId: string,
  options: RunOptions,
  track: TelemetryTrack
): Promise<void> {
  const { tabs } = useEditorStore.getState();
  const activeTab = tabs.find(tab => tab.id === tabId);

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

  const tier = currentEffectiveTier();
  if (!isLanguageAllowed(tier, activeTab.language)) {
    pushUpsellNotice({
      messageKey: 'upsell.freeCeilingReached',
      featureLabel: i18next.t('upsell.feature.extraLanguages'),
    });
    track('feature.blocked', {
      entitlement: 'languages-extended',
      tier,
    });
    return;
  }

  // Flip the per-tab status before loading the execution implementation so
  // every shell control exposes Stop during runner preparation.
  const editor = useEditorStore.getState();
  const resultState = useResultStore.getState();
  editor.setTabExecutionState(activeTab.id, 'running');
  resultState.setIsManualRunning(true);
  resultState.setManualRunMode(options.debug ? 'debug' : 'run');
  resultState.setManualExecutionTarget({
    language: activeTab.language,
    ...(activeTab.runtimeMode ? { runtimeMode: activeTab.runtimeMode } : {}),
  });
  if (options.debug) {
    useUIStore.getState().openBottomPanel('debugger');
  }

  try {
    const { executeTabManually } = await import('./executeTabManually');
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
      setCurrentLanguage: language => {
        resultState.setManualExecutionTarget(
          language
            ? {
                language,
                ...(activeTab.runtimeMode ? { runtimeMode: activeTab.runtimeMode } : {}),
              }
            : null
        );
      },
      recordHistory: options.recordHistory,
      debug: options.debug,
    });
    if (summary.cancelled) {
      editor.setTabExecutionState(activeTab.id, 'idle');
    } else if (!summary.ok) {
      editor.setTabExecutionState(activeTab.id, 'error', oneLineTooltip(summary.message));
    } else {
      editor.setTabExecutionState(activeTab.id, 'success');
    }
    announceRunSummary(summary);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    editor.setTabExecutionState(activeTab.id, 'error', oneLineTooltip(message));
    announce(i18next.t('console.run.announce.error'));
    throw error;
  } finally {
    const currentResultState = useResultStore.getState();
    currentResultState.setIsManualRunning(false);
    currentResultState.setManualRunMode(null);
    currentResultState.setManualExecutionTarget(null);
    currentResultState.setIsManualInitializing(false);
    currentResultState.setManualLoadingMessage(null);
  }
}

function oneLineTooltip(message: string): string | null {
  const firstLine = message.split('\n')[0]?.trim();
  return firstLine && firstLine.length > 0 ? firstLine.slice(0, 160) : null;
}

/**
 * Console output is silent to screen readers, so explicit runs announce one
 * coalesced result instead of one message per line.
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
  const outputCount = summary.consoleEntryCount ?? useConsoleStore.getState().entries.length;
  announce(i18next.t('console.run.announce.ok', { count: outputCount }));
}

function pushNotebookRunNotice(): void {
  useUIStore.getState().pushStatusNotice({
    tone: 'info',
    messageKey: 'notebook.notice.useNotebookToolbar',
  });
}

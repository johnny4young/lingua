import { useEffect, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultWorkflowMode } from '../../shared/workflowMode';
import { runPolicyDelayMs } from '../../shared/runPolicy';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { runInputKey, useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatRelativeTime } from '../utils/timeLabels';
import { resolveAutoRunSchedule } from './autoRunModel';

export interface RunStale {
  stale: boolean;
  ranAt: number | null;
}

const CURRENT: RunStale = { stale: false, ranAt: null };

/**
 * With Run state on, the visible results are stale once the editor no longer
 * holds the code, stdin or arguments they ran from. A Scratchpad that runs on its own is only
 * stale while an incomplete edit keeps it from running.
 */
export function useRunStale(): RunStale {
  const on = useSettingsStore(state => state.featureFlags.runState === true);
  const policies = useSettingsStore(state => state.runPolicyByGroup);
  const previewRefresh = useSettingsStore(state => state.browserPreviewRefreshIntervalMs);
  const ranCode = useResultStore(state => state.ranCode);
  const hasResults = useResultStore(state => state.lineResults.length > 0 || state.fullOutput !== '' || state.error !== null);
  const running = useResultStore(state => state.isManualRunning || state.isAutoRunning);
  const gated = useResultStore(state => state.autoRunGateReason === 'incomplete');
  const tab = useEditorStore(state => getActiveTab(state));

  if (!on || !tab || !ranCode || ranCode.tabId !== tab.id || !hasResults || running) return CURRENT;
  if (tab.content === ranCode.code && runInputKey(tab.stdinBuffer, tab.inputArgs) === ranCode.input) return CURRENT;
  const workflowMode = tab.workflowMode ?? defaultWorkflowMode(tab.language);
  const schedule = resolveAutoRunSchedule(tab.runtimeMode, tab.content, previewRefresh, runPolicyDelayMs(tab.language, policies));
  const runsItself = workflowMode === 'scratchpad' && schedule.debounceMs !== null;
  if (runsItself && !gated) return CURRENT;
  return { stale: true, ranAt: ranCode.at };
}

/**
 * Writes " · 12 sec. ago" to the node's `--run-stale-age` every 5 s while the
 * results are stale, without re-rendering the editor.
 */
export function useRunStaleAgeProperty(ref: RefObject<HTMLElement | null>, ranAt: number | null): void {
  const { i18n } = useTranslation();
  useEffect(() => {
    const node = ref.current;
    if (!node || ranAt === null) return;
    const paint = () =>
      node.style.setProperty(
        '--run-stale-age',
        JSON.stringify(` · ${formatRelativeTime(ranAt, Math.max(Date.now(), ranAt), i18n.language)}`)
      );
    paint();
    const timer = setInterval(paint, 5_000);
    return () => {
      clearInterval(timer);
      node.style.removeProperty('--run-stale-age');
    };
  }, [ref, ranAt, i18n.language]);
}

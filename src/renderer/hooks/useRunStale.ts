import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultWorkflowMode } from '../../shared/workflowMode';
import { runPolicyDelayMs } from '../../shared/runPolicy';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { formatRelativeTime } from '../utils/timeLabels';

export interface RunStale {
  stale: boolean;
  ranAt: number | null;
}

const CURRENT: RunStale = { stale: false, ranAt: null };

/**
 * With Run state on, the visible results are stale once the editor no longer
 * holds the code they ran from. A Scratchpad that runs on its own is only
 * stale while an incomplete edit keeps it from running.
 */
export function useRunStale(): RunStale {
  const on = useSettingsStore(state => state.featureFlags.runState === true);
  const policies = useSettingsStore(state => state.runPolicyByGroup);
  const ranCode = useResultStore(state => state.ranCode);
  const hasResults = useResultStore(state => state.lineResults.length > 0 || state.fullOutput !== '' || state.error !== null);
  const running = useResultStore(state => state.isManualRunning || state.isAutoRunning);
  const gated = useResultStore(state => state.autoRunGateReason === 'incomplete');
  const tab = useEditorStore(state => getActiveTab(state));

  if (!on || !tab || !ranCode || ranCode.tabId !== tab.id || !hasResults || running || tab.content === ranCode.code) {
    return CURRENT;
  }
  const workflowMode = tab.workflowMode ?? defaultWorkflowMode(tab.language);
  const runsItself = workflowMode === 'scratchpad' && runPolicyDelayMs(tab.language, policies) !== null;
  if (runsItself && !gated) return CURRENT;
  return { stale: true, ranAt: ranCode.at };
}

/** "12 sec. ago" for stale results, refreshed every 5 s while shown. */
export function useRunStaleAge(ranAt: number | null): string | null {
  const { i18n } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (ranAt === null) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [ranAt]);
  return ranAt === null ? null : formatRelativeTime(ranAt, Math.max(now, ranAt), i18n.language);
}

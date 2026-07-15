import { useEffect, useRef } from 'react';
import { defaultWorkflowMode } from '../../shared/workflowMode';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useResultStore } from '../stores/resultStore';
import { useSettingsStore } from '../stores/settingsStore';
import { runnerManager } from '../runners';
import { executeAutoRun } from './autoRunExecution';
import { useTelemetry } from './useTelemetry';
import {
  isSameAutoRunInput,
  resolveAutoLogEnabled,
  resolveAutoRunSchedule,
  type AutoRunInput,
} from './autoRunModel';

export {
  AUTO_RUN_DEBOUNCE_MS,
  bucketAutoLogCount,
  type AutoLogCountBucket,
} from './autoRunModel';

/** Auto-run the active Scratchpad after its runtime-specific typing pause. */
export function useAutoRun() {
  const { track } = useTelemetry();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef(false);
  const runTokenRef = useRef(0);
  const lastRunInputRef = useRef<AutoRunInput | null>(null);

  const activeTabId = useEditorStore((state) => state.activeTabId);
  const activeTab = useEditorStore((state) => getActiveTab(state));
  const autoLogByLanguage = useSettingsStore(
    (state) => state.scratchpadAutoLogByLanguage
  );
  const browserPreviewRefreshPreference = useSettingsStore(
    (state) => state.browserPreviewRefreshIntervalMs
  );

  const code = activeTab?.content ?? '';
  const language = activeTab?.language ?? 'javascript';
  const runtimeMode = activeTab?.runtimeMode;
  const workflowMode =
    activeTab?.workflowMode ?? defaultWorkflowMode(language);
  const autoLogEnabled = resolveAutoLogEnabled(
    language,
    workflowMode,
    activeTab?.autoLogEnabled,
    autoLogByLanguage
  );
  const stdinBuffer = activeTab?.stdinBuffer;
  const autoRunSchedule = resolveAutoRunSchedule(
    runtimeMode,
    code,
    browserPreviewRefreshPreference
  );

  useEffect(() => {
    // Run and Debug are manual workflows. Invalidate scheduled or in-flight
    // work without clearing the user's last manual result.
    if (workflowMode !== 'scratchpad') {
      cancelTimer(timerRef);
      abortRef.current = true;
      runTokenRef.current += 1;
      lastRunInputRef.current = null;

      const resultState = useResultStore.getState();
      if (resultState.isAutoRunning) {
        resultState.setIsAutoRunning(false);
      }
      if (resultState.autoRunGateReason !== null) {
        resultState.setAutoRunGateReason(null);
      }
      if (resultState.executionSource === 'auto') {
        resultState.setExecutionSource(null);
      }
      return;
    }

    if (!activeTab || !code.trim()) {
      runTokenRef.current += 1;
      abortRef.current = true;
      lastRunInputRef.current = null;
      useResultStore.getState().setIsAutoRunning(false);
      // Preserve the last successful snapshot through an empty-buffer transit.
      useResultStore.getState().clearVisibleResults();
      return;
    }

    // RL-119 — Off is a real scheduling mode, not a large timeout. Cancel a
    // pending/in-flight silent preview without touching the last visible DOM
    // or result so manual Run remains the only refresh path.
    if (autoRunSchedule.debounceMs === null) {
      cancelTimer(timerRef);
      abortRef.current = true;
      runTokenRef.current += 1;
      lastRunInputRef.current = null;
      const resultState = useResultStore.getState();
      if (
        resultState.isAutoRunning &&
        resultState.executionSource === 'auto' &&
        runtimeMode === 'browser-preview'
      ) {
        runnerManager.stop(language, runtimeMode);
      }
      resultState.setIsAutoRunning(false);
      resultState.setAutoRunGateReason(null);
      if (resultState.executionSource === 'auto') {
        resultState.setExecutionSource(null);
      }
      return;
    }

    const input: AutoRunInput = {
      code,
      language,
      runtimeMode,
      workflowMode,
      autoLogEnabled,
      browserPreviewRefreshIntervalMs:
        autoRunSchedule.browserPreviewRefreshIntervalMs,
      stdinBuffer,
    };
    if (isSameAutoRunInput(lastRunInputRef.current, input)) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current = true;
    const runToken = runTokenRef.current + 1;
    runTokenRef.current = runToken;

    timerRef.current = setTimeout(async () => {
      const isRunStale = () =>
        abortRef.current ||
        runToken !== runTokenRef.current ||
        useResultStore.getState().isManualRunning;
      const shouldDiscard = () =>
        isRunStale() ||
        useResultStore.getState().executionSource !== 'auto';
      const finish = () => {
        if (runToken === runTokenRef.current && !abortRef.current) {
          useResultStore.getState().setIsAutoRunning(false);
        }
      };

      if (
        runToken !== runTokenRef.current ||
        useResultStore.getState().isManualRunning
      ) {
        return;
      }

      lastRunInputRef.current = input;
      abortRef.current = false;
      await executeAutoRun({
        input,
        activeTab,
        activeTabId,
        shouldDiscard,
        finish,
        track,
      });
    }, autoRunSchedule.debounceMs);

    return () => {
      cancelTimer(timerRef);
      abortRef.current = true;
      runTokenRef.current += 1;
      const resultState = useResultStore.getState();
      if (
        runtimeMode === 'browser-preview' &&
        resultState.isAutoRunning &&
        resultState.executionSource === 'auto'
      ) {
        runnerManager.stop(language, runtimeMode);
        resultState.setIsAutoRunning(false);
        resultState.setExecutionSource(null);
      }
    };
  }, [
    code,
    language,
    runtimeMode,
    workflowMode,
    autoLogEnabled,
    autoRunSchedule.debounceMs,
    autoRunSchedule.browserPreviewRefreshIntervalMs,
    stdinBuffer,
    activeTab,
    activeTabId,
    track,
  ]);

  useEffect(() => {
    lastRunInputRef.current = null;
    useResultStore.getState().clear();
  }, [activeTabId]);
}

function cancelTimer(
  timerRef: { current: ReturnType<typeof setTimeout> | null }
): void {
  if (!timerRef.current) return;
  clearTimeout(timerRef.current);
  timerRef.current = null;
}

import { useCallback } from 'react';
import { useResultStore } from '../stores/resultStore';
import { useUIStore } from '../stores/uiStore';
import { loadManualRunController } from './manualRunControllerLoader';
import { useTelemetry } from './useTelemetry';

export interface RunOptions {
  recordHistory?: boolean;
  debug?: boolean;
}

export function useRunner() {
  const { track } = useTelemetry();
  const isRunning = useResultStore(state => state.isManualRunning);
  const isInitializing = useResultStore(state => state.isManualInitializing);
  const loadingMessage = useResultStore(state => state.manualLoadingMessage);
  const runMode = useResultStore(state => state.manualRunMode);

  const run = useCallback(
    async (options: RunOptions = {}) => {
      let controller: Awaited<ReturnType<typeof loadManualRunController>>;
      try {
        controller = await loadManualRunController();
      } catch {
        useUIStore.getState().pushStatusNotice({
          tone: 'error',
          messageKey: 'runtime.manualRun.loadFailed',
        });
        return;
      }
      await controller.runActiveTab(track, options);
    },
    [track]
  );

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

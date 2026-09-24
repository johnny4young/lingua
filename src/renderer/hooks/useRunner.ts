import { useCallback } from 'react';
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { beginManualRun } from '../runtime/manualRunSession';
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
      const session = beginManualRun(
        getActiveTab(useEditorStore.getState()) ?? undefined,
        options.debug
      );
      if (!session) return;
      try {
        let controller: Awaited<ReturnType<typeof loadManualRunController>>;
        try {
          controller = await loadManualRunController();
        } catch {
          if (session.isCurrent()) {
            useUIStore.getState().pushStatusNotice({
              tone: 'error',
              messageKey: 'runtime.manualRun.loadFailed',
            });
          }
          return;
        }
        if (session.isCurrent()) await controller.runActiveTab(track, options, session);
      } finally {
        session.finish();
      }
    },
    [track]
  );

  const stop = useCallback(() => {
    useResultStore.getState().manualRunSession?.cancel();
  }, []);

  return { run, stop, isRunning, isInitializing, loadingMessage, runMode };
}

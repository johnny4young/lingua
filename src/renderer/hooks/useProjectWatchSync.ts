import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';
import {
  clearWatchChangeBatch,
  createWatchChangeBatch,
  PROJECT_WATCH_REFRESH_DEBOUNCE_MS,
  queueWatchChange,
  takeWatchChanges,
} from './projectWatchModel';
import {
  clearReloadBatchState,
  createReloadBatchState,
  scheduleReloadNotice,
} from './projectWatchReload';
import { collectLoadedDirs, maybePushStaleTabNotice } from './projectWatchTree';

export { PROJECT_WATCH_REFRESH_DEBOUNCE_MS } from './projectWatchModel';

/** Subscribe to project filesystem events and coalesce renderer refresh work. */
export function useProjectWatchSync(): void {
  const refreshTimerRef = useRef<number | null>(null);
  const lastStaleNoticeAtRef = useRef(0);
  const activeRootIdRef = useRef<string | null>(null);
  const reloadBatchRef = useRef(createReloadBatchState());
  const watchChangeBatchRef = useRef(createWatchChangeBatch());

  useEffect(() => {
    const unsubscribe = window.lingua.fs.onChanged(event => {
      const { currentProject } = useProjectStore.getState();
      if (!currentProject || event.rootId !== currentProject.rootId) return;

      scheduleReloadNotice(event, reloadBatchRef);
      queueWatchChange(watchChangeBatchRef.current, event);

      if (refreshTimerRef.current !== null) window.clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = window.setTimeout(async () => {
        refreshTimerRef.current = null;
        const { currentProject: activeProject, applyWatchChanges } =
          useProjectStore.getState();
        const changes = takeWatchChanges(
          watchChangeBatchRef.current,
          activeProject?.rootId ?? null
        );
        if (!activeProject || !changes) return;

        const previousTree = {
          rootId: activeProject.rootId,
          loadedDirs: collectLoadedDirs(useProjectStore.getState().nodes),
        };
        try {
          await applyWatchChanges(changes);
        } catch {
          return;
        }
        maybePushStaleTabNotice(
          lastStaleNoticeAtRef,
          activeRootIdRef,
          previousTree
        );
      }, PROJECT_WATCH_REFRESH_DEBOUNCE_MS);
    });

    const reloadBatchSnapshot = reloadBatchRef.current;
    const watchChangeBatchSnapshot = watchChangeBatchRef.current;
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      clearReloadBatchState(reloadBatchSnapshot);
      clearWatchChangeBatch(watchChangeBatchSnapshot);
      unsubscribe();
    };
  }, []);
}

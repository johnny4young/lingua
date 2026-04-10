import { useEffect, useRef } from 'react';
import { useProjectStore } from '../stores/projectStore';

export const PROJECT_WATCH_REFRESH_DEBOUNCE_MS = 150;

export function useProjectWatchSync(): void {
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = window.runlang.fs.onChanged((event) => {
      const { currentProject } = useProjectStore.getState();
      if (!currentProject || event.dirPath !== currentProject.rootPath) {
        return;
      }

      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(() => {
        refreshTimerRef.current = null;
        const { currentProject, refreshTree } = useProjectStore.getState();
        if (!currentProject) {
          return;
        }

        void refreshTree();
      }, PROJECT_WATCH_REFRESH_DEBOUNCE_MS);
    });

    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }

      unsubscribe();
    };
  }, []);
}

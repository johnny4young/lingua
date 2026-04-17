import { useEffect, useRef } from 'react';
import { useProjectIndexStore } from '../stores/projectIndexStore';
import { useProjectStore } from '../stores/projectStore';

/**
 * Debounce window applied to file-system change events before the project
 * index is rebuilt. Rebuilding is more expensive than the tree refresh, so
 * this is deliberately looser than `PROJECT_WATCH_REFRESH_DEBOUNCE_MS`.
 */
export const PROJECT_INDEX_REFRESH_DEBOUNCE_MS = 600;

/**
 * Keeps the project-wide file index aligned with the currently-open project.
 * Builds (or rebuilds) the index whenever the active project changes and
 * schedules a debounced rebuild when the main-process file watcher fires.
 * The index is the source of truth for Quick Open; losing it falls back to
 * the file-tree walk so the feature degrades gracefully.
 */
export function useProjectIndexSync(): void {
  const watchDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    const { refresh, clear } = useProjectIndexStore.getState();

    function applyProject(rootPath: string | null): void {
      if (!rootPath) {
        clear();
        return;
      }
      void refresh(rootPath);
    }

    applyProject(useProjectStore.getState().currentProject?.rootPath ?? null);

    const unsubscribeProject = useProjectStore.subscribe((state, previousState) => {
      const nextRoot = state.currentProject?.rootPath ?? null;
      const previousRoot = previousState.currentProject?.rootPath ?? null;
      if (nextRoot === previousRoot) return;
      applyProject(nextRoot);
    });

    const unsubscribeWatch = window.lingua?.fs?.onChanged?.((event) => {
      const { currentProject } = useProjectStore.getState();
      if (!currentProject || event.dirPath !== currentProject.rootPath) {
        return;
      }

      if (watchDebounceRef.current !== null) {
        window.clearTimeout(watchDebounceRef.current);
      }

      watchDebounceRef.current = window.setTimeout(() => {
        watchDebounceRef.current = null;
        const { currentProject: projectNow } = useProjectStore.getState();
        if (!projectNow) return;
        void useProjectIndexStore.getState().refresh(projectNow.rootPath);
      }, PROJECT_INDEX_REFRESH_DEBOUNCE_MS);
    });

    return () => {
      if (watchDebounceRef.current !== null) {
        window.clearTimeout(watchDebounceRef.current);
        watchDebounceRef.current = null;
      }
      unsubscribeProject();
      unsubscribeWatch?.();
    };
  }, []);
}

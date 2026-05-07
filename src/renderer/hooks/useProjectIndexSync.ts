import { useEffect, useRef } from 'react';
import { isIgnoredPath } from '../../shared/fs/ignoredPaths';
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

    function applyProject(rootId: string | null): void {
      if (!rootId) {
        clear();
        return;
      }
      void refresh(rootId);
    }

    applyProject(useProjectStore.getState().currentProject?.rootId ?? null);

    const unsubscribeProject = useProjectStore.subscribe((state, previousState) => {
      const nextRootId = state.currentProject?.rootId ?? null;
      const previousRootId = previousState.currentProject?.rootId ?? null;
      if (nextRootId === previousRootId) return;
      applyProject(nextRootId);
    });

    const unsubscribeWatch = window.lingua?.fs?.onChanged?.((event) => {
      const { currentProject } = useProjectStore.getState();
      if (!currentProject || event.rootId !== currentProject.rootId) {
        return;
      }

      // RL-087 — drop events from ignored directories before the
      // debounce window even starts. A 100-file burst inside
      // `node_modules/.cache/` would otherwise schedule a costly
      // re-index. The shared module owns the prefix list so
      // future search/index features inherit the same policy.
      if (event.relativePath && isIgnoredPath(event.relativePath)) {
        return;
      }

      if (watchDebounceRef.current !== null) {
        window.clearTimeout(watchDebounceRef.current);
      }

      watchDebounceRef.current = window.setTimeout(() => {
        watchDebounceRef.current = null;
        const { currentProject: projectNow } = useProjectStore.getState();
        if (!projectNow) return;
        void useProjectIndexStore.getState().refresh(projectNow.rootId);
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

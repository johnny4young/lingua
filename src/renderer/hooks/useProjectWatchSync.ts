import { useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import type { FileTreeNode } from '../stores/projectTree';

export const PROJECT_WATCH_REFRESH_DEBOUNCE_MS = 150;

/**
 * RL-024 Slice 1 fold D — gate the "file was deleted externally"
 * notice. After every refresh, we walk the new tree and compare
 * against open tabs; a tab whose `relativePath` no longer exists
 * triggers a one-shot status notice. Debounced so a vendored
 * dependency wipe doesn't spam 200 toasts. The timestamp lives in
 * a ref so it resets cleanly between project switches (a
 * module-scoped value would let a notice in project A suppress a
 * legitimate notice in project B fired moments after the switch).
 */
const STALE_TAB_NOTICE_DEBOUNCE_MS = 1500;

function collectFilePaths(nodes: ReadonlyArray<FileTreeNode>): Set<string> {
  const out = new Set<string>();
  const walk = (list: ReadonlyArray<FileTreeNode>): void => {
    for (const node of list) {
      if (node.isDirectory) {
        if (node.children) walk(node.children);
      } else {
        out.add(node.path);
      }
    }
  };
  walk(nodes);
  return out;
}

function collectLoadedDirs(nodes: ReadonlyArray<FileTreeNode>): Set<string> {
  // Set of directory paths whose `children` have actually been
  // loaded. Used to filter out "still unexpanded" tabs whose file
  // legitimately isn't in the tree yet.
  const out = new Set<string>();
  // The project root is always loaded once we have `nodes`.
  out.add('');
  const walk = (list: ReadonlyArray<FileTreeNode>): void => {
    for (const node of list) {
      if (node.isDirectory && node.children) {
        out.add(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

function parentRelativeOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/');
  return idx === -1 ? '' : relativePath.slice(0, idx);
}

function maybePushStaleTabNotice(
  lastNoticeAtRef: { current: number },
  activeRootIdRef: { current: string | null },
  previousTree?: {
    rootId: string;
    loadedDirs: ReadonlySet<string>;
  }
): void {
  const { currentProject, nodes } = useProjectStore.getState();
  if (!currentProject) return;
  // Reset the debounce timestamp if the project switched since the
  // last notice — otherwise a notice in project A would suppress a
  // legitimate notice in project B for up to STALE_TAB_NOTICE_DEBOUNCE_MS.
  if (activeRootIdRef.current !== currentProject.rootId) {
    activeRootIdRef.current = currentProject.rootId;
    lastNoticeAtRef.current = 0;
  }
  const { tabs } = useEditorStore.getState();
  const loadedDirs = collectLoadedDirs(nodes);
  if (previousTree?.rootId === currentProject.rootId) {
    for (const dir of previousTree.loadedDirs) {
      loadedDirs.add(dir);
    }
  }
  const presentFiles = collectFilePaths(nodes);
  for (const tab of tabs) {
    if (!tab.rootId || tab.rootId !== currentProject.rootId) continue;
    if (!tab.relativePath) continue;
    const parent = parentRelativeOf(tab.relativePath);
    // Only fire when the containing directory is or was loaded during
    // this watcher refresh; an unexpanded dir's child legitimately
    // isn't in `nodes` yet.
    if (!loadedDirs.has(parent)) continue;
    if (presentFiles.has(tab.relativePath)) continue;
    // Found a tab whose file just vanished from the loaded tree.
    const now = Date.now();
    if (now - lastNoticeAtRef.current < STALE_TAB_NOTICE_DEBOUNCE_MS) return;
    lastNoticeAtRef.current = now;
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'fileTree.staleTab.deletedExternally',
      values: { name: tab.name },
    });
    // Only surface one notice per refresh — debounce upstream will
    // squelch repeated bursts. Stop walking once we've fired.
    return;
  }
}

export function useProjectWatchSync(): void {
  const refreshTimerRef = useRef<number | null>(null);
  const lastStaleNoticeAtRef = useRef<number>(0);
  const activeRootIdRef = useRef<string | null>(null);

  useEffect(() => {
    const unsubscribe = window.lingua.fs.onChanged((event) => {
      const { currentProject } = useProjectStore.getState();
      if (!currentProject || event.rootId !== currentProject.rootId) {
        return;
      }

      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(async () => {
        refreshTimerRef.current = null;
        const { currentProject, refreshTree } = useProjectStore.getState();
        if (!currentProject) {
          return;
        }

        const previousTree = {
          rootId: currentProject.rootId,
          loadedDirs: collectLoadedDirs(useProjectStore.getState().nodes),
        };
        try {
          await refreshTree();
        } catch {
          return;
        }
        // RL-024 Slice 1 fold D — after refresh, surface any tab
        // whose file got deleted on disk. Debounced + scoped to
        // already-loaded directories so the notice never fires for
        // a file that simply lives in an unexpanded subtree.
        maybePushStaleTabNotice(
          lastStaleNoticeAtRef,
          activeRootIdRef,
          previousTree
        );
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

import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { parentRelativeOf, type FileTreeNode } from '../stores/projectTree';
import { useUIStore } from '../stores/uiStore';

const STALE_TAB_NOTICE_DEBOUNCE_MS = 1500;

export interface LoadedTreeSnapshot {
  rootId: string;
  loadedDirs: ReadonlySet<string>;
}

export function collectFilePaths(nodes: ReadonlyArray<FileTreeNode>): Set<string> {
  const paths = new Set<string>();
  const walk = (list: ReadonlyArray<FileTreeNode>): void => {
    for (const node of list) {
      if (node.isDirectory) {
        if (node.children) walk(node.children);
      } else {
        paths.add(node.path);
      }
    }
  };
  walk(nodes);
  return paths;
}

/** Return only directories whose children have been loaded, plus the root. */
export function collectLoadedDirs(nodes: ReadonlyArray<FileTreeNode>): Set<string> {
  const paths = new Set<string>(['']);
  const walk = (list: ReadonlyArray<FileTreeNode>): void => {
    for (const node of list) {
      if (node.isDirectory && node.children) {
        paths.add(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return paths;
}

export function maybePushStaleTabNotice(
  lastNoticeAtRef: { current: number },
  activeRootIdRef: { current: string | null },
  previousTree?: LoadedTreeSnapshot
): void {
  const { currentProject, nodes } = useProjectStore.getState();
  if (!currentProject) return;

  if (activeRootIdRef.current !== currentProject.rootId) {
    activeRootIdRef.current = currentProject.rootId;
    lastNoticeAtRef.current = 0;
  }

  const loadedDirs = collectLoadedDirs(nodes);
  if (previousTree?.rootId === currentProject.rootId) {
    for (const dir of previousTree.loadedDirs) loadedDirs.add(dir);
  }
  const presentFiles = collectFilePaths(nodes);

  for (const tab of useEditorStore.getState().tabs) {
    if (!tab.rootId || tab.rootId !== currentProject.rootId || !tab.relativePath) continue;
    if (!loadedDirs.has(parentRelativeOf(tab.relativePath))) continue;
    if (presentFiles.has(tab.relativePath)) continue;

    const now = Date.now();
    if (now - lastNoticeAtRef.current < STALE_TAB_NOTICE_DEBOUNCE_MS) return;
    lastNoticeAtRef.current = now;
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'fileTree.staleTab.deletedExternally',
      values: { name: tab.name },
    });
    return;
  }
}

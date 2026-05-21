/**
 * Project management store.
 *
 * Handles:
 * - Creating and opening projects (directories on disk)
 * - Lazy-loaded file tree with expand/collapse
 * - File CRUD operations delegated to window.lingua.fs IPC
 * - Recent projects list (persisted)
 * - Watch mode to detect external file changes
 *
 * RL-077 — every filesystem operation goes through the active project's
 * `rootId` (capability token minted by main on `selectDirectory()` or
 * re-minted on `reopenRoot(absolutePath)` for a recent project). The
 * persisted RecentProject row stores `rootPath` only; `rootId` is
 * process-lifetime and lives only on `currentProject` while a project
 * is open. Re-opening a recent project triggers `fs:reopen-root` to
 * mint a fresh capability without forcing a re-pick.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getActiveAppLanguage } from '../i18n';
import { languageFromPath } from '../utils/language';
import {
  addNodeToParent,
  collapseAll,
  collectExpandedPaths,
  depthOf,
  entriesToNodes,
  joinPath,
  loadNodesForDirectory,
  MAX_TREE_EXPANSION_DEPTH,
  removeNode,
  renameNode,
  setNodeChildren,
  toggleExpanded,
  type FileTreeNode,
} from './projectTree';
import { useUIStore } from './uiStore';

/**
 * RL-087 — narrow the new tagged-union return shape from watchStart.
 * Returns the watchId on success, or null when registration failed
 * (and the typed diagnostic was already pushed via `onWatcherFailed`,
 * so callers do not need to push it again).
 */
function unwrapWatchStart(
  response: string | { ok: false; diagnostic: WatcherDiagnostic },
): string | null {
  if (typeof response === 'string') return response;
  return null;
}

export type { FileTreeNode } from './projectTree';

export interface RecentProject {
  id: string;
  name: string;
  rootPath: string;
  openedAt: number;
}

/**
 * The active project carries a live `rootId` capability in addition to
 * the persisted `RecentProject` shape. The rootId is process-lifetime
 * only — it is never written to localStorage; on rehydrate the user
 * re-opens the project from the recent-projects list, which calls
 * `fs:reopen-root` to mint a fresh capability tied to the same root
 * path.
 */
export interface ActiveProject extends RecentProject {
  rootId: string;
}

interface ProjectState {
  currentProject: ActiveProject | null;
  recentProjects: RecentProject[];
  nodes: FileTreeNode[];
  watchId: string | null;

  // Project lifecycle
  createProject: () => Promise<void>;
  openProject: (rootPath?: string) => Promise<void>;
  closeProject: () => void;
  refreshTree: () => Promise<void>;

  // Tree navigation
  expandDirectory: (relativePath: string) => Promise<void>;
  collapseDirectory: (relativePath: string) => void;
  /** RL-024 Slice 1 fold F — collapse every expanded directory at once. */
  collapseAllDirectories: () => void;

  // File operations
  createFile: (parentRelativePath: string, name: string) => Promise<string | null>;
  createDirectory: (parentRelativePath: string, name: string) => Promise<void>;
  deleteEntry: (relativePath: string, isDirectory: boolean) => Promise<boolean>;
  renameEntry: (oldRelativePath: string, newName: string) => Promise<string | null>;
}

function basenameOf(absolutePath: string): string {
  return absolutePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? 'project';
}

/**
 * RL-024 Slice 1 — debounce the `Folder nested too deep` notice so a
 * user who repeat-clicks a deep chevron only sees one toast per ~1.5s
 * burst. Mirrors `useDefaultOpenFileConsumer`'s timestamp-debounce
 * pattern from RL-044 Slice 2b-β-α so cross-feature behavior feels
 * consistent.
 */
const DEPTH_LIMIT_NOTICE_DEBOUNCE_MS = 1500;
let lastDepthLimitNoticeAt = 0;

function pushDepthLimitNoticeOnce(): void {
  const now = Date.now();
  if (now - lastDepthLimitNoticeAt < DEPTH_LIMIT_NOTICE_DEBOUNCE_MS) {
    return;
  }
  lastDepthLimitNoticeAt = now;
  useUIStore.getState().pushStatusNotice({
    tone: 'warning',
    messageKey: 'fileTree.depthLimitReached',
    values: { max: MAX_TREE_EXPANSION_DEPTH },
  });
}

// ----------------------------------------------------------------- store

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      currentProject: null,
      recentProjects: [],
      nodes: [],
      watchId: null,

      // --------------------------------------------------------- lifecycle

      createProject: async () => {
        const result = await window.lingua.fs.selectDirectory();
        if (result.canceled) return;

        let newWatchId: string | null = null;
        let nodes: FileTreeNode[];
        try {
          const entries = await window.lingua.fs.readdir(result.rootId, '');
          nodes = entriesToNodes(entries);
          newWatchId = unwrapWatchStart(
            await window.lingua.fs.watchStart(result.rootId, ''),
          );
        } catch (error) {
          if (newWatchId) {
            await window.lingua.fs.watchStop(newWatchId).catch(() => {});
          }
          await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
          throw error;
        }

        const { watchId, currentProject: previous } = get();
        if (watchId) {
          await window.lingua.fs.watchStop(watchId);
        }
        if (previous && previous.rootId !== result.rootId) {
          await window.lingua.fs.revokeRoot(previous.rootId);
        }

        const name = basenameOf(result.rootPath);
        const project: ActiveProject = {
          id: result.rootPath,
          name,
          rootPath: result.rootPath,
          openedAt: Date.now(),
          rootId: result.rootId,
        };
        const persistedRecent: RecentProject = {
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
          openedAt: project.openedAt,
        };

        set((s) => ({
          currentProject: project,
          nodes,
          watchId: newWatchId,
          recentProjects: [
            persistedRecent,
            ...s.recentProjects
              .filter((p) => p.id !== persistedRecent.id)
              .slice(0, 9),
          ],
        }));
      },

      openProject: async (rootPath?: string) => {
        let activeRootId: string;
        let activeRootPath: string;

        if (rootPath) {
          const reopen = await window.lingua.fs.reopenRoot(rootPath);
          if (!reopen.ok) return;
          activeRootId = reopen.rootId;
          activeRootPath = reopen.rootPath;
        } else {
          const picked = await window.lingua.fs.selectDirectory();
          if (picked.canceled) return;
          activeRootId = picked.rootId;
          activeRootPath = picked.rootPath;
        }

        const name = basenameOf(activeRootPath);

        const project: ActiveProject = {
          id: activeRootPath,
          name,
          rootPath: activeRootPath,
          openedAt: Date.now(),
          rootId: activeRootId,
        };

        let newWatchId: string | null = null;
        let nodes: FileTreeNode[];
        try {
          const entries = await window.lingua.fs.readdir(activeRootId, '');
          nodes = entriesToNodes(entries);
          newWatchId = unwrapWatchStart(
            await window.lingua.fs.watchStart(activeRootId, ''),
          );
        } catch (error) {
          if (newWatchId) {
            await window.lingua.fs.watchStop(newWatchId).catch(() => {});
          }
          await window.lingua.fs.revokeRoot(activeRootId).catch(() => {});
          throw error;
        }

        const { watchId, currentProject: previous } = get();
        if (watchId) {
          await window.lingua.fs.watchStop(watchId);
        }
        if (previous && previous.rootId !== activeRootId) {
          await window.lingua.fs.revokeRoot(previous.rootId);
        }

        const persistedRecent: RecentProject = {
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
          openedAt: project.openedAt,
        };

        set((s) => ({
          currentProject: project,
          nodes,
          watchId: newWatchId,
          recentProjects: [
            persistedRecent,
            ...s.recentProjects
              .filter((p) => p.id !== persistedRecent.id)
              .slice(0, 9),
          ],
        }));
      },

      closeProject: () => {
        const { watchId, currentProject } = get();
        if (watchId) {
          window.lingua.fs.watchStop(watchId).catch(() => {});
        }
        if (currentProject) {
          window.lingua.fs.revokeRoot(currentProject.rootId).catch(() => {});
        }
        set({ currentProject: null, nodes: [], watchId: null });
      },

      refreshTree: async () => {
        const { currentProject, nodes } = get();
        if (!currentProject) return;
        const expandedPaths = new Set(collectExpandedPaths(nodes));
        const nextNodes = await loadNodesForDirectory(
          currentProject.rootId,
          '',
          expandedPaths
        );
        set({ nodes: nextNodes });
      },

      // ---------------------------------------------------- tree navigation

      expandDirectory: async (relativePath: string) => {
        const { currentProject } = get();
        if (!currentProject) return;
        // RL-024 Slice 1 — depth cap. Refusing the expand here (rather
        // than letting `readdir` recurse) keeps a pathological tree
        // (symlink loop, vendored deps) from freezing the renderer.
        // The child we're about to render would sit at depth+1, so the
        // cap fires when the requested directory is already at the
        // max — its children would be one level past the limit.
        if (depthOf(relativePath) >= MAX_TREE_EXPANSION_DEPTH) {
          pushDepthLimitNoticeOnce();
          return;
        }
        const entries = await window.lingua.fs.readdir(
          currentProject.rootId,
          relativePath
        );
        const children = entriesToNodes(entries);
        set((s) => ({
          nodes: setNodeChildren(s.nodes, relativePath, children, true),
        }));
      },

      collapseDirectory: (relativePath: string) => {
        set((s) => ({
          nodes: toggleExpanded(s.nodes, relativePath, false),
        }));
      },

      collapseAllDirectories: () => {
        set((s) => ({ nodes: collapseAll(s.nodes) }));
      },

      // ------------------------------------------------------- file ops

      createFile: async (parentRelativePath: string, name: string) => {
        const { currentProject } = get();
        if (!currentProject) return null;
        const fileRelativePath = joinPath(parentRelativePath, name);
        await window.lingua.fs.touch(currentProject.rootId, fileRelativePath);

        const node: FileTreeNode = {
          name,
          path: fileRelativePath,
          isDirectory: false,
          language: languageFromPath(name),
        };

        set((s) => ({
          nodes: addNodeToParent(s.nodes, parentRelativePath, node),
        }));

        return fileRelativePath;
      },

      createDirectory: async (parentRelativePath: string, name: string) => {
        const { currentProject } = get();
        if (!currentProject) return;
        const dirRelativePath = joinPath(parentRelativePath, name);
        await window.lingua.fs.mkdir(currentProject.rootId, dirRelativePath);

        const node: FileTreeNode = {
          name,
          path: dirRelativePath,
          isDirectory: true,
          children: [],
          isExpanded: false,
        };

        set((s) => ({
          nodes: addNodeToParent(s.nodes, parentRelativePath, node),
        }));
      },

      deleteEntry: async (relativePath: string, isDirectory: boolean) => {
        const { currentProject } = get();
        if (!currentProject) return false;
        const deleted = await window.lingua.fs.delete(
          currentProject.rootId,
          relativePath,
          isDirectory,
          getActiveAppLanguage()
        );
        if (deleted) {
          set((s) => ({ nodes: removeNode(s.nodes, relativePath) }));
        }
        return deleted;
      },

      renameEntry: async (oldRelativePath: string, newName: string) => {
        const { currentProject } = get();
        if (!currentProject) return null;
        const newRelativePath = await window.lingua.fs.rename(
          currentProject.rootId,
          oldRelativePath,
          newName
        );
        set((s) => ({
          nodes: renameNode(s.nodes, oldRelativePath, newRelativePath, newName),
        }));
        return newRelativePath;
      },
    }),
    {
      name: 'lingua-project-store',
      // Only persist the project registry; runtime state (nodes, watchId,
      // currentProject — which carries a process-lifetime rootId) is
      // always re-derived. The persisted recent-projects entries are
      // re-minted via `fs:reopen-root` when the user re-opens one.
      partialize: (state) => ({
        recentProjects: state.recentProjects,
        currentProject: null,
      }),
    }
  )
);

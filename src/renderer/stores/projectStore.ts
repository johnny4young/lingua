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
 * internal — every filesystem operation goes through the active project's
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
import { createMigrate } from './persistence/migrationRegistry';
import { languageFromPath } from '../utils/language';
import {
  asRelativePath,
  type RelativePath,
  type RootId,
  type WatchId,
} from '../../shared/fs/brandedIds';
import {
  addNodeToParent,
  buildNodeIndex,
  collapseAll,
  collectExpandedPaths,
  depthOf,
  entriesToNodes,
  isLoadedDirectory,
  joinPath,
  loadNodesForDirectory,
  MAX_TREE_EXPANSION_DEPTH,
  parentRelativeOf,
  removeNode,
  renameNode,
  setNodeChildren,
  toggleExpanded,
  updateChildrenAtPath,
  type FileTreeNode,
} from './projectTree';
import { useUIStore } from './uiStore';
import { notifyBlockedFamily, notifyBlockedPath } from '../utils/blockedPath';

/**
 * internal — narrow the new tagged-union return shape from watchStart.
 * Returns the watchId on success, or null when registration failed
 * (and the typed diagnostic was already pushed via `onWatcherFailed`,
 * so callers do not need to push it again).
 */
function unwrapWatchStart(
  response: WatchId | { ok: false; diagnostic: WatcherDiagnostic },
): WatchId | null {
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
  rootId: RootId;
}

/**
 * implementation detail — a single coalesced filesystem-watch event handed
 * to `applyWatchChanges`. Shaped as a subset of the ambient
 * `FsChangedEvent` so the watcher hook can forward events directly.
 *
 * - `relativePath` — the changed entry's path (or, when the platform
 *   drops the filename under load, the parent directory it aggregates
 *   to; see `filename`).
 * - `eventType` — `'change'` for content modification (no tree-structure
 *   delta — skipped by the delta refresh) or `'rename'` for
 *   create / delete / move (re-reads the containing directory).
 * - `filename` — `null` when the platform aggregated the event to the
 *   parent directory; in that case `relativePath` IS that directory.
 */
export interface WatchChange {
  relativePath: string;
  eventType: string;
  filename: string | null;
}

interface ProjectState {
  currentProject: ActiveProject | null;
  recentProjects: RecentProject[];
  nodes: FileTreeNode[];
  /**
   * implementation detail — flat `path -> node` index over `nodes`, rebuilt
   * on every node commit (a pure derivation, so it never drifts). Gives
   * the watcher delta refresh O(1) loaded-directory lookups instead of
   * walking the whole tree per event. Never persisted (see `partialize`)
   * and never written to directly — always commit via the internal
   * `withNodeIndex` helper.
   */
  nodeIndex: Map<RelativePath, FileTreeNode>;
  watchId: WatchId | null;

  // Project lifecycle
  createProject: () => Promise<void>;
  openProject: (rootPath?: string) => Promise<void>;
  closeProject: () => void;
  refreshTree: () => Promise<void>;
  /**
   * implementation detail — delta refresh for a coalesced burst of watch
   * events. Re-reads from disk ONLY the loaded directories that actually
   * changed (skipping pure file-content `'change'` events, whose content
   * is handled by the reload-from-disk notice), preserving each branch's
   * expansion and the object identity of untouched sibling subtrees so
   * React re-renders O(branch) not O(N). `refreshTree` stays the full
   * walk for boot / manual refresh / restart.
   */
  applyWatchChanges: (changes: readonly WatchChange[]) => Promise<void>;

  // Tree navigation
  expandDirectory: (relativePath: string) => Promise<void>;
  collapseDirectory: (relativePath: string) => void;
  /** implementation note — collapse every expanded directory at once. */
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
 * implementation — debounce the `Folder nested too deep` notice so a
 * user who repeat-clicks a deep chevron only sees one toast per ~1.5s
 * burst. Mirrors `useDefaultOpenFileConsumer`'s timestamp-debounce
 * pattern from implementation so cross-feature behavior feels
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

/**
 * implementation detail — commit a new node tree together with its
 * freshly-derived path index. The index is a pure derivation of `nodes`
 * (rebuilt on every commit, so it can never drift) that gives the
 * watcher delta refresh O(1) loaded-directory lookups. Spread the result
 * into the `set` payload alongside any other fields being updated.
 */
function withNodeIndex(nodes: FileTreeNode[]): {
  nodes: FileTreeNode[];
  nodeIndex: Map<RelativePath, FileTreeNode>;
} {
  return { nodes, nodeIndex: buildNodeIndex(nodes) };
}

// ----------------------------------------------------------------- store

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      currentProject: null,
      recentProjects: [],
      nodes: [],
      nodeIndex: new Map<RelativePath, FileTreeNode>(),
      watchId: null,

      // --------------------------------------------------------- lifecycle

      createProject: async () => {
        const result = await window.lingua.fs.selectDirectory();
        if (result.canceled) {
          notifyBlockedFamily(result.blockedFamily);
          return;
        }

        let newWatchId: WatchId | null = null;
        let nodes: FileTreeNode[];
        try {
          // Activate the newly picked root only after both the initial tree and
          // watcher attempt complete. Until then the previous project remains
          // live, so a failed open cannot leave the app with no usable root.
          const entries = await window.lingua.fs.readdir(
            result.rootId,
            asRelativePath(''),
          );
          nodes = entriesToNodes(entries);
          newWatchId = unwrapWatchStart(
            await window.lingua.fs.watchStart(result.rootId, asRelativePath('')),
          );
        } catch (error) {
          if (newWatchId) {
            await window.lingua.fs.watchStop(newWatchId).catch(() => {});
          }
          await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
          throw error;
        }

        const { watchId, currentProject: previous } = get();
        // The new root is ready; now retire the old watcher/capability. This
        // ordering prevents a transient gap where editor tabs still point at
        // a revoked root if `readdir` or `watchStart` failed above.
        // Retirement is best-effort: a rejected watchStop/revokeRoot for the
        // OLD project must not abort the open mid-flight (the new project is
        // already live at this point).
        if (watchId) {
          await window.lingua.fs.watchStop(watchId).catch(() => {});
        }
        if (previous && previous.rootId !== result.rootId) {
          await window.lingua.fs.revokeRoot(previous.rootId).catch(() => {});
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
          watchId: newWatchId,
          recentProjects: [
            persistedRecent,
            ...s.recentProjects
              .filter((p) => p.id !== persistedRecent.id)
              .slice(0, 9),
          ],
          ...withNodeIndex(nodes),
        }));
      },

      openProject: async (rootPath?: string) => {
        let activeRootId: RootId;
        let activeRootPath: string;

        if (rootPath) {
          // Recent-project rows persist only absolute paths. Main must re-mint
          // a fresh root capability before the renderer can read that tree.
          const reopen = await window.lingua.fs.reopenRoot(rootPath);
          if (!reopen.ok) {
            // internal — a previously-approved root that now falls inside the
            // denylist (e.g. under a newly-blocked app-data root) surfaces an
            // actionable notice instead of silently failing to restore.
            if (reopen.error === 'blocked') void notifyBlockedPath(rootPath);
            return;
          }
          activeRootId = reopen.rootId;
          activeRootPath = reopen.rootPath;
        } else {
          const picked = await window.lingua.fs.selectDirectory();
          if (picked.canceled) {
            notifyBlockedFamily(picked.blockedFamily);
            return;
          }
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

        let newWatchId: WatchId | null = null;
        let nodes: FileTreeNode[];
        try {
          // Same activation contract as createProject(): prove the new root can
          // be read and watched before revoking the old project capability.
          const entries = await window.lingua.fs.readdir(
            activeRootId,
            asRelativePath(''),
          );
          nodes = entriesToNodes(entries);
          newWatchId = unwrapWatchStart(
            await window.lingua.fs.watchStart(activeRootId, asRelativePath('')),
          );
        } catch (error) {
          if (newWatchId) {
            await window.lingua.fs.watchStop(newWatchId).catch(() => {});
          }
          await window.lingua.fs.revokeRoot(activeRootId).catch(() => {});
          throw error;
        }

        const { watchId, currentProject: previous } = get();
        // Best-effort retirement — same rationale as openProject above.
        if (watchId) {
          await window.lingua.fs.watchStop(watchId).catch(() => {});
        }
        if (previous && previous.rootId !== activeRootId) {
          await window.lingua.fs.revokeRoot(previous.rootId).catch(() => {});
        }

        const persistedRecent: RecentProject = {
          id: project.id,
          name: project.name,
          rootPath: project.rootPath,
          openedAt: project.openedAt,
        };

        set((s) => ({
          currentProject: project,
          watchId: newWatchId,
          recentProjects: [
            persistedRecent,
            ...s.recentProjects
              .filter((p) => p.id !== persistedRecent.id)
              .slice(0, 9),
          ],
          ...withNodeIndex(nodes),
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
        set({ currentProject: null, watchId: null, ...withNodeIndex([]) });
      },

      refreshTree: async () => {
        const { currentProject, nodes } = get();
        if (!currentProject) return;
        // Preserve expansion by relative path, then rebuild those subtrees from
        // disk. The store deliberately reuses rootId, never absolute paths.
        // This is the full-walk path kept for boot / manual refresh / restart;
        // the watcher hot path uses applyWatchChanges.
        const expandedPaths = new Set(collectExpandedPaths(nodes));
        const nextNodes = await loadNodesForDirectory(
          currentProject.rootId,
          asRelativePath(''),
          expandedPaths
        );
        set(withNodeIndex(nextNodes));
      },

      applyWatchChanges: async (changes) => {
        const { currentProject, nodeIndex } = get();
        if (!currentProject || changes.length === 0) return;
        const rootId = currentProject.rootId;

        // Resolve the set of currently-loaded directories whose children
        // must be re-read from disk. Pure file 'change' events carry no
        // structural delta — their content is handled by the
        // reload-from-disk notice — so they are skipped here (the biggest
        // real-world win: a formatter touching N files no longer re-walks
        // the tree). 'rename' events (create / delete / move) re-read only
        // the containing directory's branch. A 'change' on a known
        // DIRECTORY is treated as structural, since some platforms report
        // directory-level changes that way.
        const dirsToRefresh = new Set<string>();
        for (const change of changes) {
          if (change.eventType === 'change') {
            const node = nodeIndex.get(asRelativePath(change.relativePath));
            if (!node || !node.isDirectory) continue; // file content → no tree work
            dirsToRefresh.add(change.relativePath);
            continue;
          }
          // When the platform drops the filename (e.g. inotify under load)
          // the payload already aggregates to the parent directory.
          const dir = change.filename
            ? parentRelativeOf(change.relativePath)
            : change.relativePath;
          dirsToRefresh.add(dir);
        }
        if (dirsToRefresh.size === 0) return;

        // Re-read only the loaded directories that changed. Each async read is
        // committed against the fresh store state instead of the snapshot from
        // the beginning of the burst: a concurrent expand/collapse, CRUD
        // action, or a second watcher refresh must never be overwritten when
        // this read settles. Re-check the root capability on both sides of the
        // await so a late response from a closed/switched project is dropped.
        for (const dir of dirsToRefresh) {
          const beforeRead = get();
          if (beforeRead.currentProject?.rootId !== rootId) return;
          if (!isLoadedDirectory(beforeRead.nodeIndex, dir)) continue; // unexpanded subtree
          const expandedPaths = new Set(collectExpandedPaths(beforeRead.nodes));
          const children = await loadNodesForDirectory(
            rootId,
            asRelativePath(dir),
            expandedPaths
          );
          const afterRead = get();
          if (afterRead.currentProject?.rootId !== rootId) return;
          if (!isLoadedDirectory(afterRead.nodeIndex, dir)) continue;
          const nextNodes =
            dir === ''
              ? children
              : updateChildrenAtPath(afterRead.nodes, dir, children);
          if (nextNodes !== afterRead.nodes) {
            set(withNodeIndex(nextNodes));
          }
        }
      },

      // ---------------------------------------------------- tree navigation

      expandDirectory: async (relativePath: string) => {
        const { currentProject } = get();
        if (!currentProject) return;
        // implementation — depth cap. Refusing the expand here (rather
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
          asRelativePath(relativePath)
        );
        const children = entriesToNodes(entries);
        set((s) => withNodeIndex(setNodeChildren(s.nodes, relativePath, children, true)));
      },

      collapseDirectory: (relativePath: string) => {
        set((s) => withNodeIndex(toggleExpanded(s.nodes, relativePath, false)));
      },

      collapseAllDirectories: () => {
        set((s) => withNodeIndex(collapseAll(s.nodes)));
      },

      // ------------------------------------------------------- file ops

      createFile: async (parentRelativePath: string, name: string) => {
        const { currentProject } = get();
        if (!currentProject) return null;
        const fileRelativePath = joinPath(parentRelativePath, name);
        await window.lingua.fs.touch(
          currentProject.rootId,
          asRelativePath(fileRelativePath)
        );

        const node: FileTreeNode = {
          name,
          path: fileRelativePath,
          isDirectory: false,
          language: languageFromPath(name),
        };

        set((s) => withNodeIndex(addNodeToParent(s.nodes, parentRelativePath, node)));

        return fileRelativePath;
      },

      createDirectory: async (parentRelativePath: string, name: string) => {
        const { currentProject } = get();
        if (!currentProject) return;
        const dirRelativePath = joinPath(parentRelativePath, name);
        await window.lingua.fs.mkdir(
          currentProject.rootId,
          asRelativePath(dirRelativePath)
        );

        const node: FileTreeNode = {
          name,
          path: dirRelativePath,
          isDirectory: true,
          children: [],
          isExpanded: false,
        };

        set((s) => withNodeIndex(addNodeToParent(s.nodes, parentRelativePath, node)));
      },

      deleteEntry: async (relativePath: string, isDirectory: boolean) => {
        const { currentProject } = get();
        if (!currentProject) return false;
        const deleted = await window.lingua.fs.delete(
          currentProject.rootId,
          asRelativePath(relativePath),
          isDirectory,
          getActiveAppLanguage()
        );
        if (deleted) {
          set((s) => withNodeIndex(removeNode(s.nodes, relativePath)));
        }
        return deleted;
      },

      renameEntry: async (oldRelativePath: string, newName: string) => {
        const { currentProject } = get();
        if (!currentProject) return null;
        const newRelativePath = await window.lingua.fs.rename(
          currentProject.rootId,
          asRelativePath(oldRelativePath),
          newName
        );
        set((s) =>
          withNodeIndex(
            renameNode(s.nodes, oldRelativePath, newRelativePath, newName)
          )
        );
        return newRelativePath;
      },
    }),
    {
      name: 'lingua-project-store',
      version: 1,
      migrate: createMigrate('lingua-project-store'),
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

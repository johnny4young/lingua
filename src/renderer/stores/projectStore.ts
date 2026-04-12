/**
 * Project management store.
 *
 * Handles:
 * - Creating and opening projects (directories on disk)
 * - Lazy-loaded file tree with expand/collapse
 * - File CRUD operations delegated to window.lingua.fs IPC
 * - Recent projects list (persisted)
 * - Watch mode to detect external file changes
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { languageFromPath } from '../utils/language';
import {
  addNodeToParent,
  collectExpandedPaths,
  entriesToNodes,
  joinPath,
  loadNodesForDirectory,
  removeNode,
  renameNode,
  setNodeChildren,
  toggleExpanded,
  type FileTreeNode,
} from './projectTree';

export type { FileTreeNode } from './projectTree';

export interface RecentProject {
  id: string;
  name: string;
  rootPath: string;
  openedAt: number;
}

interface ProjectState {
  currentProject: RecentProject | null;
  recentProjects: RecentProject[];
  nodes: FileTreeNode[];
  watchId: string | null;

  // Project lifecycle
  createProject: () => Promise<void>;
  openProject: (dirPath?: string) => Promise<void>;
  closeProject: () => void;
  refreshTree: () => Promise<void>;

  // Tree navigation
  expandDirectory: (dirPath: string) => Promise<void>;
  collapseDirectory: (dirPath: string) => void;

  // File operations
  createFile: (parentPath: string, name: string) => Promise<string | null>;
  createDirectory: (parentPath: string, name: string) => Promise<void>;
  deleteEntry: (entryPath: string, isDirectory: boolean) => Promise<boolean>;
  renameEntry: (oldPath: string, newName: string) => Promise<string | null>;
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
        const dirPath = await window.lingua.fs.selectDirectory();
        if (!dirPath) return;

        const name = dirPath.split('/').pop() ?? dirPath.split('\\').pop() ?? 'project';
        await get().openProject(dirPath);
        // Override the name with the directory's basename
        set((s) => ({
          currentProject: s.currentProject ? { ...s.currentProject, name } : null,
        }));
      },

      openProject: async (dirPath?: string) => {
        const targetPath = dirPath ?? (await window.lingua.fs.selectDirectory());
        if (!targetPath) return;

        // Stop existing watcher
        const { watchId } = get();
        if (watchId) {
          await window.lingua.fs.watchStop(watchId);
        }

        const name =
          targetPath.split('/').pop() ?? targetPath.split('\\').pop() ?? 'project';

        const project: RecentProject = {
          id: targetPath,
          name,
          rootPath: targetPath,
          openedAt: Date.now(),
        };

        // Read root entries
        const entries = await window.lingua.fs.readdir(targetPath);
        const nodes = entriesToNodes(entries);

        // Start watching
        const newWatchId = await window.lingua.fs.watchStart(targetPath);

        set((s) => ({
          currentProject: project,
          nodes,
          watchId: newWatchId,
          recentProjects: [
            project,
            ...s.recentProjects
              .filter((p) => p.id !== project.id)
              .slice(0, 9), // keep last 10
          ],
        }));
      },

      closeProject: () => {
        const { watchId } = get();
        if (watchId) {
          window.lingua.fs.watchStop(watchId).catch(() => {});
        }
        set({ currentProject: null, nodes: [], watchId: null });
      },

      refreshTree: async () => {
        const { currentProject, nodes } = get();
        if (!currentProject) return;
        const expandedPaths = new Set(collectExpandedPaths(nodes));
        const nextNodes = await loadNodesForDirectory(
          currentProject.rootPath,
          expandedPaths
        );
        set({ nodes: nextNodes });
      },

      // ---------------------------------------------------- tree navigation

      expandDirectory: async (dirPath: string) => {
        // Load children if not yet loaded
        const entries = await window.lingua.fs.readdir(dirPath);
        const children = entriesToNodes(entries);
        set((s) => ({
          nodes: setNodeChildren(s.nodes, dirPath, children, true),
        }));
      },

      collapseDirectory: (dirPath: string) => {
        set((s) => ({
          nodes: toggleExpanded(s.nodes, dirPath, false),
        }));
      },

      // ------------------------------------------------------- file ops

      createFile: async (parentPath: string, name: string) => {
        const filePath = joinPath(parentPath, name);
        await window.lingua.fs.touch(filePath);

        const node: FileTreeNode = {
          name,
          path: filePath,
          isDirectory: false,
          language: languageFromPath(name),
        };

        set((s) => ({
          nodes: addNodeToParent(s.nodes, parentPath, node),
        }));

        return filePath;
      },

      createDirectory: async (parentPath: string, name: string) => {
        const dirPath = joinPath(parentPath, name);
        await window.lingua.fs.mkdir(dirPath);

        const node: FileTreeNode = {
          name,
          path: dirPath,
          isDirectory: true,
          children: [],
          isExpanded: false,
        };

        set((s) => ({
          nodes: addNodeToParent(s.nodes, parentPath, node),
        }));
      },

      deleteEntry: async (entryPath: string, isDirectory: boolean) => {
        const deleted = await window.lingua.fs.delete(entryPath, isDirectory);
        if (deleted) {
          set((s) => ({ nodes: removeNode(s.nodes, entryPath) }));
        }
        return deleted;
      },

      renameEntry: async (oldPath: string, newName: string) => {
        const newPath = await window.lingua.fs.rename(oldPath, newName);
        set((s) => ({
          nodes: renameNode(s.nodes, oldPath, newPath, newName),
        }));
        return newPath;
      },
    }),
    {
      name: 'lingua-project-store',
      // Only persist the project registry; runtime state (nodes, watchId) is always re-derived
      partialize: (state) => ({
        recentProjects: state.recentProjects,
        // Don't persist currentProject — app starts fresh without a project open
        currentProject: null,
      }),
    }
  )
);

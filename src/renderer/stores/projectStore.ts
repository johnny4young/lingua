/**
 * Project management store.
 *
 * Handles:
 * - Creating and opening projects (directories on disk)
 * - Lazy-loaded file tree with expand/collapse
 * - File CRUD operations delegated to window.runlang.fs IPC
 * - Recent projects list (persisted)
 * - Watch mode to detect external file changes
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Language } from '../types';

/** Join path segments using the OS separator detected from the base path */
function joinPath(base: string, name: string): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return base.endsWith(sep) ? `${base}${name}` : `${base}${sep}${name}`;
}

// ----------------------------------------------------------------- types

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  /** Language inferred from extension (files only) */
  language?: Language;
  /** Children: undefined = not yet loaded; null is not used */
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

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

// ----------------------------------------------------------------- helpers

/** Infer Language from file extension */
function languageFromName(name: string): Language {
  if (name.endsWith('.ts') || name.endsWith('.tsx')) return 'typescript';
  if (
    name.endsWith('.js') ||
    name.endsWith('.jsx') ||
    name.endsWith('.mjs') ||
    name.endsWith('.cjs')
  )
    return 'javascript';
  if (name.endsWith('.go')) return 'go';
  if (name.endsWith('.py')) return 'python';
  if (name.endsWith('.rs')) return 'rust';
  return 'javascript';
}

/** Convert raw FsDirEntry list into FileTreeNode list */
function entriesToNodes(
  entries: { name: string; isDirectory: boolean; path: string }[]
): FileTreeNode[] {
  return entries.map((e) => ({
    name: e.name,
    path: e.path,
    isDirectory: e.isDirectory,
    language: e.isDirectory ? undefined : languageFromName(e.name),
    children: e.isDirectory ? undefined : undefined, // will be lazy-loaded
    isExpanded: false,
  }));
}

/** Immutable helper: set children of the node matching targetPath */
function setNodeChildren(
  nodes: FileTreeNode[],
  targetPath: string,
  children: FileTreeNode[],
  expanded: boolean
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath && node.isDirectory) {
      return { ...node, children, isExpanded: expanded };
    }
    if (node.isDirectory && node.children) {
      return {
        ...node,
        children: setNodeChildren(node.children, targetPath, children, expanded),
      };
    }
    return node;
  });
}

/** Immutable helper: toggle isExpanded flag for a directory node */
function toggleExpanded(
  nodes: FileTreeNode[],
  targetPath: string,
  expanded: boolean
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === targetPath && node.isDirectory) {
      return { ...node, isExpanded: expanded };
    }
    if (node.isDirectory && node.children) {
      return {
        ...node,
        children: toggleExpanded(node.children, targetPath, expanded),
      };
    }
    return node;
  });
}

/** Immutable helper: remove a node by path anywhere in the tree */
function removeNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode[] {
  return nodes
    .filter((n) => n.path !== targetPath)
    .map((n) =>
      n.isDirectory && n.children
        ? { ...n, children: removeNode(n.children, targetPath) }
        : n
    );
}

/** Immutable helper: rename a node by path anywhere in the tree */
function renameNode(
  nodes: FileTreeNode[],
  oldPath: string,
  newPath: string,
  newName: string
): FileTreeNode[] {
  return nodes.map((n) => {
    if (n.path === oldPath) {
      return { ...n, path: newPath, name: newName };
    }
    if (n.isDirectory && n.children) {
      return {
        ...n,
        children: renameNode(n.children, oldPath, newPath, newName),
      };
    }
    return n;
  });
}

/** Immutable helper: add a new node as child of parentPath */
function addNodeToParent(
  nodes: FileTreeNode[],
  parentPath: string,
  newNode: FileTreeNode
): FileTreeNode[] {
  return nodes.map((n) => {
    if (n.path === parentPath && n.isDirectory && n.isExpanded && n.children) {
      // Insert directories first, then files, alphabetically
      const children = [...n.children, newNode].sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      return { ...n, children };
    }
    if (n.isDirectory && n.children) {
      return { ...n, children: addNodeToParent(n.children, parentPath, newNode) };
    }
    return n;
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
        const dirPath = await window.runlang.fs.selectDirectory();
        if (!dirPath) return;

        const name = dirPath.split('/').pop() ?? dirPath.split('\\').pop() ?? 'project';
        await get().openProject(dirPath);
        // Override the name with the directory's basename
        set((s) => ({
          currentProject: s.currentProject ? { ...s.currentProject, name } : null,
        }));
      },

      openProject: async (dirPath?: string) => {
        const targetPath = dirPath ?? (await window.runlang.fs.selectDirectory());
        if (!targetPath) return;

        // Stop existing watcher
        const { watchId } = get();
        if (watchId) {
          await window.runlang.fs.watchStop(watchId);
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
        const entries = await window.runlang.fs.readdir(targetPath);
        const nodes = entriesToNodes(entries);

        // Start watching
        const newWatchId = await window.runlang.fs.watchStart(targetPath);

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
          window.runlang.fs.watchStop(watchId).catch(() => {});
        }
        set({ currentProject: null, nodes: [], watchId: null });
      },

      refreshTree: async () => {
        const { currentProject } = get();
        if (!currentProject) return;
        const entries = await window.runlang.fs.readdir(currentProject.rootPath);
        set({ nodes: entriesToNodes(entries) });
      },

      // ---------------------------------------------------- tree navigation

      expandDirectory: async (dirPath: string) => {
        // Load children if not yet loaded
        const entries = await window.runlang.fs.readdir(dirPath);
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
        await window.runlang.fs.touch(filePath);

        const node: FileTreeNode = {
          name,
          path: filePath,
          isDirectory: false,
          language: languageFromName(name),
        };

        set((s) => ({
          nodes: addNodeToParent(s.nodes, parentPath, node),
        }));

        return filePath;
      },

      createDirectory: async (parentPath: string, name: string) => {
        const dirPath = joinPath(parentPath, name);
        await window.runlang.fs.mkdir(dirPath);

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
        const deleted = await window.runlang.fs.delete(entryPath, isDirectory);
        if (deleted) {
          set((s) => ({ nodes: removeNode(s.nodes, entryPath) }));
        }
        return deleted;
      },

      renameEntry: async (oldPath: string, newName: string) => {
        const newPath = await window.runlang.fs.rename(oldPath, newName);
        set((s) => ({
          nodes: renameNode(s.nodes, oldPath, newPath, newName),
        }));
        return newPath;
      },
    }),
    {
      name: 'runlang-project-store',
      // Only persist the project registry; runtime state (nodes, watchId) is always re-derived
      partialize: (state) => ({
        recentProjects: state.recentProjects,
        currentProject: state.currentProject
          ? {
              id: state.currentProject.id,
              name: state.currentProject.name,
              rootPath: state.currentProject.rootPath,
              openedAt: state.currentProject.openedAt,
            }
          : null,
      }),
    }
  )
);

import type { Language } from '../types';
import { languageFromPath } from '../utils/language';

/**
 * RL-077 — Tree-node `path` is the relative path of this entry inside
 * the active project root. The capability `rootId` lives on the
 * project store; combining `currentProject.rootId` with `node.path`
 * yields the `{ rootId, relativePath }` pair every IPC handler now
 * requires. The empty string `''` represents the project root itself.
 */
export interface FileTreeNode {
  name: string;
  /** Path relative to the current project root. */
  path: string;
  isDirectory: boolean;
  language?: Language;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

/**
 * Join two relative path segments using the POSIX separator. Tree
 * paths are always normalised to `/` regardless of the host OS so a
 * persisted expansion key from one platform can rehydrate elsewhere.
 */
export function joinPath(base: string, name: string): string {
  if (base.length === 0) return name;
  return base.endsWith('/') ? `${base}${name}` : `${base}/${name}`;
}

/**
 * RL-024 Slice 1 — depth guard for `expandDirectory`. Tree paths are
 * stored as POSIX-style relative strings (`'a/b/c'`); the empty string
 * is the project root and counts as depth 0. Pathological projects
 * (symlink loops, deeply nested dependency trees) are capped at 8
 * levels of expansion so the renderer never recurses into a multi-MB
 * `node_modules` shape that would freeze the tree.
 *
 * The cap is intentionally generous — real projects rarely exceed
 * 5–6 levels of meaningful nesting. Hitting 8 almost always means
 * the user wandered into a dependency vendor tree by mistake, and the
 * status notice surfaces that without crashing.
 */
export const MAX_TREE_EXPANSION_DEPTH = 8;

export function depthOf(relativePath: string): number {
  if (relativePath.length === 0) return 0;
  // Strip leading/trailing slashes so `/a/b/` and `a/b` both return 2.
  const trimmed = relativePath.replace(/^\/+/, '').replace(/\/+$/, '');
  if (trimmed.length === 0) return 0;
  return trimmed.split('/').length;
}

/**
 * RL-024 Slice 1 fold B — recursive file count for the header badge.
 * Only counts file nodes (directories don't contribute to the
 * "{{count}} files" badge). The lazy-load contract means this is a
 * lower bound — directories not yet expanded contribute zero. The
 * header copy treats it as "discovered files" rather than "total
 * files on disk" by design; an accurate count would require eagerly
 * walking every subtree on every refresh and burn the 500 ms budget
 * the Slice 1 perf bench locks.
 */
export function countFiles(nodes: ReadonlyArray<FileTreeNode>): number {
  let total = 0;
  for (const node of nodes) {
    if (node.isDirectory) {
      if (node.children) total += countFiles(node.children);
    } else {
      total += 1;
    }
  }
  return total;
}

/**
 * RL-024 Slice 1 fold F — collapse-all. Walks every expanded
 * directory and flips `isExpanded` to false. Children are preserved
 * so re-expanding doesn't re-fetch (lazy load only triggers when
 * `children === undefined`).
 */
export function collapseAll(
  nodes: ReadonlyArray<FileTreeNode>
): FileTreeNode[] {
  return nodes.map((node) => {
    if (!node.isDirectory) return node;
    return {
      ...node,
      isExpanded: false,
      children: node.children ? collapseAll(node.children) : node.children,
    };
  });
}

export function entriesToNodes(entries: FsDirEntry[]): FileTreeNode[] {
  // Main already returns entries sorted and filtered for the active root. The
  // renderer converts them into tree nodes without storing absolute paths.
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.relativePath,
    isDirectory: entry.isDirectory,
    language: entry.isDirectory ? undefined : languageFromPath(entry.name),
    children: undefined,
    isExpanded: false,
  }));
}

export function collectExpandedPaths(nodes: FileTreeNode[]): string[] {
  return nodes.flatMap((node) => {
    if (!node.isDirectory) {
      return [];
    }

    const childPaths = node.children ? collectExpandedPaths(node.children) : [];
    return node.isExpanded ? [node.path, ...childPaths] : childPaths;
  });
}

export async function loadNodesForDirectory(
  rootId: string,
  relativePath: string,
  expandedPaths: ReadonlySet<string>
): Promise<FileTreeNode[]> {
  const entries = await window.lingua.fs.readdir(rootId, relativePath);
  const nodes = entriesToNodes(entries);

  // Recurse only into directories that were expanded before refresh. This
  // keeps refresh proportional to the visible tree, not the whole project.
  return Promise.all(
    nodes.map(async (node) => {
      if (!node.isDirectory || !expandedPaths.has(node.path)) {
        return node;
      }

      return {
        ...node,
        children: await loadNodesForDirectory(rootId, node.path, expandedPaths),
        isExpanded: true,
      };
    })
  );
}

export function setNodeChildren(
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

export function toggleExpanded(
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

export function removeNode(nodes: FileTreeNode[], targetPath: string): FileTreeNode[] {
  return nodes
    .filter((node) => node.path !== targetPath)
    .map((node) =>
      node.isDirectory && node.children
        ? { ...node, children: removeNode(node.children, targetPath) }
        : node
    );
}

export function renameNode(
  nodes: FileTreeNode[],
  oldPath: string,
  newPath: string,
  newName: string
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === oldPath) {
      return node.isDirectory
        ? { ...node, path: newPath, name: newName }
        : {
            ...node,
            path: newPath,
            name: newName,
            language: languageFromPath(newName),
          };
    }

    if (node.isDirectory && node.children) {
      return {
        ...node,
        children: renameNode(node.children, oldPath, newPath, newName),
      };
    }

    return node;
  });
}

export function addNodeToParent(
  nodes: FileTreeNode[],
  parentPath: string,
  newNode: FileTreeNode
): FileTreeNode[] {
  return nodes.map((node) => {
    if (node.path === parentPath && node.isDirectory && node.isExpanded && node.children) {
      const children = [...node.children, newNode].sort((left, right) => {
        if (left.isDirectory !== right.isDirectory) {
          return left.isDirectory ? -1 : 1;
        }
        return left.name.localeCompare(right.name);
      });

      return { ...node, children };
    }

    if (node.isDirectory && node.children) {
      return {
        ...node,
        children: addNodeToParent(node.children, parentPath, newNode),
      };
    }

    return node;
  });
}

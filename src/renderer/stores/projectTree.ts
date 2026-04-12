import type { Language } from '../types';
import { languageFromPath } from '../utils/language';

export interface FileTreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  language?: Language;
  children?: FileTreeNode[];
  isExpanded?: boolean;
}

export function joinPath(base: string, name: string): string {
  const separator = base.includes('\\') ? '\\' : '/';
  return base.endsWith(separator) ? `${base}${name}` : `${base}${separator}${name}`;
}

export function entriesToNodes(
  entries: FsDirEntry[]
): FileTreeNode[] {
  return entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
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
  dirPath: string,
  expandedPaths: ReadonlySet<string>
): Promise<FileTreeNode[]> {
  const entries = await window.runlang.fs.readdir(dirPath);
  const nodes = entriesToNodes(entries);

  return Promise.all(
    nodes.map(async (node) => {
      if (!node.isDirectory || !expandedPaths.has(node.path)) {
        return node;
      }

      return {
        ...node,
        children: await loadNodesForDirectory(node.path, expandedPaths),
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
      return { ...node, path: newPath, name: newName };
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

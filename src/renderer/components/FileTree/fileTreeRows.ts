import type { FileTreeNode as ProjectFileTreeNode } from '../../stores/projectStore';
import type { CreationTarget } from './fileTreeTypes';

/**
 * IT2-B2 — flat row model for the virtualized explorer. The tree renders
 * as ONE windowed list (via the shared `useListWindow`), so everything
 * that used to render inside a directory's recursive `role="group"` block
 * must exist as a row with a stable key and a known display position:
 *
 * - `node` — a real file/directory row (the only focusable kind; keyboard
 *   navigation steps through these).
 * - `create` — the inline new-file/new-folder input, placed directly
 *   under its parent directory row (or at index 0 for a root-level
 *   creation).
 * - `empty-dir` — the "empty directory" hint under an expanded directory
 *   with no children.
 *
 * `depth` is the PARENT directory's depth for the synthetic kinds (the
 * pre-virtualization markup indented them by `(depth + 2) * 12 + 4`px,
 * which is preserved verbatim by the renderer).
 */
export type FlatTreeRow =
  | {
      kind: 'node';
      key: string;
      node: ProjectFileTreeNode;
      parentPath: string;
      depth: number;
    }
  | { kind: 'create'; key: string; parentPath: string; depth: number }
  | { kind: 'empty-dir'; key: string; parentPath: string; depth: number };

/**
 * Flatten the tree into the rows that are CURRENTLY visible (respecting
 * each directory's expanded state), in display order. Successor of the
 * UX Sweep T7 `flattenVisibleTree` — same walk, now emitting `depth` and
 * the synthetic `create` / `empty-dir` rows so the windowed list is the
 * single source of display order.
 *
 * Ordering contract per expanded directory (matches the recursive
 * markup this replaced): creation input first, then children, then the
 * empty-directory hint when there are no children.
 */
export function flattenVisibleRows(
  nodes: readonly ProjectFileTreeNode[],
  creating: CreationTarget,
  parentPath = '',
  depth = 0,
  out: FlatTreeRow[] = []
): FlatTreeRow[] {
  if (parentPath === '' && depth === 0 && creating && creating.parentPath === '') {
    out.push({ kind: 'create', key: 'create:', parentPath: '', depth: 0 });
  }
  for (const node of nodes) {
    out.push({ kind: 'node', key: node.path, node, parentPath, depth });
    if (node.isDirectory && node.isExpanded && node.children) {
      if (creating && creating.parentPath === node.path) {
        out.push({
          kind: 'create',
          key: `create:${node.path}`,
          parentPath: node.path,
          depth,
        });
      }
      flattenVisibleRows(node.children, creating, node.path, depth + 1, out);
      if (node.children.length === 0) {
        out.push({
          kind: 'empty-dir',
          key: `empty:${node.path}`,
          parentPath: node.path,
          depth,
        });
      }
    }
  }
  return out;
}

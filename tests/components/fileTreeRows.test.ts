/**
 * internal — display-order contract for the virtualized explorer's flat row
 * model, plus the windowing guarantee that motivated the change: a
 * 5,000-row tree mounts a viewport-sized slice, never the whole list.
 */

import { describe, expect, it } from 'vitest';
import { flattenVisibleRows } from '@/components/FileTree/fileTreeRows';
import { computeWindow } from '@/hooks/useListWindow';
import type { FileTreeNode } from '@/stores/projectStore';

function file(path: string): FileTreeNode {
  const name = path.split('/').pop() ?? path;
  return { path, name, isDirectory: false } as FileTreeNode;
}

function dir(
  path: string,
  children: FileTreeNode[] | undefined,
  isExpanded: boolean
): FileTreeNode {
  const name = path.split('/').pop() ?? path;
  return { path, name, isDirectory: true, isExpanded, children } as FileTreeNode;
}

describe('flattenVisibleRows', () => {
  const tree: FileTreeNode[] = [
    dir('src', [file('src/a.ts'), dir('src/lib', [file('src/lib/b.ts')], false)], true),
    dir('empty', [], true),
    dir('closed', [file('closed/hidden.ts')], false),
    file('readme.md'),
  ];

  it('emits visible rows in display order with depths', () => {
    const rows = flattenVisibleRows(tree, null);
    expect(
      rows.map((row) => (row.kind === 'node' ? `${row.node.path}@${row.depth}` : row.key))
    ).toEqual([
      'src@0',
      'src/a.ts@1',
      'src/lib@1',
      'empty@0',
      'empty:empty',
      'closed@0',
      'readme.md@0',
    ]);
    // Collapsed directories contribute their own row only — never children.
    expect(rows.some((row) => row.kind === 'node' && row.node.path === 'closed/hidden.ts')).toBe(
      false
    );
  });

  it('places the creation input directly under its parent directory', () => {
    const rows = flattenVisibleRows(tree, { parentPath: 'src', kind: 'file' });
    const keys = rows.map((row) => row.key);
    expect(keys.indexOf('create:src')).toBe(keys.indexOf('src') + 1);
    const createRow = rows.find((row) => row.kind === 'create');
    expect(createRow).toMatchObject({ parentPath: 'src', depth: 0 });
  });

  it('places a root-level creation input at index 0', () => {
    const rows = flattenVisibleRows(tree, { parentPath: '', kind: 'dir' });
    expect(rows[0]).toMatchObject({ kind: 'create', parentPath: '' });
  });

  it('keeps the empty-directory hint under its expanded parent', () => {
    const rows = flattenVisibleRows(tree, null);
    const keys = rows.map((row) => row.key);
    expect(keys.indexOf('empty:empty')).toBe(keys.indexOf('empty') + 1);
  });
});

describe('tree windowing guarantee', () => {
  it('mounts a viewport-sized slice of a 5,000-row tree', () => {
    const estimate = 26;
    const window = computeWindow({
      count: 5_000,
      heights: [],
      scrollTop: 2_000 * estimate,
      viewportHeight: 800,
      overscanPx: 600,
      estimate,
    });
    const mounted = window.endIndex - window.startIndex + 1;
    expect(mounted).toBeLessThan(100);
    expect(mounted).toBeGreaterThan(0);
    // Spacers preserve total scroll geometry.
    const total = 5_000 * estimate;
    expect(window.topSpacer + mounted * estimate + window.bottomSpacer).toBe(total);
  });
});

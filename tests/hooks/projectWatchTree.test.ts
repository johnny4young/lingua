import { describe, expect, it } from 'vitest';
import { collectFilePaths, collectLoadedDirs } from '@/hooks/projectWatchTree';
import type { FileTreeNode } from '@/stores/projectTree';

const tree: FileTreeNode[] = [
  {
    name: 'src',
    path: 'src',
    isDirectory: true,
    children: [
      { name: 'main.ts', path: 'src/main.ts', isDirectory: false },
      {
        name: 'nested',
        path: 'src/nested',
        isDirectory: true,
        children: [{ name: 'deep.ts', path: 'src/nested/deep.ts', isDirectory: false }],
      },
    ],
  },
  { name: 'unloaded', path: 'unloaded', isDirectory: true },
];

describe('project watch tree snapshots', () => {
  it('collects files only from loaded branches', () => {
    expect(Array.from(collectFilePaths(tree))).toEqual(['src/main.ts', 'src/nested/deep.ts']);
  });

  it('marks the root and directories with loaded children', () => {
    expect(Array.from(collectLoadedDirs(tree))).toEqual(['', 'src', 'src/nested']);
  });
});

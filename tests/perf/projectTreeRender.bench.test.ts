/**
 * RL-024 Slice 1 — file tree first-paint defense.
 *
 * The Slice 1 acceptance criterion is: opening a folder with ~50
 * files renders the tree within 500 ms. The cost we lock here is
 * `entriesToNodes` + the immutable `setNodeChildren` shape the
 * store hands the renderer on every `expandDirectory` / refresh.
 * If a future change starts re-sorting / re-validating / deep-
 * cloning per node, this bench fires before the user notices a
 * sluggish sidebar.
 *
 * Budget: 500 ms wall clock to build the in-memory tree for 50
 * files spread across 8 sibling directories + project root. CI
 * gets a 1.5× multiplier (750 ms) per the existing pattern in
 * `tests/shared/consoleRich.bench.test.ts`. The single-pass
 * benchmark walks the data through the same code path the
 * store uses: `entriesToNodes` flattens IPC `FsDirEntry[]` and
 * `setNodeChildren` immutably re-roots each subtree into the
 * parent.
 */

import { describe, it, expect } from 'vitest';
import {
  entriesToNodes,
  setNodeChildren,
  type FileTreeNode,
} from '@/stores/projectTree';

function makeFlatFixture(fileCount: number): {
  rootEntries: Array<{ name: string; isDirectory: boolean; relativePath: string }>;
  dirEntriesByPath: Map<
    string,
    Array<{ name: string; isDirectory: boolean; relativePath: string }>
  >;
} {
  const DIR_COUNT = 8;
  const FILES_PER_DIR = Math.ceil(fileCount / DIR_COUNT);
  const rootEntries: Array<{
    name: string;
    isDirectory: boolean;
    relativePath: string;
  }> = [];
  const dirEntriesByPath = new Map<
    string,
    Array<{ name: string; isDirectory: boolean; relativePath: string }>
  >();

  for (let d = 0; d < DIR_COUNT; d += 1) {
    const dirName = `dir-${d}`;
    rootEntries.push({
      name: dirName,
      isDirectory: true,
      relativePath: dirName,
    });
    const children: Array<{
      name: string;
      isDirectory: boolean;
      relativePath: string;
    }> = [];
    for (let f = 0; f < FILES_PER_DIR; f += 1) {
      const fileName = `file-${f}.ts`;
      children.push({
        name: fileName,
        isDirectory: false,
        relativePath: `${dirName}/${fileName}`,
      });
    }
    dirEntriesByPath.set(dirName, children);
  }
  return { rootEntries, dirEntriesByPath };
}

const BUDGET_MS =
  process.env.CI === 'true' ? 750 /* 1.5× CI flake margin */ : 500;

describe(`projectTreeRender bench — ${BUDGET_MS} ms budget for 50 files`, () => {
  it('entriesToNodes + setNodeChildren build a 50-file tree under budget', () => {
    const { rootEntries, dirEntriesByPath } = makeFlatFixture(50);

    // Warm-up — give V8 a chance to inline the tight loop before we
    // measure. Mirrors the warm-up in `consoleRich.bench.test.ts`.
    for (let i = 0; i < 5; i += 1) {
      const rootNodes = entriesToNodes(rootEntries);
      let nodes: FileTreeNode[] = rootNodes;
      for (const [dirPath, children] of dirEntriesByPath) {
        nodes = setNodeChildren(nodes, dirPath, entriesToNodes(children), true);
      }
    }

    const now = () =>
      typeof performance !== 'undefined' && performance.now
        ? performance.now()
        : Date.now();

    const startMs = now();
    const rootNodes = entriesToNodes(rootEntries);
    let nodes: FileTreeNode[] = rootNodes;
    for (const [dirPath, children] of dirEntriesByPath) {
      nodes = setNodeChildren(nodes, dirPath, entriesToNodes(children), true);
    }
    const elapsedMs = now() - startMs;

    expect(nodes.length).toBe(8);
    expect(elapsedMs).toBeLessThan(BUDGET_MS);
  });
});

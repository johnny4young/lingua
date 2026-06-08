/**
 * RL-146 / AUDIT-26 — watcher delta-refresh budget.
 *
 * Locks the win the delta refresh delivers over the legacy full walk: on
 * a watcher burst, `applyWatchChanges` re-reads only the directories that
 * structurally changed (skipping pure file-content events entirely),
 * whereas `refreshTree` re-`readdir`s the root plus every expanded
 * directory and re-allocates the whole tree.
 *
 * The scenario is a ~600-node project (60 expanded directories) hit by a
 * burst of renames concentrated in ONE directory — the shape of a
 * `git checkout` / formatter run that rewrites files under `src/`. The
 * bench asserts three things:
 *   - deterministic: the full walk issues `DIR_COUNT + 1` readdir calls,
 *     the delta exactly 1 (the dominant real-world cost is IPC round
 *     trips, so this readdir-count drop IS the perf win);
 *   - timing: the delta completes >5x faster than the full walk
 *     (AUDIT-26 acceptance criterion), min-of-iterations to dampen noise;
 *   - structural sharing (fold D): untouched sibling branches keep their
 *     object identity, so React re-renders O(branch) not O(N).
 *
 * CI gets a 1.5x leniency multiplier on the required speedup, mirroring
 * `console.bench.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '@/stores/projectStore';
import { buildNodeIndex, type FileTreeNode } from '@/stores/projectTree';

const IS_CI = process.env.CI === 'true';
// AUDIT-26 requires >5x; on the noisier CI box, require the same headline
// 5x but divided by the standard 1.5 leniency so transient scheduling
// jitter does not flake the gate (the deterministic readdir-count lock
// below stays exact regardless).
const REQUIRED_SPEEDUP = IS_CI ? 5 / 1.5 : 5;

const DIR_COUNT = 60;
const FILES_PER_DIR = 9; // 60 dirs * 9 files + 60 dirs = 600 nodes

interface DirEntry {
  name: string;
  isDirectory: boolean;
  relativePath: string;
}

function buildEntries(): Map<string, DirEntry[]> {
  const byDir = new Map<string, DirEntry[]>();
  const rootEntries: DirEntry[] = [];
  for (let d = 0; d < DIR_COUNT; d += 1) {
    const dir = `d${d}`;
    rootEntries.push({ name: dir, isDirectory: true, relativePath: dir });
    const files: DirEntry[] = [];
    for (let f = 0; f < FILES_PER_DIR; f += 1) {
      files.push({
        name: `f${f}.ts`,
        isDirectory: false,
        relativePath: `${dir}/f${f}.ts`,
      });
    }
    byDir.set(dir, files);
  }
  byDir.set('', rootEntries);
  return byDir;
}

function buildTree(byDir: Map<string, DirEntry[]>): FileTreeNode[] {
  return (byDir.get('') ?? []).map((dirEntry) => ({
    name: dirEntry.name,
    path: dirEntry.relativePath,
    isDirectory: true,
    isExpanded: true,
    children: (byDir.get(dirEntry.relativePath) ?? []).map((file) => ({
      name: file.name,
      path: file.relativePath,
      isDirectory: false,
    })),
  }));
}

describe('useProjectWatchSync delta refresh — burst budget (RL-146 / AUDIT-26)', () => {
  const mockReaddir = vi.fn<(rootId: string, rel: string) => Promise<DirEntry[]>>();

  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: {
        ...globalThis.window,
        lingua: {
          ...(globalThis.window?.lingua ?? {}),
          fs: {
            ...(globalThis.window?.lingua?.fs ?? {}),
            readdir: mockReaddir,
          },
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('re-reads one branch on a burst, >5x faster than a full walk', async () => {
    const byDir = buildEntries();
    mockReaddir.mockImplementation(async (_rootId, rel) => byDir.get(rel) ?? []);
    const tree = buildTree(byDir);

    function seed(): void {
      useProjectStore.setState({
        currentProject: {
          id: '/proj',
          name: 'proj',
          rootId: 'root-proj',
          rootPath: '/proj',
          openedAt: 0,
        },
        nodes: tree,
        nodeIndex: buildNodeIndex(tree),
        watchId: 'watch-1',
        recentProjects: [],
      });
    }

    // A burst of renames concentrated in one directory (git checkout / a
    // formatter rewriting files under d0), coalesced to one changed dir.
    const renameBurst = (byDir.get('d0') ?? []).map((file) => ({
      relativePath: file.relativePath,
      eventType: 'rename',
      filename: file.name,
    }));

    let fullMs = Infinity;
    let deltaMs = Infinity;
    let fullCalls = 0;
    let deltaCalls = 0;

    for (let i = 0; i < 10; i += 1) {
      seed();
      mockReaddir.mockClear();
      const fullStart = performance.now();
      await useProjectStore.getState().refreshTree();
      fullMs = Math.min(fullMs, performance.now() - fullStart);
      fullCalls = mockReaddir.mock.calls.length;

      seed();
      mockReaddir.mockClear();
      const deltaStart = performance.now();
      await useProjectStore.getState().applyWatchChanges(renameBurst);
      deltaMs = Math.min(deltaMs, performance.now() - deltaStart);
      deltaCalls = mockReaddir.mock.calls.length;
    }

    // Deterministic lock: the full walk re-reads the root + every expanded
    // directory; the delta re-reads exactly the one changed directory.
    expect(fullCalls).toBe(DIR_COUNT + 1);
    expect(deltaCalls).toBe(1);

    // Timing lock: the delta is at least REQUIRED_SPEEDUP times faster.
    expect(deltaMs * REQUIRED_SPEEDUP).toBeLessThan(fullMs);

    // Structural sharing (fold D): an untouched sibling branch keeps its
    // object identity across the delta.
    seed();
    const before = useProjectStore.getState().nodes;
    await useProjectStore.getState().applyWatchChanges(renameBurst);
    const after = useProjectStore.getState().nodes;
    expect(after.find((n) => n.path === 'd1')).toBe(
      before.find((n) => n.path === 'd1')
    );
    expect(after.find((n) => n.path === 'd0')).not.toBe(
      before.find((n) => n.path === 'd0')
    );
  });

  it('does zero readdir work for a pure file-content burst (fold B)', async () => {
    const byDir = buildEntries();
    mockReaddir.mockImplementation(async (_rootId, rel) => byDir.get(rel) ?? []);
    const tree = buildTree(byDir);
    useProjectStore.setState({
      currentProject: {
        id: '/proj',
        name: 'proj',
        rootId: 'root-proj',
        rootPath: '/proj',
        openedAt: 0,
      },
      nodes: tree,
      nodeIndex: buildNodeIndex(tree),
      watchId: 'watch-1',
      recentProjects: [],
    });

    const changeBurst = (byDir.get('d0') ?? []).map((file) => ({
      relativePath: file.relativePath,
      eventType: 'change',
      filename: file.name,
    }));
    const before = useProjectStore.getState().nodes;

    await useProjectStore.getState().applyWatchChanges(changeBurst);

    expect(mockReaddir).not.toHaveBeenCalled();
    expect(useProjectStore.getState().nodes).toBe(before);
  });
});

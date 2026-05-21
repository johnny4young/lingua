import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type FileTreeNode,
  useProjectStore,
} from '@/stores/projectStore';
import {
  entriesToNodes,
  collapseAll,
  collectExpandedPaths,
  countFiles,
  depthOf,
  MAX_TREE_EXPANSION_DEPTH,
  setNodeChildren,
  toggleExpanded,
  removeNode,
  renameNode,
  addNodeToParent,
} from '@/stores/projectTree';
import { useUIStore } from '@/stores/uiStore';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDir(name: string, path: string, children?: FileTreeNode[]): FileTreeNode {
  return { name, path, isDirectory: true, isExpanded: false, children };
}

function makeFile(name: string, path: string): FileTreeNode {
  return { name, path, isDirectory: false };
}

const initialState = useProjectStore.getState();

beforeEach(() => {
  Object.defineProperty(globalThis, 'window', {
    value: {
      ...globalThis.window,
      lingua: {
        ...(globalThis.window?.lingua ?? {}),
        fs: {
          ...(globalThis.window?.lingua?.fs ?? {}),
          readdir: vi.fn(),
          selectDirectory: vi.fn(),
          reopenRoot: vi.fn(),
          revokeRoot: vi.fn().mockResolvedValue(true),
          watchStart: vi.fn().mockResolvedValue('watch-new'),
          watchStop: vi.fn().mockResolvedValue(true),
        },
      },
    },
    writable: true,
    configurable: true,
  });
});

afterEach(() => {
  useProjectStore.setState(initialState, true);
  vi.clearAllMocks();
  localStorage.clear();
});

// ---------------------------------------------------------------------------
// setNodeChildren
// ---------------------------------------------------------------------------

describe('setNodeChildren', () => {
  it('sets children on a top-level directory node by path', () => {
    const nodes = [makeDir('src', '/proj/src')];
    const children = [makeFile('main.ts', '/proj/src/main.ts')];
    const result = setNodeChildren(nodes, '/proj/src', children, true);
    expect(result[0].children).toEqual(children);
  });

  it('sets children recursively on a nested directory node', () => {
    const inner = makeDir('utils', '/proj/src/utils');
    const outer = makeDir('src', '/proj/src', [inner]);
    const nodes = [outer];
    const children = [makeFile('helpers.ts', '/proj/src/utils/helpers.ts')];
    const result = setNodeChildren(nodes, '/proj/src/utils', children, true);
    expect(result[0].children![0].children).toEqual(children);
  });

  it('marks node as expanded=true when expanded arg is true', () => {
    const nodes = [makeDir('src', '/proj/src')];
    const result = setNodeChildren(nodes, '/proj/src', [], true);
    expect(result[0].isExpanded).toBe(true);
  });

  it('marks node as expanded=false when expanded arg is false', () => {
    const nodes = [{ ...makeDir('src', '/proj/src'), isExpanded: true }];
    const result = setNodeChildren(nodes, '/proj/src', [], false);
    expect(result[0].isExpanded).toBe(false);
  });

  it('does not affect non-matching nodes', () => {
    const nodes = [makeDir('src', '/proj/src'), makeDir('lib', '/proj/lib')];
    const result = setNodeChildren(nodes, '/proj/src', [], true);
    expect(result[1].isExpanded).toBe(false);
    expect(result[1].children).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// toggleExpanded
// ---------------------------------------------------------------------------

describe('toggleExpanded', () => {
  it('sets isExpanded=true on a matching directory', () => {
    const nodes = [makeDir('src', '/proj/src')];
    const result = toggleExpanded(nodes, '/proj/src', true);
    expect(result[0].isExpanded).toBe(true);
  });

  it('sets isExpanded=false on a matching directory', () => {
    const nodes = [{ ...makeDir('src', '/proj/src'), isExpanded: true }];
    const result = toggleExpanded(nodes, '/proj/src', false);
    expect(result[0].isExpanded).toBe(false);
  });

  it('recurses into nested trees to find the target', () => {
    const inner = makeDir('utils', '/proj/src/utils');
    const outer = makeDir('src', '/proj/src', [inner]);
    const nodes = [outer];
    const result = toggleExpanded(nodes, '/proj/src/utils', true);
    expect(result[0].children![0].isExpanded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// removeNode
// ---------------------------------------------------------------------------

describe('removeNode', () => {
  it('removes a top-level node by path', () => {
    const nodes = [makeFile('a.ts', '/proj/a.ts'), makeFile('b.ts', '/proj/b.ts')];
    const result = removeNode(nodes, '/proj/a.ts');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/proj/b.ts');
  });

  it('removes a nested node by path', () => {
    const file = makeFile('index.ts', '/proj/src/index.ts');
    const dir = makeDir('src', '/proj/src', [file]);
    const nodes = [dir];
    const result = removeNode(nodes, '/proj/src/index.ts');
    expect(result[0].children).toHaveLength(0);
  });

  it('returns the same tree if path not found', () => {
    const nodes = [makeFile('a.ts', '/proj/a.ts')];
    const result = removeNode(nodes, '/proj/nonexistent.ts');
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/proj/a.ts');
  });
});

// ---------------------------------------------------------------------------
// renameNode
// ---------------------------------------------------------------------------

describe('renameNode', () => {
  it('updates path and name of a matching node', () => {
    const nodes = [makeFile('old.ts', '/proj/old.ts')];
    const result = renameNode(nodes, '/proj/old.ts', '/proj/new.ts', 'new.ts');
    expect(result[0].path).toBe('/proj/new.ts');
    expect(result[0].name).toBe('new.ts');
  });

  it('recurses into nested trees', () => {
    const file = makeFile('old.ts', '/proj/src/old.ts');
    const dir = makeDir('src', '/proj/src', [file]);
    const nodes = [dir];
    const result = renameNode(nodes, '/proj/src/old.ts', '/proj/src/new.ts', 'new.ts');
    expect(result[0].children![0].path).toBe('/proj/src/new.ts');
    expect(result[0].children![0].name).toBe('new.ts');
    expect(result[0].children![0].language).toBe('typescript');
  });

  it('recomputes language metadata when a file extension changes', () => {
    const nodes = [
      {
        name: 'draft.rs',
        path: '/proj/draft.rs',
        isDirectory: false,
        language: 'rust' as const,
      },
    ];

    const result = renameNode(nodes, '/proj/draft.rs', '/proj/draft.txt', 'draft.txt');
    expect(result[0].language).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// addNodeToParent
// ---------------------------------------------------------------------------

describe('addNodeToParent', () => {
  it('adds a child to an expanded directory with children array', () => {
    const parent = { ...makeDir('src', '/proj/src', []), isExpanded: true };
    const nodes = [parent];
    const newFile = makeFile('index.ts', '/proj/src/index.ts');
    const result = addNodeToParent(nodes, '/proj/src', newFile);
    expect(result[0].children).toHaveLength(1);
    expect(result[0].children![0].path).toBe('/proj/src/index.ts');
  });

  it('sorts directories before files', () => {
    const existingFile = makeFile('a.ts', '/proj/src/a.ts');
    const parent = { ...makeDir('src', '/proj/src', [existingFile]), isExpanded: true };
    const nodes = [parent];
    const newDir = makeDir('utils', '/proj/src/utils', []);
    const result = addNodeToParent(nodes, '/proj/src', newDir);
    // Directory should come before file
    expect(result[0].children![0].isDirectory).toBe(true);
    expect(result[0].children![1].isDirectory).toBe(false);
  });

  it('does not add to a collapsed directory (isExpanded=false)', () => {
    // makeDir sets isExpanded: false by default
    const parent = makeDir('src', '/proj/src', []);
    const nodes = [parent];
    const newFile = makeFile('index.ts', '/proj/src/index.ts');
    const result = addNodeToParent(nodes, '/proj/src', newFile);
    expect(result[0].children).toHaveLength(0);
  });

  it('does not add to a non-matching parent', () => {
    const parent = { ...makeDir('src', '/proj/src', []), isExpanded: true };
    const nodes = [parent];
    const newFile = makeFile('index.ts', '/proj/lib/index.ts');
    const result = addNodeToParent(nodes, '/proj/lib', newFile);
    // /proj/lib doesn't exist in the tree, so nothing changes
    expect(result[0].children).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// collectExpandedPaths
// ---------------------------------------------------------------------------

describe('collectExpandedPaths', () => {
  it('returns expanded directory paths recursively', () => {
    const nested = { ...makeDir('utils', '/proj/src/utils', []), isExpanded: true };
    const nodes = [
      { ...makeDir('src', '/proj/src', [nested]), isExpanded: true },
      makeDir('docs', '/proj/docs'),
    ];

    expect(collectExpandedPaths(nodes)).toEqual(['/proj/src', '/proj/src/utils']);
  });
});

// ---------------------------------------------------------------------------
// depthOf — RL-024 Slice 1 depth guard
// ---------------------------------------------------------------------------

describe('depthOf', () => {
  it('returns 0 for the project root (empty string)', () => {
    expect(depthOf('')).toBe(0);
  });

  it('counts segments in a flat path', () => {
    expect(depthOf('src')).toBe(1);
  });

  it('counts segments in a nested path', () => {
    expect(depthOf('src/lib/utils')).toBe(3);
  });

  it('ignores leading and trailing slashes', () => {
    expect(depthOf('/src/lib/')).toBe(2);
  });

  it('counts up to MAX_TREE_EXPANSION_DEPTH for an 8-segment path', () => {
    expect(depthOf('a/b/c/d/e/f/g/h')).toBe(MAX_TREE_EXPANSION_DEPTH);
  });
});

// ---------------------------------------------------------------------------
// countFiles + collapseAll — RL-024 Slice 1 folds B + F
// ---------------------------------------------------------------------------

describe('countFiles', () => {
  it('returns 0 for an empty tree', () => {
    expect(countFiles([])).toBe(0);
  });

  it('counts files at the root', () => {
    expect(
      countFiles([
        makeFile('a.ts', 'a.ts'),
        makeFile('b.ts', 'b.ts'),
      ])
    ).toBe(2);
  });

  it('does not count directories themselves', () => {
    expect(
      countFiles([makeDir('src', 'src'), makeFile('a.ts', 'a.ts')])
    ).toBe(1);
  });

  it('recurses into loaded child directories', () => {
    const tree = [
      makeDir('src', 'src', [
        makeFile('main.ts', 'src/main.ts'),
        makeDir('lib', 'src/lib', [makeFile('util.ts', 'src/lib/util.ts')]),
      ]),
      makeFile('README.md', 'README.md'),
    ];
    expect(countFiles(tree)).toBe(3);
  });

  it('skips unloaded subtrees (lazy-load contract)', () => {
    // `children: undefined` means "not yet expanded" — count must
    // not assume a value there.
    const tree = [makeDir('src', 'src')];
    expect(countFiles(tree)).toBe(0);
  });
});

describe('collapseAll', () => {
  it('collapses every expanded directory in one walk', () => {
    const tree = [
      {
        ...makeDir('src', 'src', [
          {
            ...makeDir('lib', 'src/lib', []),
            isExpanded: true,
          },
        ]),
        isExpanded: true,
      },
    ];
    const out = collapseAll(tree);
    expect(out[0]!.isExpanded).toBe(false);
    expect(out[0]!.children?.[0]?.isExpanded).toBe(false);
  });

  it('preserves cached children so re-expanding does not re-fetch', () => {
    const cached = [makeFile('main.ts', 'src/main.ts')];
    const tree = [{ ...makeDir('src', 'src', cached), isExpanded: true }];
    const out = collapseAll(tree);
    expect(out[0]!.children).toHaveLength(1);
    expect(out[0]!.children?.[0]?.name).toBe('main.ts');
  });

  it('leaves leaf files untouched', () => {
    const tree = [makeFile('a.ts', 'a.ts')];
    const out = collapseAll(tree);
    expect(out[0]).toEqual(tree[0]);
  });
});

// ---------------------------------------------------------------------------
// expandDirectory depth cap
// ---------------------------------------------------------------------------

describe('projectStore expandDirectory depth cap', () => {
  beforeEach(() => {
    useUIStore.setState({ statusNotice: null });
  });

  it('refuses to expand a directory whose own depth is at the cap', async () => {
    const mockReaddir = vi.mocked(window.lingua.fs.readdir);
    useProjectStore.setState({
      currentProject: {
        id: '/proj',
        name: 'proj',
        rootId: 'root-proj',
        rootPath: '/proj',
        openedAt: Date.now(),
      },
      nodes: [],
      watchId: null,
      recentProjects: [],
    });

    const deepPath = 'a/b/c/d/e/f/g/h'; // depth 8 == MAX_TREE_EXPANSION_DEPTH
    await useProjectStore.getState().expandDirectory(deepPath);

    expect(mockReaddir).not.toHaveBeenCalled();
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('fileTree.depthLimitReached');
    expect(notice?.tone).toBe('warning');
  });

  it('still expands directories below the cap', async () => {
    const mockReaddir = vi
      .mocked(window.lingua.fs.readdir)
      .mockResolvedValue([
        { name: 'inner.ts', isDirectory: false, relativePath: 'a/b/c/inner.ts' },
      ]);
    useProjectStore.setState({
      currentProject: {
        id: '/proj',
        name: 'proj',
        rootId: 'root-proj',
        rootPath: '/proj',
        openedAt: Date.now(),
      },
      nodes: [
        {
          name: 'a',
          path: 'a',
          isDirectory: true,
          isExpanded: true,
          children: [
            {
              name: 'b',
              path: 'a/b',
              isDirectory: true,
              isExpanded: true,
              children: [
                {
                  name: 'c',
                  path: 'a/b/c',
                  isDirectory: true,
                  isExpanded: false,
                  children: undefined,
                },
              ],
            },
          ],
        },
      ],
      watchId: null,
      recentProjects: [],
    });

    await useProjectStore.getState().expandDirectory('a/b/c'); // depth 3

    expect(mockReaddir).toHaveBeenCalledWith('root-proj', 'a/b/c');
    expect(useUIStore.getState().statusNotice).toBeNull();
  });
});

describe('entriesToNodes', () => {
  it('leaves unknown file extensions without a language instead of forcing javascript', () => {
    const result = entriesToNodes([
      { name: 'notes.txt', isDirectory: false, relativePath: 'notes.txt' },
    ]);

    expect(result).toEqual([
      {
        name: 'notes.txt',
        path: 'notes.txt',
        isDirectory: false,
        language: undefined,
        children: undefined,
        isExpanded: false,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// project lifecycle
// ---------------------------------------------------------------------------

describe('projectStore createProject', () => {
  it('uses the picker-minted capability directly instead of reopening by path', async () => {
    vi.mocked(window.lingua.fs.selectDirectory).mockResolvedValue({
      canceled: false,
      rootId: 'root-picked',
      rootPath: '/picked',
    });
    vi.mocked(window.lingua.fs.readdir).mockResolvedValue([
      { name: 'README.md', isDirectory: false, relativePath: 'README.md' },
    ]);

    await useProjectStore.getState().createProject();

    const state = useProjectStore.getState();
    expect(window.lingua.fs.reopenRoot).not.toHaveBeenCalled();
    expect(state.currentProject?.rootId).toBe('root-picked');
    expect(state.currentProject?.rootPath).toBe('/picked');
    expect(state.nodes).toEqual([
      expect.objectContaining({
        name: 'README.md',
        path: 'README.md',
        isDirectory: false,
      }),
    ]);
  });

  it('derives a friendly project name from Windows-style root paths', async () => {
    vi.mocked(window.lingua.fs.selectDirectory).mockResolvedValue({
      canceled: false,
      rootId: 'root-picked',
      rootPath: 'C:\\Users\\dev\\picked',
    });
    vi.mocked(window.lingua.fs.readdir).mockResolvedValue([]);

    await useProjectStore.getState().createProject();

    expect(useProjectStore.getState().currentProject?.name).toBe('picked');
  });
});

// ---------------------------------------------------------------------------
// refreshTree
// ---------------------------------------------------------------------------

describe('projectStore refreshTree', () => {
  it('preserves expanded directories while refreshing children from disk', async () => {
    const mockReaddir = vi.mocked(window.lingua.fs.readdir);

    mockReaddir.mockImplementation(async (rootId: string, relativePath: string) => {
      if (rootId !== 'root-proj') return [];
      if (relativePath === '') {
        return [
          { name: 'src', isDirectory: true, relativePath: 'src' },
          { name: 'README.md', isDirectory: false, relativePath: 'README.md' },
        ];
      }
      if (relativePath === 'src') {
        return [
          { name: 'main.ts', isDirectory: false, relativePath: 'src/main.ts' },
        ];
      }
      return [];
    });

    useProjectStore.setState({
      currentProject: {
        id: '/proj',
        name: 'proj',
        rootId: 'root-proj',
        rootPath: '/proj',
        openedAt: Date.now(),
      },
      nodes: [
        {
          name: 'src',
          path: 'src',
          isDirectory: true,
          isExpanded: true,
          children: [],
        },
      ],
      watchId: 'watch-project',
      recentProjects: [],
    });

    await useProjectStore.getState().refreshTree();

    const [srcNode, readmeNode] = useProjectStore.getState().nodes;
    expect(mockReaddir).toHaveBeenCalledWith('root-proj', '');
    expect(mockReaddir).toHaveBeenCalledWith('root-proj', 'src');
    expect(srcNode?.path).toBe('src');
    expect(srcNode?.isExpanded).toBe(true);
    expect(srcNode?.children).toEqual([
      {
        name: 'main.ts',
        path: 'src/main.ts',
        isDirectory: false,
        language: 'typescript',
        children: undefined,
        isExpanded: false,
      },
    ]);
    expect(readmeNode?.path).toBe('README.md');
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  PROJECT_WATCH_REFRESH_DEBOUNCE_MS,
  useProjectWatchSync,
} from '@/hooks/useProjectWatchSync';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore, type WatchChange } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import { buildNodeIndex, type FileTreeNode } from '@/stores/projectTree';

function WatchSyncHarness() {
  useProjectWatchSync();
  return null;
}

const initialState = useProjectStore.getState();
const initialEditorState = useEditorStore.getState();
const initialUiState = useUIStore.getState();

describe('useProjectWatchSync', () => {
  const mockOnChanged = vi.fn<LinguaAPI['fs']['onChanged']>();
  const mockApplyWatchChanges =
    vi.fn<(changes: readonly WatchChange[]) => Promise<void>>();
  let emitChange: ((event: FsChangedEvent) => void) | null = null;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    unsubscribe = vi.fn();
    emitChange = null;
    mockApplyWatchChanges.mockResolvedValue();
    mockOnChanged.mockImplementation((callback) => {
      emitChange = callback;
      return unsubscribe;
    });

    Object.defineProperty(globalThis, 'window', {
      value: {
        ...globalThis.window,
        lingua: {
          ...(globalThis.window?.lingua ?? {}),
          fs: {
            ...(globalThis.window?.lingua?.fs ?? {}),
            onChanged: mockOnChanged,
          },
        },
      },
      writable: true,
      configurable: true,
    });

    useProjectStore.setState({
      ...initialState,
      currentProject: {
        id: '/proj',
        name: 'proj',
        rootId: 'root-proj',
        rootPath: '/proj',
        openedAt: Date.now(),
      },
      applyWatchChanges: mockApplyWatchChanges,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState(initialState, true);
    useEditorStore.setState(initialEditorState, true);
    useUIStore.setState(initialUiState, true);
    localStorage.clear();
  });

  it('subscribes once and unsubscribes on unmount', () => {
    const { unmount } = render(<WatchSyncHarness />);

    expect(mockOnChanged).toHaveBeenCalledOnce();

    unmount();

    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('refreshes the active project once after debounced matching change events', async () => {
    render(<WatchSyncHarness />);
    expect(mockOnChanged).toHaveBeenCalledOnce();
    expect(emitChange).toBeTypeOf('function');

    await act(async () => {
      emitChange?.({
        rootId: 'root-proj',
        relativePath: 'a.ts',
        eventType: 'rename',
        filename: 'a.ts',
      });
      emitChange?.({
        rootId: 'root-proj',
        relativePath: 'b.ts',
        eventType: 'change',
        filename: 'b.ts',
      });
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS - 25)
        )
    );
    expect(mockApplyWatchChanges).not.toHaveBeenCalled();

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, 50)
        )
    );
    expect(mockApplyWatchChanges).toHaveBeenCalledOnce();
  });

  it('keeps same-path structural changes when a later content change arrives before debounce', async () => {
    render(<WatchSyncHarness />);

    await act(async () => {
      emitChange?.({
        rootId: 'root-proj',
        relativePath: 'src/new.ts',
        eventType: 'rename',
        filename: 'new.ts',
      });
      emitChange?.({
        rootId: 'root-proj',
        relativePath: 'src/new.ts',
        eventType: 'change',
        filename: 'new.ts',
      });
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
        )
    );

    expect(mockApplyWatchChanges).toHaveBeenCalledWith([
      {
        relativePath: 'src/new.ts',
        eventType: 'rename',
        filename: 'new.ts',
      },
    ]);
  });

  it('drops pending deltas if the active project changes before debounce', async () => {
    render(<WatchSyncHarness />);

    await act(async () => {
      emitChange?.({
        rootId: 'root-proj',
        relativePath: 'src/new.ts',
        eventType: 'rename',
        filename: 'new.ts',
      });
      useProjectStore.setState({
        ...useProjectStore.getState(),
        currentProject: {
          id: '/other',
          name: 'other',
          rootId: 'root-other',
          rootPath: '/other',
          openedAt: Date.now(),
        },
      });
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
        )
    );

    expect(mockApplyWatchChanges).not.toHaveBeenCalled();
  });

  it('ignores changes for other projects', async () => {
    render(<WatchSyncHarness />);
    await Promise.resolve();

    emitChange?.({
      rootId: 'root-other',
      relativePath: 'a.ts',
      eventType: 'rename',
      filename: 'a.ts',
    });
    await new Promise((resolve) =>
      window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
    );

    expect(mockApplyWatchChanges).not.toHaveBeenCalled();
  });

  it('ignores changes when no project is open', async () => {
    useProjectStore.setState({ ...useProjectStore.getState(), currentProject: null });

    render(<WatchSyncHarness />);
    await Promise.resolve();

    emitChange?.({
      rootId: 'root-proj',
      relativePath: 'a.ts',
      eventType: 'rename',
      filename: 'a.ts',
    });
    await new Promise((resolve) =>
      window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
    );

    expect(mockApplyWatchChanges).not.toHaveBeenCalled();
  });

  it('warns when a tab file disappears because its loaded parent directory was deleted', async () => {
    const loadedTree: FileTreeNode[] = [
      {
        name: 'src',
        path: 'src',
        isDirectory: true,
        isExpanded: true,
        children: [
          {
            name: 'main.ts',
            path: 'src/main.ts',
            isDirectory: false,
            language: 'typescript',
          },
        ],
      },
    ];
    useProjectStore.setState({
      ...useProjectStore.getState(),
      nodes: loadedTree,
    });
    useEditorStore.setState({
      ...useEditorStore.getState(),
      tabs: [
        {
          id: 'tab-1',
          name: 'main.ts',
          language: 'typescript',
          content: '',
          isDirty: false,
          rootId: 'root-proj',
          relativePath: 'src/main.ts',
        },
      ],
    });
    mockApplyWatchChanges.mockImplementation(async () => {
      useProjectStore.setState({ ...useProjectStore.getState(), nodes: [] });
    });

    render(<WatchSyncHarness />);
    emitChange?.({
      rootId: 'root-proj',
      relativePath: 'src',
      eventType: 'rename',
      filename: 'src',
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
        )
    );

    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'fileTree.staleTab.deletedExternally'
    );
  });

  it('swallows refresh failures so watcher bursts do not create unhandled rejections', async () => {
    mockApplyWatchChanges.mockRejectedValue(new Error('permission denied'));
    render(<WatchSyncHarness />);

    emitChange?.({
      rootId: 'root-proj',
      relativePath: 'a.ts',
      eventType: 'change',
      filename: 'a.ts',
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
        )
    );

    expect(mockApplyWatchChanges).toHaveBeenCalledOnce();
    expect(useUIStore.getState().statusNotice).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// RL-146 / AUDIT-26 fold E — end-to-end delta readdir wiring. Uses the REAL
// applyWatchChanges so a watch event drives a scoped readdir of only the
// affected directory's branch (not a full tree walk).
// ---------------------------------------------------------------------------

describe('useProjectWatchSync — delta readdir wiring (RL-146)', () => {
  let emitChange: ((event: FsChangedEvent) => void) | null = null;
  const mockReaddir = vi.fn();

  beforeEach(() => {
    emitChange = null;
    mockReaddir.mockReset();
    const mockOnChanged = vi.fn((cb: (event: FsChangedEvent) => void) => {
      emitChange = cb;
      return vi.fn();
    });

    Object.defineProperty(globalThis, 'window', {
      value: {
        ...globalThis.window,
        lingua: {
          ...(globalThis.window?.lingua ?? {}),
          fs: {
            ...(globalThis.window?.lingua?.fs ?? {}),
            onChanged: mockOnChanged,
            readdir: mockReaddir,
          },
        },
      },
      writable: true,
      configurable: true,
    });

    const tree: FileTreeNode[] = [
      {
        name: 'src',
        path: 'src',
        isDirectory: true,
        isExpanded: true,
        children: [{ name: 'a.ts', path: 'src/a.ts', isDirectory: false }],
      },
      {
        name: 'lib',
        path: 'lib',
        isDirectory: true,
        isExpanded: true,
        children: [{ name: 'c.ts', path: 'lib/c.ts', isDirectory: false }],
      },
    ];
    useProjectStore.setState({
      ...initialState,
      currentProject: {
        id: '/proj',
        name: 'proj',
        rootId: 'root-proj',
        rootPath: '/proj',
        openedAt: 0,
      },
      nodes: tree,
      nodeIndex: buildNodeIndex(tree),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState(initialState, true);
    useEditorStore.setState(initialEditorState, true);
    useUIStore.setState(initialUiState, true);
    localStorage.clear();
    delete (window as unknown as { lingua?: unknown }).lingua;
  });

  it('re-reads only the affected parent directory on a rename event', async () => {
    mockReaddir.mockResolvedValue([
      { name: 'a.ts', isDirectory: false, relativePath: 'src/a.ts' },
      { name: 'new.ts', isDirectory: false, relativePath: 'src/new.ts' },
    ]);

    render(<WatchSyncHarness />);
    emitChange?.({
      rootId: 'root-proj',
      relativePath: 'src/new.ts',
      eventType: 'rename',
      filename: 'new.ts',
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
        )
    );

    expect(mockReaddir).toHaveBeenCalledTimes(1);
    expect(mockReaddir).toHaveBeenCalledWith('root-proj', 'src');
    const srcNode = useProjectStore
      .getState()
      .nodes.find((n) => n.path === 'src');
    expect(srcNode?.children?.map((c) => c.path)).toContain('src/new.ts');
  });

  it('does not re-read anything for a pure file change event (fold B)', async () => {
    render(<WatchSyncHarness />);
    emitChange?.({
      rootId: 'root-proj',
      relativePath: 'src/a.ts',
      eventType: 'change',
      filename: 'a.ts',
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
        )
    );

    expect(mockReaddir).not.toHaveBeenCalled();
  });
});

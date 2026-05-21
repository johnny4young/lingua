import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  PROJECT_WATCH_REFRESH_DEBOUNCE_MS,
  useProjectWatchSync,
} from '@/hooks/useProjectWatchSync';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUIStore } from '@/stores/uiStore';
import type { FileTreeNode } from '@/stores/projectTree';

function WatchSyncHarness() {
  useProjectWatchSync();
  return null;
}

const initialState = useProjectStore.getState();
const initialEditorState = useEditorStore.getState();
const initialUiState = useUIStore.getState();

describe('useProjectWatchSync', () => {
  const mockOnChanged = vi.fn<LinguaAPI['fs']['onChanged']>();
  const mockRefreshTree = vi.fn<() => Promise<void>>();
  let emitChange: ((event: FsChangedEvent) => void) | null = null;
  let unsubscribe: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    unsubscribe = vi.fn();
    emitChange = null;
    mockRefreshTree.mockResolvedValue();
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
        lastOpenedAt: Date.now(),
      },
      refreshTree: mockRefreshTree,
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
    expect(mockRefreshTree).not.toHaveBeenCalled();

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, 50)
        )
    );
    expect(mockRefreshTree).toHaveBeenCalledOnce();
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

    expect(mockRefreshTree).not.toHaveBeenCalled();
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

    expect(mockRefreshTree).not.toHaveBeenCalled();
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
    mockRefreshTree.mockImplementation(async () => {
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
    mockRefreshTree.mockRejectedValue(new Error('permission denied'));
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

    expect(mockRefreshTree).toHaveBeenCalledOnce();
    expect(useUIStore.getState().statusNotice).toBeNull();
  });
});

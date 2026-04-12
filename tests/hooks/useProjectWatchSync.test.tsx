import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  PROJECT_WATCH_REFRESH_DEBOUNCE_MS,
  useProjectWatchSync,
} from '@/hooks/useProjectWatchSync';
import { useProjectStore } from '@/stores/projectStore';

function WatchSyncHarness() {
  useProjectWatchSync();
  return null;
}

const initialState = useProjectStore.getState();

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
        rootPath: '/proj',
        openedAt: Date.now(),
      },
      refreshTree: mockRefreshTree,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState(initialState, true);
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
      emitChange?.({ dirPath: '/proj', eventType: 'rename', filename: 'a.ts' });
      emitChange?.({ dirPath: '/proj', eventType: 'change', filename: 'b.ts' });
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

    emitChange?.({ dirPath: '/other', eventType: 'rename', filename: 'a.ts' });
    await new Promise((resolve) =>
      window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
    );

    expect(mockRefreshTree).not.toHaveBeenCalled();
  });

  it('ignores changes when no project is open', async () => {
    useProjectStore.setState({ ...useProjectStore.getState(), currentProject: null });

    render(<WatchSyncHarness />);
    await Promise.resolve();

    emitChange?.({ dirPath: '/proj', eventType: 'rename', filename: 'a.ts' });
    await new Promise((resolve) =>
      window.setTimeout(resolve, PROJECT_WATCH_REFRESH_DEBOUNCE_MS + 25)
    );

    expect(mockRefreshTree).not.toHaveBeenCalled();
  });
});

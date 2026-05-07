import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import {
  PROJECT_INDEX_REFRESH_DEBOUNCE_MS,
  useProjectIndexSync,
} from '@/hooks/useProjectIndexSync';
import { useProjectIndexStore } from '@/stores/projectIndexStore';
import { useProjectStore } from '@/stores/projectStore';

function Harness() {
  useProjectIndexSync();
  return null;
}

describe('useProjectIndexSync', () => {
  const mockOnChanged = vi.fn<LinguaAPI['fs']['onChanged']>();
  const mockRefresh = vi.fn<(rootId: string) => Promise<void>>();
  const mockClear = vi.fn<() => void>();
  let emit: ((event: FsChangedEvent) => void) | null = null;
  let unsubscribe: ReturnType<typeof vi.fn>;
  const initialProjectState = useProjectStore.getState();
  const initialIndexState = useProjectIndexStore.getState();

  beforeEach(() => {
    emit = null;
    unsubscribe = vi.fn();
    mockOnChanged.mockImplementation((callback) => {
      emit = callback;
      return unsubscribe;
    });
    mockRefresh.mockResolvedValue();

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

    useProjectIndexStore.setState({
      ...initialIndexState,
      refresh: mockRefresh,
      clear: mockClear,
    });

    useProjectStore.setState({
      ...initialProjectState,
      currentProject: {
        id: '/proj',
        name: 'proj',
        rootId: 'root-proj',
        rootPath: '/proj',
        openedAt: Date.now(),
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState(initialProjectState, true);
    useProjectIndexStore.setState(initialIndexState, true);
    localStorage.clear();
  });

  it('refreshes the index for the active project on mount', () => {
    render(<Harness />);
    expect(mockRefresh).toHaveBeenCalledWith('root-proj');
  });

  it('clears the index when no project is open', () => {
    useProjectStore.setState({
      ...useProjectStore.getState(),
      currentProject: null,
    });
    render(<Harness />);
    expect(mockClear).toHaveBeenCalled();
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('drops events from ignored prefixes before scheduling a rebuild', async () => {
    render(<Harness />);
    mockRefresh.mockClear();

    await act(async () => {
      // 50 events all under `node_modules/`.
      for (let i = 0; i < 50; i += 1) {
        emit?.({
          rootId: 'root-proj',
          relativePath: `node_modules/pkg/file-${i}.js`,
          eventType: 'change',
          filename: `file-${i}.js`,
        });
      }
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_INDEX_REFRESH_DEBOUNCE_MS + 50)
        )
    );

    // The whole burst was filtered out — no rebuild scheduled.
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('rebuilds once for a burst of visible events after debounce', async () => {
    render(<Harness />);
    mockRefresh.mockClear();

    await act(async () => {
      for (let i = 0; i < 25; i += 1) {
        emit?.({
          rootId: 'root-proj',
          relativePath: `src/feature-${i}.ts`,
          eventType: 'change',
          filename: `feature-${i}.ts`,
        });
      }
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_INDEX_REFRESH_DEBOUNCE_MS + 50)
        )
    );

    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockRefresh).toHaveBeenCalledWith('root-proj');
  });

  it('rebuilds once for a mixed burst — only the visible slice survives', async () => {
    render(<Harness />);
    mockRefresh.mockClear();

    await act(async () => {
      for (let i = 0; i < 25; i += 1) {
        emit?.({
          rootId: 'root-proj',
          relativePath: `node_modules/pkg/file-${i}.js`,
          eventType: 'change',
          filename: `file-${i}.js`,
        });
      }
      for (let i = 0; i < 25; i += 1) {
        emit?.({
          rootId: 'root-proj',
          relativePath: `src/feature-${i}.ts`,
          eventType: 'change',
          filename: `feature-${i}.ts`,
        });
      }
    });

    await act(
      async () =>
        await new Promise((resolve) =>
          window.setTimeout(resolve, PROJECT_INDEX_REFRESH_DEBOUNCE_MS + 50)
        )
    );

    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('ignores events for other projects', async () => {
    render(<Harness />);
    mockRefresh.mockClear();

    emit?.({
      rootId: 'root-other',
      relativePath: 'src/foo.ts',
      eventType: 'change',
      filename: 'foo.ts',
    });

    await new Promise((resolve) =>
      window.setTimeout(resolve, PROJECT_INDEX_REFRESH_DEBOUNCE_MS + 50)
    );

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('ignores .git/ events', async () => {
    render(<Harness />);
    mockRefresh.mockClear();

    emit?.({
      rootId: 'root-proj',
      relativePath: '.git/HEAD',
      eventType: 'change',
      filename: 'HEAD',
    });

    await new Promise((resolve) =>
      window.setTimeout(resolve, PROJECT_INDEX_REFRESH_DEBOUNCE_MS + 50)
    );

    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = render(<Harness />);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});

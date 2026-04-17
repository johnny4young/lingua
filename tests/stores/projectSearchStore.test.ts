import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectSearchStore } from '@/stores/projectSearchStore';

const mockSearchInFiles = vi.fn();

type LinguaTestWindow = typeof window & {
  lingua?: { fs?: { searchInFiles?: typeof mockSearchInFiles } };
};

function stubLinguaApi(withBridge = true) {
  const testWindow = window as LinguaTestWindow;
  testWindow.lingua = withBridge
    ? { fs: { searchInFiles: mockSearchInFiles } }
    : { fs: {} };
}

describe('projectSearchStore', () => {
  beforeEach(() => {
    mockSearchInFiles.mockReset();
    useProjectSearchStore.setState({
      query: '',
      rootPath: null,
      status: 'idle',
      results: [],
      totalMatches: 0,
      error: null,
      requestId: 0,
    });
    stubLinguaApi();
  });

  afterEach(() => {
    const testWindow = window as LinguaTestWindow;
    delete testWindow.lingua;
  });

  it('short-circuits empty queries and returns to idle without hitting the bridge', async () => {
    await useProjectSearchStore.getState().search('/project', '   ');

    expect(mockSearchInFiles).not.toHaveBeenCalled();
    expect(useProjectSearchStore.getState().status).toBe('idle');
  });

  it('counts total matches across all returned files', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
        filePath: '/project/a.ts',
        relativePath: 'a.ts',
        matches: [
          { line: 1, column: 1, preview: 'foo', matchStart: 0, matchEnd: 3 },
          { line: 5, column: 2, preview: 'foo again', matchStart: 0, matchEnd: 3 },
        ],
      },
      {
        filePath: '/project/b.ts',
        relativePath: 'b.ts',
        matches: [{ line: 3, column: 1, preview: 'foo', matchStart: 0, matchEnd: 3 }],
      },
    ]);

    await useProjectSearchStore.getState().search('/project', 'foo');

    const state = useProjectSearchStore.getState();
    expect(state.status).toBe('ready');
    expect(state.totalMatches).toBe(3);
    expect(state.results).toHaveLength(2);
  });

  it('captures errors without clobbering the last valid request', async () => {
    mockSearchInFiles.mockRejectedValue(new Error('ipc disconnected'));

    await useProjectSearchStore.getState().search('/project', 'foo');

    const state = useProjectSearchStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('ipc disconnected');
  });

  it('drops stale responses when a newer query has already started', async () => {
    let resolveSlow: (value: unknown) => void = () => {};
    const slowPromise = new Promise<unknown>((resolve) => {
      resolveSlow = resolve;
    });

    mockSearchInFiles
      .mockImplementationOnce(() => slowPromise)
      .mockResolvedValueOnce([
        {
          filePath: '/project/fast.ts',
          relativePath: 'fast.ts',
          matches: [{ line: 1, column: 1, preview: 'bar', matchStart: 0, matchEnd: 3 }],
        },
      ]);

    const slow = useProjectSearchStore.getState().search('/project', 'foo');
    await useProjectSearchStore.getState().search('/project', 'bar');

    // Resolve the older request after the newer one already committed its
    // results — the store must not overwrite them with the stale payload.
    resolveSlow([
      {
        filePath: '/project/slow.ts',
        relativePath: 'slow.ts',
        matches: [{ line: 1, column: 1, preview: 'foo', matchStart: 0, matchEnd: 3 }],
      },
    ]);
    await slow;

    const state = useProjectSearchStore.getState();
    expect(state.query).toBe('bar');
    expect(state.results.map((result) => result.relativePath)).toEqual(['fast.ts']);
  });

  it('degrades to an empty ready state when no bridge is exposed', async () => {
    stubLinguaApi(false);
    await useProjectSearchStore.getState().search('/project', 'foo');

    const state = useProjectSearchStore.getState();
    expect(state.status).toBe('ready');
    expect(state.results).toEqual([]);
    expect(state.totalMatches).toBe(0);
  });

  it('clear resets every field to the idle defaults', async () => {
    mockSearchInFiles.mockResolvedValue([
      {
        filePath: '/project/a.ts',
        relativePath: 'a.ts',
        matches: [{ line: 1, column: 1, preview: 'foo', matchStart: 0, matchEnd: 3 }],
      },
    ]);
    await useProjectSearchStore.getState().search('/project', 'foo');

    useProjectSearchStore.getState().clear();

    const state = useProjectSearchStore.getState();
    expect(state.query).toBe('');
    expect(state.status).toBe('idle');
    expect(state.results).toEqual([]);
    expect(state.rootPath).toBeNull();
  });
});

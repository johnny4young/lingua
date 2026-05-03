import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectIndexStore } from '@/stores/projectIndexStore';

const mockListAllFiles = vi.fn();

type LinguaTestWindow = typeof window & {
  lingua?: { fs?: { listAllFiles?: (path: string) => Promise<unknown[]> } };
};

function stubLinguaApi(withListAllFiles = true) {
  const testWindow = window as LinguaTestWindow;
  testWindow.lingua = withListAllFiles
    ? { fs: { listAllFiles: mockListAllFiles } }
    : { fs: {} };
}

function restoreLinguaApi() {
  const testWindow = window as LinguaTestWindow;
  delete testWindow.lingua;
}

describe('projectIndexStore', () => {
  beforeEach(() => {
    mockListAllFiles.mockReset();
    useProjectIndexStore.setState({
      rootId: null,
      status: 'idle',
      entries: [],
      lastIndexedAt: null,
      error: null,
    });
    stubLinguaApi();
  });

  afterEach(() => {
    restoreLinguaApi();
  });

  it('starts with an empty idle state', () => {
    const state = useProjectIndexStore.getState();
    expect(state.status).toBe('idle');
    expect(state.entries).toEqual([]);
    expect(state.rootId).toBeNull();
  });

  it('refresh populates the index with language metadata derived from extensions', async () => {
    mockListAllFiles.mockResolvedValue([
      { name: 'main.ts', relativePath: 'main.ts' },
      { name: 'README', relativePath: 'README' },
      { name: 'data.csv', relativePath: 'data/data.csv' },
    ]);

    await useProjectIndexStore.getState().refresh('root-proj');

    const state = useProjectIndexStore.getState();
    expect(state.status).toBe('ready');
    expect(state.rootId).toBe('root-proj');
    expect(state.entries).toEqual([
      { name: 'main.ts', relativePath: 'main.ts', language: 'typescript' },
      { name: 'README', relativePath: 'README', language: undefined },
      { name: 'data.csv', relativePath: 'data/data.csv', language: 'csv' },
    ]);
    expect(state.lastIndexedAt).toBeGreaterThan(0);
  });

  it('degrades to idle when the runtime has no listAllFiles bridge', async () => {
    stubLinguaApi(false);
    await useProjectIndexStore.getState().refresh('root-proj');

    const state = useProjectIndexStore.getState();
    expect(state.status).toBe('idle');
    expect(state.entries).toEqual([]);
    expect(mockListAllFiles).not.toHaveBeenCalled();
  });

  it('captures walker errors and transitions to the error state', async () => {
    mockListAllFiles.mockRejectedValue(new Error('disk unreadable'));
    await useProjectIndexStore.getState().refresh('root-proj');

    const state = useProjectIndexStore.getState();
    expect(state.status).toBe('error');
    expect(state.error).toBe('disk unreadable');
    expect(state.entries).toEqual([]);
  });

  it('drops stale responses when the root changes mid-walk', async () => {
    let resolveFirst: (value: unknown[]) => void = () => {};
    const firstPromise = new Promise<unknown[]>((resolve) => {
      resolveFirst = resolve;
    });

    mockListAllFiles
      .mockImplementationOnce(() => firstPromise)
      .mockResolvedValueOnce([{ name: 'other.ts', relativePath: 'other.ts' }]);

    const first = useProjectIndexStore.getState().refresh('root-proj');
    await useProjectIndexStore.getState().refresh('root-other');

    // Resolve the stale walk AFTER the newer root has committed.
    resolveFirst([{ name: 'stale.ts', relativePath: 'stale.ts' }]);
    await first;

    const state = useProjectIndexStore.getState();
    expect(state.rootId).toBe('root-other');
    expect(state.entries.map((entry) => entry.name)).toEqual(['other.ts']);
  });

  it('clear resets the store to the idle state', async () => {
    mockListAllFiles.mockResolvedValue([
      { name: 'main.ts', relativePath: 'main.ts' },
    ]);
    await useProjectIndexStore.getState().refresh('root-proj');
    useProjectIndexStore.getState().clear();

    const state = useProjectIndexStore.getState();
    expect(state.status).toBe('idle');
    expect(state.entries).toEqual([]);
    expect(state.rootId).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectReplaceStore } from '@/stores/projectReplaceStore';
import i18next from 'i18next';

const mockReplaceInFiles = vi.fn();
const mockApplyReplaceInFile = vi.fn();

type LinguaTestWindow = typeof window & {
  lingua?: {
    fs?: {
      replaceInFiles?: typeof mockReplaceInFiles;
      applyReplaceInFile?: typeof mockApplyReplaceInFile;
    };
  };
};

function stubLinguaApi(withBridge = true) {
  const testWindow = window as LinguaTestWindow;
  testWindow.lingua = withBridge
    ? {
        fs: {
          replaceInFiles: mockReplaceInFiles,
          applyReplaceInFile: mockApplyReplaceInFile,
        },
      }
    : { fs: {} };
}

function previewResult(relativePath: string, count: number) {
  const matches = Array.from({ length: count }, (_, idx) => ({
    line: idx + 1,
    column: 1,
    preview: 'oldName',
    matchStart: 0,
    matchEnd: 7,
    replacedPreview: 'newName',
    replacement: 'newName',
  }));
  return { relativePath, matches };
}

describe('projectReplaceStore', () => {
  beforeEach(() => {
    mockReplaceInFiles.mockReset();
    mockApplyReplaceInFile.mockReset();
    useProjectReplaceStore.setState({
      query: '',
      replacement: '',
      regex: false,
      caseSensitive: false,
      rootId: null,
      status: 'idle',
      results: [],
      totalMatches: 0,
      error: null,
      requestId: 0,
      applying: new Set<string>(),
      applyProgress: null,
    });
    stubLinguaApi();
  });

  afterEach(() => {
    const testWindow = window as LinguaTestWindow;
    delete testWindow.lingua;
  });

  it('short-circuits empty queries without hitting the bridge', async () => {
    useProjectReplaceStore.getState().setQuery('');
    await useProjectReplaceStore.getState().preview('root');

    expect(mockReplaceInFiles).not.toHaveBeenCalled();
    expect(useProjectReplaceStore.getState().status).toBe('idle');
  });

  it('preserves whitespace in non-empty queries', async () => {
    mockReplaceInFiles.mockResolvedValue([]);

    useProjectReplaceStore.getState().setQuery(' oldName ');
    await useProjectReplaceStore.getState().preview('root');

    expect(mockReplaceInFiles).toHaveBeenCalledWith(
      'root',
      '',
      ' oldName ',
      '',
      { regex: false, caseSensitive: false }
    );
  });

  it('previews matches grouped by file and counts totals', async () => {
    mockReplaceInFiles.mockResolvedValue([
      previewResult('a.ts', 2),
      previewResult('b.ts', 1),
    ]);

    useProjectReplaceStore.getState().setQuery('oldName');
    useProjectReplaceStore.getState().setReplacement('newName');
    await useProjectReplaceStore.getState().preview('root');

    const state = useProjectReplaceStore.getState();
    expect(state.status).toBe('ready');
    expect(state.totalMatches).toBe(3);
    expect(state.results.map((r) => r.relativePath)).toEqual(['a.ts', 'b.ts']);
    expect(mockReplaceInFiles).toHaveBeenCalledWith(
      'root',
      '',
      'oldName',
      'newName',
      { regex: false, caseSensitive: false }
    );
  });

  it('drops stale preview responses when a newer query overtakes', async () => {
    let resolveSlow: (value: unknown) => void = () => {};
    const slowPromise = new Promise<unknown>((resolve) => {
      resolveSlow = resolve;
    });
    mockReplaceInFiles
      .mockImplementationOnce(() => slowPromise)
      .mockResolvedValueOnce([previewResult('fast.ts', 1)]);

    useProjectReplaceStore.getState().setQuery('foo');
    const slow = useProjectReplaceStore.getState().preview('root');

    useProjectReplaceStore.getState().setQuery('bar');
    await useProjectReplaceStore.getState().preview('root');

    resolveSlow([previewResult('slow.ts', 5)]);
    await slow;

    const state = useProjectReplaceStore.getState();
    expect(state.results.map((r) => r.relativePath)).toEqual(['fast.ts']);
  });

  it('captures errors via i18n-mapped messages', async () => {
    mockReplaceInFiles.mockRejectedValue(
      new Error('Filesystem capability error: unknown-root')
    );

    const previous = i18next.language;
    await i18next.changeLanguage('en');
    try {
      useProjectReplaceStore.getState().setQuery('foo');
      await useProjectReplaceStore.getState().preview('root');
      const state = useProjectReplaceStore.getState();
      expect(state.status).toBe('error');
      expect(state.error).toContain('no longer authorized');
    } finally {
      await i18next.changeLanguage(previous);
    }
  });

  it('marks files with regexTimedOut so the overlay can flag them', async () => {
    mockReplaceInFiles.mockResolvedValue([
      { ...previewResult('slow.ts', 0), regexTimedOut: true },
    ]);

    useProjectReplaceStore.getState().setQuery('.*.*.*');
    useProjectReplaceStore.getState().setRegex(true);
    await useProjectReplaceStore.getState().preview('root');

    const state = useProjectReplaceStore.getState();
    expect(state.results[0]?.regexTimedOut).toBe(true);
  });

  it('applyToFile removes the row when the IPC succeeds', async () => {
    mockReplaceInFiles.mockResolvedValue([
      previewResult('a.ts', 2),
      previewResult('b.ts', 1),
    ]);
    useProjectReplaceStore.getState().setQuery('oldName');
    useProjectReplaceStore.getState().setReplacement('newName');
    await useProjectReplaceStore.getState().preview('root');

    mockApplyReplaceInFile.mockResolvedValue({ ok: true, replaced: 2 });
    const result = await useProjectReplaceStore
      .getState()
      .applyToFile('a.ts');

    expect(result).toEqual({ ok: true, replaced: 2 });
    const state = useProjectReplaceStore.getState();
    expect(state.results.map((r) => r.relativePath)).toEqual(['b.ts']);
    expect(state.totalMatches).toBe(1);
  });

  it('applyToFile keeps the row when the IPC fails', async () => {
    mockReplaceInFiles.mockResolvedValue([previewResult('a.ts', 1)]);
    useProjectReplaceStore.getState().setQuery('oldName');
    await useProjectReplaceStore.getState().preview('root');

    mockApplyReplaceInFile.mockResolvedValue({
      ok: false,
      replaced: 0,
      reason: 'read-error',
    });
    const result = await useProjectReplaceStore
      .getState()
      .applyToFile('a.ts');

    expect(result.ok).toBe(false);
    expect(useProjectReplaceStore.getState().results).toHaveLength(1);
  });

  it('applyToAll walks eligible files, tracks progress, and excludes regex-timed-out files', async () => {
    mockReplaceInFiles.mockResolvedValue([
      previewResult('a.ts', 1),
      previewResult('b.ts', 1),
      { ...previewResult('c.ts', 0), regexTimedOut: true },
    ]);
    useProjectReplaceStore.getState().setQuery('oldName');
    await useProjectReplaceStore.getState().preview('root');

    mockApplyReplaceInFile.mockResolvedValue({ ok: true, replaced: 1 });

    const progressSnapshots: Array<{ done: number; total: number } | null> = [];
    const unsubscribe = useProjectReplaceStore.subscribe((state) => {
      if (state.applyProgress) {
        progressSnapshots.push({ ...state.applyProgress });
      }
    });

    const summary = await useProjectReplaceStore.getState().applyToAll();
    unsubscribe();

    expect(summary).toEqual({ ok: 2, failed: 0, replaced: 2 });
    // Eligible = 2 files; we should see at least the initial {0,2} and final {2,2}.
    expect(progressSnapshots.at(0)).toEqual({ done: 0, total: 2 });
    expect(progressSnapshots.at(-1)).toEqual({ done: 2, total: 2 });
    expect(mockApplyReplaceInFile).toHaveBeenCalledTimes(2);
    // c.ts must not have been touched.
    const touched = mockApplyReplaceInFile.mock.calls.map((args) => args[1]);
    expect(touched).not.toContain('c.ts');
  });

  it('applyToFile via:monaco does not hit the IPC bridge', async () => {
    mockReplaceInFiles.mockResolvedValue([previewResult('open.ts', 1)]);
    useProjectReplaceStore.getState().setQuery('oldName');
    await useProjectReplaceStore.getState().preview('root');

    const result = await useProjectReplaceStore
      .getState()
      .applyToFile('open.ts', { via: 'monaco' });

    expect(mockApplyReplaceInFile).not.toHaveBeenCalled();
    expect(result.ok).toBe(true);
    // The row is still removed (Monaco edit succeeded).
    expect(useProjectReplaceStore.getState().results).toHaveLength(0);
  });

  it('clear resets every field to idle defaults', async () => {
    mockReplaceInFiles.mockResolvedValue([previewResult('a.ts', 1)]);
    useProjectReplaceStore.getState().setQuery('oldName');
    useProjectReplaceStore.getState().setReplacement('newName');
    useProjectReplaceStore.getState().setRegex(true);
    useProjectReplaceStore.getState().setCaseSensitive(true);
    await useProjectReplaceStore.getState().preview('root');

    const beforeRequestId = useProjectReplaceStore.getState().requestId;
    useProjectReplaceStore.getState().clear();

    const state = useProjectReplaceStore.getState();
    expect(state.query).toBe('');
    expect(state.replacement).toBe('');
    expect(state.regex).toBe(false);
    expect(state.caseSensitive).toBe(false);
    expect(state.results).toEqual([]);
    expect(state.status).toBe('idle');
    expect(state.rootId).toBeNull();
    expect(state.requestId).toBe(beforeRequestId + 1);
  });

  it('degrades to an empty ready state when no bridge is exposed', async () => {
    stubLinguaApi(false);
    useProjectReplaceStore.getState().setQuery('oldName');
    await useProjectReplaceStore.getState().preview('root');

    const state = useProjectReplaceStore.getState();
    expect(state.status).toBe('ready');
    expect(state.results).toEqual([]);
  });
});

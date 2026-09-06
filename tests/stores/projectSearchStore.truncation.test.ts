import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_SEARCH_MAX_MATCHES,
  useProjectSearchStore,
} from '../../src/renderer/stores/projectSearchStore';

type LinguaTestWindow = Window & { lingua?: unknown };

const mockSearchInFiles = vi.fn();

function matchesFor(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    line: index + 1,
    column: 1,
    preview: `hit ${index}`,
    matchStart: 0,
    matchEnd: 3,
  }));
}

describe('projectSearchStore result cap', () => {
  beforeEach(() => {
    mockSearchInFiles.mockReset();
    useProjectSearchStore.getState().clear();
    (window as LinguaTestWindow).lingua = { fs: { searchInFiles: mockSearchInFiles } };
  });
  afterEach(() => {
    delete (window as LinguaTestWindow).lingua;
  });

  it.each([499, 500, 501])('handles %i matches across a file boundary', async count => {
    mockSearchInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: matchesFor(499) },
      ...(count > 499 ? [{ relativePath: 'b.ts', matches: matchesFor(count - 499) }] : []),
    ]);
    await useProjectSearchStore.getState().search('root-1', 'needle');
    const state = useProjectSearchStore.getState();
    expect(mockSearchInFiles.mock.calls[0]?.[3]).toEqual({ maxTotalMatches: 501 });
    expect(state.totalMatches).toBe(Math.min(count, PROJECT_SEARCH_MAX_MATCHES));
    expect(state.truncated).toBe(count > PROJECT_SEARCH_MAX_MATCHES);
    expect(state.results.flatMap(result => result.matches)).toHaveLength(state.totalMatches);
    expect(state.results.at(-1)?.matches).toHaveLength(count > 499 ? 1 : 499);
  });

  it('does not retain a sentinel-only file group', async () => {
    mockSearchInFiles.mockResolvedValue([
      { relativePath: 'a.ts', matches: matchesFor(500) },
      { relativePath: 'b.ts', matches: matchesFor(1) },
    ]);
    await useProjectSearchStore.getState().search('root-1', 'needle');
    expect(useProjectSearchStore.getState().results.map(result => result.relativePath)).toEqual([
      'a.ts',
    ]);
  });

  it('clears truncation during loading and after failure, smaller results or reset', async () => {
    mockSearchInFiles.mockResolvedValue([{ relativePath: 'a.ts', matches: matchesFor(501) }]);
    await useProjectSearchStore.getState().search('root-1', 'needle');
    expect(useProjectSearchStore.getState().truncated).toBe(true);
    mockSearchInFiles.mockRejectedValueOnce(new Error('read failed'));
    const pending = useProjectSearchStore.getState().search('root-1', 'again');
    expect(useProjectSearchStore.getState().truncated).toBe(false);
    await pending;
    expect(useProjectSearchStore.getState()).toMatchObject({
      truncated: false,
      totalMatches: 0,
      status: 'error',
    });
    mockSearchInFiles.mockResolvedValueOnce([{ relativePath: 'a.ts', matches: matchesFor(3) }]);
    await useProjectSearchStore.getState().search('root-1', 'small');
    expect(useProjectSearchStore.getState()).toMatchObject({ truncated: false, totalMatches: 3 });
    useProjectSearchStore.getState().clear();
    expect(useProjectSearchStore.getState()).toMatchObject({ truncated: false, totalMatches: 0 });
  });

  it.each(['clear', 'empty', 'missing-bridge'])(
    'invalidates pending capped responses after %s',
    async action => {
      let resolve!: (value: unknown) => void;
      mockSearchInFiles.mockReturnValueOnce(
        new Promise(done => {
          resolve = done;
        })
      );
      const pending = useProjectSearchStore.getState().search('root-1', 'needle');
      if (action === 'clear') useProjectSearchStore.getState().clear();
      else {
        if (action === 'missing-bridge') delete (window as LinguaTestWindow).lingua;
        await useProjectSearchStore.getState().search('root-1', action === 'empty' ? '' : 'next');
      }
      resolve([{ relativePath: 'a.ts', matches: matchesFor(501) }]);
      await pending;
      expect(useProjectSearchStore.getState()).toMatchObject({
        truncated: false,
        results: [],
        totalMatches: 0,
      });
    }
  );
});

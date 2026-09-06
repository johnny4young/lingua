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

  it('asks the filesystem bridge to stop at PROJECT_SEARCH_MAX_MATCHES', async () => {
    mockSearchInFiles.mockResolvedValue([]);
    await useProjectSearchStore.getState().search('root-1', 'needle');
    expect(mockSearchInFiles).toHaveBeenCalledTimes(1);
    expect(mockSearchInFiles.mock.calls[0]?.[3]).toEqual({
      maxTotalMatches: PROJECT_SEARCH_MAX_MATCHES,
    });
  });

  it('flags a capped result set as truncated and clears the flag on the next smaller one', async () => {
    mockSearchInFiles.mockResolvedValueOnce([
      { relativePath: 'a.ts', matches: matchesFor(PROJECT_SEARCH_MAX_MATCHES - 1) },
      { relativePath: 'b.ts', matches: matchesFor(1) },
    ]);
    await useProjectSearchStore.getState().search('root-1', 'needle');
    expect(useProjectSearchStore.getState().totalMatches).toBe(PROJECT_SEARCH_MAX_MATCHES);
    expect(useProjectSearchStore.getState().truncated).toBe(true);

    mockSearchInFiles.mockResolvedValueOnce([{ relativePath: 'a.ts', matches: matchesFor(3) }]);
    await useProjectSearchStore.getState().search('root-1', 'needle again');
    expect(useProjectSearchStore.getState().truncated).toBe(false);
    expect(useProjectSearchStore.getState().totalMatches).toBe(3);
  });

  it('clear() resets the flag', async () => {
    mockSearchInFiles.mockResolvedValueOnce([
      { relativePath: 'a.ts', matches: matchesFor(PROJECT_SEARCH_MAX_MATCHES) },
    ]);
    await useProjectSearchStore.getState().search('root-1', 'needle');
    expect(useProjectSearchStore.getState().truncated).toBe(true);
    useProjectSearchStore.getState().clear();
    expect(useProjectSearchStore.getState().truncated).toBe(false);
  });
});

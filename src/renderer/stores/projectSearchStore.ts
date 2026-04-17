import { create } from 'zustand';

export type ProjectSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectSearchMatch {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface ProjectSearchResult {
  filePath: string;
  relativePath: string;
  matches: ProjectSearchMatch[];
}

interface ProjectSearchState {
  query: string;
  rootPath: string | null;
  status: ProjectSearchStatus;
  results: ProjectSearchResult[];
  totalMatches: number;
  error: string | null;
  /** Monotonically increasing request id so stale responses can be dropped. */
  requestId: number;

  setQuery: (query: string) => void;
  /** Kick off a search against `rootPath`. Cancels any older inflight search. */
  search: (rootPath: string, query: string) => Promise<void>;
  clear: () => void;
}

function sumMatches(results: ProjectSearchResult[]): number {
  return results.reduce((total, result) => total + result.matches.length, 0);
}

export const useProjectSearchStore = create<ProjectSearchState>((set, get) => ({
  query: '',
  rootPath: null,
  status: 'idle',
  results: [],
  totalMatches: 0,
  error: null,
  requestId: 0,

  setQuery: (query) => set({ query }),

  search: async (rootPath, query) => {
    const trimmed = query.trim();
    // Empty queries short-circuit — the UI shouldn't enter a loading state
    // just because the input was cleared.
    if (trimmed.length === 0) {
      set({
        query,
        rootPath,
        status: 'idle',
        results: [],
        totalMatches: 0,
        error: null,
      });
      return;
    }

    const searchInFiles = window.lingua?.fs?.searchInFiles;
    if (!searchInFiles) {
      // Runtime does not expose the search bridge. Mark as ready-with-zero
      // rather than error so the UI can render an empty state instead of a
      // red failure banner.
      set({
        query,
        rootPath,
        status: 'ready',
        results: [],
        totalMatches: 0,
        error: null,
      });
      return;
    }

    const requestId = get().requestId + 1;
    set({ query, rootPath, status: 'loading', error: null, requestId });

    try {
      const results = await searchInFiles(rootPath, trimmed);
      // Drop the response if a newer search has already started. Without this
      // guard, a slow search against a large project could overwrite fresher
      // results typed by the user milliseconds later.
      if (get().requestId !== requestId) return;
      set({
        status: 'ready',
        results,
        totalMatches: sumMatches(results),
        error: null,
      });
    } catch (err) {
      if (get().requestId !== requestId) return;
      set({
        status: 'error',
        results: [],
        totalMatches: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },

  clear: () => {
    set({
      query: '',
      rootPath: null,
      status: 'idle',
      results: [],
      totalMatches: 0,
      error: null,
    });
  },
}));

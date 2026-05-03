import { create } from 'zustand';
import i18next from 'i18next';

export type ProjectSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectSearchMatch {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

/**
 * RL-077 — search results carry the relative path inside the project
 * root. Consumers compose `currentProject.rootPath + '/' + relativePath`
 * for display only; the IPC layer never sees an absolute path.
 */
export interface ProjectSearchResult {
  /** Path relative to the project root the search was scoped to. */
  relativePath: string;
  matches: ProjectSearchMatch[];
}

interface ProjectSearchState {
  query: string;
  /** Capability id of the project the current results belong to. */
  rootId: string | null;
  status: ProjectSearchStatus;
  results: ProjectSearchResult[];
  totalMatches: number;
  error: string | null;
  /** Monotonically increasing request id so stale responses can be dropped. */
  requestId: number;

  setQuery: (query: string) => void;
  /** Kick off a search against `rootId`. Cancels any older inflight search. */
  search: (rootId: string, query: string) => Promise<void>;
  clear: () => void;
}

function sumMatches(results: ProjectSearchResult[]): number {
  return results.reduce((total, result) => total + result.matches.length, 0);
}

function userFacingSearchError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('unknown-root')) {
    return i18next.t('fs.error.unknownRoot');
  }
  if (message.includes('escapes-root') || message.includes('unsafe-path')) {
    return i18next.t('fs.error.escapesRoot');
  }
  return message;
}

export const useProjectSearchStore = create<ProjectSearchState>((set, get) => ({
  query: '',
  rootId: null,
  status: 'idle',
  results: [],
  totalMatches: 0,
  error: null,
  requestId: 0,

  setQuery: (query) => set({ query }),

  search: async (rootId, query) => {
    const trimmed = query.trim();
    // Empty queries short-circuit — the UI shouldn't enter a loading state
    // just because the input was cleared.
    if (trimmed.length === 0) {
      set({
        query,
        rootId,
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
        rootId,
        status: 'ready',
        results: [],
        totalMatches: 0,
        error: null,
      });
      return;
    }

    const requestId = get().requestId + 1;
    set({ query, rootId, status: 'loading', error: null, requestId });

    try {
      const results = await searchInFiles(rootId, '', trimmed);
      // Drop the response if a newer search has already started. Without this
      // guard, a slow search against a large project could overwrite fresher
      // results typed by the user milliseconds later.
      if (get().requestId !== requestId) return;
      const projectResults: ProjectSearchResult[] = results.map((result) => ({
        relativePath: result.relativePath,
        matches: result.matches,
      }));
      set({
        status: 'ready',
        results: projectResults,
        totalMatches: sumMatches(projectResults),
        error: null,
      });
    } catch (err) {
      if (get().requestId !== requestId) return;
      set({
        status: 'error',
        results: [],
        totalMatches: 0,
        error: userFacingSearchError(err),
      });
    }
  },

  clear: () => {
    set({
      query: '',
      rootId: null,
      status: 'idle',
      results: [],
      totalMatches: 0,
      error: null,
    });
  },
}));

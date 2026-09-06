import { create } from 'zustand';
import i18next from 'i18next';
import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';

type ProjectSearchStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProjectSearchMatch {
  line: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

/** Maximum displayed matches; the bridge supplies one extra truncation sentinel. */
export const PROJECT_SEARCH_MAX_MATCHES = 500;

/** Search paths stay relative to the approved root across the filesystem bridge. */
export interface ProjectSearchResult {
  /** Path relative to the project root the search was scoped to. */
  relativePath: string;
  matches: ProjectSearchMatch[];
}

interface ProjectSearchState {
  query: string;
  /** Capability id of the project the current results belong to. */
  rootId: string | null;
  /** Query string that produced the currently settled results/error. */
  resultsQuery: string;
  status: ProjectSearchStatus;
  results: ProjectSearchResult[];
  totalMatches: number;
  /** True when the result set was cut at PROJECT_SEARCH_MAX_MATCHES. */
  truncated: boolean;
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
  resultsQuery: '',
  status: 'idle',
  results: [],
  totalMatches: 0,
  truncated: false,
  error: null,
  requestId: 0,

  setQuery: query => set({ query }),

  search: async (rootId, query) => {
    const trimmed = query.trim();
    const requestId = get().requestId + 1;
    // Empty queries short-circuit — the UI shouldn't enter a loading state
    // just because the input was cleared.
    if (trimmed.length === 0) {
      set({
        requestId,
        query,
        rootId,
        resultsQuery: query,
        status: 'idle',
        results: [],
        totalMatches: 0,
        truncated: false,
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
        requestId,
        query,
        rootId,
        resultsQuery: query,
        status: 'ready',
        results: [],
        totalMatches: 0,
        truncated: false,
        error: null,
      });
      return;
    }

    set({ query, rootId, truncated: false, status: 'loading', error: null, requestId });

    try {
      const results = await searchInFiles(asRootId(rootId), asRelativePath(''), trimmed, {
        maxTotalMatches: PROJECT_SEARCH_MAX_MATCHES + 1,
      });
      // Drop the response if a newer search has already started. Without this
      // guard, a slow search against a large project could overwrite fresher
      // results typed by the user milliseconds later.
      if (get().requestId !== requestId) return;
      const truncated = sumMatches(results) > PROJECT_SEARCH_MAX_MATCHES;
      let remaining = PROJECT_SEARCH_MAX_MATCHES;
      const projectResults: ProjectSearchResult[] = [];
      for (const result of results) {
        if (remaining === 0) break;
        const matches = result.matches.slice(0, remaining);
        if (matches.length === 0) continue;
        projectResults.push({ relativePath: result.relativePath, matches });
        remaining -= matches.length;
      }
      const totalMatches = PROJECT_SEARCH_MAX_MATCHES - remaining;
      set({
        resultsQuery: query,
        status: 'ready',
        results: projectResults,
        totalMatches,
        truncated,
        error: null,
      });
    } catch (err) {
      if (get().requestId !== requestId) return;
      set({
        resultsQuery: query,
        status: 'error',
        results: [],
        totalMatches: 0,
        truncated: false,
        error: userFacingSearchError(err),
      });
    }
  },

  clear: () => {
    set({
      requestId: get().requestId + 1,
      query: '',
      rootId: null,
      resultsQuery: '',
      status: 'idle',
      results: [],
      totalMatches: 0,
      truncated: false,
      error: null,
    });
  },
}));

/**
 * RL-097 Slice 2 — SQL workspace persisted store.
 *
 * Owns the list of user-created SQL queries + their response history.
 * Isolated on its own localStorage key (`lingua-workspace-sql-state`)
 * per the RL-069 convention so a Settings reset doesn't wipe saved
 * queries.
 *
 * Shape parity with `workspaceToolStore`: identical CRUD names +
 * LRU=10 + active id + isExecuting flag + sanitize-on-rehydrate
 * boundary. RL-099 Utility Pipelines (Slot 21) will iterate over
 * both stores uniformly via this matching surface; never extend the
 * SQL store with shape that diverges from the HTTP store without
 * mirroring the change there too.
 *
 * Privacy posture:
 *
 *   - Rows + columns are user content. They never leave the device
 *     unless the user explicitly exports a capsule (the capsule
 *     sanitiser handles the PII-defense pass at that boundary).
 *   - LRU cap of 10 responses per query bounds storage growth.
 *   - Sanitize-on-rehydrate drops invalid entries silently so a
 *     hand-edited localStorage key or a forward-version drift
 *     cannot brick the panel on boot.
 *   - The DuckDB DATABASE itself is NOT persisted — only the query
 *     text + metadata + result preview. Reload always starts with
 *     a fresh in-memory database.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  parseSqlQuery,
  parseSqlResponse,
  type SqlQueryV1,
  type SqlResponseV1,
} from '../../shared/sqlWorkspace';

/**
 * Per-query response history LRU. 10 entries keep recent runs
 * available while bounding localStorage growth. Bodies are stored
 * ONLY on the latest entry; older entries keep metadata + `rows = []`
 * so the user still sees status / duration / timestamp history
 * without paying the size cost. Mirrors the HTTP workspace LRU
 * pattern exactly.
 */
const RESPONSE_LRU_CAP = 10;

interface WorkspaceSqlState {
  /** Persisted list of SQL queries, newest-first. */
  readonly queries: ReadonlyArray<SqlQueryV1>;
  /** Per-query response history (LRU; newest-first within each list). */
  readonly responsesByQueryId: Readonly<
    Record<string, ReadonlyArray<SqlResponseV1>>
  >;
  /** Currently-active query id; null when none. */
  readonly activeQueryId: string | null;
  /**
   * Flips true when the in-flight execution of `activeQueryId`
   * starts; back to false on settle. Used to disable the Run
   * button + suppress concurrent Cmd+Enter triggers. NOT persisted
   * — a crash mid-execution should leave the next session with a
   * clean "no run in flight" state.
   */
  readonly isExecutingActive: boolean;

  // -------- mutations ------------------------------------------------------

  /** Append a new query to the top of the list. */
  createQuery: (query: SqlQueryV1) => void;
  /** Patch fields on an existing query; updates `updatedAt`. */
  updateQuery: (id: string, patch: Partial<SqlQueryV1>) => void;
  /** Drop the query + its entire response history. */
  deleteQuery: (id: string) => void;
  /** Set the active query (UI-driven). */
  setActiveQuery: (id: string | null) => void;
  /** Record a response under a query; applies the LRU cap. */
  recordResponse: (queryId: string, response: SqlResponseV1) => void;
  /** Clear the history for a single query. */
  clearHistory: (queryId: string) => void;
  /** Flip the execution flag (called by the panel layer). */
  setIsExecutingActive: (value: boolean) => void;

  // -------- selectors (cheap derived data) ---------------------------------

  /** Find a query by id; returns undefined when missing. */
  getQuery: (id: string) => SqlQueryV1 | undefined;
  /** Returns the most-recent response for a query, or undefined. */
  getLatestResponse: (id: string) => SqlResponseV1 | undefined;
}

/**
 * Default state factory. Extracted so tests can call it via
 * `useWorkspaceSqlStore.setState(createInitialState())` to reset
 * between cases without needing the `persist` middleware to reset.
 */
function createInitialState(): Pick<
  WorkspaceSqlState,
  'queries' | 'responsesByQueryId' | 'activeQueryId' | 'isExecutingActive'
> {
  return {
    queries: [],
    responsesByQueryId: {},
    activeQueryId: null,
    isExecutingActive: false,
  };
}

export const useWorkspaceSqlStore = create<WorkspaceSqlState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      createQuery: (query) =>
        set((state) => ({
          queries: [query, ...state.queries],
          activeQueryId: query.id,
        })),

      updateQuery: (id, patch) =>
        set((state) => {
          const idx = state.queries.findIndex((q) => q.id === id);
          if (idx === -1) return state;
          const existing = state.queries[idx];
          if (!existing) return state;
          const updated: SqlQueryV1 = {
            ...existing,
            ...patch,
            // Always preserve the version + id pin.
            version: 1,
            id: existing.id,
            updatedAt: new Date().toISOString(),
          };
          const next = state.queries.slice();
          next[idx] = updated;
          return { queries: next };
        }),

      deleteQuery: (id) =>
        set((state) => {
          if (!state.queries.some((q) => q.id === id)) return state;
          const queries = state.queries.filter((q) => q.id !== id);
          const responsesByQueryId = { ...state.responsesByQueryId };
          delete responsesByQueryId[id];
          const activeQueryId =
            state.activeQueryId === id
              ? (queries[0]?.id ?? null)
              : state.activeQueryId;
          return { queries, responsesByQueryId, activeQueryId };
        }),

      setActiveQuery: (id) =>
        set((state) => {
          if (state.activeQueryId === id) return state;
          // Reset the executing flag when switching away from an
          // in-flight query — mirrors workspaceToolStore.
          return { activeQueryId: id, isExecutingActive: false };
        }),

      recordResponse: (queryId, response) =>
        set((state) => {
          if (!state.queries.some((query) => query.id === queryId)) {
            return state;
          }
          const existing = state.responsesByQueryId[queryId] ?? [];
          // Strip the row preview from previously-latest entries so
          // only the newest entry retains rows. Older entries keep
          // metadata for the user-facing history view.
          const trimmedPrevious: SqlResponseV1[] = existing.map((entry) => ({
            ...entry,
            rows: [],
          }));
          const next: SqlResponseV1[] = [response, ...trimmedPrevious].slice(
            0,
            RESPONSE_LRU_CAP
          );
          return {
            responsesByQueryId: {
              ...state.responsesByQueryId,
              [queryId]: next,
            },
          };
        }),

      clearHistory: (queryId) =>
        set((state) => {
          if (!state.responsesByQueryId[queryId]) return state;
          const responsesByQueryId = { ...state.responsesByQueryId };
          delete responsesByQueryId[queryId];
          return { responsesByQueryId };
        }),

      setIsExecutingActive: (value) =>
        set((state) =>
          state.isExecutingActive === value ? state : { isExecutingActive: value }
        ),

      getQuery: (id) => get().queries.find((q) => q.id === id),
      getLatestResponse: (id) => get().responsesByQueryId[id]?.[0],
    }),
    {
      name: 'lingua-workspace-sql-state',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // Transient runtime failures (`timeout` / `engine-load-failed`)
        // live in the session for immediate feedback but persisting
        // them across reloads creates ghost rows the user has no way
        // to clear. Filter the persisted slice so only successful +
        // SQL-error responses (where DuckDB actually had a say) survive
        // a reload. Mirrors the HTTP workspace partialize.
        const persistedResponses: Record<
          string,
          ReadonlyArray<SqlResponseV1>
        > = {};
        for (const [qid, list] of Object.entries(state.responsesByQueryId)) {
          const surviving = list.filter(
            (entry) =>
              entry.status !== 'timeout' && entry.status !== 'engine-load-failed'
          );
          if (surviving.length > 0) persistedResponses[qid] = surviving;
        }
        return {
          queries: state.queries,
          responsesByQueryId: persistedResponses,
          activeQueryId: state.activeQueryId,
        };
      },
      // Sanitize on rehydrate — drop any invalid entry silently so a
      // hand-edited localStorage cannot brick the panel.
      merge: (persisted, current) => {
        const merged = { ...current };
        if (
          persisted &&
          typeof persisted === 'object' &&
          !Array.isArray(persisted)
        ) {
          const p = persisted as Record<string, unknown>;
          if (Array.isArray(p.queries)) {
            const safeQueries: SqlQueryV1[] = [];
            for (const raw of p.queries) {
              const parsed = parseSqlQuery(raw);
              if (parsed !== null) safeQueries.push(parsed);
            }
            merged.queries = safeQueries;
          }
          if (
            p.responsesByQueryId &&
            typeof p.responsesByQueryId === 'object' &&
            !Array.isArray(p.responsesByQueryId)
          ) {
            const safeByQuery: Record<string, SqlResponseV1[]> = {};
            for (const [qid, list] of Object.entries(
              p.responsesByQueryId as Record<string, unknown>
            )) {
              if (!merged.queries.some((query) => query.id === qid)) {
                continue;
              }
              if (!Array.isArray(list)) continue;
              const safeList: SqlResponseV1[] = [];
              for (const raw of list) {
                const parsed = parseSqlResponse(raw);
                if (parsed !== null) safeList.push(parsed);
              }
              if (safeList.length > 0) safeByQuery[qid] = safeList;
            }
            merged.responsesByQueryId = safeByQuery;
          }
          // Active id is only valid when it points at a surviving query.
          if (typeof p.activeQueryId === 'string') {
            const exists = merged.queries.some(
              (q) => q.id === p.activeQueryId
            );
            merged.activeQueryId = exists ? p.activeQueryId : null;
          } else {
            merged.activeQueryId = null;
          }
        }
        // Always start with a clean execution flag (see field docs).
        merged.isExecutingActive = false;
        return merged;
      },
    }
  )
);

/**
 * Test seam — reset the store to its initial state. Persisted to
 * localStorage too so a vitest case can call this in `beforeEach`
 * without ripple effects between cases.
 */
export function resetWorkspaceSqlStoreForTests(): void {
  useWorkspaceSqlStore.setState(createInitialState());
}

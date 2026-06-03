/**
 * RL-097 Slice 1 — HTTP workspace persisted store.
 *
 * Owns the list of user-created HTTP requests + their response
 * history. Isolated on its own localStorage key (`lingua-workspace-tool-state`)
 * per the RL-069 convention so a Settings reset doesn't wipe the
 * user's saved requests, and a workspace reset doesn't touch
 * `lingua-settings`.
 *
 * Slice 2 (DuckDB-WASM SQL scratchpad) will extend this store with a
 * parallel `queries` collection that shares the same shape — hence
 * the name `workspaceToolStore`, not `httpStore`.
 *
 * Privacy posture:
 *
 *   - Responses are stored AFTER `httpClient.ts` redacts sensitive
 *     headers. The persisted JSON never carries `Authorization` /
 *     `Cookie` values.
 *   - LRU cap of 10 responses per request limits storage growth and
 *     keeps the user's history meaningful (most recent runs).
 *   - Sanitize-on-rehydrate drops invalid entries silently so a
 *     hand-edited localStorage key or a forward-version drift cannot
 *     brick the panel on boot.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createMigrate } from './persistence/migrationRegistry';
import {
  parseHttpRequest,
  parseHttpResponse,
  type HttpRequestV1,
  type HttpResponseV1,
} from '../../shared/httpWorkspace';

/**
 * Per-request response history LRU. 10 entries keep recent runs
 * available while bounding localStorage growth (4 MiB body × 10 ×
 * N requests would otherwise be unbounded). Bodies are stored ONLY
 * on the latest entry; older entries keep metadata + `body = ''`
 * + `bodyTruncated = true` so the user still sees the status / size
 * / timestamp history without paying the size cost. The `tooLarge`
 * flag keeps its original meaning: the server response hit the body
 * cap. It is not reused to mean "body omitted from old history".
 */
const RESPONSE_LRU_CAP = 10;

interface WorkspaceToolState {
  /** Persisted list of HTTP requests, newest-first. */
  readonly requests: ReadonlyArray<HttpRequestV1>;
  /** Per-request response history (LRU; newest-first within each list). */
  readonly responsesByRequestId: Readonly<
    Record<string, ReadonlyArray<HttpResponseV1>>
  >;
  /** Currently-active request id; null when none. */
  readonly activeRequestId: string | null;
  /**
   * Flips true when the in-flight execution of `activeRequestId`
   * starts; back to false on settle. Used to disable the Send button
   * + suppress concurrent Cmd+Enter triggers. NOT persisted — a
   * crash mid-execution should leave the next session with a clean
   * "no run in flight" state.
   */
  readonly isExecutingActive: boolean;

  // -------- mutations ------------------------------------------------------

  /** Append a new request to the top of the list. */
  createRequest: (request: HttpRequestV1) => void;
  /**
   * Bulk-append requests to the top of the list, preserving their
   * order (first element ends up topmost) and selecting the first.
   * Used by the RL-100 Slice 3 collection importer so a Postman /
   * Bruno import lands every request in one state write. A no-op for
   * an empty array. There is no request-count cap (the LRU is
   * per-request RESPONSE history only).
   */
  createRequests: (requests: ReadonlyArray<HttpRequestV1>) => void;
  /** Patch fields on an existing request; updates `updatedAt`. */
  updateRequest: (id: string, patch: Partial<HttpRequestV1>) => void;
  /** Drop the request + its entire response history. */
  deleteRequest: (id: string) => void;
  /** Set the active request (UI-driven). */
  setActiveRequest: (id: string | null) => void;
  /** Record a response under a request; applies the LRU cap. */
  recordResponse: (requestId: string, response: HttpResponseV1) => void;
  /** Clear the history for a single request. */
  clearHistory: (requestId: string) => void;
  /** Flip the execution flag (called by the runtime layer). */
  setIsExecutingActive: (value: boolean) => void;

  // -------- selectors (cheap derived data) ---------------------------------

  /** Find a request by id; returns undefined when missing. */
  getRequest: (id: string) => HttpRequestV1 | undefined;
  /** Returns the most-recent response for a request, or undefined. */
  getLatestResponse: (id: string) => HttpResponseV1 | undefined;
}

/**
 * Default state factory. Extracted so tests can call it via
 * `useWorkspaceToolStore.setState(createInitialState())` to reset
 * between cases without needing the `persist` middleware to reset.
 */
function createInitialState(): Pick<
  WorkspaceToolState,
  'requests' | 'responsesByRequestId' | 'activeRequestId' | 'isExecutingActive'
> {
  return {
    requests: [],
    responsesByRequestId: {},
    activeRequestId: null,
    isExecutingActive: false,
  };
}

export const useWorkspaceToolStore = create<WorkspaceToolState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      createRequest: (request) =>
        set((state) => ({
          requests: [request, ...state.requests],
          activeRequestId: request.id,
        })),

      createRequests: (requests) =>
        set((state) => {
          if (requests.length === 0) return state;
          return {
            // Preserve collection order — `requests[0]` ends up topmost.
            requests: [...requests, ...state.requests],
            activeRequestId: requests[0]?.id ?? state.activeRequestId,
          };
        }),

      updateRequest: (id, patch) =>
        set((state) => {
          const idx = state.requests.findIndex((r) => r.id === id);
          if (idx === -1) return state;
          const existing = state.requests[idx];
          if (!existing) return state;
          const updated: HttpRequestV1 = {
            ...existing,
            ...patch,
            // Always preserve the version + id pin.
            version: 1,
            id: existing.id,
            updatedAt: new Date().toISOString(),
          };
          const next = state.requests.slice();
          next[idx] = updated;
          return { requests: next };
        }),

      deleteRequest: (id) =>
        set((state) => {
          if (!state.requests.some((r) => r.id === id)) return state;
          const requests = state.requests.filter((r) => r.id !== id);
          const responsesByRequestId = { ...state.responsesByRequestId };
          delete responsesByRequestId[id];
          const activeRequestId =
            state.activeRequestId === id
              ? (requests[0]?.id ?? null)
              : state.activeRequestId;
          return { requests, responsesByRequestId, activeRequestId };
        }),

      setActiveRequest: (id) =>
        set((state) => {
          if (state.activeRequestId === id) return state;
          // Reset the executing flag when switching away from an
          // in-flight request — the UI is no longer focused on it,
          // so a stuck `true` would freeze the Send button next
          // time the user returns.
          return { activeRequestId: id, isExecutingActive: false };
        }),

      recordResponse: (requestId, response) =>
        set((state) => {
          if (!state.requests.some((request) => request.id === requestId)) {
            return state;
          }
          const existing = state.responsesByRequestId[requestId] ?? [];
          // Strip the body from previously-latest entries so we
          // only retain the body for the newest response. Older
          // entries keep metadata for the user-facing history.
          const trimmedPrevious: HttpResponseV1[] = existing.map((entry) => ({
            ...entry,
            body: '',
            tooLarge: entry.tooLarge,
          }));
          const next: HttpResponseV1[] = [response, ...trimmedPrevious].slice(
            0,
            RESPONSE_LRU_CAP
          );
          return {
            responsesByRequestId: {
              ...state.responsesByRequestId,
              [requestId]: next,
            },
          };
        }),

      clearHistory: (requestId) =>
        set((state) => {
          if (!state.responsesByRequestId[requestId]) return state;
          const responsesByRequestId = { ...state.responsesByRequestId };
          delete responsesByRequestId[requestId];
          return { responsesByRequestId };
        }),

      setIsExecutingActive: (value) =>
        set((state) =>
          state.isExecutingActive === value ? state : { isExecutingActive: value }
        ),

      getRequest: (id) => get().requests.find((r) => r.id === id),
      getLatestResponse: (id) => get().responsesByRequestId[id]?.[0],
    }),
    {
      name: 'lingua-workspace-tool-state',
      version: 1,
      migrate: createMigrate('lingua-workspace-tool-state'),
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => {
        // Typed runtime failures (`network-error` / `timeout` /
        // `cors-error`) are transient: they live in the
        // session for the user's immediate feedback, but persisting
        // them across reloads creates ghost "Error de red" rows the
        // user has no way to clear. Filter the persisted slice so
        // only successful + HTTP-error responses (kinds where the
        // server actually replied) survive a reload.
        const persistedResponses: Record<
          string,
          ReadonlyArray<HttpResponseV1>
        > = {};
        for (const [reqId, list] of Object.entries(
          state.responsesByRequestId
        )) {
          const surviving = list.filter(
            (entry) =>
              entry.kind !== 'network-error' &&
              entry.kind !== 'timeout' &&
              entry.kind !== 'cors-error'
          );
          if (surviving.length > 0) persistedResponses[reqId] = surviving;
        }
        return {
          requests: state.requests,
          responsesByRequestId: persistedResponses,
          activeRequestId: state.activeRequestId,
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
          if (Array.isArray(p.requests)) {
            const safeRequests: HttpRequestV1[] = [];
            for (const raw of p.requests) {
              const parsed = parseHttpRequest(raw);
              if (parsed !== null) safeRequests.push(parsed);
            }
            merged.requests = safeRequests;
          }
          if (
            p.responsesByRequestId &&
            typeof p.responsesByRequestId === 'object' &&
            !Array.isArray(p.responsesByRequestId)
          ) {
            const safeByRequest: Record<string, HttpResponseV1[]> = {};
            for (const [reqId, list] of Object.entries(
              p.responsesByRequestId as Record<string, unknown>
            )) {
              if (!merged.requests.some((request) => request.id === reqId)) {
                continue;
              }
              if (!Array.isArray(list)) continue;
              const safeList: HttpResponseV1[] = [];
              for (const raw of list) {
                const parsed = parseHttpResponse(raw);
                if (parsed !== null) safeList.push(parsed);
              }
              if (safeList.length > 0) safeByRequest[reqId] = safeList;
            }
            merged.responsesByRequestId = safeByRequest;
          }
          // Active id is only valid when it points at a surviving request.
          if (typeof p.activeRequestId === 'string') {
            const exists = merged.requests.some(
              (r) => r.id === p.activeRequestId
            );
            merged.activeRequestId = exists ? p.activeRequestId : null;
          } else {
            merged.activeRequestId = null;
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
export function resetWorkspaceToolStoreForTests(): void {
  useWorkspaceToolStore.setState(createInitialState());
}

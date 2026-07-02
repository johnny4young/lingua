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
import {
  parseHttpEnvironment,
  toExportableEnvironment,
  type HttpEnvironmentV1,
  type HttpEnvVariableV1,
} from '../../shared/httpEnvironment';

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
   * The id of the request whose execution is currently in flight, or
   * null when none. Tracked per-request (not a single global boolean)
   * so switching to a different request no longer has to reset the flag
   * — the previous design's reset-on-switch let a stale settle clobber
   * a newer send's state (concurrent duplicate sends). The Send button
   * for a request is disabled only while THAT request is the one in
   * flight. NOT persisted — a crash mid-execution should leave the next
   * session with a clean "no run in flight" state.
   */
  readonly executingRequestId: string | null;

  /**
   * RL-097 Slice 3a — persisted HTTP environments. Each is a named bag
   * of `{{key}}` → value bindings (some flagged secret) the user can
   * swap before sending. Persisted alongside requests; secret VALUES
   * are stored in plain the same way an explicit `Authorization`
   * header row already is — redaction is a TELEMETRY / SHARE / DISPLAY
   * guarantee, not a localStorage-at-rest one (see `httpWorkspace.ts`
   * file header).
   */
  readonly environments: ReadonlyArray<HttpEnvironmentV1>;
  /**
   * RL-097 Slice 3a — the active environment's id, or null for "No
   * environment". Validated against the surviving environment list on
   * rehydrate (a stale id repoints to null).
   */
  readonly activeEnvironmentId: string | null;

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
  /** Set (or clear with null) the id of the in-flight request. */
  setExecutingRequestId: (id: string | null) => void;

  // -------- selectors (cheap derived data) ---------------------------------

  /** Find a request by id; returns undefined when missing. */
  getRequest: (id: string) => HttpRequestV1 | undefined;
  /** Returns the most-recent response for a request, or undefined. */
  getLatestResponse: (id: string) => HttpResponseV1 | undefined;

  // -------- RL-097 Slice 3a — environment CRUD ----------------------------

  /** Append a new environment to the list. Does not auto-activate it. */
  createEnvironment: (env: HttpEnvironmentV1) => void;
  /**
   * Patch fields on an existing environment; preserves the version + id
   * pin and bumps `updatedAt`. No-op on an unknown id.
   */
  updateEnvironment: (id: string, patch: Partial<HttpEnvironmentV1>) => void;
  /**
   * RL-097 Slice 3b — functional variable update. Apply `updater` to the
   * environment's CURRENT variable list (read inside the `set`) and store
   * the result. This is the collapse-safe path for the manager: two adds
   * dispatched in one tick each see the prior add's result, so neither is
   * lost (a render-prop-based `onUpdate({ variables: [...prop, row] })`
   * would clobber the first). Bumps `updatedAt`, preserves version/id.
   * No-op on an unknown id.
   */
  updateEnvironmentVariables: (
    id: string,
    updater: (variables: ReadonlyArray<HttpEnvVariableV1>) => HttpEnvVariableV1[]
  ) => void;
  /**
   * RL-097 Slice 3b — clone an environment. Deep-clones the variable rows
   * with FRESH opaque ids (preserving key/value/secret), mints a new env
   * id, names it `<original> <copySuffix>`, stamps fresh timestamps, and
   * appends WITHOUT auto-activating (mirrors `duplicatePipeline`). No-op on
   * an unknown id.
   */
  duplicateEnvironment: (
    id: string,
    newId: string,
    copySuffix: string
  ) => void;
  /**
   * RL-097 Slice 3b — serialise an environment to pretty JSON for sharing.
   * PRIVACY: secret values are blanked and all instance-local ids stripped
   * (see `toExportableEnvironment`). Returns null on an unknown id or a
   * (practically impossible) serialise failure.
   */
  exportEnvironmentJson: (id: string) => string | null;
  /**
   * RL-097 Slice 3b — parse an exported environment JSON, mint a FRESH env
   * id, append it WITHOUT auto-activating. Tolerates malformed JSON +
   * invalid shapes (returns `{ ok: false }`). On success returns the new
   * env id so the caller can select it if it wants.
   */
  importEnvironmentJson: (
    json: string
  ) => { ok: true; id: string } | { ok: false };
  /**
   * Drop an environment. If it was the active one, repoint
   * `activeEnvironmentId` to null (never to a different environment —
   * the user's active selection should not silently jump).
   */
  deleteEnvironment: (id: string) => void;
  /** Set the active environment (or null for "No environment"). */
  setActiveEnvironment: (id: string | null) => void;
  /** The currently-active environment, or undefined when none is set. */
  getActiveEnvironment: () => HttpEnvironmentV1 | undefined;
}

/**
 * Default state factory. Extracted so tests can call it via
 * `useWorkspaceToolStore.setState(createInitialState())` to reset
 * between cases without needing the `persist` middleware to reset.
 */
function createInitialState(): Pick<
  WorkspaceToolState,
  | 'requests'
  | 'responsesByRequestId'
  | 'activeRequestId'
  | 'executingRequestId'
  | 'environments'
  | 'activeEnvironmentId'
> {
  return {
    requests: [],
    responsesByRequestId: {},
    activeRequestId: null,
    executingRequestId: null,
    environments: [],
    activeEnvironmentId: null,
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
          // Execution state is per-request now, so switching away does
          // NOT touch it — the previous reset-on-switch was the source
          // of the stale-settle-clobbers-newer-send race.
          return { activeRequestId: id };
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

      setExecutingRequestId: (id) =>
        set((state) =>
          state.executingRequestId === id ? state : { executingRequestId: id }
        ),

      getRequest: (id) => get().requests.find((r) => r.id === id),
      getLatestResponse: (id) => get().responsesByRequestId[id]?.[0],

      // -------- RL-097 Slice 3a — environment CRUD ------------------------

      createEnvironment: (env) =>
        set((state) => ({ environments: [...state.environments, env] })),

      updateEnvironment: (id, patch) =>
        set((state) => {
          const idx = state.environments.findIndex((e) => e.id === id);
          if (idx === -1) return state;
          const existing = state.environments[idx];
          if (!existing) return state;
          const updated: HttpEnvironmentV1 = {
            ...existing,
            ...patch,
            // Preserve the version + id pin (mirrors updateRequest).
            version: 1,
            id: existing.id,
            updatedAt: new Date().toISOString(),
          };
          const next = state.environments.slice();
          next[idx] = updated;
          return { environments: next };
        }),

      updateEnvironmentVariables: (id, updater) =>
        set((state) => {
          const idx = state.environments.findIndex((e) => e.id === id);
          if (idx === -1) return state;
          const existing = state.environments[idx];
          if (!existing) return state;
          const updated: HttpEnvironmentV1 = {
            ...existing,
            // `updater` reads the CURRENT list inside this `set`, so two
            // adds in one tick compose instead of clobbering.
            variables: updater(existing.variables),
            version: 1,
            id: existing.id,
            updatedAt: new Date().toISOString(),
          };
          const next = state.environments.slice();
          next[idx] = updated;
          return { environments: next };
        }),

      duplicateEnvironment: (id, newId, copySuffix) =>
        set((state) => {
          const source = state.environments.find((e) => e.id === id);
          if (!source) return state;
          const now = new Date().toISOString();
          const clone: HttpEnvironmentV1 = {
            version: 1,
            id: newId,
            name:
              source.name.length > 0
                ? `${source.name} ${copySuffix}`
                : copySuffix.trim(),
            // Deep-clone rows with FRESH ids so the clone's drag reorder +
            // React keys never collide with the original's rows. Secret
            // flags + values are preserved (this is a local clone, not an
            // export — `exportEnvironmentJson` is where secrets get blanked).
            variables: source.variables.map((variable) => ({
              ...variable,
              id: crypto.randomUUID(),
            })),
            createdAt: now,
            updatedAt: now,
          };
          // Append (do NOT auto-activate — mirrors createEnvironment).
          return { environments: [...state.environments, clone] };
        }),

      exportEnvironmentJson: (id) => {
        const env = get().environments.find((e) => e.id === id);
        if (!env) return null;
        try {
          return JSON.stringify(toExportableEnvironment(env), null, 2);
        } catch {
          return null;
        }
      },

      importEnvironmentJson: (json) => {
        let raw: unknown;
        try {
          raw = JSON.parse(json);
        } catch {
          return { ok: false };
        }
        // parseHttpEnvironment requires id + timestamps; an exported blob
        // strips them. Layer the importer's own fields on top so the strict
        // parser still validates version/name/variables (and backfills each
        // variable's opaque id), then re-pin a FRESH env id.
        const newId = crypto.randomUUID();
        const now = new Date().toISOString();
        const candidate =
          raw && typeof raw === 'object' && !Array.isArray(raw)
            ? {
                ...(raw as Record<string, unknown>),
                id: newId,
                createdAt: now,
                updatedAt: now,
              }
            : raw;
        const parsed = parseHttpEnvironment(candidate);
        if (parsed === null) return { ok: false };
        set((state) => ({ environments: [...state.environments, parsed] }));
        return { ok: true, id: parsed.id };
      },

      deleteEnvironment: (id) =>
        set((state) => {
          if (!state.environments.some((e) => e.id === id)) return state;
          const environments = state.environments.filter((e) => e.id !== id);
          // If the deleted env was active, repoint to null — never to a
          // surviving sibling (the user's active selection should not
          // silently jump to an unrelated environment).
          const activeEnvironmentId =
            state.activeEnvironmentId === id ? null : state.activeEnvironmentId;
          return { environments, activeEnvironmentId };
        }),

      setActiveEnvironment: (id) =>
        set((state) =>
          state.activeEnvironmentId === id
            ? state
            : { activeEnvironmentId: id }
        ),

      getActiveEnvironment: () => {
        const { environments, activeEnvironmentId } = get();
        if (activeEnvironmentId === null) return undefined;
        return environments.find((e) => e.id === activeEnvironmentId);
      },
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
          // RL-097 Slice 3a — additive fields. No persist `version` bump:
          // a v1 blob predating this field has no `environments` key, and
          // `merge` below defaults it to `[]` (and `activeEnvironmentId`
          // to a validated id or null), so old blobs rehydrate cleanly
          // without a migration step.
          environments: state.environments,
          activeEnvironmentId: state.activeEnvironmentId,
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
          // RL-097 Slice 3a — additive fields. No persist version bump is
          // needed: a v1 blob with NO `environments` key falls through to
          // the `[]` default here, and `activeEnvironmentId` is re-validated
          // against the surviving environments (stale id → null). Invalid
          // individual environments drop silently via parseHttpEnvironment.
          if (Array.isArray(p.environments)) {
            const safeEnvironments: HttpEnvironmentV1[] = [];
            for (const raw of p.environments) {
              const parsed = parseHttpEnvironment(raw);
              if (parsed !== null) safeEnvironments.push(parsed);
            }
            merged.environments = safeEnvironments;
          } else {
            merged.environments = [];
          }
          if (typeof p.activeEnvironmentId === 'string') {
            const exists = merged.environments.some(
              (e) => e.id === p.activeEnvironmentId
            );
            merged.activeEnvironmentId = exists ? p.activeEnvironmentId : null;
          } else {
            merged.activeEnvironmentId = null;
          }
        }
        // Always start with a clean execution state (see field docs).
        merged.executingRequestId = null;
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

/**
 * implementation — Utility pipeline persisted store.
 *
 * Owns the user's pipeline library + per-pipeline last-run input.
 * Isolated on its own localStorage key (`lingua-utility-pipeline-state`)
 * per the internal convention — a Settings reset doesn't wipe saved
 * pipelines, and a pipeline reset doesn't touch `lingua-settings`.
 *
 * Shape parity with `workspaceToolStore` + `workspaceSqlStore`: same
 * CRUD names + LRU + active id + isExecuting flag + sanitize-on-
 * rehydrate. future work (AI-generated pipelines, network steps)
 * can extend this store without diverging from the workspace family.
 *
 * Privacy posture:
 *
 *   - Pipelines + last-run inputs live ONLY on the device.
 *     `exportPipelineJson` emits the recipe (no input data) for the
 *     user to share; `importPipelineJson` rejects malformed shapes
 *     via the shared `tryImportPipelineJson` guard.
 *   - LRU cap of `PIPELINE_CAP = 100` pipelines bounds storage growth.
 *   - Sanitize-on-rehydrate drops invalid entries silently so a
 *     hand-edited localStorage key cannot brick the panel.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createMigrate } from './persistence/migrationRegistry';
import {
  PIPELINE_CAP,
  parsePipeline,
  tryImportPipelineJson,
  type PipelineImportOutcome,
  type UtilityPipelineV1,
} from '../../shared/utilityPipeline';

interface UtilityPipelineState {
  /** Persisted pipeline library, newest-first. */
  readonly pipelines: ReadonlyArray<UtilityPipelineV1>;
  /** Per-pipeline last-run input (transient — not persisted). */
  readonly inputsByPipelineId: Readonly<Record<string, string>>;
  /** Currently-active pipeline id; null when none. */
  readonly activePipelineId: string | null;
  /**
   * Flips true when the in-flight run of `activePipelineId` starts;
   * back to false on settle. Used to disable the Run button +
   * suppress concurrent triggers. NOT persisted — a crash mid-run
   * should leave the next session with a clean "no run in flight".
   */
  readonly isExecutingActive: boolean;

  // -------- mutations -----------------------------------------------------

  /** Append a new pipeline to the top of the list (newest-first). */
  createPipeline: (pipeline: UtilityPipelineV1) => void;
  /** Patch fields on an existing pipeline; updates `updatedAt`. */
  updatePipeline: (id: string, patch: Partial<UtilityPipelineV1>) => void;
  /** Drop a pipeline + its transient input. */
  deletePipeline: (id: string) => void;
  /** Duplicate a pipeline as `name + " (copy)"` with a fresh id. */
  duplicatePipeline: (id: string, newId: string, copySuffix: string) => string | null;
  /** Set the active pipeline (UI-driven). */
  setActivePipeline: (id: string | null) => void;
  /** Update the transient input for a pipeline. */
  setPipelineInput: (id: string, input: string) => void;
  /** Flip the execution flag (called by the panel layer). */
  setIsExecutingActive: (value: boolean) => void;

  // -------- selectors -----------------------------------------------------

  /** Find a pipeline by id; returns undefined when missing. */
  getPipeline: (id: string) => UtilityPipelineV1 | undefined;
  /** Returns the transient last-run input for a pipeline (defaults to ''). */
  getPipelineInput: (id: string) => string;

  // -------- import / export -----------------------------------------------

  /** Decode a pasted JSON; on success, append to the library. */
  importPipelineJson: (json: string) => PipelineImportOutcome;
  /** Serialize a pipeline to JSON for export. Recipe only — no input data. */
  exportPipelineJson: (id: string) => string | null;
}

function createInitialState(): Pick<
  UtilityPipelineState,
  'pipelines' | 'inputsByPipelineId' | 'activePipelineId' | 'isExecutingActive'
> {
  return {
    pipelines: [],
    inputsByPipelineId: {},
    activePipelineId: null,
    isExecutingActive: false,
  };
}

function createPipelineId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return randomUUID.call(globalThis.crypto);
  }
  return `pipeline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function ensureImportedPipelineIdIsUnique(
  pipeline: UtilityPipelineV1,
  existing: ReadonlyArray<UtilityPipelineV1>
): UtilityPipelineV1 {
  if (!existing.some((entry) => entry.id === pipeline.id)) return pipeline;
  const now = new Date().toISOString();
  return {
    ...pipeline,
    id: createPipelineId(),
    createdAt: now,
    updatedAt: now,
  };
}

export const useUtilityPipelineStore = create<UtilityPipelineState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      createPipeline: (pipeline) =>
        set((state) => {
          // LRU cap: trim oldest pipelines (tail) when at cap.
          const next = [pipeline, ...state.pipelines].slice(0, PIPELINE_CAP);
          return {
            pipelines: next,
            activePipelineId: pipeline.id,
          };
        }),

      updatePipeline: (id, patch) =>
        set((state) => {
          const idx = state.pipelines.findIndex((p) => p.id === id);
          if (idx === -1) return state;
          const existing = state.pipelines[idx];
          if (!existing) return state;
          const updated: UtilityPipelineV1 = {
            ...existing,
            ...patch,
            // Pin version + id so a careless caller can't drift them.
            version: 1,
            id: existing.id,
            updatedAt: new Date().toISOString(),
          };
          const next = state.pipelines.slice();
          next[idx] = updated;
          return { pipelines: next };
        }),

      deletePipeline: (id) =>
        set((state) => {
          if (!state.pipelines.some((p) => p.id === id)) return state;
          const pipelines = state.pipelines.filter((p) => p.id !== id);
          const inputsByPipelineId = { ...state.inputsByPipelineId };
          delete inputsByPipelineId[id];
          const activePipelineId =
            state.activePipelineId === id
              ? (pipelines[0]?.id ?? null)
              : state.activePipelineId;
          return { pipelines, inputsByPipelineId, activePipelineId };
        }),

      duplicatePipeline: (id, newId, copySuffix) => {
        const state = get();
        const source = state.pipelines.find((p) => p.id === id);
        if (!source) return null;
        if (state.pipelines.length >= PIPELINE_CAP) return null;
        const now = new Date().toISOString();
        const clone: UtilityPipelineV1 = {
          version: 1,
          id: newId,
          name: source.name.length > 0 ? `${source.name} ${copySuffix}` : copySuffix.trim(),
          steps: source.steps.map((step) => ({
            id: step.id, // step ids stay stable — the parent pipeline's id distinguishes them
            utilityId: step.utilityId,
            options: { ...step.options },
          })),
          createdAt: now,
          updatedAt: now,
        };
        set((s) => ({
          pipelines: [clone, ...s.pipelines].slice(0, PIPELINE_CAP),
          activePipelineId: newId,
        }));
        return newId;
      },

      setActivePipeline: (id) =>
        set((state) => {
          if (state.activePipelineId === id) return state;
          // Mirror the workspace stores — switch resets the executing flag.
          return { activePipelineId: id, isExecutingActive: false };
        }),

      setPipelineInput: (id, input) =>
        set((state) => ({
          inputsByPipelineId: { ...state.inputsByPipelineId, [id]: input },
        })),

      setIsExecutingActive: (value) =>
        set((state) =>
          state.isExecutingActive === value ? state : { isExecutingActive: value }
        ),

      getPipeline: (id) => get().pipelines.find((p) => p.id === id),
      getPipelineInput: (id) => get().inputsByPipelineId[id] ?? '',

      importPipelineJson: (json) => {
        const state = get();
        const outcome = tryImportPipelineJson(json, state.pipelines.length);
        if (outcome.ok) {
          const pipeline = ensureImportedPipelineIdIsUnique(
            outcome.pipeline,
            state.pipelines
          );
          set((s) => ({
            pipelines: [pipeline, ...s.pipelines].slice(0, PIPELINE_CAP),
            activePipelineId: pipeline.id,
          }));
          return { ...outcome, pipeline };
        }
        return outcome;
      },

      exportPipelineJson: (id) => {
        const pipeline = get().pipelines.find((p) => p.id === id);
        if (!pipeline) return null;
        try {
          return JSON.stringify(pipeline, null, 2);
        } catch {
          return null;
        }
      },
    }),
    {
      name: 'lingua-utility-pipeline-state',
      version: 1,
      migrate: createMigrate('lingua-utility-pipeline-state'),
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        pipelines: state.pipelines,
        activePipelineId: state.activePipelineId,
        // inputsByPipelineId is transient — last-run input does NOT
        // survive a reload. The user's recipe persists; their last
        // throwaway test input does not.
      }),
      // Sanitize on rehydrate — drop any invalid entry silently.
      merge: (persisted, current) => {
        const merged = { ...current };
        if (
          persisted &&
          typeof persisted === 'object' &&
          !Array.isArray(persisted)
        ) {
          const p = persisted as Record<string, unknown>;
          if (Array.isArray(p.pipelines)) {
            const safe: UtilityPipelineV1[] = [];
            for (const raw of p.pipelines) {
              const parsed = parsePipeline(raw);
              if (parsed !== null) safe.push(parsed);
              if (safe.length >= PIPELINE_CAP) break;
            }
            merged.pipelines = safe;
          }
          if (typeof p.activePipelineId === 'string') {
            const exists = merged.pipelines.some((entry) => entry.id === p.activePipelineId);
            merged.activePipelineId = exists ? p.activePipelineId : null;
          } else {
            merged.activePipelineId = null;
          }
        }
        // Always start with empty transient inputs + clean execution flag.
        merged.inputsByPipelineId = {};
        merged.isExecutingActive = false;
        return merged;
      },
    }
  )
);

/**
 * Test seam — reset the store to its initial state.
 */
export function resetUtilityPipelineStoreForTests(): void {
  useUtilityPipelineStore.setState(createInitialState());
}

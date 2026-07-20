import { MAX_OUTPUTS_PER_CELL } from '../../shared/notebook';
import { isNotebookCellRunStatus, type NotebookState } from './notebookStore';
import type { NotebookSet } from './notebookStoreContext';

/**
 * implementation — notebook run-state action factory.
 *
 * Owns the outputs / run-status / duration / var-flow / execution-order writes
 * plus the clear + restart flows. Every action is a pure `set` update (plus
 * `restartNotebookSession`'s lazy runtime-dispose import), so the factory only
 * needs zustand `set`. Extracted verbatim from `notebookStore.ts`.
 */
export function createRunActions(
  set: NotebookSet
): Pick<
  NotebookState,
  | 'setCellOutputs'
  | 'setCellRunStatus'
  | 'setCellDurationMs'
  | 'setCellVarFlow'
  | 'setCellExecutionOrder'
  | 'clearAllOutputs'
  | 'clearCellOutput'
  | 'restartNotebookSession'
> {
  return {
    setCellOutputs: (tabId, cellId, outputs) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        const idx = slice.notebook.cells.findIndex((c) => c.id === cellId);
        if (idx === -1) return state;
        const existing = slice.notebook.cells[idx]!;
        if (existing.kind !== 'code') return state;
        const trimmed = outputs.slice(0, MAX_OUTPUTS_PER_CELL);
        const next = slice.notebook.cells.slice();
        next[idx] = { ...existing, outputs: trimmed };
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
            },
          },
        };
      }),

    setCellRunStatus: (tabId, cellId, status) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        if (!isNotebookCellRunStatus(status)) return state;
        if (slice.cellRunStatus[cellId] === status) return state;
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              cellRunStatus: {
                ...slice.cellRunStatus,
                [cellId]: status,
              },
            },
          },
        };
      }),

    setCellDurationMs: (tabId, cellId, ms) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) {
          return state;
        }
        // Defensive: these transient maps may be absent on a slice
        // seeded outside `createNotebookForTab` (tests / legacy
        // rehydrate) — treat a missing map as empty rather than throw.
        const prev = slice.cellDurationMs ?? {};
        if (prev[cellId] === ms) return state;
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              cellDurationMs: { ...prev, [cellId]: ms },
            },
          },
        };
      }),

    setCellVarFlow: (tabId, cellId, varFlow) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        const prev = slice.cellVarFlow ?? {};
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              cellVarFlow: {
                ...prev,
                [cellId]: {
                  uses: varFlow.uses,
                  produces: varFlow.produces,
                },
              },
            },
          },
        };
      }),

    setCellExecutionOrder: (tabId, cellId) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        // Only stamp cells that actually exist in the notebook.
        if (!slice.notebook.cells.some((c) => c.id === cellId)) return state;
        const nextCounter = (slice.executionCounter ?? 0) + 1;
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              executionCounter: nextCounter,
              cellExecutionOrder: {
                ...(slice.cellExecutionOrder ?? {}),
                [cellId]: nextCounter,
              },
            },
          },
        };
      }),

    clearAllOutputs: (tabId) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        let mutated = false;
        const next = slice.notebook.cells.map((cell) => {
          if (cell.kind !== 'code' || cell.outputs.length === 0) return cell;
          mutated = true;
          return { ...cell, outputs: [] };
        });
        if (!mutated) return state;
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
            },
          },
        };
      }),

    clearCellOutput: (tabId, cellId) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        const idx = slice.notebook.cells.findIndex((c) => c.id === cellId);
        if (idx === -1) return state;
        const existing = slice.notebook.cells[idx]!;
        if (existing.kind !== 'code' || existing.outputs.length === 0) {
          return state;
        }
        const next = slice.notebook.cells.slice();
        next[idx] = { ...existing, outputs: [] };
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
            },
          },
        };
      }),

    restartNotebookSession: (tabId) => {
      // Dispose the runtime sandbox so the kernel is freed and a
      // concurrent run can't merge a delta into a sandbox we're about
      // to drop. Idempotent on an unknown tabId. Lazy import — keeps
      // the runner/`esbuild-wasm` chain out of `notebookStore`'s
      // static graph (see the import-site note above); mirrors
      // `editorStore.removeTab`.
      void import('../runtime/notebookSession').then((mod) =>
        mod.disposeNotebookSession(tabId)
      );
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        const next = slice.notebook.cells.map((cell) =>
          cell.kind === 'code' && cell.outputs.length > 0
            ? { ...cell, outputs: [] }
            : cell
        );
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
              // Reset every transient map to its just-created state.
              cellRunStatus: {},
              cellDurationMs: {},
              cellVarFlow: {},
              executionCounter: 0,
              cellExecutionOrder: {},
            },
          },
        };
      });
    },
  };
}

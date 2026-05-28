/**
 * RL-043 Slice A — Per-tab notebook store.
 *
 * Owns the cells + last-run outputs + per-cell run status keyed by
 * `tabId`. Persisted on an isolated `lingua-notebook-state`
 * localStorage key so a Settings reset doesn't wipe notebooks; the
 * tab's own `recipeBindingId`-style `FileTab.kind: 'notebook'`
 * discriminator is the canonical "is this a notebook?" check.
 *
 * Why a separate store from `editorStore`:
 *
 *   - `editorStore` persists FileTab metadata (name, language,
 *     content, recipeBindingId, runtimeMode…). Each notebook ALSO
 *     has cells + per-cell outputs + per-cell run status that don't
 *     belong on the FileTab itself (would balloon the persisted blob
 *     + break per-language fields like `content`).
 *   - Keeping notebook state in its own store mirrors the RL-094
 *     capsule / RL-097 HTTP / RL-099 utility-pipeline pattern.
 *   - The tab discriminator + the notebook store stay in sync via
 *     `editorStore.removeTab` + `editorStore.renameTab` hooks that
 *     call `notebookStore.disposeNotebookForTab(tabId)` (mirror of
 *     the RL-039 Slice B recipeStore unbind pattern).
 *
 * Per-cell run outputs persist alongside the cells so a reload
 * surfaces the last-known output state. Cell run status (`idle` /
 * `running` / `ok` / `error` / `stopped`) is TRANSIENT — reload
 * resets every cell to `idle` so the user knows the session was
 * cleared.
 */

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import {
  createBlankNotebook,
  MAX_CELLS_PER_NOTEBOOK,
  MAX_CELL_SOURCE_LENGTH,
  MAX_OUTPUTS_PER_CELL,
  parseNotebook,
  type NotebookCellLanguage,
  type NotebookCellOutputV1,
  type NotebookCellV1,
  type NotebookV1,
} from '../../shared/notebook';

/**
 * Closed-enum cell run status. `idle` is the default + the rehydrate
 * value (transient state never persists). `running` flips while a
 * `runNotebookCell` call is in flight; `ok` / `error` / `stopped`
 * are terminal.
 */
export const NOTEBOOK_CELL_RUN_STATUSES = [
  'idle',
  'running',
  'ok',
  'error',
  'stopped',
] as const;
export type NotebookCellRunStatus =
  (typeof NOTEBOOK_CELL_RUN_STATUSES)[number];

interface NotebookTabState {
  readonly notebook: NotebookV1;
  /** Per-cell run status. Reload resets to `idle`. */
  readonly cellRunStatus: Readonly<Record<string, NotebookCellRunStatus>>;
  /** Active cell id for keyboard focus / context actions. */
  readonly activeCellId: string | null;
}

export interface NotebookState {
  /** Per-tabId notebook state. Persisted via `partialize`. */
  readonly notebooks: Readonly<Record<string, NotebookTabState>>;

  // -------- mutations -----------------------------------------------------

  /** Create a new notebook for a tab; idempotent if already exists. */
  createNotebookForTab: (tabId: string, title?: string) => void;
  /** Drop the entire notebook entry for a tab. Called by editorStore's
   * `removeTab` + `renameTab` hooks. */
  disposeNotebookForTab: (tabId: string) => void;
  /** Rename the user-visible notebook title for a tab. */
  renameNotebookForTab: (tabId: string, title: string) => void;
  /** Append a new cell after the given cell id (or at the end when null). */
  addCell: (
    tabId: string,
    afterCellId: string | null,
    cell: { kind: 'code'; language: NotebookCellLanguage } | { kind: 'markdown' }
  ) => string | null;
  /** Remove a cell by id. */
  removeCell: (tabId: string, cellId: string) => void;
  /** Edit a cell's source. */
  updateCellSource: (tabId: string, cellId: string, source: string) => void;
  /** Reorder cells — move from index `fromIdx` to `toIdx`. */
  moveCell: (tabId: string, fromIdx: number, toIdx: number) => void;
  /** Set the outputs of a cell after a Run+settle. */
  setCellOutputs: (
    tabId: string,
    cellId: string,
    outputs: ReadonlyArray<NotebookCellOutputV1>
  ) => void;
  /** Flip the run status. */
  setCellRunStatus: (
    tabId: string,
    cellId: string,
    status: NotebookCellRunStatus
  ) => void;
  /** Set the active cell. */
  setActiveCell: (tabId: string, cellId: string | null) => void;

  // -------- selectors -----------------------------------------------------

  getNotebookForTab: (tabId: string) => NotebookV1 | undefined;
  getCellRunStatus: (tabId: string, cellId: string) => NotebookCellRunStatus;
  getActiveCellId: (tabId: string) => string | null;
}

function createInitialState(): Pick<NotebookState, 'notebooks'> {
  return { notebooks: {} };
}

function isNotebookCellRunStatus(
  value: unknown
): value is NotebookCellRunStatus {
  return (
    typeof value === 'string' &&
    (NOTEBOOK_CELL_RUN_STATUSES as readonly string[]).includes(value)
  );
}

function createCellId(prefix: 'cell'): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `${prefix}-${randomUUID.call(globalThis.crypto).slice(0, 8)}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useNotebookStore = create<NotebookState>()(
  persist(
    (set, get) => ({
      ...createInitialState(),

      createNotebookForTab: (tabId, title = 'Untitled notebook') => {
        if (typeof tabId !== 'string' || tabId.length === 0) return;
        set((state) => {
          if (state.notebooks[tabId]) return state;
          const notebook = createBlankNotebook({
            id: `notebook-${tabId.slice(0, 8)}`,
            title,
          });
          return {
            notebooks: {
              ...state.notebooks,
              [tabId]: {
                notebook,
                cellRunStatus: {},
                activeCellId: notebook.cells[0]?.id ?? null,
              },
            },
          };
        });
      },

      disposeNotebookForTab: (tabId) =>
        set((state) => {
          if (!state.notebooks[tabId]) return state;
          const { [tabId]: _drop, ...rest } = state.notebooks;
          void _drop;
          return { notebooks: rest };
        }),

      renameNotebookForTab: (tabId, title) =>
        set((state) => {
          const slice = state.notebooks[tabId];
          if (!slice) return state;
          const trimmed = title.trim();
          if (trimmed.length === 0 || trimmed === slice.notebook.title) {
            return state;
          }
          return {
            notebooks: {
              ...state.notebooks,
              [tabId]: {
                ...slice,
                notebook: { ...slice.notebook, title: trimmed },
              },
            },
          };
        }),

      addCell: (tabId, afterCellId, spec) => {
        const state = get();
        const entry = state.notebooks[tabId];
        if (!entry) return null;
        if (entry.notebook.cells.length >= MAX_CELLS_PER_NOTEBOOK) return null;
        const id = createCellId('cell');
        const cell: NotebookCellV1 =
          spec.kind === 'code'
            ? {
                kind: 'code',
                id,
                language: spec.language,
                source: '',
                outputs: [],
              }
            : { kind: 'markdown', id, source: '' };
        set((s) => {
          const slice = s.notebooks[tabId];
          if (!slice) return s;
          const next = slice.notebook.cells.slice();
          if (afterCellId === null) {
            next.push(cell);
          } else {
            const idx = next.findIndex((c) => c.id === afterCellId);
            next.splice(idx === -1 ? next.length : idx + 1, 0, cell);
          }
          return {
            notebooks: {
              ...s.notebooks,
              [tabId]: {
                ...slice,
                notebook: { ...slice.notebook, cells: next },
                activeCellId: id,
              },
            },
          };
        });
        return id;
      },

      removeCell: (tabId, cellId) =>
        set((state) => {
          const slice = state.notebooks[tabId];
          if (!slice) return state;
          const idx = slice.notebook.cells.findIndex((c) => c.id === cellId);
          if (idx === -1) return state;
          const next = slice.notebook.cells.slice();
          next.splice(idx, 1);
          const { [cellId]: _droppedStatus, ...remainingStatus } =
            slice.cellRunStatus;
          void _droppedStatus;
          return {
            notebooks: {
              ...state.notebooks,
              [tabId]: {
                ...slice,
                notebook: { ...slice.notebook, cells: next },
                cellRunStatus: remainingStatus,
                activeCellId:
                  slice.activeCellId === cellId
                    ? next[Math.min(idx, next.length - 1)]?.id ?? null
                    : slice.activeCellId,
              },
            },
          };
        }),

      updateCellSource: (tabId, cellId, source) =>
        set((state) => {
          const slice = state.notebooks[tabId];
          if (!slice) return state;
          // Clamp at MAX_CELL_SOURCE_LENGTH defensively — UI also
          // caps the textarea, but a paste could overflow.
          const clamped =
            source.length > MAX_CELL_SOURCE_LENGTH
              ? source.slice(0, MAX_CELL_SOURCE_LENGTH)
              : source;
          const idx = slice.notebook.cells.findIndex((c) => c.id === cellId);
          if (idx === -1) return state;
          const existing = slice.notebook.cells[idx]!;
          if (existing.source === clamped) return state;
          const updatedCell: NotebookCellV1 =
            existing.kind === 'code'
              ? { ...existing, source: clamped }
              : { ...existing, source: clamped };
          const next = slice.notebook.cells.slice();
          next[idx] = updatedCell;
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

      moveCell: (tabId, fromIdx, toIdx) =>
        set((state) => {
          const slice = state.notebooks[tabId];
          if (!slice) return state;
          const cells = slice.notebook.cells;
          if (
            fromIdx < 0 ||
            fromIdx >= cells.length ||
            toIdx < 0 ||
            toIdx >= cells.length ||
            fromIdx === toIdx
          ) {
            return state;
          }
          const next = cells.slice();
          const [moved] = next.splice(fromIdx, 1);
          if (!moved) return state;
          next.splice(toIdx, 0, moved);
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

      setActiveCell: (tabId, cellId) =>
        set((state) => {
          const slice = state.notebooks[tabId];
          if (!slice) return state;
          if (slice.activeCellId === cellId) return state;
          return {
            notebooks: {
              ...state.notebooks,
              [tabId]: { ...slice, activeCellId: cellId },
            },
          };
        }),

      getNotebookForTab: (tabId) => get().notebooks[tabId]?.notebook,
      getCellRunStatus: (tabId, cellId) =>
        get().notebooks[tabId]?.cellRunStatus[cellId] ?? 'idle',
      getActiveCellId: (tabId) => get().notebooks[tabId]?.activeCellId ?? null,
    }),
    {
      name: 'lingua-notebook-state',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ notebooks: state.notebooks }),
      merge: (persisted, current) => {
        const merged = { ...current };
        if (
          persisted &&
          typeof persisted === 'object' &&
          !Array.isArray(persisted)
        ) {
          const p = persisted as Record<string, unknown>;
          if (
            p.notebooks !== null &&
            typeof p.notebooks === 'object' &&
            !Array.isArray(p.notebooks)
          ) {
            const safe: Record<string, NotebookTabState> = {};
            for (const [tabId, value] of Object.entries(
              p.notebooks as Record<string, unknown>
            )) {
              if (typeof tabId !== 'string' || tabId.length === 0) continue;
              if (value === null || typeof value !== 'object') continue;
              const entry = value as Record<string, unknown>;
              const parsed = parseNotebook(entry.notebook);
              if (!parsed.ok) continue;
              safe[tabId] = {
                notebook: parsed.notebook,
                // Reload always resets transient run status.
                cellRunStatus: {},
                activeCellId:
                  typeof entry.activeCellId === 'string' &&
                  parsed.notebook.cells.some(
                    (c) => c.id === entry.activeCellId
                  )
                    ? entry.activeCellId
                    : parsed.notebook.cells[0]?.id ?? null,
              };
            }
            merged.notebooks = safe;
          }
        }
        return merged;
      },
    }
  )
);

/**
 * Test seam — reset the store to its initial state.
 */
export function resetNotebookStoreForTests(): void {
  useNotebookStore.setState(createInitialState());
}

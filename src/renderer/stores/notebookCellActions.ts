import {
  MAX_CELLS_PER_NOTEBOOK,
  MAX_CELL_SOURCE_LENGTH,
  NOTEBOOK_CELL_LANGUAGES,
  type NotebookCellV1,
} from '../../shared/notebook';
import { createCellId, type NotebookState } from './notebookStore';
import type { NotebookGet, NotebookSet } from './notebookStoreContext';

/**
 * implementation — notebook cell-editing action factory.
 *
 * Owns add / remove / undo-delete / update-source / transform / set-language /
 * move for a tab's cells. `addCell` reads the current store via `get()` before
 * its `set`, so this factory takes both `set` and `get`. Extracted verbatim
 * from `notebookStore.ts`.
 */
export function createCellActions(
  set: NotebookSet,
  get: NotebookGet
): Pick<
  NotebookState,
  | 'addCell'
  | 'removeCell'
  | 'undoDeleteCell'
  | 'updateCellSource'
  | 'transformCell'
  | 'setCellLanguage'
  | 'moveCell'
> {
  return {
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
        const removed = slice.notebook.cells[idx]!;
        const next = slice.notebook.cells.slice();
        next.splice(idx, 1);
        const { [cellId]: _droppedStatus, ...remainingStatus } =
          slice.cellRunStatus;
        void _droppedStatus;
        // FASE 4 — drop this cell's transient latency + var-flow
        // entries in lockstep with its run status so a deleted cell
        // never leaves orphaned per-cell state behind. The `?? {}`
        // guards a slice seeded without these maps (tests / legacy).
        const { [cellId]: _droppedDuration, ...remainingDuration } =
          slice.cellDurationMs ?? {};
        void _droppedDuration;
        const { [cellId]: _droppedVarFlow, ...remainingVarFlow } =
          slice.cellVarFlow ?? {};
        void _droppedVarFlow;
        // Signal-Slate — drop the execution-order stamp too; if this
        // cell ever runs again it earns a fresh `[N]`.
        const { [cellId]: _droppedOrder, ...remainingOrder } =
          slice.cellExecutionOrder ?? {};
        void _droppedOrder;
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
              cellRunStatus: remainingStatus,
              cellDurationMs: remainingDuration,
              cellVarFlow: remainingVarFlow,
              cellExecutionOrder: remainingOrder,
              // Signal-Slate — park the removed cell for a one-shot
              // undo (Jupyter `z`). Capped to the single most-recent
              // delete: a new remove overwrites the buffer.
              lastDeleted: { cell: removed, index: idx },
              activeCellId:
                slice.activeCellId === cellId
                  ? next[Math.min(idx, next.length - 1)]?.id ?? null
                  : slice.activeCellId,
            },
          },
        };
      }),

    undoDeleteCell: (tabId) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        const buffered = slice.lastDeleted;
        if (!buffered) return state;
        // Respect the cell cap — a full notebook can't grow via undo.
        if (slice.notebook.cells.length >= MAX_CELLS_PER_NOTEBOOK) {
          return state;
        }
        // A cell id is globally unique inside a notebook; never
        // re-insert a duplicate (the original may have been recreated
        // before the user hit undo).
        if (slice.notebook.cells.some((c) => c.id === buffered.cell.id)) {
          return state;
        }
        const next = slice.notebook.cells.slice();
        const insertAt = Math.min(
          Math.max(buffered.index, 0),
          next.length
        );
        next.splice(insertAt, 0, buffered.cell);
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
              // One-shot: consuming the buffer empties it so a second
              // `z` is a no-op (matches Jupyter's single undo depth).
              lastDeleted: null,
              activeCellId: buffered.cell.id,
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

    transformCell: (tabId, cellId, newKind) =>
      set((state) => {
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        const idx = slice.notebook.cells.findIndex((c) => c.id === cellId);
        if (idx === -1) return state;
        const existing = slice.notebook.cells[idx]!;
        // No-op when the kind already matches — keeps the union of
        // returned states minimal + avoids a needless rerender.
        if (existing.kind === newKind) return state;
        // Faithful replace: keep the id + position + source text. The
        // schema's discriminated union forbids an in-place toggle
        // (a markdown cell can't carry `language`/`outputs`), so we
        // build the opposite arm fresh. Markdown→code seeds the
        // JavaScript language so the cell is immediately runnable;
        // code→markdown drops outputs (markdown cells carry none).
        const replacement: NotebookCellV1 =
          newKind === 'code'
            ? {
                kind: 'code',
                id: existing.id,
                language: 'javascript',
                source: existing.source,
                outputs: [],
              }
            : {
                kind: 'markdown',
                id: existing.id,
                source: existing.source,
              };
        const next = slice.notebook.cells.slice();
        next[idx] = replacement;
        // Clear this cell's transient run state — its prior status /
        // latency / var-flow / execution stamp no longer describe the
        // new cell kind. Drop them in lockstep so nothing orphans.
        const { [cellId]: _ds, ...remainingStatus } = slice.cellRunStatus;
        void _ds;
        const { [cellId]: _dd, ...remainingDuration } =
          slice.cellDurationMs ?? {};
        void _dd;
        const { [cellId]: _dv, ...remainingVarFlow } =
          slice.cellVarFlow ?? {};
        void _dv;
        const { [cellId]: _do, ...remainingOrder } =
          slice.cellExecutionOrder ?? {};
        void _do;
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
              cellRunStatus: remainingStatus,
              cellDurationMs: remainingDuration,
              cellVarFlow: remainingVarFlow,
              cellExecutionOrder: remainingOrder,
            },
          },
        };
      }),

    setCellLanguage: (tabId, cellId, language) =>
      set((state) => {
        // implementation — JS / TS / Python are all valid code-cell
        // languages now. Defensively reject a runtime value outside the
        // schema enum (e.g. a cast from a programmatic caller).
        if (!NOTEBOOK_CELL_LANGUAGES.includes(language)) {
          return state;
        }
        const slice = state.notebooks[tabId];
        if (!slice) return state;
        const idx = slice.notebook.cells.findIndex((c) => c.id === cellId);
        if (idx === -1) return state;
        const existing = slice.notebook.cells[idx]!;
        // Only code cells carry a language; an unchanged language is a
        // no-op so the union of returned states stays minimal.
        if (existing.kind !== 'code' || existing.language === language) {
          return state;
        }
        const next = slice.notebook.cells.slice();
        // Outputs from the prior language are stale once the cell runs
        // under the new one — drop them with the language change.
        next[idx] = { ...existing, language, outputs: [] };
        // Clear this cell's transient run state in lockstep so nothing
        // orphans (mirrors `transformCell`).
        const { [cellId]: _ds, ...remainingStatus } = slice.cellRunStatus;
        void _ds;
        const { [cellId]: _dd, ...remainingDuration } =
          slice.cellDurationMs ?? {};
        void _dd;
        const { [cellId]: _dv, ...remainingVarFlow } =
          slice.cellVarFlow ?? {};
        void _dv;
        const { [cellId]: _do, ...remainingOrder } =
          slice.cellExecutionOrder ?? {};
        void _do;
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              ...slice,
              notebook: { ...slice.notebook, cells: next },
              cellRunStatus: remainingStatus,
              cellDurationMs: remainingDuration,
              cellVarFlow: remainingVarFlow,
              cellExecutionOrder: remainingOrder,
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
  };
}

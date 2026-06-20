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
import { createMigrate } from './persistence/migrationRegistry';
import {
  createBlankNotebook,
  MAX_CELLS_PER_NOTEBOOK,
  MAX_CELL_SOURCE_LENGTH,
  MAX_OUTPUTS_PER_CELL,
  parseNotebook,
  type NotebookCellKind,
  type NotebookCellLanguage,
  type NotebookCellOutputV1,
  type NotebookCellV1,
  type NotebookV1,
} from '../../shared/notebook';
// NOTE: `notebookSession` is lazy-loaded inside `restartNotebookSession`
// (see below), NOT imported statically here. The module statically pulls
// `runnerManager` → `esbuild-wasm`, whose module body trips an invariant
// under vitest's jsdom env at import time. A static import would cascade
// that failure into every consumer of `notebookStore` (editorStore, App,
// runner tests, …) — the exact ~40-file fallout `editorStore.removeTab`
// already avoids with the same lazy-import trick.

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

/**
 * FASE 4 — per-cell inter-cell variable flow surfaced in the cell
 * header. `uses` is the identifiers the cell referenced that already
 * existed in the sandbox before the run (best-effort token scan);
 * `produces` is the top-level declarations the run added to the
 * sandbox (`outcome.producedKeys`). TRANSIENT, like `cellRunStatus`.
 */
export interface NotebookCellVarFlow {
  readonly uses: ReadonlyArray<string>;
  readonly produces: ReadonlyArray<string>;
}

/**
 * Signal-Slate — a soft-deleted cell parked for one-shot undo (`z` in
 * Jupyter command mode). Holds the removed cell + the index it lived
 * at so `undoDeleteCell` can re-insert it in place. TRANSIENT: cleared
 * on reload like the other in-flight maps, and capped at the single
 * most-recent delete per tab.
 */
export interface NotebookLastDeletedCell {
  readonly cell: NotebookCellV1;
  readonly index: number;
}

interface NotebookTabState {
  readonly notebook: NotebookV1;
  /** Per-cell run status. Reload resets to `idle`. */
  readonly cellRunStatus: Readonly<Record<string, NotebookCellRunStatus>>;
  /**
   * FASE 4 — per-cell last-run latency in ms (fractional). TRANSIENT:
   * mirrors `cellRunStatus`, so reload wipes it back to "no latency".
   */
  readonly cellDurationMs: Readonly<Record<string, number>>;
  /**
   * FASE 4 — per-cell inter-cell variable flow. TRANSIENT, mirrors
   * `cellRunStatus`.
   */
  readonly cellVarFlow: Readonly<Record<string, NotebookCellVarFlow>>;
  /**
   * Signal-Slate — Jupyter `[N]` execution counter. `executionCounter`
   * is the per-tab monotonic seed; `cellExecutionOrder` records the
   * value stamped onto each cell the last time it ran. TRANSIENT:
   * mirrors `cellRunStatus`, so reload restarts numbering at 1.
   */
  readonly executionCounter: number;
  readonly cellExecutionOrder: Readonly<Record<string, number>>;
  /**
   * Signal-Slate — one-shot soft-delete buffer feeding `undoDeleteCell`.
   * `null` when there is nothing to restore. TRANSIENT.
   */
  readonly lastDeleted: NotebookLastDeletedCell | null;
  /** Active cell id for keyboard focus / context actions. */
  readonly activeCellId: string | null;
}

export interface NotebookState {
  /** Per-tabId notebook state. Persisted via `partialize`. */
  readonly notebooks: Readonly<Record<string, NotebookTabState>>;

  // -------- mutations -----------------------------------------------------

  /** Create a new notebook for a tab; idempotent if already exists. */
  createNotebookForTab: (
    tabId: string,
    title?: string,
    initialCodeCellLanguage?: NotebookCellLanguage
  ) => void;
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
  /** Remove a cell by id. Parks it in the per-tab soft-delete buffer
   * so `undoDeleteCell` can restore it. */
  removeCell: (tabId: string, cellId: string) => void;
  /** Signal-Slate — re-insert the most-recently removed cell at its
   * original index (Jupyter `z`). No-op when the buffer is empty. */
  undoDeleteCell: (tabId: string) => void;
  /** Edit a cell's source. */
  updateCellSource: (tabId: string, cellId: string, source: string) => void;
  /** Signal-Slate — toggle a cell between code and markdown while
   * preserving its source text + id + position (Jupyter `m` / `y`).
   * Markdown→code seeds the JavaScript language so the cell is
   * runnable; code→markdown drops outputs (markdown cells carry none).
   * Transient run state for the cell is cleared on transform. */
  transformCell: (
    tabId: string,
    cellId: string,
    newKind: NotebookCellKind
  ) => void;
  /** RL-043 Slice C — change a code cell's language (JS↔TS). Clears the
   * cell's outputs + transient run state (the prior run no longer
   * describes the new language). No-op on a markdown cell or when the
   * language is unchanged. */
  setCellLanguage: (
    tabId: string,
    cellId: string,
    language: NotebookCellLanguage
  ) => void;
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
  /** FASE 4 — record the last-run latency (ms) for a cell. Transient. */
  setCellDurationMs: (tabId: string, cellId: string, ms: number) => void;
  /** FASE 4 — record the inter-cell variable flow for a cell. Transient. */
  setCellVarFlow: (
    tabId: string,
    cellId: string,
    varFlow: NotebookCellVarFlow
  ) => void;
  /** Signal-Slate — stamp the next Jupyter `[N]` execution number onto
   * a cell and bump the per-tab counter. Called from the run path
   * after every settled run (ok / error). Transient. */
  setCellExecutionOrder: (tabId: string, cellId: string) => void;
  /** Signal-Slate — empty every code cell's outputs but keep the cells.
   * Leaves run status untouched (the kernel sandbox is unchanged). */
  clearAllOutputs: (tabId: string) => void;
  /** Signal-Slate — empty a single code cell's outputs. */
  clearCellOutput: (tabId: string, cellId: string) => void;
  /** Signal-Slate — full kernel restart: clear every output, reset run
   * status / durations / var-flow / execution order + counter, AND
   * dispose the runtime sandbox so the next run starts clean. */
  restartNotebookSession: (tabId: string) => void;
  /** Set the active cell. */
  setActiveCell: (tabId: string, cellId: string | null) => void;

  // -------- selectors -----------------------------------------------------

  getNotebookForTab: (tabId: string) => NotebookV1 | undefined;
  getCellRunStatus: (tabId: string, cellId: string) => NotebookCellRunStatus;
  getCellExecutionOrder: (tabId: string, cellId: string) => number | null;
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

      createNotebookForTab: (
        tabId,
        title = 'Untitled notebook',
        initialCodeCellLanguage
      ) => {
        if (typeof tabId !== 'string' || tabId.length === 0) return;
        set((state) => {
          if (state.notebooks[tabId]) return state;
          const notebook = createBlankNotebook({
            id: `notebook-${tabId.slice(0, 8)}`,
            title,
            initialCodeCellLanguage,
          });
          return {
            notebooks: {
              ...state.notebooks,
              [tabId]: {
                notebook,
                cellRunStatus: {},
                cellDurationMs: {},
                cellVarFlow: {},
                executionCounter: 0,
                cellExecutionOrder: {},
                lastDeleted: null,
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
          if (language !== 'javascript' && language !== 'typescript') {
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
      getCellExecutionOrder: (tabId, cellId) =>
        get().notebooks[tabId]?.cellExecutionOrder?.[cellId] ?? null,
      getActiveCellId: (tabId) => get().notebooks[tabId]?.activeCellId ?? null,
    }),
    {
      name: 'lingua-notebook-state',
      version: 1,
      migrate: createMigrate('lingua-notebook-state'),
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
                // Reload always resets transient run status + the FASE 4
                // latency / variable-flow maps + the Signal-Slate
                // execution counter / soft-delete buffer that ride
                // alongside it. A reloaded notebook starts numbering at 1
                // with a fresh kernel and nothing to undo.
                cellRunStatus: {},
                cellDurationMs: {},
                cellVarFlow: {},
                executionCounter: 0,
                cellExecutionOrder: {},
                lastDeleted: null,
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

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
  parseNotebook,
  type NotebookCellKind,
  type NotebookCellLanguage,
  type NotebookCellOutputV1,
  type NotebookCellV1,
  type NotebookV1,
} from '../../shared/notebook';
import { createLifecycleActions } from './notebookLifecycleActions';
import { createCellActions } from './notebookCellActions';
import { createRunActions } from './notebookRunActions';
import { createUiActions } from './notebookUiActions';
import { createNotebookSelectors } from './notebookSelectors';
// NOTE: `notebookSession` is lazy-loaded inside `restartNotebookSession`
// (see the run-action factory), NOT imported statically here. The module
// statically pulls `runnerManager` → `esbuild-wasm`, whose module body trips
// an invariant under vitest's jsdom env at import time. A static import would
// cascade that failure into every consumer of `notebookStore` (editorStore,
// App, runner tests, …) — the exact ~40-file fallout `editorStore.removeTab`
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
  /**
   * RL-043 Slice H fold B — last-known scroll position (px from top) of
   * each tab's cell list, keyed by `tabId`. TRANSIENT session UI state:
   * excluded from `partialize` so a reload starts at the top rather than
   * restoring a stale offset against a possibly-changed notebook. Lets the
   * windowed cell list restore its scroll on a tab switch within a session.
   */
  readonly notebookScrollTop: Readonly<Record<string, number>>;

  // -------- mutations -----------------------------------------------------

  /** Create a new notebook for a tab; idempotent if already exists. */
  createNotebookForTab: (
    tabId: string,
    title?: string,
    initialCodeCellLanguage?: NotebookCellLanguage
  ) => void;
  /**
   * RL-043 Slice E — install a fully-formed `NotebookV1` (parsed from a
   * `.linguanb` import) into a tab, preserving the document's own cell
   * ids / title / createdAt and restoring the per-cell `[N]` execution
   * stamps (fold B). Unlike the `addCell` walk the `.ipynb` import uses,
   * this keeps the import lossless. Overwrites any existing slice for the
   * tab; transient run state (status / durations / var-flow) starts clean
   * since the imported run did not happen in this session.
   */
  installImportedNotebook: (
    tabId: string,
    notebook: NotebookV1,
    executionOrder?: Readonly<Record<string, number>>
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
  /**
   * RL-043 Slice H fold B — record the cell list's scroll position for a
   * tab so a later tab switch can restore it. No-op when the value is
   * unchanged. Transient (not persisted).
   */
  setNotebookScrollTop: (tabId: string, top: number) => void;

  // -------- selectors -----------------------------------------------------

  getNotebookForTab: (tabId: string) => NotebookV1 | undefined;
  getCellRunStatus: (tabId: string, cellId: string) => NotebookCellRunStatus;
  getCellExecutionOrder: (tabId: string, cellId: string) => number | null;
  getActiveCellId: (tabId: string) => string | null;
}

function createInitialState(): Pick<
  NotebookState,
  'notebooks' | 'notebookScrollTop'
> {
  return { notebooks: {}, notebookScrollTop: {} };
}

/**
 * T9 — exported so the extracted run-action factory (`notebookRunActions`)
 * can guard `setCellRunStatus` against an out-of-enum value exactly as the
 * inline body did.
 */
export function isNotebookCellRunStatus(
  value: unknown
): value is NotebookCellRunStatus {
  return (
    typeof value === 'string' &&
    (NOTEBOOK_CELL_RUN_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * T9 — exported so the extracted cell-action factory (`notebookCellActions`)
 * can mint new cell ids exactly as the inline `addCell` body did.
 */
export function createCellId(prefix: 'cell'): string {
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
      ...createLifecycleActions(set),
      ...createCellActions(set, get),
      ...createRunActions(set),
      ...createUiActions(set),
      ...createNotebookSelectors(get),
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

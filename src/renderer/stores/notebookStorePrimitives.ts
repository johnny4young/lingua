/**
 * Runtime-safe primitives shared by the notebook store and its action
 * factories. This leaf must stay independent from `notebookStore.ts`: the
 * store assembles those factories, so importing the assembled store back from
 * a factory would create a module-initialization cycle.
 */

const NOTEBOOK_CELL_RUN_STATUSES = ['idle', 'running', 'ok', 'error', 'stopped'] as const;

export type NotebookCellRunStatus = (typeof NOTEBOOK_CELL_RUN_STATUSES)[number];

export function isNotebookCellRunStatus(value: unknown): value is NotebookCellRunStatus {
  return (
    typeof value === 'string' && (NOTEBOOK_CELL_RUN_STATUSES as readonly string[]).includes(value)
  );
}

export function createNotebookCellId(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === 'function') {
    return `cell-${randomUUID.call(globalThis.crypto).slice(0, 8)}`;
  }
  return `cell-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

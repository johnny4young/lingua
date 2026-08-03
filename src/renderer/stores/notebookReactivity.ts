import type { NotebookCellV1 } from '../../shared/notebook';
import type { NotebookCellRunStatus } from './notebookStorePrimitives';

/**
 * Lazy notebook reactivity is deliberately conservative across runtimes.
 * Lingua's JavaScript, Python, and SQL kernels do not share a typed value
 * bridge, but their effects are ordered by the notebook document. Once a code
 * cell has executed, a change above it can invalidate that visible result even
 * when the two cells use different languages.
 */

export function hasNotebookExecutionEvidence(
  cell: NotebookCellV1,
  status: NotebookCellRunStatus | undefined,
  executionOrder: number | undefined
): boolean {
  if (cell.kind !== 'code') return false;
  return (
    (status !== undefined && status !== 'idle') ||
    cell.outputs.length > 0 ||
    (typeof executionOrder === 'number' && executionOrder > 0)
  );
}

/**
 * Mark only previously-executed code cells stale from a document index.
 * Never-run cells remain idle: they have no output or kernel contribution to
 * invalidate. The original map is returned when no value changes.
 */
export function markExecutedNotebookCellsStale(
  cells: ReadonlyArray<NotebookCellV1>,
  statuses: Readonly<Record<string, NotebookCellRunStatus>> | undefined,
  executionOrder: Readonly<Record<string, number>> | undefined,
  startIndex: number,
  forceCellId?: string
): Readonly<Record<string, NotebookCellRunStatus>> {
  const current = statuses ?? {};
  let next: Record<string, NotebookCellRunStatus> | null = null;
  for (let index = Math.max(0, startIndex); index < cells.length; index += 1) {
    const cell = cells[index]!;
    if (cell.kind !== 'code') continue;
    const shouldMark =
      cell.id === forceCellId ||
      hasNotebookExecutionEvidence(
        cell,
        current[cell.id],
        executionOrder?.[cell.id]
      );
    if (!shouldMark || current[cell.id] === 'stale') continue;
    next ??= { ...current };
    next[cell.id] = 'stale';
  }
  return next ?? current;
}

export function staleNotebookStatusesFromPersistedState(
  cells: ReadonlyArray<NotebookCellV1>,
  executionOrder: Readonly<Record<string, number>> = {}
): Readonly<Record<string, NotebookCellRunStatus>> {
  return markExecutedNotebookCellsStale(cells, {}, executionOrder, 0);
}

export interface RestoredNotebookExecutionOrder {
  readonly order: Readonly<Record<string, number>>;
  readonly maxStamp: number;
}

/**
 * Restore only positive integer stamps belonging to current code cells.
 * Keeping this small execution ledger is what lets a reload replay a silent
 * setup cell before a stale visible result without guessing or running a cell
 * the user never executed.
 */
export function restoreNotebookExecutionOrder(
  cells: ReadonlyArray<NotebookCellV1>,
  value: unknown
): RestoredNotebookExecutionOrder {
  const cellIds = new Set(
    cells.filter((cell) => cell.kind === 'code').map((cell) => cell.id)
  );
  const order: Record<string, number> = {};
  let maxStamp = 0;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { order, maxStamp };
  }
  for (const [cellId, stamp] of Object.entries(value)) {
    if (!cellIds.has(cellId) || !Number.isInteger(stamp) || Number(stamp) <= 0) {
      continue;
    }
    const safeStamp = Number(stamp);
    order[cellId] = safeStamp;
    maxStamp = Math.max(maxStamp, safeStamp);
  }
  return { order, maxStamp };
}

import type { NotebookState } from './notebookStore';
import type { NotebookGet } from './notebookStoreContext';

/**
 * implementation — notebook read-only selector factory.
 *
 * Bundles the derived reads (`getNotebookForTab`, `getCellRunStatus`,
 * `getCellExecutionOrder`, `getActiveCellId`). Every selector reads the
 * assembled store via `get()`, so the factory only needs zustand `get`.
 * Extracted verbatim from `notebookStore.ts`.
 */
export function createNotebookSelectors(
  get: NotebookGet
): Pick<
  NotebookState,
  | 'getNotebookForTab'
  | 'getCellRunStatus'
  | 'getCellExecutionOrder'
  | 'getActiveCellId'
> {
  return {
    getNotebookForTab: (tabId) => get().notebooks[tabId]?.notebook,
    getCellRunStatus: (tabId, cellId) =>
      get().notebooks[tabId]?.cellRunStatus[cellId] ?? 'idle',
    getCellExecutionOrder: (tabId, cellId) =>
      get().notebooks[tabId]?.cellExecutionOrder?.[cellId] ?? null,
    getActiveCellId: (tabId) => get().notebooks[tabId]?.activeCellId ?? null,
  };
}

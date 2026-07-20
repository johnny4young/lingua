import type { NotebookState } from './notebookStore';
import type { NotebookSet } from './notebookStoreContext';

/**
 * implementation — notebook session-UI action factory.
 *
 * Owns the active-cell + scroll-position writes. Both are pure `set` updates,
 * so the factory only needs zustand `set`. Extracted verbatim from
 * `notebookStore.ts`.
 */
export function createUiActions(
  set: NotebookSet
): Pick<NotebookState, 'setActiveCell' | 'setNotebookScrollTop'> {
  return {
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

    setNotebookScrollTop: (tabId, top) =>
      set((state) => {
        if (typeof tabId !== 'string' || tabId.length === 0) return state;
        if (typeof top !== 'number' || !Number.isFinite(top) || top < 0) {
          return state;
        }
        if (state.notebookScrollTop[tabId] === top) return state;
        return {
          notebookScrollTop: { ...state.notebookScrollTop, [tabId]: top },
        };
      }),
  };
}

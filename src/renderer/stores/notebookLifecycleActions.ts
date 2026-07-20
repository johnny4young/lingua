import { createBlankNotebook } from '../../shared/notebook';
import type { NotebookState } from './notebookStore';
import type { NotebookSet } from './notebookStoreContext';

/**
 * implementation — notebook lifecycle action factory.
 *
 * Owns creating / installing / disposing / renaming a tab's notebook entry.
 * Every action is a pure `set` update, so the factory only needs zustand `set`.
 * Extracted verbatim from `notebookStore.ts`.
 */
export function createLifecycleActions(
  set: NotebookSet
): Pick<
  NotebookState,
  | 'createNotebookForTab'
  | 'installImportedNotebook'
  | 'disposeNotebookForTab'
  | 'renameNotebookForTab'
> {
  return {
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

    installImportedNotebook: (tabId, notebook, executionOrder) => {
      if (typeof tabId !== 'string' || tabId.length === 0) return;
      set((state) => {
        const cellIds = new Set(notebook.cells.map((cell) => cell.id));
        const order: Record<string, number> = {};
        let maxStamp = 0;
        for (const [cellId, value] of Object.entries(executionOrder ?? {})) {
          if (cellIds.has(cellId) && Number.isInteger(value) && value > 0) {
            order[cellId] = value;
            if (value > maxStamp) maxStamp = value;
          }
        }
        return {
          notebooks: {
            ...state.notebooks,
            [tabId]: {
              notebook,
              cellRunStatus: {},
              cellDurationMs: {},
              cellVarFlow: {},
              // Resume the counter past the highest restored stamp so a
              // later run in this session earns a fresh, monotonic `[N]`.
              executionCounter: maxStamp,
              cellExecutionOrder: order,
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
        // Drop the tab's remembered scroll offset in lockstep so it can't
        // outlive the notebook (implementation Slice H implementation note).
        const { [tabId]: _dropScroll, ...restScroll } =
          state.notebookScrollTop;
        void _dropScroll;
        return { notebooks: rest, notebookScrollTop: restScroll };
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
  };
}

import { useUIStore, type StatusNoticeAction } from './uiStore';
import { serializeNotebookDocument } from '../../shared/notebookDocumentFormat';
import { useNotebookStore } from './notebookStore';

export function notebookDocumentSnapshot(tabId: string): string | null {
  const slice = useNotebookStore.getState().notebooks[tabId];
  return slice
    ? serializeNotebookDocument(slice.notebook, { executionOrder: slice.cellExecutionOrder })
    : null;
}

export function notebookDocumentNotice(
  reason:
    | 'invalid'
    | 'conflict'
    | 'destinationConflict'
    | 'writeFailed'
    | 'saved'
    | 'openFailed'
    | 'unavailable',
  actions?: ReadonlyArray<StatusNoticeAction>
) {
  useUIStore.getState().pushStatusNotice({
    // Conflicts stay up until the user picks Reload or Save As.
    tone:
      reason === 'saved'
        ? 'success'
        : reason === 'conflict' || reason === 'destinationConflict'
          ? 'error'
          : 'warning',
    messageKey: `notebook.document.${reason}`,
    ...(actions && actions.length > 0 ? { actions } : {}),
  });
}

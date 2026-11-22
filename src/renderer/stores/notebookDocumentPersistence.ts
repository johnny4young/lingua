import { useUIStore, type StatusNoticeAction } from './uiStore';
import {
  serializeNotebookDocument,
  serializeNotebookDocumentWithinLimit,
} from '../../shared/notebookDocumentFormat';
import { useNotebookStore } from './notebookStore';

export function notebookDocumentSnapshot(tabId: string): string | null {
  const slice = useNotebookStore.getState().notebooks[tabId];
  if (!slice) return null;
  const options = { executionOrder: slice.cellExecutionOrder };
  // Within the limit when dropping answers is enough; an oversized document still fails the save.
  const outcome = serializeNotebookDocumentWithinLimit(slice.notebook, options);
  return outcome.ok ? outcome.json : serializeNotebookDocument(slice.notebook, options);
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

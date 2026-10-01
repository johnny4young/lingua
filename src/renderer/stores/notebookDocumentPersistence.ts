import { useUIStore } from './uiStore';
import { serializeNotebookDocument } from '../../shared/notebookDocumentFormat';
import { useNotebookStore } from './notebookStore';

export function notebookDocumentSnapshot(tabId: string): string | null {
  const slice = useNotebookStore.getState().notebooks[tabId];
  return slice
    ? serializeNotebookDocument(slice.notebook, { executionOrder: slice.cellExecutionOrder })
    : null;
}

export function notebookDocumentNotice(
  reason: 'invalid' | 'conflict' | 'writeFailed' | 'saved' | 'openFailed' | 'unavailable'
) {
  useUIStore.getState().pushStatusNotice({
    tone: reason === 'saved' ? 'success' : 'warning',
    messageKey: `notebook.document.${reason}`,
  });
}

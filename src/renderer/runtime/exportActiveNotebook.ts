/**
 * implementation Slice E implementation note — export the ACTIVE notebook as a `.linguanb`
 * document from outside the notebook toolbar (the command-palette
 * "Export notebook as .linguanb" action).
 *
 * Self-contained so the palette host (`AppOverlays`) wires a one-liner:
 * it reads the active tab + its notebook directly from the stores
 * (the notebook export is a pure function of `NotebookV1` +
 * execution-order), downloads via the shared helper, and surfaces a
 * status notice. When the active tab is not a notebook it no-ops with
 * an informational notice instead of doing nothing silently, so the
 * always-listed palette entry behaves predictably.
 */

import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useNotebookStore } from '../stores/notebookStore';
import { useUIStore } from '../stores/uiStore';
import { trackNotebookExported } from '../hooks/notebookTelemetry';
import { exportNotebookAsLinguanb } from '../components/Notebook/notebookExportToLinguanb';
import { saveOrDownloadLinguanb } from './notebookLinguanbDisk';

export function exportActiveNotebookAsLinguanb(): void {
  const pushStatusNotice = useUIStore.getState().pushStatusNotice;
  const tab = getActiveTab(useEditorStore.getState());
  if (!tab || tab.kind !== 'notebook') {
    pushStatusNotice({
      tone: 'info',
      messageKey: 'notebook.notice.exportNoActiveNotebook',
    });
    return;
  }
  const notebookState = useNotebookStore.getState();
  const notebook = notebookState.getNotebookForTab(tab.id);
  if (!notebook) {
    pushStatusNotice({
      tone: 'info',
      messageKey: 'notebook.notice.exportNoActiveNotebook',
    });
    return;
  }
  const executionOrder = notebookState.notebooks[tab.id]?.cellExecutionOrder;
  const result = exportNotebookAsLinguanb(notebook, {
    ...(executionOrder ? { executionOrder } : {}),
  });
  // implementation note — native Save dialog on desktop; blob download on web.
  void saveOrDownloadLinguanb(result.json, result.suggestedFileName, {
    onOk: () => {
      trackNotebookExported('linguanb');
      pushStatusNotice({
        tone: 'success',
        messageKey: 'notebook.notice.exportLinguanbOk',
      });
    },
    onError: () =>
      pushStatusNotice({
        tone: 'error',
        messageKey: 'notebook.notice.exportFailed',
      }),
  });
}

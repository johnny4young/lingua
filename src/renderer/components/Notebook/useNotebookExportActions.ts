import { useCallback } from 'react';
import type { NotebookV1 } from '../../../shared/notebook';
import { useUIStore } from '../../stores/uiStore';
import { trackNotebookExported } from '../../hooks/notebookTelemetry';
import { downloadTextFile } from '../../utils/downloadTextFile';
import { saveOrDownloadLinguanb } from '../../runtime/notebookLinguanbDisk';
import { exportNotebookAsScript } from './notebookExportToScript';
import { exportNotebookAsIpynb } from './notebookExportToIpynb';
import { exportNotebookAsLinguanb } from './notebookExportToLinguanb';

interface UseNotebookExportActionsOptions {
  readonly notebook: NotebookV1 | undefined;
  readonly cellExecutionOrderMap: Readonly<Record<string, number>> | undefined;
  readonly closeMenu: () => void;
}

export function useNotebookExportActions({
  notebook,
  cellExecutionOrderMap,
  closeMenu,
}: UseNotebookExportActionsOptions) {
  const pushStatusNotice = useUIStore((state) => state.pushStatusNotice);

  const handleExport = useCallback(() => {
    closeMenu();
    if (!notebook) return;
    const result = exportNotebookAsScript(notebook);
    if (result.source.length === 0) {
      pushStatusNotice({ tone: 'info', messageKey: 'notebook.notice.exportEmpty' });
      return;
    }
    try {
      downloadTextFile(result.source, result.suggestedFileName, 'text/plain;charset=utf-8');
      trackNotebookExported('script');
      pushStatusNotice({ tone: 'success', messageKey: 'notebook.notice.exportOk' });
    } catch {
      pushStatusNotice({ tone: 'error', messageKey: 'notebook.notice.exportFailed' });
    }
  }, [closeMenu, notebook, pushStatusNotice]);

  const handleExportIpynb = useCallback(() => {
    closeMenu();
    if (!notebook) return;
    const result = exportNotebookAsIpynb(notebook, {
      executionOrder: cellExecutionOrderMap ?? {},
    });
    try {
      downloadTextFile(
        result.json,
        result.suggestedFileName,
        'application/x-ipynb+json;charset=utf-8'
      );
      trackNotebookExported('ipynb');
      pushStatusNotice({ tone: 'success', messageKey: 'notebook.notice.exportIpynbOk' });
    } catch {
      pushStatusNotice({ tone: 'error', messageKey: 'notebook.notice.exportFailed' });
    }
  }, [cellExecutionOrderMap, closeMenu, notebook, pushStatusNotice]);

  const handleExportLinguanb = useCallback(() => {
    closeMenu();
    if (!notebook) return;
    const result = exportNotebookAsLinguanb(notebook, {
      executionOrder: cellExecutionOrderMap ?? {},
    });
    void saveOrDownloadLinguanb(result.json, result.suggestedFileName, {
      onOk: () => {
        trackNotebookExported('linguanb');
        pushStatusNotice({
          tone: 'success',
          messageKey: 'notebook.notice.exportLinguanbOk',
        });
      },
      onError: () =>
        pushStatusNotice({ tone: 'error', messageKey: 'notebook.notice.exportFailed' }),
    });
  }, [cellExecutionOrderMap, closeMenu, notebook, pushStatusNotice]);

  return { handleExport, handleExportIpynb, handleExportLinguanb };
}

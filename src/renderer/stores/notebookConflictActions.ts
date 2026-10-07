import type { StatusNoticeAction } from './uiStore';
import { emitCommand } from './commandBus';
import { notebookDocumentNotice } from './notebookDocumentPersistence';

/** Recovery actions for a document whose disk copy moved past our baseline. */
export function notebookConflictActions(
  tabId: string,
  canReload: boolean
): ReadonlyArray<StatusNoticeAction> {
  const saveAs: StatusNoticeAction = {
    labelKey: 'commandPalette.action.saveAs.label',
    onClick: () => {
      void import('./editorStore')
        .then(({ useEditorStore }) => useEditorStore.getState().saveTabById(tabId, true))
        .catch(() => notebookDocumentNotice('writeFailed'));
    },
  };
  if (!canReload) return [saveAs];
  return [
    {
      labelKey: 'git.externalReload.dirty.action',
      onClick: () => emitCommand('editor.reloadFromDisk', { tabId }),
    },
    saveAs,
  ];
}

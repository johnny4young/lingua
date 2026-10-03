import { flushNotebookDocumentDrafts } from './notebookDocumentDrafts';
import { useEditorStore } from './editorStore';
import { useUIStore } from './uiStore';

/**
 * Save `tabIds` for a Save All quit. Resolves true only when nothing is left
 * dirty; otherwise the quit is canceled with a sticky notice naming the tabs.
 */
export async function saveTabsBeforeQuit(tabIds: readonly string[]): Promise<boolean> {
  try {
    for (const id of tabIds) {
      if (!(await useEditorStore.getState().saveTabById(id))) break;
    }
  } catch {
    // The still-dirty check below reports the failure.
  }

  // An edit during any awaited save must remain recoverable.
  for (const tab of useEditorStore.getState().tabs) flushNotebookDocumentDrafts(tab.id);
  const stillDirty = useEditorStore.getState().tabs.filter(tab => tab.isDirty);
  if (stillDirty.length === 0) return true;
  useUIStore.getState().pushStatusNotice({
    tone: 'error',
    messageKey: 'dialogs.closeApp.saveIncomplete',
    values: { count: stillDirty.length, names: stillDirty.map(tab => tab.name).join(', ') },
  });
  return false;
}

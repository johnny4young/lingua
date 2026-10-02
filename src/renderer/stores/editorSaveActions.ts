import { flushNotebookDocumentDrafts } from './notebookDocumentDrafts';
import { notebookDocumentSnapshot } from './notebookDocumentPersistence';
import { withDocumentWriteLock } from '../../shared/documentWrite';
import type { EditorState } from '../types/editor';
import type { EditorGet, EditorSet } from './editorStoreContext';

/** Dispatch explicit file gestures without loading document actions during cold start. */
export function createSaveActions(
  set: EditorSet,
  get: EditorGet
): Pick<
  EditorState,
  'openFile' | 'openFileFromDisk' | 'saveActiveTab' | 'saveActiveTabAs' | 'saveTabById'
> {
  const saveTab = async (id: string, forceSaveAs = false, snapshot?: string | null) => {
    const { createDocumentSaveAction } = await import('./editorDocumentSave');
    return createDocumentSaveAction(set, get)(id, forceSaveAs, snapshot);
  };
  const openActions = async () => {
    const { createDocumentOpenActions } = await import('./editorDocumentOpen');
    return createDocumentOpenActions(set, get);
  };
  return {
    openFile: async (...args) => (await openActions()).openFile(...args),
    openFileFromDisk: async () => (await openActions()).openFileFromDisk(),
    saveActiveTab: async () => {
      const { activeTabId, saveTabById } = get();
      if (!activeTabId) return;
      await saveTabById(activeTabId);
    },

    saveActiveTabAs: async () => {
      const { activeTabId, saveTabById } = get();
      if (!activeTabId) return;
      await saveTabById(activeTabId, true);
    },

    saveTabById: (id, forceSaveAs = false) => {
      if (get().tabs.find(t => t.id === id)?.kind !== 'notebook') return saveTab(id, forceSaveAs);
      // Freeze the user's request before lock queueing or any lazy module load.
      flushNotebookDocumentDrafts(id);
      const snapshot = notebookDocumentSnapshot(id);
      return withDocumentWriteLock(`notebook-tab:${id}`, () => saveTab(id, forceSaveAs, snapshot));
    },
  };
}

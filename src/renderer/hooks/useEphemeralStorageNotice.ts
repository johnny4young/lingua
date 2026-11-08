import { useEffect } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import { isStorageEphemeral } from '../utils/ephemeralStorage';

/** Says on boot that blocked storage keeps nothing, and has the browser ask before a reload drops edits. */
export function useEphemeralStorageNotice(): void {
  useEffect(() => {
    if (!isStorageEphemeral()) return;
    useUIStore.getState().pushStatusNotice({ tone: 'warning', messageKey: 'storage.ephemeral.message' });
    const guardEdits = (event: BeforeUnloadEvent) => {
      if (useEditorStore.getState().tabs.some(tab => tab.isDirty)) event.preventDefault();
    };
    window.addEventListener('beforeunload', guardEdits);
    return () => window.removeEventListener('beforeunload', guardEdits);
  }, []);
}

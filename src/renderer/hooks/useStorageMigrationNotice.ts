import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';

/** Tells the user once when storage from an older build could not be copied over. */
export function useStorageMigrationNotice(): void {
  useEffect(() => {
    void window.lingua
      ?.consumeStorageMigrationNotice?.()
      .then(notice => {
        if (!notice) return;
        useUIStore.getState().pushStatusNotice({
          tone: 'warning',
          messageKey:
            notice === 'final'
              ? 'startup.storageMigration.final'
              : 'startup.storageMigration.retry',
          sticky: notice === 'final',
        });
      })
      .catch(() => {});
  }, []);
}

import { useSyncExternalStore } from 'react';

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;

  window.addEventListener('online', onStoreChange);
  window.addEventListener('offline', onStoreChange);

  return () => {
    window.removeEventListener('online', onStoreChange);
    window.removeEventListener('offline', onStoreChange);
  };
}

function getOnlineSnapshot(): boolean {
  if (typeof navigator === 'undefined') return true;
  return navigator.onLine !== false;
}

/**
 * IT2-G5 — reactive browser/Electron connectivity signal.
 *
 * The browser owns the state, so `useSyncExternalStore` keeps React aligned
 * with `navigator.onLine` without duplicating it in a component or store. The
 * server/non-DOM snapshot stays online because no connectivity signal exists
 * there and the offline affordance should never flash during hydration.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getOnlineSnapshot, () => true);
}

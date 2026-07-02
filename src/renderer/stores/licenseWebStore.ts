import { create, type StateCreator } from 'zustand';
import { persist } from 'zustand/middleware';
import { createMigrate } from './persistence/migrationRegistry';
import { isLicenseServerEnabled } from '../services/licenseServer';
import { FREE_STATUS, type LicenseState } from './licenseTypes';
import { createWebActions } from './licenseWebActions';
import { createWebRevalidate } from './licenseWebRevalidate';

/**
 * RL-130 — web license store, extracted from `licenseStore.ts`. Assembles the
 * web-flow state creator (initial state + the action factories) and wraps it in
 * the `lingua-license` persist boundary (version 1 + central migrate +
 * token-scoped partialize + the rehydrate revalidate), then attaches the
 * cross-tab `storage` listener. Persist is web-only — the desktop store mirrors
 * the main-process snapshot instead.
 */

const webStateCreator: StateCreator<LicenseState> = (set, get) => ({
  token: null,
  status: FREE_STATUS,
  lastVerifiedAt: null,
  serverSync: isLicenseServerEnabled() ? null : 'disabled',
  devices: null,
  deviceLimit: null,
  recoverHint: null,
  ...createWebActions(set, get),
  ...createWebRevalidate(set, get),
});

/**
 * Wire a `storage` listener that re-reads persisted state when another tab
 * mutates `lingua-license` in localStorage. Zustand's persist middleware
 * does NOT sync in-memory state across tabs on its own — without an
 * explicit `rehydrate()` this tab would revalidate with its stale
 * in-memory token and re-persist a license the other tab just removed.
 * `rehydrate()` re-fires `onRehydrateStorage`, which runs the server
 * roundtrip when a token is present, so a paste in tab A reaches D1 from
 * tab B's perspective too.
 */
function attachCrossTabListener(store: {
  getState: () => LicenseState;
  persist: { rehydrate: () => Promise<void> | void };
}): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('storage', (event) => {
    if (event.key !== 'lingua-license') return;
    queueMicrotask(() => {
      void store.persist.rehydrate();
    });
  });
}

export function createWebStore() {
  const store = create<LicenseState>()(
    persist(webStateCreator, {
      name: 'lingua-license',
      version: 1,
      migrate: createMigrate('lingua-license'),
      partialize: (state) => ({
        token: state.token,
        status: state.token ? state.status : FREE_STATUS,
        lastVerifiedAt: state.token ? state.lastVerifiedAt : null,
        serverSync: state.serverSync,
      }),
      onRehydrateStorage: () => () => {
        // Defer through a microtask so the `store` binding has finished
        // initializing by the time we touch `getState()` — persist v5
        // can fire this callback synchronously inside `create()`.
        queueMicrotask(() => {
          if (!store.getState().token) {
            return;
          }
          void store.getState().revalidate();
        });
      },
    })
  );
  attachCrossTabListener(store);
  return store;
}

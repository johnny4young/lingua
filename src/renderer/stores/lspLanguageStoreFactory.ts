import { create, type UseBoundStore, type StoreApi } from 'zustand';

/**
 * implementation — shared shape for desktop-LSP runtime state.
 *
 * implementation introduced the `useRustLanguageStore`; implementation mirrors the
 * same fields for `useGoLanguageStore`. Rather than duplicate the
 * store body, both languages instantiate this factory. The static
 * language-pack descriptor in `src/shared/languagePacks.ts` records
 * the shape (`lsp: 'desktop'`); the runtime state lives here.
 *
 * Lifecycle (per language):
 *  - `'unknown'`        — capability has not been detected yet.
 *  - `'available'`      — server is running and answering requests.
 *  - `'unavailable'`    — binary missing on PATH, web build, or
 *                         initialize handshake failed. `reason`
 *                         discriminates so the Settings row can render
 *                         the right hint.
 *  - `'degraded'`       — server crashed and could not be auto-
 *                         restarted. UI surfaces a recovery row with
 *                         a Restart button.
 */

export type LspLanguageStatus =
  | { kind: 'unknown' }
  | { kind: 'available'; version: string }
  | { kind: 'unavailable'; reason: 'missing' | 'web-build' | 'startup-failed'; detail?: string }
  | { kind: 'degraded'; detail?: string };

export interface LspLanguageState {
  status: LspLanguageStatus;
  /** True once a tab in the matching language has triggered boot. */
  bootRequested: boolean;
  /** True once the ready toast has fired for the current session. */
  readyToastShown: boolean;
  setStatus: (status: LspLanguageStatus) => void;
  markBootRequested: () => void;
  markReadyToastShown: () => void;
  reset: () => void;
}

export type LspLanguageStore = UseBoundStore<StoreApi<LspLanguageState>>;

export function createLspLanguageStore(): LspLanguageStore {
  return create<LspLanguageState>((set) => ({
    status: { kind: 'unknown' },
    bootRequested: false,
    readyToastShown: false,
    setStatus: (status) => set({ status }),
    markBootRequested: () => set({ bootRequested: true }),
    markReadyToastShown: () => set({ readyToastShown: true }),
    reset: () =>
      set({ status: { kind: 'unknown' }, bootRequested: false, readyToastShown: false }),
  }));
}

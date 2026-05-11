import { create } from 'zustand';

/**
 * RL-026 Slice 3 — live rust-analyzer capability state.
 *
 * The static `LanguagePack` descriptor in `src/shared/languagePacks.ts`
 * records *that* Rust supports a desktop LSP (`lsp: 'desktop'`). This
 * store records the runtime answer to "is rust-analyzer actually
 * available right now on this host?". Keeping the two separated means
 * the descriptor stays buildable without spawning subprocesses.
 *
 * Lifecycle:
 *  - `'unknown'`  — capability has not been detected yet (initial boot).
 *  - `'available'` — server is running and answering requests.
 *  - `'unavailable'` — `rust-analyzer` is not on PATH, the web build
 *    explicitly stubs it out, or the initialize handshake failed. The
 *    `reason` discriminates so the UI can render the right hint.
 *  - `'degraded'` — the server crashed and the launcher could not
 *    auto-restart it. Renders a recovery row with a restart button.
 */

export type RustLanguageStatus =
  | { kind: 'unknown' }
  | { kind: 'available'; version: string }
  | { kind: 'unavailable'; reason: 'missing' | 'web-build' | 'startup-failed'; detail?: string }
  | { kind: 'degraded'; detail?: string };

export interface RustLanguageState {
  status: RustLanguageStatus;
  /** True once a `.rs` tab has triggered the boot path at least once. */
  bootRequested: boolean;
  /** True once the ready toast has fired for the current session. */
  readyToastShown: boolean;
  setStatus: (status: RustLanguageStatus) => void;
  markBootRequested: () => void;
  markReadyToastShown: () => void;
  reset: () => void;
}

export const useRustLanguageStore = create<RustLanguageState>((set) => ({
  status: { kind: 'unknown' },
  bootRequested: false,
  readyToastShown: false,
  setStatus: (status) => set({ status }),
  markBootRequested: () => set({ bootRequested: true }),
  markReadyToastShown: () => set({ readyToastShown: true }),
  reset: () =>
    set({ status: { kind: 'unknown' }, bootRequested: false, readyToastShown: false }),
}));

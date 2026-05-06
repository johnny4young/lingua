import { create } from 'zustand';

/**
 * RL-069 Slice 1 — current utility panel output provider.
 *
 * The Developer Utilities modal mounts one panel at a time. That panel
 * registers a getter on mount via `useRegisterUtilityOutput`; the
 * global keyboard shortcut handler reads through that getter when the
 * user presses Cmd+Shift+C / Cmd+Alt+R. Nothing is "captured" — we
 * call the getter at dispatch time so the value is always fresh.
 *
 * Slice 1 deliberately wires only 5 representative panels (JSON,
 * Base64, URL, JWT, UUID); panels without a registered provider fall
 * through to `getProvider() === null` and the shortcut handler shows
 * the "no output yet" toast. Slice 2 adds the remaining 24 panels in
 * the same pass that introduces `detect()`.
 *
 * The store is intentionally state-light: a single function reference
 * plus a setter / clearer. No history, no debounce, no React tree
 * re-render on read — `getProvider()` lives outside the React data
 * flow because it's only consulted from imperative event handlers.
 */

export type UtilityOutputProvider = () => string | null;

interface UtilityOutputState {
  provider: UtilityOutputProvider | null;
  setProvider: (provider: UtilityOutputProvider) => void;
  clearProvider: () => void;
  /** Imperative read — returns the current output or null if no panel registered. */
  getProvider: () => UtilityOutputProvider | null;
}

export const useUtilityOutputStore = create<UtilityOutputState>((set, get) => ({
  provider: null,
  setProvider: (provider) => set({ provider }),
  clearProvider: () => set({ provider: null }),
  getProvider: () => get().provider,
}));

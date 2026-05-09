import { create } from 'zustand';

/**
 * RL-069 Slice 1 — current utility panel output provider.
 * RL-069 Slice 2 — adds an `applyHandler` slot so the global
 * `Mod+Shift+A` shortcut can fire the focused panel's ⚡ Apply.
 *
 * The Developer Utilities modal mounts one panel at a time. That panel
 * registers a getter on mount via `useRegisterUtilityOutput`; the
 * global keyboard shortcut handler reads through that getter when the
 * user presses Cmd+Shift+C / Cmd+Alt+R. Nothing is "captured" — we
 * call the getter at dispatch time so the value is always fresh.
 *
 * Slice 2 closes Slice 1's deliberate gap: every panel that is not a
 * pure generator (random-string, lorem-ipsum) registers an output
 * provider AND, where applicable, an apply handler. The store remains
 * intentionally state-light: two function references plus their
 * setter / clearer pairs. No history, no debounce, no React tree
 * re-render on read — both getters live outside the React data flow
 * because they're only consulted from imperative event handlers.
 */

export type UtilityOutputProvider = () => string | null;

export interface UtilityApplyDescriptor {
  /** Whether the panel currently considers `Apply` actionable. */
  enabled: boolean;
  /** Display name (translated) of the focused tool, used in the success toast. */
  toolNameKey: string;
  /** Imperative trigger that re-runs the tool against its current input. */
  run: () => void;
}

export type UtilityApplyHandler = () => UtilityApplyDescriptor | null;

interface UtilityOutputState {
  provider: UtilityOutputProvider | null;
  applyHandler: UtilityApplyHandler | null;
  setProvider: (provider: UtilityOutputProvider) => void;
  clearProvider: () => void;
  setApplyHandler: (handler: UtilityApplyHandler) => void;
  clearApplyHandler: () => void;
  /** Imperative read — returns the current output or null if no panel registered. */
  getProvider: () => UtilityOutputProvider | null;
  /** Imperative read — returns the current Apply descriptor or null if absent. */
  getApplyHandler: () => UtilityApplyHandler | null;
}

export const useUtilityOutputStore = create<UtilityOutputState>((set, get) => ({
  provider: null,
  applyHandler: null,
  setProvider: (provider) => set({ provider }),
  clearProvider: () => set({ provider: null }),
  setApplyHandler: (handler) => set({ applyHandler: handler }),
  clearApplyHandler: () => set({ applyHandler: null }),
  getProvider: () => get().provider,
  getApplyHandler: () => get().applyHandler,
}));

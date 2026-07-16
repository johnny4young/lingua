/**
 * RL-116 Slice 1 — presenter / focus mode.
 *
 * One session-only boolean that the chrome reads at RENDER time:
 * sidebar, toolbar, and status bar gate themselves on it, the editor
 * adds +4 to its font size, and the console output adds +2. Nothing
 * here mutates the underlying uiStore/settings values — that is the
 * point. A snapshot-and-restore design would write presenter values
 * into the persisted settings, and a reload mid-presentation would
 * then "restore" the presenter state as the user's real preferences.
 * Render-time overrides make switching off (or crashing, or
 * reloading) trivially lossless.
 */

import { create } from 'zustand';

/** Editor font-size lift while presenting, in px over the user's base. */
export const PRESENTER_EDITOR_FONT_LIFT = 4;

interface PresenterModeState {
  active: boolean;
  toggle: () => void;
  setActive: (active: boolean) => void;
}

export const usePresenterModeStore = create<PresenterModeState>(set => ({
  active: false,
  toggle: () => set(state => ({ active: !state.active })),
  setActive: active => set({ active }),
}));

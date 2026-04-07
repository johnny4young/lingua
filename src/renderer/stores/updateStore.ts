import { create } from 'zustand';

type UpdateStore = UpdateState & {
  initialized: boolean;
  initialize: () => Promise<() => void>;
  refresh: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  restartToApply: () => Promise<boolean>;
};

const defaultState: UpdateState = {
  status: 'unavailable',
  supported: false,
  enabled: false,
  message: 'Automatic updates are not available.',
};

let teardownUpdatesListener: (() => void) | null = null;

export const useUpdateStore = create<UpdateStore>((set) => ({
  ...defaultState,
  initialized: false,

  initialize: async () => {
    if (teardownUpdatesListener) {
      return teardownUpdatesListener;
    }

    const state = await window.runlang.updates.getState();
    set({ ...state, initialized: true });

    teardownUpdatesListener = window.runlang.updates.onStateChanged((nextState) => {
      set(nextState);
    });

    return teardownUpdatesListener;
  },

  refresh: async () => {
    const state = await window.runlang.updates.getState();
    set(state);
  },

  checkForUpdates: async () => {
    const state = await window.runlang.updates.check();
    set(state);
  },

  restartToApply: async () => window.runlang.updates.restartToApply(),
}));

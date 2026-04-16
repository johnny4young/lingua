import { create } from 'zustand';
import { getActiveAppLanguage } from '../i18n';
import { translateCommon } from '../../shared/i18n/runtime';

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

function checkingState(): Pick<UpdateState, 'status' | 'message' | 'lastCheckedAt'> {
  return {
    status: 'checking',
    message: translateCommon(getActiveAppLanguage(), 'updates.actions.checking'),
    lastCheckedAt: new Date().toISOString(),
  };
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  ...defaultState,
  initialized: false,

  initialize: async () => {
    if (teardownUpdatesListener) {
      return teardownUpdatesListener;
    }

    const state = await window.lingua.updates.getState();
    set({ ...state, initialized: true });

    teardownUpdatesListener = window.lingua.updates.onStateChanged((nextState) => {
      set(nextState);
    });

    return teardownUpdatesListener;
  },

  refresh: async () => {
    const state = await window.lingua.updates.getState();
    set(state);
  },

  checkForUpdates: async () => {
    set(checkingState());
    const state = await window.lingua.updates.check();
    set(state);
  },

  restartToApply: async () => window.lingua.updates.restartToApply(),
}));

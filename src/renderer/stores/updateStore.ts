import { create } from 'zustand';
import { getActiveAppLanguage } from '../i18n';
import { translateCommon } from '../../shared/i18n/runtime';
import { trackEvent } from '../utils/telemetry';

type UpdateStore = UpdateState & {
  initialized: boolean;
  initialize: () => Promise<() => void>;
  refresh: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  restartToApply: () => Promise<boolean>;
};

/**
 * RL-065 Slice 5 fold D — fire `update.checked` telemetry on every
 * transition out of `checking`. Closed-enum status:
 *   `available`  — autoupdater found an update (available/downloaded).
 *   `no-update`  — autoupdater confirmed we're current.
 *   `failure`    — autoupdater raised an error during the check.
 * Other transitions (unavailable → unavailable, checking → checking,
 * any transition into `checking`) are ignored.
 */
function resolveCheckedStatus(
  next: UpdateState['status']
): 'available' | 'no-update' | 'failure' | null {
  switch (next) {
    case 'available':
    case 'downloaded':
      return 'available';
    case 'not-available':
      return 'no-update';
    case 'error':
      return 'failure';
    default:
      return null;
  }
}

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

// RL-065 Slice 5 fold D — subscribe at module load so every transition
// out of `checking` (whether triggered by the manual check action, the
// autoupdater's hourly setInterval, or a direct refresh()) yields one
// `update.checked` telemetry event. Subscribing covers all three call
// sites without instrumenting each one.
useUpdateStore.subscribe((next, prev) => {
  if (prev.status !== 'checking') return;
  if (next.status === 'checking') return;
  const status = resolveCheckedStatus(next.status);
  if (status === null) return;
  void trackEvent('update.checked', { status });
});

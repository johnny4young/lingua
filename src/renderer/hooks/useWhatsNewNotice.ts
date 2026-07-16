import { useEffect, useRef } from 'react';
import type { AppOverlay } from './useGlobalShortcuts';
import { useStatusNotice } from './useStatusNotice';
import { useSettingsStore } from '../stores/settingsStore';

interface UseWhatsNewNoticeOptions {
  currentVersion?: string;
  hasHandledDeepLink: boolean;
  overlay: AppOverlay;
  openOverlay: (overlay: Exclude<AppOverlay, 'none'>) => void;
  suppressed: boolean;
}

/**
 * Acknowledge the running version once and surface a non-blocking release
 * notice only for returning users who opted in. Keeping this lifecycle out of
 * AppChrome preserves the shell size budget and gives the version/settings/UI
 * coordination one owner.
 */
export function useWhatsNewNotice({
  currentVersion,
  hasHandledDeepLink,
  overlay,
  openOverlay,
  suppressed,
}: UseWhatsNewNoticeOptions): void {
  const lastSeenVersion = useSettingsStore(state => state.lastSeenVersion);
  const notificationsEnabled = useSettingsStore(
    state => state.whatsNewNotificationsEnabled
  );
  const setLastSeenVersion = useSettingsStore(state => state.setLastSeenVersion);
  const { info } = useStatusNotice();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current || suppressed || hasHandledDeepLink || !currentVersion) {
      return;
    }

    if (lastSeenVersion === currentVersion) {
      handledRef.current = true;
      return;
    }

    if (overlay !== 'none') {
      return;
    }

    handledRef.current = true;
    setLastSeenVersion(currentVersion);

    // A null version is a fresh install, not an upgrade. Acknowledge the
    // current build and let onboarding own first boot without competing
    // release-note chrome.
    if (lastSeenVersion !== null && notificationsEnabled) {
      info('whatsNew.notice.updated', {
        priority: 'normal',
        values: { version: currentVersion },
        actions: [
          {
            labelKey: 'about.actions.whatsNew',
            onClick: () => openOverlay('whats-new'),
          },
        ],
      });
    }
  }, [
    currentVersion,
    hasHandledDeepLink,
    info,
    lastSeenVersion,
    notificationsEnabled,
    openOverlay,
    overlay,
    setLastSeenVersion,
    suppressed,
  ]);
}

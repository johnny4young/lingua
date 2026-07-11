import { useEffect } from 'react';
import { OPEN_LICENSE_SETTINGS_EVENT } from '../utils/upsellNotice';

/** IT2-D1 — route shared upsell CTAs to Settings → Account/License. */
export function useLicenseSettingsNavigation(openSettings: () => void): void {
  useEffect(() => {
    const handler = () => {
      openSettings();
      // SettingsModal owns its selected tab. Wait for it to mount its
      // navigation listener before dispatching the account-tab request.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          window.dispatchEvent(
            new CustomEvent('lingua-settings-navigate-tab', { detail: 'account' })
          );
        });
      });
    };
    window.addEventListener(OPEN_LICENSE_SETTINGS_EVENT, handler);
    return () => window.removeEventListener(OPEN_LICENSE_SETTINGS_EVENT, handler);
  }, [openSettings]);
}

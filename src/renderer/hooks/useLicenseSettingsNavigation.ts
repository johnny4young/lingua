import { emitCommand } from '../stores/commandBus';
import { useCommandListener } from './useCommandListener';

/** IT2-D1 — route shared upsell CTAs to Settings → Account/License. */
export function useLicenseSettingsNavigation(openSettings: () => void): void {
  useCommandListener('settings.openLicense', () => {
    openSettings();
    // SettingsModal owns its selected tab. Wait for it to mount its
    // command listener before issuing the account-tab request.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        emitCommand('settings.navigate', { tab: 'account' });
      });
    });
  });
}

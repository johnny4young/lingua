import { useCommandListener } from './useCommandListener';
import { requestSettingsTab } from '../components/Settings/pendingSettingsTab';

/** Route shared upsell CTAs to Settings → Account/License. */
export function useLicenseSettingsNavigation(openSettings: () => void): void {
  useCommandListener('settings.openLicense', () => {
    requestSettingsTab('account', openSettings);
  });
}

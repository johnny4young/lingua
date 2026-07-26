import { emitCommand } from '../stores/commandBus';
import { useCommandListener } from './useCommandListener';
import { setPendingSettingsTab } from '../components/Settings/pendingSettingsTab';

/** internal — route shared upsell CTAs to Settings → Account/License. */
export function useLicenseSettingsNavigation(openSettings: () => void): void {
  useCommandListener('settings.openLicense', () => {
    // Two paths, because Settings may or may not already be mounted.
    //
    // Closed: the modal is behind a lazy boundary, so opening it schedules a
    // chunk fetch. Stashing the tab lets the modal pick it up as its initial
    // state whenever it mounts. This used to be a double requestAnimationFrame
    // and worked only while SettingsModal shipped in the initial bundle —
    // making it lazy turned the CTA into a coin flip against the network, and
    // it lost, landing users on the General tab instead of their licence.
    //
    // Open: nothing will remount, so the stash would never be read. The
    // command reaches the live listener directly. The unread stash is
    // harmless: it is one-shot and the next open clears it.
    setPendingSettingsTab('account');
    openSettings();
    emitCommand('settings.navigate', { tab: 'account' });
  });
}

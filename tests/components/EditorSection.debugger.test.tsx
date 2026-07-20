/**
 * implementation — Settings → Editor → Debugger preference.
 *
 * Pins:
 *   - the master toggle flips `debuggerEnabled`,
 *   - breakpoint actions stay out of Settings and live in the Debugger panel,
 *   - Spanish copy renders without breakpoint-management wording.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EditorSection } from '@/components/Settings/EditorSection';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';

function setActiveProLicense() {
  useLicenseStore.setState({
    token: 'test.token',
    status: {
      kind: 'active',
      verification: {
        ok: true,
        state: 'active',
        supportWindowEndsAt: Date.now() + 86_400_000,
        payload: {
          productId: 'lingua-desktop',
          tier: 'pro',
          issuedTo: 'test@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

describe('EditorSection — Debugger rows ', () => {
  const initialSettings = useSettingsStore.getState();
  const initialLicense = useLicenseStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
    setActiveProLicense();
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
  });

  // implementation — the debugger master toggle was removed from Settings →
  // Editor; debugging is baseline IDE expectation. The "renders the
  // master toggle ON" and ES localization cases no longer apply.
  it('does not render breakpoint management actions in Editor settings', () => {
    render(<EditorSection />);

    expect(screen.queryByTestId('settings-debugger-clear-all')).toBeNull();
    expect(
      screen.queryByRole('switch', { name: /Pause is disabled for all breakpoints/i })
    ).toBeNull();
  });
});

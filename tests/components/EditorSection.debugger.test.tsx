/**
 * RL-027 Slice 1.5 — Settings → Editor → Debugger preference.
 *
 * Pins:
 *   - the master toggle flips `debuggerEnabled`,
 *   - breakpoint actions stay out of Settings and live in the Debugger panel,
 *   - Spanish copy renders without breakpoint-management wording.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('EditorSection — Debugger rows (RL-027 Slice 1.5)', () => {
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

  it('renders the Debugger master toggle ON by default and flips persistently', async () => {
    const user = userEvent.setup();
    render(<EditorSection />);

    const toggle = screen.getByRole('switch', { name: /^Debugger$/ });
    expect(toggle.getAttribute('aria-checked')).toBe('true');

    await user.click(toggle);
    expect(useSettingsStore.getState().debuggerEnabled).toBe(false);
  });

  it('does not render breakpoint management actions in Editor settings', () => {
    render(<EditorSection />);

    expect(screen.queryByTestId('settings-debugger-clear-all')).toBeNull();
    expect(
      screen.queryByRole('switch', { name: /Pause is disabled for all breakpoints/i })
    ).toBeNull();
  });

  it('localizes the Debugger preference in Spanish without breakpoint actions', async () => {
    await i18next.changeLanguage('es');
    render(<EditorSection />);
    expect(screen.getByRole('switch', { name: /^Depurador$/ })).toBeTruthy();
    expect(screen.queryByText(/Borra|Limpiar todos los puntos/i)).toBeNull();
  });
});

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '@/i18n';
import { PrivacySection } from '@/components/Settings/PrivacySection';
import { useSettingsStore } from '@/stores/settingsStore';

describe('PrivacySection', () => {
  const initial = useSettingsStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initial, true);
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    useSettingsStore.setState(initial, true);
  });

  it('renders the unset status copy before the user makes a choice', () => {
    render(<PrivacySection />);

    expect(screen.getByText('Privacy')).toBeTruthy();
    expect(screen.getByTestId('telemetry-status').textContent).toContain('Not set');
  });

  it('flips the consent to granted and back to declined from a single toggle', async () => {
    const user = userEvent.setup();
    render(<PrivacySection />);

    const toggle = screen.getByRole('switch', {
      name: /usage analytics|telemetry/i,
    });
    expect(toggle.getAttribute('aria-checked')).toBe('false');

    await user.click(toggle);
    expect(await screen.findByText('Enabled — thanks for helping improve Lingua.')).toBeTruthy();
    expect(
      screen
        .getByRole('switch', { name: /usage analytics|telemetry/i })
        .getAttribute('aria-checked')
    ).toBe('true');

    await user.click(toggle);
    expect(await screen.findByText('Declined — no data leaves your machine.')).toBeTruthy();
    expect(
      screen
        .getByRole('switch', { name: /usage analytics|telemetry/i })
        .getAttribute('aria-checked')
    ).toBe('false');
  });

  it('keeps the Run Ledger off by default and reports session-only storage when enabled', async () => {
    const user = userEvent.setup();
    render(<PrivacySection />);

    const toggle = screen.getByTestId('run-ledger-toggle');
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByTestId('run-ledger-status').textContent).toContain('nothing is recorded');

    await user.click(toggle);

    expect(useSettingsStore.getState().runLedgerEnabled).toBe(true);
    expect(screen.getByTestId('run-ledger-status').textContent).toContain('this session only');
  });

  // Slice 2 — `shareLinkConfirmEnabled` was removed; the share-link
  // confirmation modal is now the only path before clipboard writes
  // (safer default for accidental shares). The toggle no longer
  // renders.
});

/**
 * RL-028 sixth slice — Editor settings: execution-history snapshot toggle.
 *
 * Verifies the toggle is visible + functional for Pro users, locked
 * behind an upsell CTA for Free users, and that flipping it persists
 * the `executionHistorySnapshotEnabled` flag in settingsStore. Spanish
 * locale spot-check pins the tuteo copy.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { initI18n } from '@/i18n';
import { EditorSection } from '@/components/Settings/EditorSection';
import { useLicenseStore } from '@/stores/licenseStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUIStore } from '@/stores/uiStore';

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

function setFreeLicense() {
  useLicenseStore.setState({
    token: null,
    status: { kind: 'free' },
    lastVerifiedAt: null,
  });
}

describe('EditorSection — execution-history snapshot toggle (RL-028)', () => {
  const initialSettings = useSettingsStore.getState();
  const initialLicense = useLicenseStore.getState();

  beforeEach(async () => {
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
    useUIStore.setState({ statusNotice: null });
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initialSettings, true);
    useLicenseStore.setState(initialLicense, true);
  });

  it('renders the snapshot toggle as on by default for Pro users', () => {
    setActiveProLicense();
    render(<EditorSection />);

    const toggle = screen.getByRole('switch', { name: /Capture code for replay/i });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('flips the persisted executionHistorySnapshotEnabled flag when the toggle is clicked', async () => {
    setActiveProLicense();
    const user = userEvent.setup();
    render(<EditorSection />);

    const toggle = screen.getByRole('switch', { name: /Capture code for replay/i });
    await user.click(toggle);

    expect(useSettingsStore.getState().executionHistorySnapshotEnabled).toBe(false);
    expect(
      screen.getByRole('switch', { name: /Capture code for replay/i }).getAttribute('aria-checked')
    ).toBe('false');
  });

  it('shows a Pro upsell CTA instead of the toggle for Free users', () => {
    setFreeLicense();
    render(<EditorSection />);

    expect(
      screen.queryByRole('switch', { name: /Capture code for replay/i })
    ).toBeNull();
    expect(screen.getByTestId('editor-execution-history-snapshot-unlock')).toBeTruthy();
  });

  it('clicking the Free upsell CTA fires the freeCeilingReached status notice', async () => {
    setFreeLicense();
    const user = userEvent.setup();
    render(<EditorSection />);

    await user.click(screen.getByTestId('editor-execution-history-snapshot-unlock'));

    expect(useUIStore.getState().statusNotice?.messageKey).toBe(
      'upsell.freeCeilingReached'
    );
  });

  it('localizes the toggle label in Spanish (tuteo)', async () => {
    setActiveProLicense();
    await i18next.changeLanguage('es');
    render(<EditorSection />);

    expect(
      screen.getByRole('switch', { name: /Captura el código para reproducir/i })
    ).toBeTruthy();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { UtilitiesSection } from '../../src/renderer/components/Settings/UtilitiesSection';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { useUIStore } from '../../src/renderer/stores/uiStore';
import {
  UTILITY_HISTORY_STORAGE_KEY,
  useUtilityHistoryStore,
} from '../../src/renderer/stores/utilityHistoryStore';

function setFreeTier() {
  useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null });
}

function setProTier() {
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
          issuedTo: 'utilities@example.com',
          issuedAt: new Date().toISOString(),
          supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
          entitlements: [],
        },
      },
    },
    lastVerifiedAt: Date.now(),
  });
}

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useSettingsStore.setState({ utilitiesClipboardOnFocusConsent: 'unset' }, false);
  useUtilityHistoryStore.setState({ history: {}, persistEnabled: {}, favorites: [] }, false);
  useUIStore.setState({ statusNotice: null });
  setProTier();
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

describe('UtilitiesSection ', () => {
  it('locks clipboard-on-focus automation on Free', () => {
    setFreeTier();
    render(<UtilitiesSection />);

    const toggle = screen.getByRole('switch', {
      name: 'Apply from clipboard on panel focus',
    }) as HTMLButtonElement;
    expect(toggle.disabled).toBe(true);
    expect(screen.getByTestId('utilities-clipboard-on-focus-status').textContent).toMatch(
      /Pro automation/
    );

    fireEvent.click(screen.getByTestId('utilities-clipboard-on-focus-unlock'));
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('upsell.freeCeilingReached');
    expect(useUIStore.getState().statusNotice?.values?.feature).toContain('utility workflows');
  });

  it('renders the off status when consent is unset', () => {
    render(<UtilitiesSection />);
    const status = screen.getByTestId('utilities-clipboard-on-focus-status');
    expect(status.textContent).toMatch(/Off · enable to opt in/);
  });

  it('flipping the toggle moves consent to granted and back', () => {
    render(<UtilitiesSection />);
    const toggle = screen.getByRole('switch', {
      name: 'Apply from clipboard on panel focus',
    });

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().utilitiesClipboardOnFocusConsent).toBe('granted');

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().utilitiesClipboardOnFocusConsent).toBe('declined');

    // Decline is sticky — clicking again moves back to granted, never
    // unset. (Same internal pattern as telemetry consent.)
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().utilitiesClipboardOnFocusConsent).toBe('granted');
  });

  it('Clear all history requires confirmation before wiping', () => {
    useUtilityHistoryStore.getState().pushEntry('json', '{"a":1}', '');
    useUtilityHistoryStore.getState().pushEntry('base64', 'plain', 'cGxhaW4=');

    render(<UtilitiesSection />);
    const clearButton = screen.getByTestId('utilities-clear-all-history');

    fireEvent.click(clearButton);
    // First click switches the label to "Confirm clear" and surfaces a
    // Cancel link — history is still intact.
    expect(useUtilityHistoryStore.getState().history.json).toBeDefined();
    expect(clearButton.textContent).toMatch(/Confirm/);

    fireEvent.click(clearButton);
    // Second click commits the clear.
    expect(useUtilityHistoryStore.getState().history).toEqual({});
  });

  it('Cancel link aborts the pending clear without wiping', () => {
    useUtilityHistoryStore.getState().pushEntry('json', '{"a":1}', '');

    render(<UtilitiesSection />);
    fireEvent.click(screen.getByTestId('utilities-clear-all-history'));
    fireEvent.click(screen.getByTestId('utilities-clear-all-history-cancel'));

    expect(useUtilityHistoryStore.getState().history.json).toBeDefined();
  });
});

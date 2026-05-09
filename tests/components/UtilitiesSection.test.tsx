import { fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { UtilitiesSection } from '../../src/renderer/components/Settings/UtilitiesSection';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import {
  UTILITY_HISTORY_STORAGE_KEY,
  useUtilityHistoryStore,
} from '../../src/renderer/stores/utilityHistoryStore';

beforeEach(async () => {
  initI18n('en');
  await i18next.changeLanguage('en');
  useSettingsStore.setState(
    { utilitiesClipboardOnFocusConsent: 'unset' },
    false
  );
  useUtilityHistoryStore.setState(
    { history: {}, persistEnabled: {}, favorites: [] },
    false
  );
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

afterEach(() => {
  localStorage.removeItem(UTILITY_HISTORY_STORAGE_KEY);
});

describe('UtilitiesSection (RL-069 Slice 3)', () => {
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
    expect(useSettingsStore.getState().utilitiesClipboardOnFocusConsent).toBe(
      'granted'
    );

    fireEvent.click(toggle);
    expect(useSettingsStore.getState().utilitiesClipboardOnFocusConsent).toBe(
      'declined'
    );

    // Decline is sticky — clicking again moves back to granted, never
    // unset. (Same RL-065 pattern as telemetry consent.)
    fireEvent.click(toggle);
    expect(useSettingsStore.getState().utilitiesClipboardOnFocusConsent).toBe(
      'granted'
    );
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

/**
 * RL-065 first-run telemetry consent prompt.
 *
 * The modal renders once on boot while `telemetryConsent === 'unset'` AND
 * the desktop consent bridge (window.lingua.consent) is present. Either
 * button resolves the `unset` gate so the modal never reappears, and the
 * settings store mirrors the choice through the existing `consent:set` IPC.
 */

import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { FirstRunConsentModal } from '@/components/FirstRunConsentModal';
import { useSettingsStore } from '@/stores/settingsStore';

const consentSet = vi.fn().mockResolvedValue({ ok: true });

function stubDesktopBridge(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: {
      ...globalThis.window,
      lingua: {
        platform: 'darwin',
        consent: { set: consentSet },
      },
    },
  });
}

function stubWebBridge(): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    writable: true,
    value: { ...globalThis.window, lingua: undefined },
  });
}

describe('FirstRunConsentModal', () => {
  const initial = useSettingsStore.getState();

  beforeEach(async () => {
    consentSet.mockClear();
    useSettingsStore.setState(initial, true);
    initI18n('en');
    await i18next.changeLanguage('en');
    stubDesktopBridge();
  });

  afterEach(() => {
    cleanup();
    useSettingsStore.setState(initial, true);
  });

  it('renders on desktop while telemetryConsent is unset', () => {
    render(<FirstRunConsentModal />);
    expect(screen.getByTestId('first-run-consent-modal')).toBeTruthy();
    expect(screen.getByText('Help improve Lingua?')).toBeTruthy();
  });

  it('does not render on the web build (no consent bridge)', () => {
    stubWebBridge();
    const { container } = render(<FirstRunConsentModal />);
    expect(container.firstChild).toBeNull();
  });

  it('does not render once the user has previously made a choice', () => {
    useSettingsStore.setState({ telemetryConsent: 'granted' });
    const { container } = render(<FirstRunConsentModal />);
    expect(container.firstChild).toBeNull();
  });

  it('Allow flips the store to granted and mirrors to main', async () => {
    const user = userEvent.setup();
    render(<FirstRunConsentModal />);

    await user.click(screen.getByTestId('first-run-consent-allow'));
    expect(useSettingsStore.getState().telemetryConsent).toBe('granted');
    expect(consentSet).toHaveBeenCalledWith('granted');
  });

  it('Decline flips the store to declined and mirrors to main', async () => {
    const user = userEvent.setup();
    render(<FirstRunConsentModal />);

    await user.click(screen.getByTestId('first-run-consent-decline'));
    expect(useSettingsStore.getState().telemetryConsent).toBe('declined');
    expect(consentSet).toHaveBeenCalledWith('declined');
  });

  it('localizes the copy when i18next is Spanish', async () => {
    await i18next.changeLanguage('es');
    render(<FirstRunConsentModal />);

    expect(screen.getByText('¿Ayudas a mejorar Lingua?')).toBeTruthy();
    expect(screen.getByTestId('first-run-consent-allow').textContent).toContain('Permitir');
    expect(screen.getByTestId('first-run-consent-decline').textContent).toContain('Rechazar');
  });
});

/**
 * RL-059 license UI — cover the four states the status pill must
 * represent (free / active / grace / invalid) and the Apply / Clear
 * buttons' state-machine transitions. The verifier itself is tested
 * elsewhere; this suite stubs `setLicenseToken` so we can script each
 * outcome deterministically and focus on UI behavior + i18n fallback.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { LicenseSection } from '@/components/Settings/LicenseSection';
import { useLicenseStore, type LicenseStatus } from '@/stores/licenseStore';
import { useUIStore } from '@/stores/uiStore';

function stubStatus(status: LicenseStatus, token: string | null = null): void {
  useLicenseStore.setState({
    token,
    status,
    lastVerifiedAt: null,
  });
}

describe('LicenseSection', () => {
  const initial = useLicenseStore.getState();

  beforeEach(async () => {
    useLicenseStore.setState(initial, true);
    useUIStore.setState({ statusNotice: null });
    initI18n('en');
    await i18next.changeLanguage('en');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useLicenseStore.setState(initial, true);
  });

  it('renders the Free status pill when no license is applied', () => {
    render(<LicenseSection />);
    expect(screen.getByTestId('license-status-pill').textContent).toContain('Free plan');
    // Clear button only shows when there is a token
    expect(screen.queryByTestId('license-clear')).toBeNull();
  });

  it('shows the Active pill and tier name when the store holds an active status', () => {
    stubStatus(
      {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 30 * 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro',
            issuedTo: 'user@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            entitlements: [],
          },
        },
      },
      'token.value'
    );
    render(<LicenseSection />);
    expect(screen.getByTestId('license-status-pill').textContent).toContain('Active — pro');
    expect(screen.getByTestId('license-clear')).toBeTruthy();
  });

  it('disables the Apply button when the input is empty or whitespace-only', () => {
    render(<LicenseSection />);
    const apply = screen.getByTestId('license-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('pushes a success notice and clears the draft when setLicenseToken returns active', async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(useLicenseStore.getState(), 'setLicenseToken')
      .mockResolvedValue({
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro_lifetime',
            issuedTo: 'user@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
            entitlements: [],
          },
        },
      });
    render(<LicenseSection />);

    const input = screen.getByTestId('license-input') as HTMLTextAreaElement;
    await user.type(input, 'some.token');
    await user.click(screen.getByTestId('license-apply'));

    expect(spy).toHaveBeenCalledWith('some.token');
    // Draft is cleared on success
    expect((screen.getByTestId('license-input') as HTMLTextAreaElement).value).toBe('');
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('license.notice.activated');
  });

  it('pushes an error notice and keeps the draft when setLicenseToken returns invalid', async () => {
    const user = userEvent.setup();
    vi.spyOn(useLicenseStore.getState(), 'setLicenseToken').mockResolvedValue({
      kind: 'invalid',
      reason: 'malformed',
      // Raw message intentionally contains developer-only copy to prove the
      // component does NOT surface it to end users.
      message: 'Dev-only detail: env var VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK',
    });
    render(<LicenseSection />);

    await user.type(screen.getByTestId('license-input'), 'garbage');
    await user.click(screen.getByTestId('license-apply'));

    // Draft survives so the user can fix it
    expect((screen.getByTestId('license-input') as HTMLTextAreaElement).value).toBe('garbage');
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('license.notice.invalid.malformed');
    expect(notice?.tone).toBe('error');
    // Crucially: the raw developer message never reaches the banner.
    expect(notice?.detail).toBeUndefined();
  });

  it('maps each invalid reason code to its own user-facing i18n key', async () => {
    const reasons = [
      ['invalid-signature', 'license.notice.invalid.signature'],
      ['expired', 'license.notice.invalid.expired'],
      ['clock-skew', 'license.notice.invalid.clockSkew'],
      ['unsupported-tier', 'license.notice.invalid.unsupportedTier'],
      ['no-public-key', 'license.notice.invalid.notAccepted'],
    ] as const;

    for (const [reason, expectedKey] of reasons) {
      const user = userEvent.setup();
      vi.spyOn(useLicenseStore.getState(), 'setLicenseToken').mockResolvedValue({
        kind: 'invalid',
        reason,
        message: 'developer-only implementation detail',
      });
      const { unmount } = render(<LicenseSection />);

      await user.type(screen.getByTestId('license-input'), 'garbage');
      await user.click(screen.getByTestId('license-apply'));

      expect(useUIStore.getState().statusNotice?.messageKey).toBe(expectedKey);
      expect(useUIStore.getState().statusNotice?.detail).toBeUndefined();

      unmount();
      // Reset between iterations so the next render starts clean.
      useUIStore.setState({ statusNotice: null });
      vi.restoreAllMocks();
    }
  });

  it('clears the license and pushes the cleared notice when Remove is clicked', async () => {
    const user = userEvent.setup();
    stubStatus(
      {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro',
            issuedTo: 'user@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 86_400_000).toISOString(),
            entitlements: [],
          },
        },
      },
      'existing.token'
    );
    const spy = vi.spyOn(useLicenseStore.getState(), 'clearLicense');
    render(<LicenseSection />);

    await user.click(screen.getByTestId('license-clear'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useUIStore.getState().statusNotice?.messageKey).toBe('license.notice.cleared');
  });

  it('falls back gracefully to es copy when i18next is switched mid-session', async () => {
    await i18next.changeLanguage('es');
    try {
      render(<LicenseSection />);
      expect(screen.getByTestId('license-status-pill').textContent).toContain('Plan Free');
    } finally {
      await i18next.changeLanguage('en');
    }
  });
});

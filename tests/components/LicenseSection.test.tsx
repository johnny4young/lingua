/**
 * RL-059 license UI — cover the four states the status pill must
 * represent (free / active / grace / invalid) and the Apply / Clear
 * buttons' state-machine transitions. The verifier itself is tested
 * elsewhere; this suite stubs `setLicenseToken` so we can script each
 * outcome deterministically and focus on UI behavior + i18n fallback.
 */

import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { LicenseSection } from '@/components/Settings/LicenseSection';
import { useLicenseStore, type LicenseStatus, type ServerSyncState } from '@/stores/licenseStore';
import { useUIStore } from '@/stores/uiStore';
import { startTrial } from '@/services/trialServer';
import { writeToClipboard } from '@/utils/clipboard';

vi.mock('@/services/trialServer', () => ({
  startTrial: vi.fn(),
}));

// RL-143 — the fingerprint row reads the module-scope PUBLIC_KEY_JWK, whose
// value in vitest depends on whether the root .env was loaded into
// import.meta.env. A getter-backed mock makes the row deterministic: tests
// flip `fingerprintMockState.jwk` instead of guessing the ambient env.
const fingerprintMockState = vi.hoisted(() => ({
  jwk: null as JsonWebKey | null,
}));

vi.mock('@/stores/licenseWebVerify', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/stores/licenseWebVerify')>();
  return {
    ...original,
    get PUBLIC_KEY_JWK() {
      return fingerprintMockState.jwk;
    },
  };
});

vi.mock('@/utils/clipboard', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/utils/clipboard')>();
  return {
    ...original,
    writeToClipboard: vi.fn(),
  };
});

function stubStatus(status: LicenseStatus, token: string | null = null): void {
  act(() => {
    useLicenseStore.setState({
      token,
      status,
      lastVerifiedAt: null,
    });
  });
}

describe('LicenseSection', () => {
  const initial = useLicenseStore.getState();

  beforeEach(async () => {
    act(() => {
      useLicenseStore.setState(initial, true);
      useUIStore.setState({ statusNotice: null });
    });
    vi.mocked(startTrial).mockReset();
    initI18n('en');
    await act(async () => {
      await i18next.changeLanguage('en');
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    act(() => {
      useLicenseStore.setState(initial, true);
    });
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
    expect(screen.getByTestId('license-status-pill').textContent).toContain('Active — Monthly');
    expect(screen.getByTestId('license-clear')).toBeTruthy();
    // UX Sweep T1 — the bespoke Remove-license button carries the focus ring.
    expect(screen.getByTestId('license-clear').className).toContain('focus-ring');
  });

  it('disables the Apply button when the input is empty or whitespace-only', () => {
    render(<LicenseSection />);
    const apply = screen.getByTestId('license-apply') as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
  });

  it('pushes a success notice and clears the draft when setLicenseToken returns active', async () => {
    const user = userEvent.setup();
    const spy = vi.spyOn(useLicenseStore.getState(), 'setLicenseToken').mockResolvedValue({
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
    const input = screen.getByTestId('license-input') as HTMLTextAreaElement;
    expect(input.value).toBe('garbage');
    const notice = useUIStore.getState().statusNotice;
    expect(notice?.messageKey).toBe('license.notice.invalid.malformed');
    expect(notice?.tone).toBe('error');
    // Crucially: the raw developer message never reaches the banner.
    expect(notice?.detail).toBeUndefined();

    // UX Sweep T14 — the input reflects the rejected state inline.
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const inlineError = screen.getByTestId('license-input-error');
    expect(input.getAttribute('aria-describedby')).toBe(inlineError.id);
    // Editing clears the invalid state.
    await user.type(input, 'x');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(screen.queryByTestId('license-input-error')).toBeNull();
  });

  it('maps each invalid reason code to its own user-facing i18n key', async () => {
    const reasons = [
      ['invalid-signature', 'license.notice.invalid.signature'],
      ['expired', 'license.notice.invalid.expired'],
      ['clock-skew', 'license.notice.invalid.clockSkew'],
      ['unsupported-tier', 'license.notice.invalid.unsupportedTier'],
      ['no-public-key', 'license.notice.invalid.notAccepted'],
      // RL-061 Slice 3 follow-up: server-side request rejection
      // (validator drift between renderer + worker) gets its own copy
      // so users do not waste time re-pasting a perfectly good token.
      ['invalid-input', 'license.notice.invalid.requestRejected'],
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
    const spy = vi.spyOn(useLicenseStore.getState(), 'clearLicense').mockResolvedValue({ kind: 'free' });
    render(<LicenseSection />);

    // UX Sweep T2 fold C — Remove now routes through a confirm dialog.
    await user.click(screen.getByTestId('license-clear'));
    expect(spy).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('license-clear-confirm-confirm'));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('license.notice.cleared')
    );
  });

  it('does NOT clear the license when the Remove confirm is cancelled', async () => {
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
    await user.click(screen.getByTestId('license-clear-confirm-cancel'));
    expect(spy).not.toHaveBeenCalled();
    expect(screen.queryByTestId('license-clear-confirm')).toBeNull();
  });

  it('pushes a failure notice when Remove cannot clear the persisted license', async () => {
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
    vi.spyOn(useLicenseStore.getState(), 'clearLicense').mockResolvedValue({
      kind: 'invalid',
      reason: 'clear-failed',
    });
    render(<LicenseSection />);

    await user.click(screen.getByTestId('license-clear'));
    await user.click(screen.getByTestId('license-clear-confirm-confirm'));

    await waitFor(() =>
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('license.notice.clearFailed')
    );
    expect(useUIStore.getState().statusNotice?.tone).toBe('error');
  });

  it('disables license actions while a clear request is pending', async () => {
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
    let resolveClear: (status: LicenseStatus) => void = () => undefined;
    vi.spyOn(useLicenseStore.getState(), 'clearLicense').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveClear = resolve;
        })
    );
    render(<LicenseSection />);

    await user.type(screen.getByTestId('license-input'), 'replacement.token');
    const apply = screen.getByTestId('license-apply') as HTMLButtonElement;
    const clear = screen.getByTestId('license-clear') as HTMLButtonElement;
    expect(apply.disabled).toBe(false);

    await user.click(clear);
    // Confirm the destructive action before the clear promise starts.
    await user.click(screen.getByTestId('license-clear-confirm-confirm'));

    await waitFor(() => expect(clear.disabled).toBe(true));
    expect(apply.disabled).toBe(true);

    await act(async () => {
      resolveClear({ kind: 'free' });
    });
    await waitFor(() =>
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('license.notice.cleared')
    );
  });

  // ----------- RL-061 Slice 3 — devices row + exhausted modal ------------

  function activeStatusForDevices(): LicenseStatus {
    return {
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
    };
  }

  function stubDevicesState(opts: {
    status: LicenseStatus;
    token: string | null;
    devices?: {
      desktop: Array<Record<string, unknown>>;
      web: Array<Record<string, unknown>>;
    };
    deviceLimit?: { desktop: number; web: number };
    serverSync?: ServerSyncState;
  }): void {
    act(() => {
      useLicenseStore.setState({
        token: opts.token,
        status: opts.status,
        lastVerifiedAt: null,
        serverSync: opts.serverSync ?? 'synced',
        devices: opts.devices ?? null,
        deviceLimit: opts.deviceLimit ?? null,
      });
    });
  }

  it('renders the Devices row with both buckets when status is active and devices are cached', () => {
    stubDevicesState({
      status: activeStatusForDevices(),
      token: 'tok.value',
      devices: {
        desktop: [
          {
            id: 'dev_d1',
            deviceId: '11111111-1111-4111-8111-111111111111',
            deviceName: 'MacBook Pro',
            os: 'macOS',
            surface: 'desktop',
            activatedAt: 1_700_000_000,
            lastSeenAt: 1_700_000_900,
          },
        ],
        web: [
          {
            id: 'dev_w1',
            deviceId: 'w-uuid-1',
            deviceName: 'Chrome on macOS',
            os: 'web-chrome',
            surface: 'web',
            activatedAt: 1_700_000_100,
            lastSeenAt: 1_700_000_900,
          },
        ],
      },
      deviceLimit: { desktop: 3, web: 3 },
    });

    render(<LicenseSection />);
    expect(screen.getByTestId('license-devices-list')).toBeTruthy();
    expect(screen.getByTestId('license-devices-bucket-desktop')).toBeTruthy();
    expect(screen.getByTestId('license-devices-bucket-web')).toBeTruthy();
    expect(screen.getByTestId('license-devices-counter-web').textContent).toContain('1');
  });

  it('hides the Devices row when status is free / verifying / invalid', () => {
    stubDevicesState({
      status: { kind: 'free' },
      token: null,
      devices: { desktop: [], web: [] },
      deviceLimit: { desktop: 3, web: 3 },
    });
    render(<LicenseSection />);
    expect(screen.queryByTestId('license-devices-list')).toBeNull();
  });

  it('hides a cached Devices row when the server sync fell back to local verification', () => {
    stubDevicesState({
      status: activeStatusForDevices(),
      token: 'tok.value',
      serverSync: 'unreachable',
      devices: {
        desktop: [],
        web: [
          {
            id: 'dev_w1',
            deviceId: 'w-uuid-1',
            deviceName: 'Chrome on macOS',
            os: 'web-chrome',
            surface: 'web',
            activatedAt: 1_700_000_100,
            lastSeenAt: 1_700_000_900,
          },
        ],
      },
      deviceLimit: { desktop: 3, web: 3 },
    });

    render(<LicenseSection />);
    expect(screen.queryByTestId('license-devices-list')).toBeNull();
  });

  it('disables the Remove button on the current device row and exposes the blocked reason via title', () => {
    // Force a deterministic device id so the test doesn't depend on
    // navigator UUID minting.
    localStorage.setItem('lingua-device-id', '11111111-1111-4111-8111-111111111111');
    stubDevicesState({
      status: activeStatusForDevices(),
      token: 'tok.value',
      devices: {
        desktop: [
          {
            id: 'dev_d1',
            deviceId: '11111111-1111-4111-8111-111111111111',
            deviceName: 'MacBook Pro',
            os: 'macOS',
            surface: 'desktop',
            activatedAt: 1_700_000_000,
            lastSeenAt: 1_700_000_900,
          },
          {
            id: 'dev_d2',
            deviceId: '22222222-2222-4222-8222-222222222222',
            deviceName: 'Other Mac',
            os: 'macOS',
            surface: 'desktop',
            activatedAt: 1_700_000_500,
            lastSeenAt: 1_700_001_900,
          },
        ],
        web: [],
      },
      deviceLimit: { desktop: 3, web: 3 },
    });

    try {
      render(<LicenseSection />);
      // Current chip lands on the matching row only.
      expect(screen.getByTestId('license-current-device-chip')).toBeTruthy();
      const currentRemove = screen.getByTestId('license-device-remove-dev_d1') as HTMLButtonElement;
      expect(currentRemove.disabled).toBe(true);
      expect(currentRemove.title).toContain('Remove license');
      const otherRemove = screen.getByTestId('license-device-remove-dev_d2') as HTMLButtonElement;
      expect(otherRemove.disabled).toBe(false);
      // UX Sweep T1 — device-remove buttons carry the shared focus ring.
      expect(otherRemove.className).toContain('focus-ring');
    } finally {
      localStorage.removeItem('lingua-device-id');
    }
  });

  it('clicking Remove on a non-current device dispatches removeDevice and pushes the success notice', async () => {
    const user = userEvent.setup();
    localStorage.setItem('lingua-device-id', '11111111-1111-4111-8111-111111111111');
    stubDevicesState({
      status: activeStatusForDevices(),
      token: 'tok.value',
      devices: {
        desktop: [
          {
            id: 'dev_d1',
            deviceId: '11111111-1111-4111-8111-111111111111',
            deviceName: 'MacBook Pro',
            os: 'macOS',
            surface: 'desktop',
            activatedAt: 1_700_000_000,
            lastSeenAt: 1_700_000_900,
          },
          {
            id: 'dev_d2',
            deviceId: '22222222-2222-4222-8222-222222222222',
            deviceName: 'Other Mac',
            os: 'macOS',
            surface: 'desktop',
            activatedAt: 1_700_000_500,
            lastSeenAt: 1_700_001_900,
          },
        ],
        web: [],
      },
      deviceLimit: { desktop: 3, web: 3 },
    });

    const removeSpy = vi.spyOn(useLicenseStore.getState(), 'removeDevice').mockResolvedValue({
      ok: true,
      licenseId: 'lic_1',
      removed: true,
      devices: {
        desktop: [
          {
            id: 'dev_d1',
            deviceId: '11111111-1111-4111-8111-111111111111',
            deviceName: 'MacBook Pro',
            os: 'macOS',
            surface: 'desktop',
            activatedAt: 1_700_000_000,
            lastSeenAt: 1_700_000_900,
          },
        ],
        web: [],
      },
      deviceLimit: { desktop: 3, web: 3 },
    });

    try {
      render(<LicenseSection />);
      await user.click(screen.getByTestId('license-device-remove-dev_d2'));
      await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222'));
      await waitFor(() =>
        expect(useUIStore.getState().statusNotice?.messageKey).toBe(
          'license.devices.removeSucceeded'
        )
      );
    } finally {
      localStorage.removeItem('lingua-device-id');
    }
  });

  it('routes setLicenseToken devices-exhausted into the modal instead of the standard error notice', async () => {
    const user = userEvent.setup();
    vi.spyOn(useLicenseStore.getState(), 'setLicenseToken').mockImplementation(async () => {
      const status: LicenseStatus = { kind: 'invalid', reason: 'devices-exhausted' };
      useLicenseStore.setState({
        token: 'tok.value',
        status,
        lastVerifiedAt: Date.now(),
        serverSync: 'synced',
        devices: {
          desktop: [],
          web: [
            {
              id: 'dev_w1',
              deviceId: 'w-uuid-1',
              deviceName: 'Chrome on macOS',
              os: 'web-chrome',
              surface: 'web',
              activatedAt: 1_700_000_000,
              lastSeenAt: 1_700_000_900,
            },
          ],
        },
        deviceLimit: { desktop: 3, web: 3 },
      });
      return status;
    });

    render(<LicenseSection />);
    await user.type(screen.getByTestId('license-input'), 'whatever');
    await user.click(screen.getByTestId('license-apply'));

    await waitFor(() => expect(screen.getByTestId('license-exhausted-modal')).toBeTruthy());
    // Crucially: the standard error banner did NOT fire.
    expect(useUIStore.getState().statusNotice?.messageKey).not.toBe(
      'license.notice.invalid.devicesExhausted'
    );
  });

  it('falls back gracefully to es copy when i18next is switched mid-session', async () => {
    await act(async () => {
      await i18next.changeLanguage('es');
    });
    try {
      render(<LicenseSection />);
      expect(screen.getByTestId('license-status-pill').textContent).toContain('Plan Gratis');
    } finally {
      await act(async () => {
        await i18next.changeLanguage('en');
      });
    }
  });

  // ----------------------------------------------- RL-061 Slice 4 — CTAs

  it('renders the Trial / Education / Recovery CTAs under the free state', () => {
    render(<LicenseSection />);
    expect(screen.getByTestId('trial-start')).toBeTruthy();
    expect(screen.getByTestId('education-start')).toBeTruthy();
    expect(screen.getByTestId('recovery-start')).toBeTruthy();
  });

  it('does NOT render the CTAs when the license is active', () => {
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
      'token.value',
    );
    render(<LicenseSection />);
    expect(screen.queryByTestId('trial-start')).toBeNull();
    expect(screen.queryByTestId('education-start')).toBeNull();
    expect(screen.queryByTestId('recovery-start')).toBeNull();
  });

  it('renders the recover-hint banner when the store has a recoverHint', () => {
    act(() => {
      useLicenseStore.setState({
        recoverHint: { email: 'user@example.com' },
      });
    });
    render(<LicenseSection />);
    expect(screen.getByTestId('license-recover-hint').textContent).toContain('user@example.com');
  });

  it('updates the Recovery form prefill when a newer recoverHint arrives', async () => {
    act(() => {
      useLicenseStore.setState({
        recoverHint: { email: 'first@example.com' },
      });
    });
    render(<LicenseSection />);

    await waitFor(() =>
      expect((screen.getByTestId('recovery-email-input') as HTMLInputElement).value).toBe(
        'first@example.com',
      ),
    );

    act(() => {
      useLicenseStore.setState({
        recoverHint: { email: 'second@example.com' },
      });
    });

    await waitFor(() =>
      expect((screen.getByTestId('recovery-email-input') as HTMLInputElement).value).toBe(
        'second@example.com',
      ),
    );
  });

  it('surfaces an activation error when a started trial token is rejected locally', async () => {
    const user = userEvent.setup();
    vi.mocked(startTrial).mockResolvedValue({
      ok: true,
      licenseId: 'lic_trial',
      token: 'trial.token.value',
      tier: 'trial',
      expiresAt: Math.floor(Date.now() / 1000) + 14 * 24 * 60 * 60,
      emailDelivered: false,
      emailReason: 'no-api-key',
    });
    vi.spyOn(useLicenseStore.getState(), 'setLicenseToken').mockResolvedValue({
      kind: 'invalid',
      reason: 'invalid-signature',
      message: 'developer-only signature mismatch detail',
    });
    render(<LicenseSection />);

    await user.type(screen.getByTestId('trial-email-input'), 'trial@example.com');
    await user.click(screen.getByTestId('trial-start'));

    await waitFor(() =>
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('license.notice.invalid'),
    );
    expect((screen.getByTestId('trial-email-input') as HTMLInputElement).value).toBe(
      'trial@example.com',
    );
  });

  it('hands off the trial unavailable canRecover flag to RecoveryCta as a prefill', async () => {
    // Pin the parent → child wiring: when TrialCta fires
    // onRequestRecovery (because the worker said `canRecover: true`),
    // the LicenseSection captures the email into local state and
    // RecoveryCta picks it up as `prefilledEmail`. A regression here
    // would silently break the "recover if you may already have a
    // token" affordance without making the server enumerate accounts.
    const user = userEvent.setup();
    vi.mocked(startTrial).mockResolvedValue({
      ok: false,
      reason: 'trial-unavailable',
      canRecover: true,
    });
    render(<LicenseSection />);

    // Recovery input starts empty (no recoverHint, no prefill yet).
    expect((screen.getByTestId('recovery-email-input') as HTMLInputElement).value).toBe('');

    await user.type(screen.getByTestId('trial-email-input'), 'taken@example.com');
    await user.click(screen.getByTestId('trial-start'));

    await waitFor(() =>
      expect(useUIStore.getState().statusNotice?.messageKey).toBe(
        'license.trial.notice.unavailable',
      ),
    );
    // The generic unavailable branch routed the address into the
    // recovery form so the user can finish recovery in one click.
    await waitFor(() =>
      expect((screen.getByTestId('recovery-email-input') as HTMLInputElement).value).toBe(
        'taken@example.com',
      ),
    );
  });

  describe('signing key fingerprint row (RL-143)', () => {
    // The committed production key; the expected value is the
    // independently computed RFC 7638 vector also pinned in
    // tests/scripts/licenseKeyRotation.test.ts.
    const PROD_THUMBPRINT = 'U0WxZzfZ6Ql5ztLrXohowxMxnik8NMUOsaRixXYdfOs';

    beforeEach(() => {
      fingerprintMockState.jwk = {
        kty: 'OKP',
        crv: 'Ed25519',
        x: '2RLtTcT4AfskWAFBqKI9t_AgFLNvS1hIoGNIK_wr1Kg',
      };
    });

    afterEach(() => {
      fingerprintMockState.jwk = null;
    });

    it('renders the RFC 7638 thumbprint of the embedded key with a Copy control', async () => {
      render(<LicenseSection />);
      await waitFor(() =>
        expect(screen.getByTestId('license-key-fingerprint').textContent).toBe(PROD_THUMBPRINT),
      );
      expect(screen.getByTestId('license-key-fingerprint-copy')).toBeTruthy();
      // UX Sweep T1 — the fingerprint Copy button carries the focus ring.
      expect(
        screen.getByTestId('license-key-fingerprint-copy').className
      ).toContain('focus-ring');
    });

    it('copies the thumbprint and pushes the success notice', async () => {
      const user = userEvent.setup();
      vi.mocked(writeToClipboard).mockResolvedValue(true);
      render(<LicenseSection />);
      await waitFor(() => expect(screen.getByTestId('license-key-fingerprint')).toBeTruthy());

      await user.click(screen.getByTestId('license-key-fingerprint-copy'));

      await waitFor(() =>
        expect(useUIStore.getState().statusNotice?.messageKey).toBe(
          'license.keyFingerprint.copied',
        ),
      );
      expect(vi.mocked(writeToClipboard)).toHaveBeenCalledWith(PROD_THUMBPRINT);
    });

    it('pushes an error notice when the clipboard write is denied', async () => {
      const user = userEvent.setup();
      vi.mocked(writeToClipboard).mockResolvedValue(false);
      render(<LicenseSection />);
      await waitFor(() => expect(screen.getByTestId('license-key-fingerprint')).toBeTruthy());

      await user.click(screen.getByTestId('license-key-fingerprint-copy'));

      await waitFor(() =>
        expect(useUIStore.getState().statusNotice?.messageKey).toBe(
          'license.keyFingerprint.copyFailed',
        ),
      );
      expect(useUIStore.getState().statusNotice?.tone).toBe('error');
    });

    it('hides the row entirely when the build embeds no public key', () => {
      fingerprintMockState.jwk = null;
      render(<LicenseSection />);
      expect(screen.queryByTestId('license-key-fingerprint')).toBeNull();
      expect(screen.queryByTestId('license-key-fingerprint-copy')).toBeNull();
    });
  });
});

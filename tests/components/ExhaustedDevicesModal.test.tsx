/**
 * RL-061 Slice 3 — exhausted-devices remediation modal.
 *
 * Drives the modal in isolation: stubs the licenseStore actions
 * (`removeDevice`, `setLicenseToken`, `clearLicense`, `revalidate`)
 * and asserts the modal calls them in the right shape, surfaces the
 * right notice, and closes on success / cancel paths. The full modal
 * + DeviceList + LicenseSection composition is covered separately in
 * `LicenseSection.test.tsx`.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '@/i18n';
import { ExhaustedDevicesModal } from '@/components/Settings/ExhaustedDevicesModal';
import { useLicenseStore, type LicenseStatus } from '@/stores/licenseStore';
import { useUIStore } from '@/stores/uiStore';

function exhaustedStatus(): LicenseStatus {
  return { kind: 'invalid', reason: 'devices-exhausted' };
}

function activeStatus(): LicenseStatus {
  return {
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
  };
}

function deviceFixture(id: string, deviceUuid: string) {
  return {
    id,
    deviceId: deviceUuid,
    deviceName: `Device ${id}`,
    os: 'web-chrome',
    surface: 'web' as const,
    activatedAt: 1_700_000_000,
    lastSeenAt: 1_700_000_900,
  };
}

function seedExhaustedState(): void {
  act(() => {
    useLicenseStore.setState({
      token: 'tok.value',
      status: exhaustedStatus(),
      lastVerifiedAt: null,
      devices: {
        desktop: [],
        web: [deviceFixture('dev_w1', 'w-uuid-1'), deviceFixture('dev_w2', 'w-uuid-2')],
      },
      deviceLimit: { desktop: 3, web: 3 },
    });
  });
}

describe('ExhaustedDevicesModal', () => {
  const initial = useLicenseStore.getState();

  beforeEach(async () => {
    act(() => {
      useLicenseStore.setState(initial, true);
      useUIStore.setState({ statusNotice: null });
    });
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

  it('renders the device list and runs revalidate on mount so the bucket is fresh', async () => {
    seedExhaustedState();
    const revalidateSpy = vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue({
      kind: 'invalid',
      reason: 'devices-exhausted',
    });

    render(<ExhaustedDevicesModal onClose={() => undefined} />);

    expect(screen.getByTestId('license-exhausted-modal')).toBeTruthy();
    expect(screen.getByTestId('license-devices-list')).toBeTruthy();
    expect(screen.getByTestId('license-device-row-dev_w1')).toBeTruthy();
    expect(screen.getByTestId('license-device-row-dev_w2')).toBeTruthy();
    await waitFor(() => expect(revalidateSpy).toHaveBeenCalled());
  });

  it('closes itself when the opening revalidate succeeds after another tab freed a slot', async () => {
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(activeStatus());
    const onClose = vi.fn();

    render(<ExhaustedDevicesModal onClose={onClose} />);

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('Remove dispatches removeDevice and pushes the success notice', async () => {
    const user = userEvent.setup();
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(exhaustedStatus());
    const removeSpy = vi.spyOn(useLicenseStore.getState(), 'removeDevice').mockResolvedValue({
      ok: true,
      licenseId: 'lic_1',
      removed: true,
      devices: { desktop: [], web: [deviceFixture('dev_w1', 'w-uuid-1')] },
      deviceLimit: { desktop: 3, web: 3 },
    });

    render(<ExhaustedDevicesModal onClose={() => undefined} />);
    await user.click(screen.getByTestId('license-device-remove-dev_w2'));

    await waitFor(() => expect(removeSpy).toHaveBeenCalledWith('w-uuid-2'));
    await waitFor(() =>
      expect(useUIStore.getState().statusNotice?.messageKey).toBe('license.devices.removeSucceeded')
    );
  });

  it('Retry calls setLicenseToken with the cached token and closes on success', async () => {
    const user = userEvent.setup();
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(exhaustedStatus());

    const onClose = vi.fn();
    const setSpy = vi.spyOn(useLicenseStore.getState(), 'setLicenseToken').mockResolvedValue(activeStatus());

    render(<ExhaustedDevicesModal onClose={onClose} />);
    await user.click(screen.getByTestId('license-exhausted-retry'));

    await waitFor(() => expect(setSpy).toHaveBeenCalledWith('tok.value'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('Retry stays open on a non-success result so the user can keep removing devices', async () => {
    const user = userEvent.setup();
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(exhaustedStatus());

    const onClose = vi.fn();
    vi.spyOn(useLicenseStore.getState(), 'setLicenseToken').mockResolvedValue(exhaustedStatus());

    render(<ExhaustedDevicesModal onClose={onClose} />);
    await user.click(screen.getByTestId('license-exhausted-retry'));

    // Allow the promise to settle before asserting the negative.
    await waitFor(() => {
      expect(
        (screen.getByTestId('license-exhausted-retry') as HTMLButtonElement).disabled
      ).toBe(false);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Discard license calls clearLicense and closes the modal', async () => {
    const user = userEvent.setup();
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(exhaustedStatus());

    const onClose = vi.fn();
    const clearSpy = vi
      .spyOn(useLicenseStore.getState(), 'clearLicense')
      .mockResolvedValue({ kind: 'free' });

    render(<ExhaustedDevicesModal onClose={onClose} />);
    await user.click(screen.getByTestId('license-exhausted-cancel'));

    await waitFor(() => expect(clearSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });

  it('labels the discard button truthfully (UX Sweep T2 relabel)', () => {
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(exhaustedStatus());

    render(<ExhaustedDevicesModal onClose={vi.fn()} />);
    // The button that calls clearLicense() must NOT read "Cancel" — that
    // implied "keep things as they are" while it actually discards the
    // license and drops the user to Free.
    const discard = screen.getByTestId('license-exhausted-cancel');
    expect(discard.textContent).toBe('Discard license');
    expect(discard.textContent).not.toBe('Cancel');
  });

  it('Escape dismisses only this modal (non-destructive) and does not leak to the Settings overlay', async () => {
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(exhaustedStatus());
    const clearSpy = vi
      .spyOn(useLicenseStore.getState(), 'clearLicense')
      .mockResolvedValue({ kind: 'free' });

    const onClose = vi.fn();
    // The Settings overlay closes on a window-level Escape listener; here a
    // React parent handler stands in for "the surface above this modal".
    const parentKeyDown = vi.fn();
    render(
      <div onKeyDown={parentKeyDown}>
        <ExhaustedDevicesModal onClose={onClose} />
      </div>
    );

    fireEvent.keyDown(screen.getByTestId('license-exhausted-modal'), {
      key: 'Escape',
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    // Esc DISMISSES (keeps the cached token) — it must NOT discard the license.
    expect(clearSpy).not.toHaveBeenCalled();
    // stopPropagation kept the event from reaching the surface above.
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it('disables Retry while a Remove is in flight to avoid concurrent activate races', async () => {
    const user = userEvent.setup();
    seedExhaustedState();
    vi.spyOn(useLicenseStore.getState(), 'revalidate').mockResolvedValue(exhaustedStatus());

    let resolveRemove: (value: { ok: boolean }) => void = () => undefined;
    vi.spyOn(useLicenseStore.getState(), 'removeDevice').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRemove = (v) => resolve(v as never);
        })
    );

    render(<ExhaustedDevicesModal onClose={() => undefined} />);
    await user.click(screen.getByTestId('license-device-remove-dev_w2'));

    await waitFor(() => {
      expect(
        (screen.getByTestId('license-exhausted-retry') as HTMLButtonElement).disabled
      ).toBe(true);
    });

    await act(async () => {
      resolveRemove({ ok: false });
    });
  });
});

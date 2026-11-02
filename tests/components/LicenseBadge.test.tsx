import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { LicenseBadge } from '../../src/renderer/components/Toolbar/LicenseBadge';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
import { useSettingsStore } from '../../src/renderer/stores/settingsStore';
import { _resetCommandBusForTesting, subscribeCommand } from '../../src/renderer/stores/commandBus';
import type { LicenseTier } from '../../src/shared/license';

function seedActiveTier(tier: Exclude<LicenseTier, 'free'>) {
  // Bypass the setter to force the resolved tier without needing a real
  // signed token — useEffectiveTier reads `status.verification.payload.tier`.
  act(() => {
    useLicenseStore.setState({
      token: `dev-${tier}.token`,
      status: {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 24 * 60 * 60 * 1000,
          payload: {
            productId: 'lingua',
            tier,
            issuedTo: 'dev@localhost',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            entitlements: [],
          },
        },
      },
      lastVerifiedAt: Date.now(),
    });
  });
}

describe('LicenseBadge', () => {
  beforeEach(async () => {
    initI18n('en');
    await i18next.changeLanguage('en');
    // Reset to the free default.
    act(() => {
      useLicenseStore.setState({
        token: null,
        status: { kind: 'free' },
        lastVerifiedAt: null,
      });
    });
  });

  afterEach(() => {
    act(() => {
      useLicenseStore.setState({
        token: null,
        status: { kind: 'free' },
        lastVerifiedAt: null,
      });
    });
  });

  it('renders FREE with muted styling when there is no active license', () => {
    render(<LicenseBadge />);
    const badge = screen.getByTestId('license-badge');
    expect(badge.textContent).toBe('FREE');
    expect(badge.getAttribute('data-license-tier')).toBe('free');
    // No onClick prop → rendered as a span, not a button.
    expect(badge.tagName.toLowerCase()).toBe('span');
  });

  it('renders PRO with primary styling when the active tier is pro', () => {
    seedActiveTier('pro');
    render(<LicenseBadge />);
    const badge = screen.getByTestId('license-badge');
    expect(badge.textContent).toBe('PRO');
    expect(badge.getAttribute('data-license-tier')).toBe('pro');
    expect(badge.className).toMatch(/text-primary/);
  });

  it('still shows PRO for legacy paid tier ids while tooltips use public labels', () => {
    seedActiveTier('pro_lifetime');
    const { unmount } = render(<LicenseBadge />);
    const lifetimeBadge = screen.getByTestId('license-badge');
    expect(lifetimeBadge.textContent).toBe('PRO');
    expect(lifetimeBadge.getAttribute('data-license-tier')).toBe('pro_lifetime');
    expect(lifetimeBadge.getAttribute('title') ?? '').toContain('Pro');
    expect(lifetimeBadge.getAttribute('title') ?? '').not.toContain('Lifetime');
    unmount();

    seedActiveTier('team');
    render(<LicenseBadge />);
    const teamBadge = screen.getByTestId('license-badge');
    expect(teamBadge.textContent).toBe('PRO');
    expect(teamBadge.getAttribute('data-license-tier')).toBe('team');
    expect(teamBadge.getAttribute('title') ?? '').toContain('Pro');
    expect(teamBadge.getAttribute('title') ?? '').not.toContain('Team');
  });

  it('has tooltip labels for server-minted trial and education tiers', () => {
    seedActiveTier('trial');
    const { unmount } = render(<LicenseBadge />);
    expect(screen.getByTestId('license-badge').textContent).toBe('PRO');
    expect(screen.getByTestId('license-badge').getAttribute('title') ?? '').toContain('Trial');
    unmount();

    seedActiveTier('education');
    render(<LicenseBadge />);
    expect(screen.getByTestId('license-badge').textContent).toBe('PRO');
    expect(screen.getByTestId('license-badge').getAttribute('title') ?? '').toContain('Education');
  });

  it('uses Monthly as the public label for subscription tokens', () => {
    seedActiveTier('pro');
    render(<LicenseBadge />);
    const badge = screen.getByTestId('license-badge');
    expect(badge.textContent).toBe('PRO');
    expect(badge.getAttribute('title') ?? '').toContain('Monthly');
  });

  it('falls back to FREE when the stored status is invalid (no silent upgrade)', () => {
    act(() => {
      useLicenseStore.setState({
        token: 'garbage',
        status: { kind: 'invalid', reason: 'malformed' },
        lastVerifiedAt: Date.now(),
      });
    });
    render(<LicenseBadge />);
    expect(screen.getByTestId('license-badge').textContent).toBe('FREE');
  });

  it('renders a button when onClick is supplied and invokes it on click', async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(<LicenseBadge onClick={onClick} />);

    const badge = screen.getByTestId('license-badge');
    expect(badge.tagName.toLowerCase()).toBe('button');
    await user.click(badge);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('renders Spanish labels when the locale switches', async () => {
    await i18next.changeLanguage('es');
    seedActiveTier('pro');
    render(<LicenseBadge />);
    // Badge label stays upper-case and identical across locales on purpose —
    // what changes is the tooltip copy that appears on hover.
    const badge = screen.getByTestId('license-badge');
    expect(badge.textContent).toBe('PRO');
    expect(badge.getAttribute('title') ?? '').toMatch(/Nivel de licencia actual/);
    expect(badge.getAttribute('title') ?? '').toContain('Mensual');
  });

  describe('with Pro in context', () => {
    afterEach(() => {
      useSettingsStore.setState({ featureFlags: {} });
      _resetCommandBusForTesting();
    });

    it('shows the days a trial has left and opens Compare plans', async () => {
      useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
      seedActiveTier('trial');
      const compare = vi.fn();
      const openLicense = vi.fn();
      subscribeCommand('plans.compare', compare);
      render(<LicenseBadge onClick={openLicense} />);
      const badge = screen.getByTestId('license-badge');
      expect(badge.textContent).toBe('TRIAL · 1 DAY');
      expect(badge.getAttribute('title')).toBe('Pro trial, 1 day left. Compare plans.');
      await userEvent.setup().click(badge);
      expect(compare).toHaveBeenCalled();
      expect(openLicense).not.toHaveBeenCalled();
    });

    it('says the trial ended in grace, and stays a plain label without onClick', () => {
      useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
      act(() => {
        useLicenseStore.setState({
          token: 'dev-trial.token',
          status: {
            kind: 'grace',
            verification: {
              ok: true,
              state: 'grace',
              supportWindowEndsAt: Date.now() - 24 * 60 * 60 * 1000,
              payload: {
                productId: 'lingua',
                tier: 'trial',
                issuedTo: 'dev@localhost',
                issuedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
                supportWindowEndsAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                entitlements: [],
              },
            },
          },
          lastVerifiedAt: Date.now(),
        } as never);
      });
      render(<LicenseBadge />);
      const badge = screen.getByTestId('license-badge');
      expect(badge.textContent).toBe('TRIAL ENDED');
      expect(badge.tagName.toLowerCase()).toBe('span');
    });

    it('updates the days left while the window stays open', () => {
      vi.useFakeTimers();
      try {
        useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
        act(() => {
          useLicenseStore.setState({
            token: 'dev-trial.token',
            status: {
              kind: 'active',
              verification: {
                ok: true,
                state: 'active',
                supportWindowEndsAt: Date.now() + 25 * 60 * 60 * 1000,
                payload: {
                  productId: 'lingua',
                  tier: 'trial',
                  issuedTo: 'dev@localhost',
                  issuedAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000).toISOString(),
                  supportWindowEndsAt: new Date(Date.now() + 24.5 * 60 * 60 * 1000).toISOString(),
                  entitlements: [],
                },
              },
            },
            lastVerifiedAt: Date.now(),
          } as never);
        });
        render(<LicenseBadge onClick={vi.fn()} />);
        expect(screen.getByTestId('license-badge').textContent).toBe('TRIAL · 2 DAYS');
        act(() => vi.advanceTimersByTime(60 * 60 * 1000));
        expect(screen.getByTestId('license-badge').textContent).toBe('TRIAL · 1 DAY');
      } finally {
        vi.useRealTimers();
      }
    });

    it('opens Compare plans from Free and License settings from a paid plan', async () => {
      useSettingsStore.setState({ featureFlags: { teachingPaywall: true } });
      const compare = vi.fn();
      const openLicense = vi.fn();
      subscribeCommand('plans.compare', compare);
      const { unmount } = render(<LicenseBadge onClick={openLicense} />);
      await userEvent.setup().click(screen.getByTestId('license-badge'));
      expect(compare).toHaveBeenCalledTimes(1);
      unmount();
      seedActiveTier('pro');
      render(<LicenseBadge onClick={openLicense} />);
      await userEvent.setup().click(screen.getByTestId('license-badge'));
      expect(openLicense).toHaveBeenCalledTimes(1);
      expect(compare).toHaveBeenCalledTimes(1);
    });
  });
});

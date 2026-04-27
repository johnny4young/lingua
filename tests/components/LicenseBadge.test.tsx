import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../src/renderer/i18n';
import { LicenseBadge } from '../../src/renderer/components/Toolbar/LicenseBadge';
import { useLicenseStore } from '../../src/renderer/stores/licenseStore';
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

  it('still shows PRO for pro_lifetime and team tiers (Settings surfaces the full tier)', () => {
    seedActiveTier('pro_lifetime');
    const { unmount } = render(<LicenseBadge />);
    expect(screen.getByTestId('license-badge').textContent).toBe('PRO');
    expect(screen.getByTestId('license-badge').getAttribute('data-license-tier')).toBe(
      'pro_lifetime'
    );
    unmount();

    seedActiveTier('team');
    render(<LicenseBadge />);
    expect(screen.getByTestId('license-badge').textContent).toBe('PRO');
    expect(screen.getByTestId('license-badge').getAttribute('data-license-tier')).toBe('team');
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
  });
});

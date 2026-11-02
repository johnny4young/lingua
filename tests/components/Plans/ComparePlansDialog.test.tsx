import { act, fireEvent, render, screen } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initI18n } from '../../../src/renderer/i18n';
import { ComparePlansDialog } from '../../../src/renderer/components/Plans/ComparePlansDialog';
import { _resetCommandBusForTesting, subscribeCommand } from '../../../src/renderer/stores/commandBus';
import { useLicenseStore } from '../../../src/renderer/stores/licenseStore';
import type { LicenseTier } from '../../../src/shared/license';

const DAY = 86_400_000;

function seedTier(tier: Exclude<LicenseTier, 'free'>, daysLeft: number, kind: 'active' | 'grace' = 'active') {
  const ends = new Date(Date.now() + daysLeft * DAY - 60_000).toISOString();
  act(() => {
    useLicenseStore.setState({
      token: `dev-${tier}.token`,
      status: {
        kind,
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.parse(ends),
          payload: { productId: 'lingua', tier, issuedTo: 'dev@localhost', issuedAt: new Date(Date.parse(ends) - 14 * DAY).toISOString(), supportWindowEndsAt: ends, entitlements: [] },
        },
      },
      lastVerifiedAt: Date.now(),
    } as never);
  });
}

describe('ComparePlansDialog', () => {
  beforeAll(async () => {
    await initI18n('en');
    await i18next.changeLanguage('en');
  });
  beforeEach(() => {
    act(() => useLicenseStore.setState({ token: null, status: { kind: 'free' }, lastVerifiedAt: null } as never));
  });
  afterEach(() => _resetCommandBusForTesting());

  it('shows the plan table with Free numbers from the enforced limits', () => {
    render(<ComparePlansDialog onClose={vi.fn()} />);
    expect(screen.getByTestId('compare-plans-row-tabs').textContent).toContain('Open tabs');
    expect(screen.getByTestId('compare-plans-row-tabs').textContent).toContain('3');
    expect(screen.getByTestId('compare-plans-row-timeline').textContent).toContain('20 steps');
    expect(screen.getByTestId('compare-plans-row-timeline').textContent).toContain('5,000 steps');
    expect(screen.getByTestId('compare-plans-row-importCapsule').querySelectorAll('[aria-label="Included"]')).toHaveLength(2);
  });

  it('offers a trial on Free that opens Account', () => {
    const onClose = vi.fn();
    const openLicense = vi.fn();
    subscribeCommand('settings.openLicense', openLicense);
    render(<ComparePlansDialog onClose={onClose} />);
    expect(screen.getByTestId('compare-plans-trial').textContent).toContain('Try Pro for 14 days');
    fireEvent.click(screen.getByTestId('compare-plans-start-trial'));
    expect(onClose).toHaveBeenCalled();
    expect(openLicense).toHaveBeenCalled();
  });

  it('shows the days a trial has left', () => {
    seedTier('trial', 11);
    render(<ComparePlansDialog onClose={vi.fn()} />);
    expect(screen.getByTestId('compare-plans-trial').textContent).toBe('Pro trial · 11 of 14 days left');
    expect(screen.queryByTestId('compare-plans-start-trial')).toBeNull();
  });

  it('says the trial ended during its grace period', () => {
    seedTier('trial', -2, 'grace');
    render(<ComparePlansDialog onClose={vi.fn()} />);
    expect(screen.getByTestId('compare-plans-trial').textContent).toBe('Your Pro trial has ended');
  });

  it('lists the Free languages from the enforced set', () => {
    render(<ComparePlansDialog onClose={vi.fn()} />);
    expect(screen.getByTestId('compare-plans-row-languages').textContent).toContain('Ruby');
    expect(screen.getByTestId('compare-plans-row-languages').textContent).toContain('Python');
  });

  it('shows no trial row on a paid plan', () => {
    seedTier('pro', 300);
    render(<ComparePlansDialog onClose={vi.fn()} />);
    expect(screen.queryByTestId('compare-plans-trial')).toBeNull();
  });

  it('opens the pricing page', () => {
    const openExternal = vi.fn().mockResolvedValue(true);
    (window as unknown as { lingua: unknown }).lingua = { ...(window as unknown as { lingua?: object }).lingua, openExternal };
    render(<ComparePlansDialog onClose={vi.fn()} />);
    fireEvent.click(screen.getByTestId('compare-plans-pricing'));
    expect(openExternal).toHaveBeenCalledWith('https://linguacode.dev/pricing');
  });
});

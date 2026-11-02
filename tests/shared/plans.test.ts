import { describe, expect, it } from 'vitest';
import { FREE_TIER_LIMITS } from '../../src/shared/entitlements';
import { PLAN_ROWS, trialDaysLeft } from '../../src/shared/plans';
import { TIMELINE_FREE_STEPS, TIMELINE_MAX_STEPS } from '../../src/shared/timeline';

const DAY = 86_400_000;
const now = Date.parse('2026-11-02T12:00:00.000Z');

describe('trialDaysLeft', () => {
  it('rounds part of a day up', () => {
    expect(trialDaysLeft(new Date(now + 10.2 * DAY).toISOString(), now)).toBe(11);
    expect(trialDaysLeft(new Date(now + 14 * DAY).toISOString(), now)).toBe(14);
  });

  it('is 0 once the window passed or for a bad date', () => {
    expect(trialDaysLeft(new Date(now - DAY).toISOString(), now)).toBe(0);
    expect(trialDaysLeft('not a date', now)).toBe(0);
  });
});

describe('PLAN_ROWS', () => {
  const row = (id: string) => PLAN_ROWS.find(candidate => candidate.id === id)!;

  it('takes its Free numbers from the limits the app enforces', () => {
    expect(row('tabs').free).toBe(FREE_TIER_LIMITS.maxOpenTabs);
    expect(row('snippets').free).toBe(FREE_TIER_LIMITS.maxSnippets);
    expect(row('dbConnections').free).toBe(FREE_TIER_LIMITS.savedDbConnections);
    expect(row('timeline')).toMatchObject({ free: TIMELINE_FREE_STEPS, pro: TIMELINE_MAX_STEPS, unit: 'steps' });
  });

  it('lists every row once, with Pro never below Free', () => {
    expect(new Set(PLAN_ROWS.map(candidate => candidate.id)).size).toBe(PLAN_ROWS.length);
    for (const candidate of PLAN_ROWS) expect(candidate.pro === false && candidate.free !== false).toBe(false);
  });
});

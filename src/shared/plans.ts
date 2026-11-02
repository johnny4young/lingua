import { FREE_TIER_LIMITS } from './entitlements';
import { TIMELINE_FREE_STEPS, TIMELINE_MAX_STEPS } from './timeline';

/** Length of the server-minted trial, in days; the fallback when a token's dates cannot be read. */
export const TRIAL_DAYS = 14;
const DAY_MS = 86_400_000;

/** Whole days left before a trial's support window ends, rounded up; 0 once it has passed. */
export function trialDaysLeft(supportWindowEndsAt: string, now = Date.now()): number {
  const ends = Date.parse(supportWindowEndsAt);
  if (!Number.isFinite(ends)) return 0;
  return Math.max(0, Math.ceil((ends - now) / DAY_MS));
}

/** A trial's own length from its token, so a longer server-minted trial reads true; 14 when the dates are bad. */
export function trialLengthDays(issuedAt: string, supportWindowEndsAt: string): number {
  const length = Math.round((Date.parse(supportWindowEndsAt) - Date.parse(issuedAt)) / DAY_MS);
  return Number.isFinite(length) && length > 0 ? length : TRIAL_DAYS;
}

/** A count, unlimited, included or not, or a named value the table words itself. */
export type PlanValue = number | 'unlimited' | boolean | 'freeLanguages' | 'allLanguages';

export interface PlanRow {
  readonly id: string;
  readonly free: PlanValue;
  readonly pro: PlanValue;
  /** Rows counting steps rather than items. */
  readonly unit?: 'steps';
}

/** The one Free against Pro table; numbers come from the limits the app enforces. */
export const PLAN_ROWS: readonly PlanRow[] = [
  { id: 'tabs', free: FREE_TIER_LIMITS.maxOpenTabs, pro: 'unlimited' },
  { id: 'snippets', free: FREE_TIER_LIMITS.maxSnippets, pro: 'unlimited' },
  { id: 'languages', free: 'freeLanguages', pro: 'allLanguages' },
  { id: 'dbConnections', free: FREE_TIER_LIMITS.savedDbConnections, pro: 'unlimited' },
  { id: 'timeline', free: TIMELINE_FREE_STEPS, pro: TIMELINE_MAX_STEPS, unit: 'steps' },
  { id: 'runHistory', free: false, pro: true },
  { id: 'utilityPipelines', free: false, pro: true },
  { id: 'ai', free: false, pro: true },
  { id: 'notebooks', free: false, pro: true },
  { id: 'benchmark', free: false, pro: true },
  { id: 'packs', free: false, pro: true },
  { id: 'importCapsule', free: true, pro: true },
];

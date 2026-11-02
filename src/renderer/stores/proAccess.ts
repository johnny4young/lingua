import { isEntitled, type Entitlement } from '../../shared/entitlements';
import { currentEffectiveTier } from './licenseSelectors';
import type { SettingsState } from '../types/settings';
import { useSettingsStore } from './settingsStore';

/** `slice`: Free with Labs › Pro in context sees a limited part of the feature instead of a lock. */
export type ProAccess = 'full' | 'slice' | 'locked';

// Only features with a built slice; any other entitlement stays locked on Free.
const SLICED_ENTITLEMENTS: ReadonlySet<Entitlement> = new Set(['DEV_UTILITIES', 'EXECUTION_HISTORY']);

export const selectTeachingPaywall = (state: SettingsState): boolean => state.featureFlags.teachingPaywall === true;

export function teachingPaywallOn(): boolean {
  return selectTeachingPaywall(useSettingsStore.getState());
}

export function proAccessFor(entitlement: Entitlement, entitled: boolean, inContext: boolean): ProAccess {
  if (entitled) return 'full';
  return inContext && SLICED_ENTITLEMENTS.has(entitlement) ? 'slice' : 'locked';
}

/** Non-hook reader for stores and imperative code. */
export function currentProAccess(entitlement: Entitlement): ProAccess {
  return proAccessFor(entitlement, isEntitled(currentEffectiveTier(), entitlement), teachingPaywallOn());
}

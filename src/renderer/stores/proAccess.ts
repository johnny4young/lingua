import { isEntitled, type Entitlement } from '../../shared/entitlements';
import { currentEffectiveTier } from './licenseSelectors';
import { useSettingsStore } from './settingsStore';

/** `slice`: Free with Labs › Pro in context sees a limited part of the feature instead of a lock. */
export type ProAccess = 'full' | 'slice' | 'locked';

export function proAccessFor(entitled: boolean, inContext: boolean): ProAccess {
  return entitled ? 'full' : inContext ? 'slice' : 'locked';
}

/** Non-hook reader for stores and imperative code. */
export function currentProAccess(entitlement: Entitlement): ProAccess {
  return proAccessFor(isEntitled(currentEffectiveTier(), entitlement), useSettingsStore.getState().featureFlags.teachingPaywall === true);
}

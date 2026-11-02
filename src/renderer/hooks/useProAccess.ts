import type { Entitlement } from '../../shared/entitlements';
import { proAccessFor, type ProAccess } from '../stores/proAccess';
import { useSettingsStore } from '../stores/settingsStore';
import { useEntitlement } from './useEntitlement';

export function useProAccess(entitlement: Entitlement): ProAccess {
  const entitled = useEntitlement(entitlement);
  const inContext = useSettingsStore(state => state.featureFlags.teachingPaywall === true);
  return proAccessFor(entitled, inContext);
}

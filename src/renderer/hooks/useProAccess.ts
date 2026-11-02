import type { Entitlement } from '../../shared/entitlements';
import { proAccessFor, selectTeachingPaywall, type ProAccess } from '../stores/proAccess';
import { useSettingsStore } from '../stores/settingsStore';
import { useEntitlement } from './useEntitlement';

export function useTeachingPaywall(): boolean {
  return useSettingsStore(selectTeachingPaywall);
}

export function useProAccess(entitlement: Entitlement): ProAccess {
  const entitled = useEntitlement(entitlement);
  return proAccessFor(entitlement, entitled, useTeachingPaywall());
}

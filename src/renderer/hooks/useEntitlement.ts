import { useLicenseStore } from '../stores/licenseStore';
import { tierFromStatus } from '../stores/licenseSelectors';
import {
  type Entitlement,
  isEntitled,
} from '../../shared/entitlements';
import type { LicenseTier } from '../../shared/license';

/**
 * Resolve the current effective tier from the license store. Invalid
 * licenses collapse to `free` so a tampered token cannot accidentally grant
 * paid entitlements.
 */
export function useEffectiveTier(): LicenseTier {
  const status = useLicenseStore((state) => state.status);
  return tierFromStatus(status);
}

/**
 * Re-export of the non-hook tier reader. The implementation lives with the
 * stores (`stores/licenseSelectors.ts`) so store modules never import from
 * the hooks layer; imperative component/hook code can keep using this path.
 */
export { currentEffectiveTier } from '../stores/licenseSelectors';

/**
 * Return whether the current license tier grants a given entitlement.
 * Components should prefer this over asking the store directly so gating
 * decisions go through the single `isEntitled` policy in
 * `src/shared/entitlements.ts`.
 */
export function useEntitlement(entitlement: Entitlement): boolean {
  const tier = useEffectiveTier();
  return isEntitled(tier, entitlement);
}

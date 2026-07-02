import { useLicenseStore } from './licenseStore';
import type { LicenseTier } from '../../shared/license';

/**
 * Non-React license selectors.
 *
 * `currentEffectiveTier` used to live in `hooks/useEntitlement.ts`, which
 * meant every store that gates on tier (editor tab budget, snippets,
 * appearance packs, histories) imported FROM the hooks layer — a
 * stores → hooks edge that inverts the documented direction (hooks
 * coordinate stores, never the reverse) and left a latent init-order
 * cycle: the day `useEntitlement` transitively touches an editor store,
 * Zustand initialization breaks at runtime, not at compile time. The
 * selector lives here now; `useEntitlement` re-exports it so hook-side
 * call sites keep their import path.
 */

type StatusLike = ReturnType<typeof useLicenseStore.getState>['status'];

/**
 * Collapse a license status onto the tier it grants. Invalid licenses
 * collapse to `free` so a tampered token cannot accidentally grant paid
 * entitlements.
 */
export function tierFromStatus(status: StatusLike): LicenseTier {
  if (status.kind === 'active' || status.kind === 'grace') {
    return status.verification.payload.tier;
  }
  return 'free';
}

/**
 * Non-hook reader for stores and imperative code that cannot take a hook
 * dependency. Returns the tier snapshotted at the moment of the call.
 */
export function currentEffectiveTier(): LicenseTier {
  return tierFromStatus(useLicenseStore.getState().status);
}

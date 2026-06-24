/**
 * RL-096 Slice 2 fold C — license-verify trust capture.
 *
 * Extracted from the `licenseStore` facade so the seam stays thin (the
 * facade just wires this in after creating the store). Records a `license`
 * trust event on each transition into a verified kind (`active` / `grace`),
 * de-duped on the kind so a re-set to the same state does not spam the
 * cap-200 trust log. The summary is the closed status kind only — never the
 * token. Fires once per launch for a persisted Pro license, which honestly
 * reflects the boot-time re-verify.
 *
 * Takes the store as a parameter (rather than importing the facade) so there
 * is no `licenseStore -> licenseTrustCapture -> licenseStore` import cycle.
 */
import type { LicenseState } from './licenseTypes';
import { recordTrustEventBestEffort } from './trustEventStore';

type LicenseStoreLike = {
  subscribe: (listener: (state: LicenseState) => void) => () => void;
};

let lastVerifiedLicenseKind: 'active' | 'grace' | null = null;

export function registerLicenseTrustCapture(store: LicenseStoreLike): void {
  store.subscribe((state) => {
    const kind =
      state.status.kind === 'active' || state.status.kind === 'grace'
        ? state.status.kind
        : null;
    if (kind === lastVerifiedLicenseKind) return;
    lastVerifiedLicenseKind = kind;
    if (kind === null) return;
    recordTrustEventBestEffort({
      feature: 'license',
      action: 'verified',
      sensitivity: 'low',
      summary: `License verified (${kind})`,
    });
  });
}

/** Test-only: reset the module-scope de-dupe guard between cases. */
export function _resetLicenseTrustCaptureForTesting(): void {
  lastVerifiedLicenseKind = null;
}

/**
 * license-verify trust capture.
 *
 * Extracted from the `licenseStore` facade so the seam stays thin (the
 * facade just wires this in after creating the store). Records a `license`
 * trust event on each transition into a verified kind (`active` / `grace`)
 * or into a rejection (`invalid`, with its reason code), de-duped on that
 * key so a re-set to the same state does not spam the cap-200 trust log.
 * The summary is the closed status kind or reason code only — never the
 * token. Fires once per launch for a persisted license, which honestly
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

type LicenseTrustEvent = { key: string; action: 'verified' | 'rejected'; summary: string };

let lastLicenseEventKey: string | null = null;

const REASON_CODE = /^[a-z][a-z-]{0,39}$/;

function licenseTrustEvent(status: LicenseState['status']): LicenseTrustEvent | null {
  if (status.kind === 'active' || status.kind === 'grace') {
    return { key: status.kind, action: 'verified', summary: `License verified (${status.kind})` };
  }
  if (status.kind === 'invalid') {
    const reason = REASON_CODE.test(status.reason) ? status.reason : 'unknown';
    return { key: `invalid:${reason}`, action: 'rejected', summary: `License rejected (${reason})` };
  }
  return null;
}

export function registerLicenseTrustCapture(store: LicenseStoreLike): void {
  store.subscribe((state) => {
    const event = licenseTrustEvent(state.status);
    const key = event?.key ?? null;
    if (key === lastLicenseEventKey) return;
    lastLicenseEventKey = key;
    if (!event) return;
    recordTrustEventBestEffort({
      feature: 'license',
      action: event.action,
      sensitivity: 'low',
      summary: event.summary,
    });
  });
}

import type { LicenseTier } from '../shared/license';
import type { LicenseSnapshot } from '../shared/licenseSnapshot';

/** The tier main trusts: the verified token's while active or in grace, else Free. */
export function licenseTier(snapshot: Pick<LicenseSnapshot, 'status'>): LicenseTier {
  const { status } = snapshot;
  return status.kind === 'active' || status.kind === 'grace' ? status.verification.payload.tier : 'free';
}

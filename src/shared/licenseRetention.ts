import type { LicenseFailureReason } from './license';
import type { LicenseServerFailureReason } from './licenseServerTypes';

/**
 * Rejections that only show this build or the license server cannot vouch
 * for a token (unknown signing key, newer format, misconfigured keyring),
 * not that the license is dead. Desktop and web keep the token on these so
 * an older build cannot destroy a license; it still grants nothing.
 */
export const RETAINED_INVALID_REASONS: ReadonlySet<string> = new Set([
  'malformed',
  'invalid-signature',
  'unsupported-tier',
  'clock-skew',
  'no-public-key',
  'unknown-license',
] satisfies readonly (LicenseFailureReason | Extract<LicenseServerFailureReason, 'unknown-license'>)[]);

export function retainsLicenseToken(status: { kind: string; reason?: string }): boolean {
  return (
    status.kind === 'invalid' &&
    typeof status.reason === 'string' &&
    RETAINED_INVALID_REASONS.has(status.reason)
  );
}

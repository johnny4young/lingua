import { decodeLicenseToken } from '../../shared/license';
import {
  isLicenseServerEnabled,
  status as serverStatus,
  type StatusResult,
} from '../services/licenseServer';
import { getOrMintDeviceId } from '../services/deviceFingerprint';
import { runVerifyWeb } from './licenseWebVerify';
import type { LicenseStatus } from './licenseTypes';

/**
 * internal — license-token helpers, extracted verbatim from `licenseStore.ts`:
 * the `issuedAt` / `issuedTo` payload decoders + the stale-token auto-pickup.
 * Depends on `licenseWebVerify` (it re-verifies any server-provided replacement
 * locally) + the license server service; never on the store or action factories.
 */

export function decodeIssuedAt(token: string): number | null {
  const decoded = decodeLicenseToken(token);
  if (!decoded.ok) return null;
  const ms = Date.parse(decoded.payload.issuedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Pull the buyer email out of a token's payload without verifying the
 * signature. Used as a "best effort" affordance when the token failed
 * local verify with `expired` and we want to pre-fill the recovery
 * form. A bogus token won't decode and we just fall back to a blank
 * recovery form.
 */
export function decodeIssuedTo(token: string): string | null {
  const decoded = decodeLicenseToken(token);
  if (!decoded.ok) return null;
  const value = decoded.payload.issuedTo;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * implementation — stale-token auto-pickup.
 *
 * When local verify on a paste / rehydrate produces
 * `{ kind: 'invalid', reason: 'expired' }`, the signature was still
 * valid (otherwise we'd see `'invalid-signature'`). The server's
 * `findCurrentLicenseForToken` walks the licenseId path and returns
 * the canonical `licenses.token` via `refreshedToken`, so a stale T1
 * resolves to the active implementation silently.
 *
 * Grace-window contract: this helper is only allowed to run after
 * local verification has proven the stale token is authentic but
 * outside its local support window. It never rescues malformed,
 * unsigned, wrong-key, or clock-skewed tokens, and it re-verifies the
 * server-provided replacement locally before storing it. If any step
 * fails, callers fall through to the recovery-hint UX.
 *
 * Returns a usable `{ token, status }` pair when the swap succeeds.
 * Otherwise `null` — caller falls through to the recover-hint UX.
 */
export async function attemptStaleTokenRefresh(
  staleToken: string,
): Promise<{ token: string; status: LicenseStatus } | null> {
  if (!isLicenseServerEnabled()) return null;
  const deviceId = getOrMintDeviceId();
  const result: StatusResult = await serverStatus({
    token: staleToken,
    deviceId,
    surface: 'web',
  });
  if (!result.ok) return null;
  if (typeof result.refreshedToken !== 'string' || result.refreshedToken === staleToken) {
    return null;
  }
  // Defensive: the refreshed token must locally verify before we
  // accept it. A malformed server response (or key rotation we
  // didn't see) should not flip the user to "active".
  const refreshedStatus = await runVerifyWeb(result.refreshedToken);
  if (refreshedStatus.kind === 'invalid') return null;
  return { token: result.refreshedToken, status: refreshedStatus };
}

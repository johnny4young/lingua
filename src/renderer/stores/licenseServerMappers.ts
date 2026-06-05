import type {
  LicenseServerFailureReason,
  LicenseServerStatusKind,
} from '../services/licenseServer';
import type { LicenseStatus } from './licenseTypes';

/**
 * RL-130 — license-server verdict mappers, extracted verbatim from
 * `licenseStore.ts`. Pure functions that fold the authoritative server status /
 * failure reason onto the local `LicenseStatus`. Leaf: depends only on the
 * server-reason types + the license types, never on the store.
 */

/**
 * Map a server-side `licenses.status` field onto our local `LicenseStatus`.
 * The server has authoritative truth (it sees revocation + expiration + a
 * stricter clock than the client) so its verdict overrides local-verify.
 */
export function serverStatusKindToStatus(
  kind: LicenseServerStatusKind,
  localStatus: LicenseStatus
): LicenseStatus {
  switch (kind) {
    case 'active':
    case 'cancel_at_period_end':
      // Cancel-at-period-end behaves like active until expires_at; the
      // renderer already shows the cancellation copy via Polar customer
      // portal, not via the status pill, so we collapse it to active here.
      if (localStatus.kind === 'active' || localStatus.kind === 'grace') {
        return { kind: 'active', verification: localStatus.verification };
      }
      return localStatus;
    case 'grace':
      if (localStatus.kind === 'active' || localStatus.kind === 'grace') {
        return { kind: 'grace', verification: localStatus.verification };
      }
      return localStatus;
    case 'expired':
      return { kind: 'invalid', reason: 'expired' };
    case 'refunded':
      return { kind: 'invalid', reason: 'license-refunded' };
    default:
      return localStatus;
  }
}

/**
 * Map a server-side failure reason onto a local invalid status. Some
 * reasons are transient (`unreachable`, `server-error`) and the caller
 * should fall back to the local-verify status; this helper only handles
 * the *terminal* reasons that render as a discrete error state.
 */
export function serverFailureToInvalid(reason: LicenseServerFailureReason): LicenseStatus | null {
  switch (reason) {
    case 'revoked':
      return { kind: 'invalid', reason: 'license-refunded' };
    case 'expired':
      return { kind: 'invalid', reason: 'expired' };
    case 'invalid-signature':
      return { kind: 'invalid', reason: 'invalid-signature' };
    case 'unknown-license':
      return { kind: 'invalid', reason: 'unknown-license' };
    case 'exhausted':
      return { kind: 'invalid', reason: 'devices-exhausted' };
    case 'invalid-input':
      return { kind: 'invalid', reason: 'invalid-input' };
    case 'unreachable':
    case 'server-error':
    case 'not-implemented':
    case 'disabled':
      return null;
    default: {
      // Type-system safety net for future additions.
      const _exhaustive: never = reason;
      void _exhaustive;
      return null;
    }
  }
}

export function isTransientServerFailure(reason: LicenseServerFailureReason): boolean {
  return reason === 'unreachable' || reason === 'server-error' || reason === 'not-implemented';
}

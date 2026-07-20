import type { StoreApi } from 'zustand';
import type { LicenseVerificationResult } from '../../shared/license';
import type {
  LicenseServerDeviceLimit,
  LicenseServerDevicesBucket,
  RemoveDeviceResult,
} from '../services/licenseServer';

/**
 * internal — shared license-store types + status constants + store-binding
 * aliases, extracted verbatim from `licenseStore.ts`. Leaf module: it imports
 * only the shared license/server contracts, never the facade or the web/desktop
 * stores, so every split module (and the facade's public re-export) can depend
 * on it without a cycle.
 */

export type LicenseStatus =
  | { kind: 'free' }
  /** Local verify succeeded; awaiting server activate response. Transient. */
  | { kind: 'verifying' }
  | { kind: 'invalid'; reason: string; message?: string }
  | { kind: 'active'; verification: Extract<LicenseVerificationResult, { ok: true }> }
  | { kind: 'grace'; verification: Extract<LicenseVerificationResult, { ok: true }> };

/**
 * Last server-side sync outcome. Web-only; desktop sets to `'disabled'`
 * because the bridge owns truth via main-process verification. The
 * `LicenseSection` component reads this to surface the
 * `license.notice.serverUnreachable` warning when the renderer fell
 * back to local-verify within the 24-hour offline-grace window.
 */
export type ServerSyncState = 'synced' | 'unreachable' | 'disabled' | null;

/**
 * implementation — recover-hint surfaced when a paste/rehydrate
 * resolves to an expired-but-signature-valid token AND the server
 * cannot auto-refresh (license cancelled, refunded, or unknown). The
 * `LicenseSection` reads this and renders an inline "Recover via
 * email" CTA pre-filled with the token's `issuedTo` payload field.
 *
 * Distinct from the user-driven RecoveryCta on the free state — this
 * one fires automatically and is dismissible.
 */
export interface RecoverHint {
  email: string;
}

export interface LicenseState {
  token: string | null;
  status: LicenseStatus;
  lastVerifiedAt: number | null;
  serverSync: ServerSyncState;
  devices: LicenseServerDevicesBucket | null;
  deviceLimit: LicenseServerDeviceLimit | null;
  /**
   * implementation — non-null when the renderer detected a stale token
   * and the server could not refresh it. The LicenseSection shows
   * an inline "Recover via email" button pre-filled with this email.
   */
  recoverHint: RecoverHint | null;
  /** Import and verify a new license token. Returns the resulting status. */
  setLicenseToken: (token: string) => Promise<LicenseStatus>;
  /** Re-verify the stored token, typically after a setting change or startup. */
  revalidate: () => Promise<LicenseStatus>;
  /** Remove the token and return to the free tier. */
  clearLicense: () => Promise<LicenseStatus>;
  /**
   * implementation — remove a device from the active license via the server's
   * `/licenses/devices/remove` endpoint and refresh the cached bucket.
   * Returns the server's response so the caller can decide whether to
   * surface the success notice or a translated error. The web store calls
   * the endpoint directly; the desktop store  delegates to the
   * main bridge, which calls the same endpoint with the persisted token.
   */
  removeDevice: (deviceIdToRemove: string) => Promise<RemoveDeviceResult>;
  /** implementation — dismiss the inline recover-hint after user acknowledgement. */
  clearRecoverHint: () => void;
}

/** Free-tier sentinel status — the default for a store with no valid token. */
export const FREE_STATUS: LicenseStatus = { kind: 'free' };
/** Transient status while a locally-verified token awaits server activation. */
export const VERIFYING_STATUS: LicenseStatus = { kind: 'verifying' };

/**
 * internal — shared store-binding types for the web license action factories.
 * The web flow's setters live in `licenseWebActions` / `licenseWebRevalidate`
 * as factories of the form `createX(set, get) => Pick<LicenseState, …>`; these
 * give them the exact zustand `set` / `get` signatures the `StateCreator`
 * callback receives.
 */
export type LicenseSet = StoreApi<LicenseState>['setState'];
export type LicenseGet = StoreApi<LicenseState>['getState'];

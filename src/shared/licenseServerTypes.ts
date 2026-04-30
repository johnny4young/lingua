/**
 * Shared type definitions for the RL-061 license-server contract
 * (`licenses.linguacode.dev`). Both `src/renderer/services/licenseServer.ts`
 * (web build) and `src/main/licenseServer.ts` (desktop main process)
 * import from here so the request / response shapes can never drift
 * between surfaces.
 *
 * The function implementations stay separate per surface — renderer
 * uses browser fetch + `import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL`,
 * main uses Node 22+ global fetch + a build-time `define` baked from
 * `loadEnv()` — but everything that crosses the wire (`ActivateInput`,
 * `StatusSuccess`, `LicenseServerFailureReason`, etc.) is canonical
 * here.
 */

export type LicenseServerSurface = 'desktop' | 'web';

export interface LicenseServerDevice {
  id: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: LicenseServerSurface;
  activatedAt: number;
  lastSeenAt: number;
}

export interface LicenseServerDevicesBucket {
  desktop: LicenseServerDevice[];
  web: LicenseServerDevice[];
}

export interface LicenseServerDeviceLimit {
  desktop: number;
  web: number;
}

export type LicenseServerStatusKind =
  | 'active'
  | 'grace'
  | 'expired'
  | 'cancel_at_period_end'
  | 'refunded';

export type LicenseServerFailureReason =
  /** The build was not configured with a license-server base URL. */
  | 'disabled'
  /** Network error, timeout, DNS failure, CORS, etc. The 24h offline-grace fallback applies. */
  | 'unreachable'
  /** Worker returned 5xx or a body shape we don't recognise. Treat as transient. */
  | 'server-error'
  /** Token signature didn't verify against the server's public key. */
  | 'invalid-signature'
  /** Token was valid but no row in D1 — typically a token signed by a non-production key. */
  | 'unknown-license'
  /** Order was refunded after issuance. License row is permanently invalid. */
  | 'revoked'
  /** Subscription expired past the grace window. */
  | 'expired'
  /** Per-surface bucket is full. Caller should surface the device list to the user. */
  | 'exhausted'
  /** Body shape didn't pass server-side validation (e.g. missing fields, bad surface). */
  | 'invalid-input'
  /** Worker is missing a critical secret (e.g. LINGUA_LICENSE_PUBLIC_KEY_JWK). */
  | 'not-implemented';

export interface ActivateInput {
  token: string;
  deviceId: string;
  deviceName: string;
  os: string;
  surface: LicenseServerSurface;
}

export interface ActivateSuccess {
  ok: true;
  licenseId: string;
  activated: boolean;
  idempotent: boolean;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
}

export interface ExhaustedFailure {
  ok: false;
  reason: 'exhausted';
  surface: LicenseServerSurface;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
}

export interface ServerFailureMeta {
  message?: string;
  /**
   * Echoed straight from the worker's validator (`license-server/src/lib/
   * validation.ts`). Populated only on `reason: 'invalid-input'`. Callers
   * log the issues for developer visibility but never surface them to
   * end users — the strings are technical and can leak server-side
   * enum names.
   */
  issues?: string[];
}

export type ActivateResult =
  | ActivateSuccess
  | ExhaustedFailure
  | ({ ok: false; reason: Exclude<LicenseServerFailureReason, 'exhausted'> } & ServerFailureMeta);

export interface StatusInput {
  token: string;
  deviceId: string;
  surface: LicenseServerSurface;
}

export interface StatusSuccess {
  ok: true;
  licenseId: string;
  status: LicenseServerStatusKind;
  tier: string;
  expiresAt: number | null;
  supportWindowEndsAt: number;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
  deviceRegistered: boolean;
  /** Present when the persisted `licenses.token` differs from the one the client sent (Monthly renewal pickup). */
  refreshedToken?: string;
}

export type StatusResult =
  | StatusSuccess
  | ({ ok: false; reason: LicenseServerFailureReason } & ServerFailureMeta);

export interface RemoveDeviceInput {
  token: string;
  deviceIdToRemove: string;
}

export interface RemoveDeviceSuccess {
  ok: true;
  licenseId: string;
  removed: boolean;
  devices: LicenseServerDevicesBucket;
  deviceLimit: LicenseServerDeviceLimit;
}

export type RemoveDeviceResult =
  | RemoveDeviceSuccess
  | ({ ok: false; reason: LicenseServerFailureReason } & ServerFailureMeta);

/**
 * Compact serialised state the desktop main bridge ships to the
 * renderer alongside the existing `LicenseSnapshot`. Slice 3.5 makes
 * desktop's licenseStore branch read this so its Devices section can
 * render under the same gate the web build already passes
 * (`serverSync === 'synced'` + non-null `devices` + `deviceLimit`).
 *
 * Persisted to disk: nothing. The bridge re-fetches from
 * `/licenses/status` on every boot — devices belong on the server
 * and the renderer only mirrors the last known snapshot.
 */
export type LicenseServerSyncState = 'synced' | 'unreachable' | 'disabled';

// ====================================================================
// RL-061 Slice 4 — Trial / Education / Recovery contracts
// ====================================================================
//
// All three flows share a similar shape: a POST /start that registers
// the request, then either an immediate token (Trial) or a magic-link
// /confirm step the user reaches via email (Education + Recovery).
//
// Failure unions are tagged-by-`reason`. The renderer maps each
// reason to an i18n key for the notice band — shape-only, no server
// strings reach the user.

/** Trial / Education / Recovery shared per-flow failure that the
 *  renderer should surface as a "Recover token" CTA hint. */
export interface RecoverableFailureFlag {
  /** Renderer turns this into an inline "Recover token" button. */
  canRecover?: boolean;
}

// -------------------------------------------------------- POST /trials/start

export interface TrialStartInput {
  email: string;
  deviceId: string;
  deviceName: string;
  os: string;
}

export interface TrialStartSuccess {
  ok: true;
  licenseId: string;
  /** Signed token returned in body for auto-paste even when email delivery fails. */
  token: string;
  tier: 'trial';
  expiresAt: number;
  emailDelivered: boolean;
  emailReason?: string;
}

export type TrialStartFailureReason =
  | 'invalid-input'
  | 'trial-exists-email'
  | 'trial-exists-device'
  | 'rate-limited'
  | 'not-implemented'
  | 'server-error'
  | 'unreachable'
  | 'disabled';

export type TrialStartResult =
  | TrialStartSuccess
  | ({
      ok: false;
      reason: TrialStartFailureReason;
      retryAfter?: number;
    } & ServerFailureMeta &
      RecoverableFailureFlag);

// ------------------------------------------------------ POST /education/start

export interface EducationStartInput {
  email: string;
  deviceId: string;
  deviceName: string;
  os: string;
}

/** Magic-link first step — user has been emailed a confirm link.
 *  No token in body; the token email lands AFTER the user clicks
 *  the confirmation link and the worker mints. */
export interface EducationStartPending {
  ok: true;
  pending: true;
  message: string;
  pendingId: string;
  expiresAt: number;
  emailDelivered: true;
}

export type EducationStartFailureReason =
  | 'invalid-input'
  | 'not-educational'
  | 'email-already-active'
  | 'device-already-active'
  | 'rate-limited'
  | 'confirmation-email-failed'
  | 'not-implemented'
  | 'server-error'
  | 'unreachable'
  | 'disabled';

export type EducationStartResult =
  | EducationStartPending
  | ({
      ok: false;
      reason: EducationStartFailureReason;
      retryAfter?: number;
    } & ServerFailureMeta &
      RecoverableFailureFlag);

// ------------------------------------------------------ POST /education/renew

export interface EducationRenewInput {
  token: string;
  email: string;
}

export interface EducationRenewSuccess {
  ok: true;
  licenseId: string;
  refreshedToken: string;
  expiresAt: number;
  emailDelivered: boolean;
  emailReason?: string;
}

export type EducationRenewFailureReason =
  | 'invalid-input'
  | 'not-educational'
  | 'unknown-license'
  | 'email-mismatch'
  | 'not-implemented'
  | 'server-error'
  | 'unreachable'
  | 'disabled';

export type EducationRenewResult =
  | EducationRenewSuccess
  | ({ ok: false; reason: EducationRenewFailureReason } & ServerFailureMeta);

// ------------------------------------------------ POST /licenses/recover/start

export interface LicenseRecoverInput {
  email: string;
}

/**
 * Recovery is no-info-leak: the worker ALWAYS responds with this
 * pending shape regardless of whether the email matches a known
 * license, hits a rate-limit, or is malformed-but-shape-valid. The
 * renderer treats it as a uniform "we sent the email if it
 * matched" notice.
 */
export interface LicenseRecoverPending {
  ok: true;
  pending: true;
  message: string;
}

export type LicenseRecoverFailureReason =
  | 'invalid-input'
  | 'server-error'
  | 'unreachable'
  | 'disabled';

export type LicenseRecoverResult =
  | LicenseRecoverPending
  | ({ ok: false; reason: LicenseRecoverFailureReason } & ServerFailureMeta);

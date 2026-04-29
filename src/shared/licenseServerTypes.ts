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

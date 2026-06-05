import {
  activate as serverActivate,
  isLicenseServerEnabled,
  removeDevice as serverRemoveDevice,
  type ActivateResult,
} from '../services/licenseServer';
import { getDeviceName, getOrMintDeviceId, getOs } from '../services/deviceFingerprint';
import { runVerifyWeb } from './licenseWebVerify';
import { attemptStaleTokenRefresh, decodeIssuedTo } from './licenseTokenHelpers';
import { isTransientServerFailure, serverFailureToInvalid } from './licenseServerMappers';
import {
  FREE_STATUS,
  type LicenseGet,
  type LicenseSet,
  type LicenseState,
  type LicenseStatus,
  VERIFYING_STATUS,
} from './licenseTypes';

/**
 * RL-130 — web-flow action factory for the license store, extracted verbatim
 * from `licenseStore.ts`. Bundles `setLicenseToken` (local verify → stale-token
 * pickup → server activate), `clearLicense` (optimistic flip + fire-and-forget
 * device removal), `removeDevice`, and `clearRecoverHint`. The ~198-line
 * `revalidate` action lives in `licenseWebRevalidate` to keep each module under
 * budget. `createWebActions(set, get)` receives the exact `StateCreator`
 * `set`/`get`, so the verification + server-sync side-effects are unchanged.
 */
export function createWebActions(
  set: LicenseSet,
  get: LicenseGet
): Pick<
  LicenseState,
  'setLicenseToken' | 'clearLicense' | 'removeDevice' | 'clearRecoverHint'
> {
  return {
    setLicenseToken: async (token) => {
      const trimmed = token.trim();
      if (trimmed.length === 0) {
        const invalid: LicenseStatus = { kind: 'invalid', reason: 'malformed' };
        set({ token: null, status: invalid, lastVerifiedAt: Date.now() });
        return invalid;
      }

      let activeToken = trimmed;
      let localStatus = await runVerifyWeb(trimmed);
      if (localStatus.kind === 'invalid') {
        // Slice 4 — stale-token auto-pickup. When the local verify
        // failed with `expired` (signature was still valid), try
        // /licenses/status before giving up. The server walks the
        // licenseId path and may return a refreshedToken via the
        // canonical row; that swap keeps subscription users on Active
        // without re-pasting after a long time away.
        if (localStatus.reason === 'expired') {
          const refreshed = await attemptStaleTokenRefresh(trimmed);
          if (refreshed) {
            activeToken = refreshed.token;
            localStatus = refreshed.status;
          } else {
            // No silent path — surface a recover-hint so the LicenseSection
            // can render the inline "Recover via email" button. Suppress
            // the hint when the build has no license server configured —
            // the recovery flow it points to (`/licenses/recover/start`)
            // is unreachable in dev builds, so the banner would dead-end.
            const issuedTo = isLicenseServerEnabled() ? decodeIssuedTo(trimmed) : null;
            set({
              token: null,
              status: localStatus,
              lastVerifiedAt: Date.now(),
              recoverHint: issuedTo ? { email: issuedTo } : null,
            });
            return localStatus;
          }
        } else {
          // Real local failure (invalid-signature / malformed / clock-skew /
          // no-public-key). Preserve the existing token if any so a
          // hot-reload paste doesn't lose state.
          if (get().token) return localStatus;
          set({ token: null, status: localStatus, lastVerifiedAt: Date.now() });
          return localStatus;
        }
      }

      // Server disabled (dev build): take the local-verify outcome and stop.
      if (!isLicenseServerEnabled()) {
        set({
          token: activeToken,
          status: localStatus,
          lastVerifiedAt: Date.now(),
          serverSync: 'disabled',
          devices: null,
          deviceLimit: null,
          recoverHint: null,
        });
        return localStatus;
      }

      // Show the transient verifying pill while the activate call runs.
      set({ token: activeToken, status: VERIFYING_STATUS, lastVerifiedAt: Date.now() });

      const deviceId = getOrMintDeviceId();
      const result: ActivateResult = await serverActivate({
        token: activeToken,
        deviceId,
        deviceName: getDeviceName(),
        os: getOs(),
        surface: 'web',
      });

      if (result.ok) {
        // Server confirmed activation; status pill resolves from local
        // verification (which already passed) — server has no view of
        // grace-window vs active that would be more authoritative than
        // our payload's supportWindowEndsAt comparison.
        set({
          token: activeToken,
          status: localStatus,
          lastVerifiedAt: Date.now(),
          serverSync: 'synced',
          devices: result.devices,
          deviceLimit: result.deviceLimit,
          recoverHint: null,
        });
        return localStatus;
      }

      if (isTransientServerFailure(result.reason)) {
        // 24-hour offline-grace per LICENSING_ADR Decision 4 — the token
        // is locally valid; the renderer will retry on the next page load
        // and synchronise the device count then.
        set({
          token: activeToken,
          status: localStatus,
          lastVerifiedAt: Date.now(),
          serverSync: 'unreachable',
          devices: null,
          deviceLimit: null,
          recoverHint: null,
        });
        return localStatus;
      }

      // Terminal server rejection: revoked / exhausted / invalid-token /
      // invalid-input. Map to a discrete invalid status. Keep the token in
      // state for `exhausted` so the Slice 3 modal can remediate without
      // forcing the user to re-paste; wipe it for everything else.
      const invalid =
        serverFailureToInvalid(result.reason) ?? { kind: 'invalid' as const, reason: result.reason };
      const keepToken = result.reason === 'exhausted';
      // Persist `devices` + `deviceLimit` on `exhausted` — the modal needs
      // the bucket to render the per-device Remove buttons. Every other
      // terminal branch clears the bucket so a replacement token cannot
      // inherit stale rows from a previous license.
      // Surface a recover-hint when the server says the license itself
      // is gone (revoked / unknown) so the renderer can prompt the user
      // to recover via email rather than just bouncing them to free.
      const issuedToForHint =
        result.reason === 'unknown-license' || result.reason === 'revoked'
          ? decodeIssuedTo(activeToken)
          : null;
      set({
        token: keepToken ? activeToken : null,
        status: invalid,
        lastVerifiedAt: Date.now(),
        serverSync: 'synced',
        devices: result.reason === 'exhausted' ? result.devices : null,
        deviceLimit: result.reason === 'exhausted' ? result.deviceLimit : null,
        recoverHint: issuedToForHint ? { email: issuedToForHint } : null,
      });
      return invalid;
    },
    clearLicense: async () => {
      const { token } = get();
      // Optimistic local flip — UI feedback is instant. Server cleanup
      // happens fire-and-forget below so a fast tab close still completes
      // the device removal via fetch keepalive.
      set({
        token: null,
        status: FREE_STATUS,
        lastVerifiedAt: Date.now(),
        serverSync: isLicenseServerEnabled() ? get().serverSync : 'disabled',
        devices: null,
        deviceLimit: null,
        recoverHint: null,
      });

      if (token && isLicenseServerEnabled()) {
        const deviceId = getOrMintDeviceId();
        // Don't await — `keepalive: true` inside the wrapper keeps the
        // request alive across navigations / tab close. Errors are
        // intentionally swallowed because the local clear already
        // succeeded; the server row will lapse to `removed_at` on the
        // next activate from another device anyway.
        void serverRemoveDevice({ token, deviceIdToRemove: deviceId });
      }
      return FREE_STATUS;
    },
    removeDevice: async (deviceIdToRemove) => {
      const { token } = get();
      if (!token) {
        return { ok: false, reason: 'invalid-input', message: 'No active license token.' };
      }
      if (!isLicenseServerEnabled()) {
        return { ok: false, reason: 'disabled' };
      }

      const result = await serverRemoveDevice({ token, deviceIdToRemove });
      if (!result.ok) {
        // Leave the cached bucket untouched on transient failure so the
        // user can retry without losing context. Terminal reasons
        // (`unknown-license` / `revoked`) should wipe; the caller maps
        // those onto the standard `invalid:*` status the renderer
        // already knows how to render.
        if (result.reason === 'unknown-license' || result.reason === 'revoked') {
          const invalid = serverFailureToInvalid(result.reason);
          if (invalid) {
            set({
              token: null,
              status: invalid,
              lastVerifiedAt: Date.now(),
              serverSync: 'synced',
              devices: null,
              deviceLimit: null,
            });
          }
        }
        return result;
      }

      // Server confirmed removal — refresh the cached bucket from the
      // response. If the device just removed was the *current* device the
      // server still returned a list excluding it, so the UI naturally
      // collapses to a no-current-row state on the next render.
      set({
        devices: result.devices,
        deviceLimit: result.deviceLimit,
        lastVerifiedAt: Date.now(),
        serverSync: 'synced',
      });
      return result;
    },
    clearRecoverHint: () => {
      set({ recoverHint: null });
    },
  };
}

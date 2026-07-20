import {
  activate as serverActivate,
  isLicenseServerEnabled,
  status as serverStatus,
  type StatusResult,
} from '../services/licenseServer';
import { getDeviceName, getOrMintDeviceId, getOs } from '../services/deviceFingerprint';
import { runVerifyWeb } from './licenseWebVerify';
import {
  attemptStaleTokenRefresh,
  decodeIssuedAt,
  decodeIssuedTo,
} from './licenseTokenHelpers';
import {
  isTransientServerFailure,
  serverFailureToInvalid,
  serverStatusKindToStatus,
} from './licenseServerMappers';
import {
  FREE_STATUS,
  type LicenseGet,
  type LicenseSet,
  type LicenseState,
} from './licenseTypes';

/**
 * internal — web-flow `revalidate` action factory, extracted verbatim from
 * `licenseStore.ts`. Re-verifies the stored token locally, picks up a newer
 * subscription token when the server offers one, implementation note authoritative server
 * status onto the local verdict, and re-activates this browser when the device
 * bucket is missing it (so a rehydrated exhausted token cannot bypass the
 * per-surface cap). Isolated in its own module because it is ~200 lines; same
 * `StateCreator` `set`/`get` as the inline original.
 */
export function createWebRevalidate(
  set: LicenseSet,
  get: LicenseGet
): Pick<LicenseState, 'revalidate'> {
  return {
    revalidate: async () => {
      const { token } = get();
      if (!token) {
        set({ status: FREE_STATUS, lastVerifiedAt: Date.now(), devices: null, deviceLimit: null });
        return FREE_STATUS;
      }

      // Every branch below sits behind one or more awaits (local verify,
      // server status, activation). If the user removed the license or
      // applied a different token while this run was in flight, the
      // stored token no longer matches the one we started from — writing
      // the stale result would resurrect the removed license (or clobber
      // the newly applied one), and persist middleware would re-save it.
      // The desktop store guards the same race with `bootstrapApplied`;
      // this is the web equivalent.
      const tokenAtStart = token;
      const commit: typeof set = (partial) => {
        if (get().token !== tokenAtStart) return;
        set(partial);
      };

      let activeToken = token;
      let localStatus = await runVerifyWeb(token);
      if (localStatus.kind === 'invalid') {
        // implementation — same stale-token auto-pickup as setLicenseToken.
        // A rehydrated `expired` token may already have a refresh waiting
        // on the server; surface that silently before wiping the row.
        if (localStatus.reason === 'expired') {
          const refreshed = await attemptStaleTokenRefresh(token);
          if (refreshed) {
            activeToken = refreshed.token;
            localStatus = refreshed.status;
          } else {
            // Stored token aged out and the server has no refresh —
            // wipe AND surface a recover-hint so the user can retrieve
            // the latest token via email. Suppress the hint when the
            // build has no license server configured (dev mode) so we
            // don't dead-end the user at an unreachable RecoveryCta.
            const issuedTo = isLicenseServerEnabled() ? decodeIssuedTo(token) : null;
            commit({
              token: null,
              status: localStatus,
              lastVerifiedAt: Date.now(),
              devices: null,
              deviceLimit: null,
              recoverHint: issuedTo ? { email: issuedTo } : null,
            });
            return localStatus;
          }
        } else {
          // Stored token failed local verification (key rotation, tampering,
          // or signature corruption) — wipe regardless of server reachability.
          commit({
            token: null,
            status: localStatus,
            lastVerifiedAt: Date.now(),
            devices: null,
            deviceLimit: null,
            recoverHint: null,
          });
          return localStatus;
        }
      }

      if (!isLicenseServerEnabled()) {
        commit({
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

      const deviceId = getOrMintDeviceId();
      const result: StatusResult = await serverStatus({
        token: activeToken,
        deviceId,
        surface: 'web',
      });

      if (result.ok) {
        // Pick up Monthly subscription `refreshedToken` only when its
        // `issuedAt` is strictly newer than the stored token's. Defends
        // against a rare stale-replica response from D1's read path.
        let activeStatus = localStatus;
        if (typeof result.refreshedToken === 'string' && result.refreshedToken !== activeToken) {
          const oldIssuedAt = decodeIssuedAt(activeToken);
          const newIssuedAt = decodeIssuedAt(result.refreshedToken);
          if (newIssuedAt !== null && (oldIssuedAt === null || newIssuedAt > oldIssuedAt)) {
            const refreshedStatus = await runVerifyWeb(result.refreshedToken);
            if (refreshedStatus.kind !== 'invalid') {
              activeToken = result.refreshedToken;
              activeStatus = refreshedStatus;
            }
          }
        }

        const finalStatus = serverStatusKindToStatus(result.status, activeStatus);
        if (finalStatus.kind === 'invalid') {
          commit({
            token: null,
            status: finalStatus,
            lastVerifiedAt: Date.now(),
            serverSync: 'synced',
            devices: null,
            deviceLimit: null,
          });
          return finalStatus;
        }

        if (!result.deviceRegistered) {
          // `/licenses/status` reports license health, not registration.
          // If this browser is missing from the active device bucket, retry
          // activation before granting Pro so a rehydrated exhausted token
          // cannot bypass the per-surface cap.
          const deviceId = getOrMintDeviceId();
          const activation = await serverActivate({
            token: activeToken,
            deviceId,
            deviceName: getDeviceName(),
            os: getOs(),
            surface: 'web',
          });

          if (activation.ok) {
            commit({
              token: activeToken,
              status: finalStatus,
              lastVerifiedAt: Date.now(),
              serverSync: 'synced',
              devices: activation.devices,
              deviceLimit: activation.deviceLimit,
            });
            return finalStatus;
          }

          if (isTransientServerFailure(activation.reason)) {
            commit({
              token: activeToken,
              status: finalStatus,
              lastVerifiedAt: Date.now(),
              serverSync: 'unreachable',
              devices: null,
              deviceLimit: null,
            });
            return finalStatus;
          }

          const invalid =
            serverFailureToInvalid(activation.reason) ?? {
              kind: 'invalid' as const,
              reason: activation.reason,
            };
          const keepToken = activation.reason === 'exhausted';
          commit({
            token: keepToken ? activeToken : null,
            status: invalid,
            lastVerifiedAt: Date.now(),
            serverSync: 'synced',
            devices: activation.reason === 'exhausted' ? activation.devices : null,
            deviceLimit: activation.reason === 'exhausted' ? activation.deviceLimit : null,
          });
          return invalid;
        }

        commit({
          token: activeToken,
          status: finalStatus,
          lastVerifiedAt: Date.now(),
          serverSync: 'synced',
          devices: result.devices,
          deviceLimit: result.deviceLimit,
        });
        return finalStatus;
      }

      if (isTransientServerFailure(result.reason)) {
        commit({
          token: activeToken,
          status: localStatus,
          lastVerifiedAt: Date.now(),
          serverSync: 'unreachable',
          devices: null,
          deviceLimit: null,
        });
        return localStatus;
      }

      const invalid =
        serverFailureToInvalid(result.reason) ?? { kind: 'invalid' as const, reason: result.reason };
      // implementation — surface a recover-hint when the server says the
      // license is gone (revoked / unknown), mirroring the setLicenseToken
      // branch in licenseWebActions.
      const issuedToForHint =
        result.reason === 'unknown-license' || result.reason === 'revoked'
          ? decodeIssuedTo(activeToken)
          : null;
      commit({
        token: invalid.kind === 'invalid' && result.reason !== 'exhausted' ? null : activeToken,
        status: invalid,
        lastVerifiedAt: Date.now(),
        serverSync: 'synced',
        devices: null,
        deviceLimit: null,
        recoverHint: issuedToForHint ? { email: issuedToForHint } : null,
      });
      return invalid;
    },
  };
}

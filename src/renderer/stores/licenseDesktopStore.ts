import { create } from 'zustand';
import type { RemoveDeviceResult } from '../services/licenseServer';
import { FREE_STATUS, type LicenseState, type LicenseStatus } from './licenseTypes';
import type { LicenseBridge } from './licenseBridge';

/**
 * RL-130 — desktop license store, extracted verbatim from `licenseStore.ts`.
 * Unlike the web store, the desktop flow does NOT verify or persist locally: the
 * main process owns the Ed25519 verification + server sync, and every action
 * delegates to the `window.lingua.license` bridge and mirrors the returned
 * snapshot. Not persisted (main is the source of truth across sessions). The
 * `LicenseSnapshot` type is a global ambient (`src/types.d.ts`), so it needs no
 * import here.
 */

function bridgeFailureStatus(reason: string, error: unknown): LicenseStatus {
  return {
    kind: 'invalid',
    reason,
    message: error instanceof Error ? error.message : String(error),
  };
}

export function createDesktopStore(bridge: LicenseBridge) {
  // The async bootstrap below races against any user mutation that lands
  // before the snapshot resolves. Once a mutation has fired, the bootstrap
  // must NOT clobber it with the pre-mutation main snapshot — track that
  // here so every action becomes a barrier for the bootstrap apply.
  let bootstrapApplied = false;
  function markBootstrapped(): void {
    bootstrapApplied = true;
  }

  /**
   * RL-061 Slice 3.5 — apply the full main-side snapshot to the
   * renderer state, including the new server-derived fields
   * (`serverSync`, `devices`, `deviceLimit`). Slice 0 only mirrored
   * the local-verify trio (token / status / lastVerifiedAt) because
   * main was local-verify-only; Slice 3.5 makes main the source of
   * truth for the server bucket too.
   */
  function applySnapshot(snapshot: LicenseSnapshot): void {
    store.setState({
      token: snapshot.token,
      status: snapshot.status,
      lastVerifiedAt: snapshot.lastVerifiedAt,
      serverSync: snapshot.serverSync,
      devices: snapshot.devices,
      deviceLimit: snapshot.deviceLimit,
    });
  }

  async function syncFromBridge(): Promise<void> {
    try {
      const snapshot = await bridge.getState();
      applySnapshot(snapshot);
    } catch {
      // Best-effort resync; leave whatever local state we have if the
      // bridge itself is failing.
    }
  }

  const store = create<LicenseState>()((set, get) => ({
    token: null,
    status: FREE_STATUS,
    lastVerifiedAt: null,
    // Slice 3.5 — main now talks to /licenses/* and reports the
    // outcome through `serverSync`. The renderer mirrors whatever
    // main snapshots; the initial `'disabled'` is just the
    // pre-rehydrate placeholder and gets overwritten on the first
    // `getState()` round-trip.
    serverSync: 'disabled' as const,
    devices: null,
    deviceLimit: null,
    // Slice 4 — recoverHint is desktop-side a no-op for now. The
    // main-process equivalent of the stale-token auto-pickup +
    // recover-hint fallback is filed as a Phase 2 follow-up; the
    // desktop user's stale-token UX still works via Settings →
    // Recover via email, which goes through the same web /licenses/
    // recover/* endpoints.
    recoverHint: null,
    setLicenseToken: async (token) => {
      markBootstrapped();
      try {
        const result = await bridge.applyToken(token);
        if (!result.ok) {
          // Bridge reported a failure (e.g., disk write failed in main)
          // — resync from main so the store reflects whatever main
          // actually persisted instead of optimistically dropping the
          // user back to free. Return the invalid status so the caller
          // surfaces the user notice while the store keeps the truth.
          await syncFromBridge();
          return { kind: 'invalid', reason: result.reason, message: result.message };
        }
        applySnapshot(result.snapshot);
        return result.status;
      } catch (error) {
        await syncFromBridge();
        return bridgeFailureStatus('apply-failed', error);
      }
    },
    revalidate: async () => {
      markBootstrapped();
      try {
        const result = await bridge.revalidate();
        if (!result.ok) {
          await syncFromBridge();
          return { kind: 'invalid', reason: result.reason, message: result.message };
        }
        applySnapshot(result.snapshot);
        return result.status;
      } catch (error) {
        await syncFromBridge();
        return bridgeFailureStatus('revalidate-failed', error);
      }
    },
    clearLicense: async () => {
      // Optimistic flip keeps the existing immediate visual behavior. The
      // returned status still carries a later main-side failure so the UI can
      // avoid showing a false "removed" notice.
      markBootstrapped();
      set({
        token: null,
        status: FREE_STATUS,
        lastVerifiedAt: Date.now(),
        devices: null,
        deviceLimit: null,
      });
      try {
        const result = await bridge.clear();
        if (!result.ok) {
          await syncFromBridge();
          return { kind: 'invalid', reason: result.reason, message: result.message };
        }
        applySnapshot(result.snapshot);
        return result.snapshot.status;
      } catch (error) {
        await syncFromBridge();
        return bridgeFailureStatus('clear-failed', error);
      }
    },
    /**
     * Slice 3.5 — desktop now delegates removeDevice to the main
     * bridge, which calls `/licenses/devices/remove` with the
     * persisted token. The bridge returns a flat snapshot on
     * success; on failure we forward the tagged-union shape so the
     * renderer's existing handlers (LicenseSection,
     * ExhaustedDevicesModal) can dispatch the right notice without
     * caring whether they are running on desktop or web.
     */
    removeDevice: async (deviceIdToRemove) => {
      markBootstrapped();
      const { token } = get();
      if (!token) {
        return { ok: false, reason: 'invalid-input', message: 'No active license token.' };
      }
      try {
        const result = await bridge.removeDevice(deviceIdToRemove);
        if (!result.ok) {
          // Terminal-reason wipes are handled by main; we just need
          // to resync the snapshot so the renderer reflects whatever
          // main wrote (e.g. a wipe to free under unknown-license).
          if (result.reason === 'unknown-license' || result.reason === 'revoked') {
            await syncFromBridge();
          }
          return {
            ok: false,
            reason: result.reason as RemoveDeviceResult extends { ok: false; reason: infer R }
              ? R
              : never,
            message: result.message,
            issues: result.issues,
          };
        }
        applySnapshot(result.snapshot);
        const devices = result.snapshot.devices ?? { desktop: [], web: [] };
        const deviceLimit = result.snapshot.deviceLimit ?? { desktop: 3, web: 3 };
        return {
          ok: true,
          licenseId: result.snapshot.token ?? '',
          removed: result.removed,
          devices,
          deviceLimit,
        };
      } catch (error) {
        await syncFromBridge();
        return {
          ok: false,
          reason: 'server-error',
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    clearRecoverHint: () => {
      set({ recoverHint: null });
    },
  }));

  // Bootstrap from the main snapshot so the very first render reflects a
  // license that was applied in a previous session. We intentionally do not
  // call `revalidate()` here — main already verified during its `app.ready`
  // boot, so a fresh check would just reburn the verifier for no gain.
  void bridge
    .getState()
    .then((snapshot) => {
      if (bootstrapApplied) {
        // A user-initiated mutation already wrote the canonical state;
        // applying the pre-mutation snapshot now would silently revert it.
        return;
      }
      bootstrapApplied = true;
      applySnapshot(snapshot);
    })
    .catch(() => {
      // Bridge errors leave the store at the free-tier defaults — main
      // surfaces its own crash reporter for the underlying failure.
      bootstrapApplied = true;
    });

  return store;
}

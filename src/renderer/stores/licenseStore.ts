import { create, type StateCreator } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  decodeLicenseToken,
  type LicenseVerificationResult,
  verifyLicenseToken,
} from '../../shared/license';
import {
  activate as serverActivate,
  isLicenseServerEnabled,
  removeDevice as serverRemoveDevice,
  status as serverStatus,
  type ActivateResult,
  type LicenseServerFailureReason,
  type LicenseServerStatusKind,
  type StatusResult,
} from '../services/licenseServer';
import { getDeviceName, getOrMintDeviceId, getOs } from '../services/deviceFingerprint';

/**
 * Public Ed25519 verification key. Populated at build time via a build-arg
 * when the issuer is live; until then the placeholder is `null` so
 * `setLicenseToken` rejects with a `no-public-key` result rather than
 * silently "verifying" against nothing. Keeping the env-read at module scope
 * means the renderer bundle embeds the key once instead of re-reading it on
 * every verification.
 */
const PUBLIC_KEY_JWK: JsonWebKey | null = readEmbeddedPublicKey();

function readEmbeddedPublicKey(): JsonWebKey | null {
  const raw = import.meta.env?.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK;
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(raw) as JsonWebKey;
  } catch {
    // Explicitly swallow and return null so a misconfigured build env fails
    // loud at set-license time instead of at module import.
    return null;
  }
}

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

export interface LicenseState {
  token: string | null;
  status: LicenseStatus;
  lastVerifiedAt: number | null;
  serverSync: ServerSyncState;
  /** Import and verify a new license token. Returns the resulting status. */
  setLicenseToken: (token: string) => Promise<LicenseStatus>;
  /** Re-verify the stored token, typically after a setting change or startup. */
  revalidate: () => Promise<LicenseStatus>;
  /** Remove the token and return to the free tier. */
  clearLicense: () => Promise<LicenseStatus>;
}

const FREE_STATUS: LicenseStatus = { kind: 'free' };
const VERIFYING_STATUS: LicenseStatus = { kind: 'verifying' };

function resultToStatus(result: LicenseVerificationResult): LicenseStatus {
  if (!result.ok) {
    return { kind: 'invalid', reason: result.reason, message: result.message };
  }
  return { kind: result.state === 'grace' ? 'grace' : 'active', verification: result };
}

async function runVerifyWeb(token: string): Promise<LicenseStatus> {
  if (!PUBLIC_KEY_JWK) {
    return {
      kind: 'invalid',
      reason: 'no-public-key',
      message:
        'Build does not embed a license public key. Set VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK at build time.',
    };
  }
  const result = await verifyLicenseToken(token, PUBLIC_KEY_JWK);
  return resultToStatus(result);
}

/**
 * Map a server-side `licenses.status` field onto our local `LicenseStatus`.
 * The server has authoritative truth (it sees revocation + expiration + a
 * stricter clock than the client) so its verdict overrides local-verify.
 */
function serverStatusKindToStatus(
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
function serverFailureToInvalid(reason: LicenseServerFailureReason): LicenseStatus | null {
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

function decodeIssuedAt(token: string): number | null {
  const decoded = decodeLicenseToken(token);
  if (!decoded.ok) return null;
  const ms = Date.parse(decoded.payload.issuedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Detect the desktop IPC bridge at module-load time. Tests (vitest, JSDOM)
 * never set this, so they run the same web path as the production web build.
 * Slice 0 of RL-059 keeps the bridge optional — when absent we transparently
 * fall through to the local-verify + zustand-persist behavior that shipped
 * in the renderer-only iteration.
 */
function readLicenseBridge() {
  if (typeof window === 'undefined') return null;
  return window.lingua?.license ?? null;
}

const webStateCreator: StateCreator<LicenseState> = (set, get) => ({
  token: null,
  status: FREE_STATUS,
  lastVerifiedAt: null,
  serverSync: isLicenseServerEnabled() ? null : 'disabled',
  setLicenseToken: async (token) => {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      const invalid: LicenseStatus = { kind: 'invalid', reason: 'malformed' };
      set({ token: null, status: invalid, lastVerifiedAt: Date.now() });
      return invalid;
    }

    const localStatus = await runVerifyWeb(trimmed);
    if (localStatus.kind === 'invalid') {
      // Local signature / shape failure — server can't fix this. Preserve
      // the existing token if any so a hot-reload paste doesn't lose state.
      if (get().token) return localStatus;
      set({ token: null, status: localStatus, lastVerifiedAt: Date.now() });
      return localStatus;
    }

    // Server disabled (dev build): take the local-verify outcome and stop.
    if (!isLicenseServerEnabled()) {
      set({
        token: trimmed,
        status: localStatus,
        lastVerifiedAt: Date.now(),
        serverSync: 'disabled',
      });
      return localStatus;
    }

    // Show the transient verifying pill while the activate call runs.
    set({ token: trimmed, status: VERIFYING_STATUS, lastVerifiedAt: Date.now() });

    const deviceId = getOrMintDeviceId();
    const result: ActivateResult = await serverActivate({
      token: trimmed,
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
        token: trimmed,
        status: localStatus,
        lastVerifiedAt: Date.now(),
        serverSync: 'synced',
      });
      return localStatus;
    }

    if (result.reason === 'unreachable' || result.reason === 'server-error' || result.reason === 'not-implemented') {
      // 24-hour offline-grace per LICENSING_ADR Decision 4 — the token
      // is locally valid; the renderer will retry on the next page load
      // and synchronise the device count then.
      set({
        token: trimmed,
        status: localStatus,
        lastVerifiedAt: Date.now(),
        serverSync: 'unreachable',
      });
      return localStatus;
    }

    // Terminal server rejection: revoked / exhausted / invalid-token /
    // invalid-input. Map to a discrete invalid status. Keep the token in
    // state for `exhausted` so the user (or a future Slice 3 modal) can
    // remediate without re-pasting; wipe it for everything else.
    const invalid =
      serverFailureToInvalid(result.reason) ?? { kind: 'invalid' as const, reason: result.reason };
    const keepToken = result.reason === 'exhausted';
    set({
      token: keepToken ? trimmed : null,
      status: invalid,
      lastVerifiedAt: Date.now(),
      serverSync: 'synced',
    });
    return invalid;
  },
  revalidate: async () => {
    const { token } = get();
    if (!token) {
      set({ status: FREE_STATUS, lastVerifiedAt: Date.now() });
      return FREE_STATUS;
    }

    const localStatus = await runVerifyWeb(token);
    if (localStatus.kind === 'invalid') {
      // Stored token failed local verification (key rotation, tampering,
      // or expiry past grace) — wipe regardless of server reachability.
      set({ token: null, status: localStatus, lastVerifiedAt: Date.now() });
      return localStatus;
    }

    if (!isLicenseServerEnabled()) {
      set({
        status: localStatus,
        lastVerifiedAt: Date.now(),
        serverSync: 'disabled',
      });
      return localStatus;
    }

    const deviceId = getOrMintDeviceId();
    const result: StatusResult = await serverStatus({
      token,
      deviceId,
      surface: 'web',
    });

    if (result.ok) {
      // Pick up Monthly subscription `refreshedToken` only when its
      // `issuedAt` is strictly newer than the stored token's. Defends
      // against a rare stale-replica response from D1's read path.
      let activeToken = token;
      let activeStatus = localStatus;
      if (typeof result.refreshedToken === 'string' && result.refreshedToken !== token) {
        const oldIssuedAt = decodeIssuedAt(token);
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
      set({
        token: finalStatus.kind === 'invalid' ? null : activeToken,
        status: finalStatus,
        lastVerifiedAt: Date.now(),
        serverSync: 'synced',
      });
      return finalStatus;
    }

    if (result.reason === 'unreachable' || result.reason === 'server-error' || result.reason === 'not-implemented') {
      set({
        status: localStatus,
        lastVerifiedAt: Date.now(),
        serverSync: 'unreachable',
      });
      return localStatus;
    }

    const invalid =
      serverFailureToInvalid(result.reason) ?? { kind: 'invalid' as const, reason: result.reason };
    set({
      token: invalid.kind === 'invalid' && result.reason !== 'exhausted' ? null : token,
      status: invalid,
      lastVerifiedAt: Date.now(),
      serverSync: 'synced',
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
});

/**
 * Wire a `storage` listener that calls `revalidate()` when another tab
 * mutates `lingua-license` in localStorage. Zustand's persist middleware
 * already syncs the in-memory state across tabs via the same event, but
 * does not run our server roundtrip — this listener closes that gap so
 * a paste in tab A reaches D1 from tab B's perspective on the next
 * interaction.
 */
function attachCrossTabListener(store: { getState: () => LicenseState }): void {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
  window.addEventListener('storage', (event) => {
    if (event.key !== 'lingua-license') return;
    // Defer through a microtask so Zustand's persist sync runs first
    // and our revalidate sees the just-rehydrated token.
    queueMicrotask(() => {
      void store.getState().revalidate();
    });
  });
}

function createWebStore() {
  const store = create<LicenseState>()(
    persist(webStateCreator, {
      name: 'lingua-license',
      partialize: (state) => ({
        token: state.token,
        status: state.token ? state.status : FREE_STATUS,
        lastVerifiedAt: state.token ? state.lastVerifiedAt : null,
        serverSync: state.serverSync,
      }),
      onRehydrateStorage: () => () => {
        // Defer through a microtask so the `store` binding has finished
        // initializing by the time we touch `getState()` — persist v5
        // can fire this callback synchronously inside `create()`.
        queueMicrotask(() => {
          if (!store.getState().token) {
            return;
          }
          void store.getState().revalidate();
        });
      },
    })
  );
  attachCrossTabListener(store);
  return store;
}

type LicenseBridge = NonNullable<ReturnType<typeof readLicenseBridge>>;

function bridgeFailureStatus(reason: string, error: unknown): LicenseStatus {
  return {
    kind: 'invalid',
    reason,
    message: error instanceof Error ? error.message : String(error),
  };
}

function createDesktopStore(bridge: LicenseBridge) {
  // The async bootstrap below races against any user mutation that lands
  // before the snapshot resolves. Once a mutation has fired, the bootstrap
  // must NOT clobber it with the pre-mutation main snapshot — track that
  // here so every action becomes a barrier for the bootstrap apply.
  let bootstrapApplied = false;
  function markBootstrapped(): void {
    bootstrapApplied = true;
  }

  async function syncFromBridge(): Promise<void> {
    try {
      const snapshot = await bridge.getState();
      store.setState({
        token: snapshot.token,
        status: snapshot.status,
        lastVerifiedAt: snapshot.lastVerifiedAt,
      });
    } catch {
      // Best-effort resync; leave whatever local state we have if the
      // bridge itself is failing.
    }
  }

  const store = create<LicenseState>()((set) => ({
    token: null,
    status: FREE_STATUS,
    lastVerifiedAt: null,
    // Desktop owns truth via main-process verification (`src/main/license.ts`)
    // — `serverSync` is fixed to `'disabled'` so the Web-only "fell back
    // to local" notice never surfaces on desktop builds.
    serverSync: 'disabled' as const,
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
        set({
          token: result.snapshot.token,
          status: result.snapshot.status,
          lastVerifiedAt: result.snapshot.lastVerifiedAt,
        });
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
        set({
          token: result.snapshot.token,
          status: result.snapshot.status,
          lastVerifiedAt: result.snapshot.lastVerifiedAt,
        });
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
      set({ token: null, status: FREE_STATUS, lastVerifiedAt: Date.now() });
      try {
        const result = await bridge.clear();
        if (!result.ok) {
          await syncFromBridge();
          return { kind: 'invalid', reason: result.reason, message: result.message };
        }
        set({
          token: result.snapshot.token,
          status: result.snapshot.status,
          lastVerifiedAt: result.snapshot.lastVerifiedAt,
        });
        return result.snapshot.status;
      } catch (error) {
        await syncFromBridge();
        return bridgeFailureStatus('clear-failed', error);
      }
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
      store.setState({
        token: snapshot.token,
        status: snapshot.status,
        lastVerifiedAt: snapshot.lastVerifiedAt,
      });
    })
    .catch(() => {
      // Bridge errors leave the store at the free-tier defaults — main
      // surfaces its own crash reporter for the underlying failure.
      bootstrapApplied = true;
    });

  return store;
}

function createLicenseStore() {
  const bridge = readLicenseBridge();
  return bridge ? createDesktopStore(bridge) : createWebStore();
}

export const useLicenseStore = createLicenseStore();

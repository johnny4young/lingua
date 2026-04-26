import { create, type StateCreator } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type LicenseVerificationResult,
  verifyLicenseToken,
} from '../../shared/license';

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
  | { kind: 'invalid'; reason: string; message?: string }
  | { kind: 'active'; verification: Extract<LicenseVerificationResult, { ok: true }> }
  | { kind: 'grace'; verification: Extract<LicenseVerificationResult, { ok: true }> };

export interface LicenseState {
  token: string | null;
  status: LicenseStatus;
  lastVerifiedAt: number | null;
  /** Import and verify a new license token. Returns the resulting status. */
  setLicenseToken: (token: string) => Promise<LicenseStatus>;
  /** Re-verify the stored token, typically after a setting change or startup. */
  revalidate: () => Promise<LicenseStatus>;
  /** Remove the token and return to the free tier. */
  clearLicense: () => Promise<LicenseStatus>;
}

const FREE_STATUS: LicenseStatus = { kind: 'free' };

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
  setLicenseToken: async (token) => {
    const trimmed = token.trim();
    if (trimmed.length === 0) {
      const invalid: LicenseStatus = { kind: 'invalid', reason: 'malformed' };
      set({ token: null, status: invalid, lastVerifiedAt: Date.now() });
      return invalid;
    }
    const status = await runVerifyWeb(trimmed);
    if (status.kind === 'invalid' && get().token) {
      return status;
    }
    set({
      token: status.kind === 'invalid' ? null : trimmed,
      status,
      lastVerifiedAt: Date.now(),
    });
    return status;
  },
  revalidate: async () => {
    const { token } = get();
    if (!token) {
      set({ status: FREE_STATUS, lastVerifiedAt: Date.now() });
      return FREE_STATUS;
    }
    const status = await runVerifyWeb(token);
    set({
      token: status.kind === 'invalid' ? null : token,
      status,
      lastVerifiedAt: Date.now(),
    });
    return status;
  },
  clearLicense: async () => {
    set({ token: null, status: FREE_STATUS, lastVerifiedAt: Date.now() });
    return FREE_STATUS;
  },
});

function createWebStore() {
  const store = create<LicenseState>()(
    persist(webStateCreator, {
      name: 'lingua-license',
      partialize: (state) => ({
        token: state.token,
        status: state.token ? state.status : FREE_STATUS,
        lastVerifiedAt: state.token ? state.lastVerifiedAt : null,
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

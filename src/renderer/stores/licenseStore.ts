import { create } from 'zustand';
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
  clearLicense: () => void;
}

const FREE_STATUS: LicenseStatus = { kind: 'free' };

function resultToStatus(result: LicenseVerificationResult): LicenseStatus {
  if (!result.ok) {
    return { kind: 'invalid', reason: result.reason, message: result.message };
  }
  return { kind: result.state === 'grace' ? 'grace' : 'active', verification: result };
}

async function runVerify(token: string): Promise<LicenseStatus> {
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

export const useLicenseStore = create<LicenseState>()(
  persist(
    (set, get) => ({
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
        const status = await runVerify(trimmed);
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
        const status = await runVerify(token);
        set({
          token: status.kind === 'invalid' ? null : token,
          status,
          lastVerifiedAt: Date.now(),
        });
        return status;
      },
      clearLicense: () => {
        set({ token: null, status: FREE_STATUS, lastVerifiedAt: Date.now() });
      },
    }),
    {
      name: 'lingua-license',
      partialize: (state) => ({
        token: state.token,
        status: state.token ? state.status : FREE_STATUS,
        lastVerifiedAt: state.token ? state.lastVerifiedAt : null,
      }),
      onRehydrateStorage: () => () => {
        queueMicrotask(() => {
          if (!useLicenseStore.getState().token) {
            return;
          }
          void useLicenseStore.getState().revalidate();
        });
      },
    }
  )
);

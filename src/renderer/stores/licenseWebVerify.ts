import {
  type LicenseVerificationResult,
  verifyLicenseToken,
} from '../../shared/license';
import type { LicenseStatus } from './licenseTypes';

/**
 * RL-130 — web-flow token-verification primitives, extracted verbatim from
 * `licenseStore.ts`. Owns the embedded Ed25519 public key + the local verify
 * that the web store (and `attemptStaleTokenRefresh`) run before trusting any
 * token. Leaf: depends only on the shared verifier + the license types, never
 * on the store or action factories.
 *
 * SECURITY: this is the renderer's only local trust anchor. `PUBLIC_KEY_JWK`
 * is `null` until the issuer key is embedded at build time, so `runVerifyWeb`
 * rejects with `no-public-key` rather than silently "verifying" against nothing.
 */

/**
 * Public Ed25519 verification key. Populated at build time via a build-arg
 * when the issuer is live; until then the placeholder is `null` so
 * `setLicenseToken` rejects with a `no-public-key` result rather than
 * silently "verifying" against nothing. Keeping the env-read at module scope
 * means the renderer bundle embeds the key once instead of re-reading it on
 * every verification.
 */
export const PUBLIC_KEY_JWK: JsonWebKey | null = readEmbeddedPublicKey();

export function readEmbeddedPublicKey(): JsonWebKey | null {
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

export function resultToStatus(result: LicenseVerificationResult): LicenseStatus {
  if (!result.ok) {
    return { kind: 'invalid', reason: result.reason, message: result.message };
  }
  return { kind: result.state === 'grace' ? 'grace' : 'active', verification: result };
}

export async function runVerifyWeb(token: string): Promise<LicenseStatus> {
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

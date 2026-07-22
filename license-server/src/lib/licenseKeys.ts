/**
 * Production signing-key slot selection.
 *
 * The existing secret remains slot `current`; rotation prepares slot `next`
 * before compatible clients ship. Promotion is a non-secret Wrangler var
 * change from `current` to `next`, so the new private key never needs to be
 * exported from Cloudflare or kept in a local file between rollout phases.
 * After the retiring verification key is removed, the inactive slot may be
 * overwritten with the following rotation key and the selector toggled back.
 */

export type LicenseSigningKeySlot = 'current' | 'next';

export interface LicenseSigningKeyEnv {
  LINGUA_LICENSE_PRIVATE_KEY_JWK: string;
  LINGUA_LICENSE_NEXT_PRIVATE_KEY_JWK?: string;
  LINGUA_LICENSE_SIGNING_KEY_SLOT?: string;
}

export interface ResolvedSigningKey {
  slot: LicenseSigningKeySlot;
  privateKeyJwk: JsonWebKey;
}

function parsePrivateJwk(raw: string | undefined): JsonWebKey | null {
  if (!raw || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw) as JsonWebKey;
    return parsed.kty === 'OKP' &&
      parsed.crv === 'Ed25519' &&
      typeof parsed.x === 'string' &&
      typeof parsed.d === 'string'
      ? parsed
      : null;
  } catch {
    return null;
  }
}

export function resolveLicenseSigningKey(env: LicenseSigningKeyEnv): ResolvedSigningKey | null {
  const slot = env.LINGUA_LICENSE_SIGNING_KEY_SLOT ?? 'current';
  if (slot !== 'current' && slot !== 'next') return null;
  const raw =
    slot === 'next' ? env.LINGUA_LICENSE_NEXT_PRIVATE_KEY_JWK : env.LINGUA_LICENSE_PRIVATE_KEY_JWK;
  const privateKeyJwk = parsePrivateJwk(raw);
  return privateKeyJwk ? { slot, privateKeyJwk } : null;
}

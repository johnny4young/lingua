/**
 * Ed25519 sign + verify helpers for the license-server worker.
 *
 * Mirrors the verifier in `src/shared/license.ts` so a token minted here
 * round-trips against the renderer + main verifiers without translation.
 * The serialized format is `<base64url(payload)>.<base64url(signature)>`.
 *
 * Why hand-rolled (no @noble/ed25519 / tweetnacl): WebCrypto on Workers
 * already supports Ed25519 since `compatibility_flags = ["nodejs_compat"]`
 * is set in wrangler.toml. Adding a JS implementation would bloat the
 * worker bundle by 30-50KB for zero functional gain.
 *
 * implementation only signs tokens issued from the worker (Polar webhook +
 * future trial / education / recovery endpoints). Verification of
 * tokens received from clients (`/licenses/activate`, `/licenses/status`,
 * `/licenses/devices/remove`) uses the public key stored as a worker
 * secret so the bundle never embeds the keypair.
 */

export interface LicensePayload {
  /** Stable `licenses.id` row id used to recover the current row after token refresh. */
  licenseId?: string;
  productId: string;
  tier: 'pro' | 'pro_lifetime' | 'team' | 'trial' | 'education';
  issuedTo: string;
  issuedAt: string;
  supportWindowEndsAt: string;
  entitlements: readonly string[];
}

export type TokenSignFailure =
  | { ok: false; reason: 'invalid-private-key'; message?: string }
  | { ok: false; reason: 'subtle-unavailable'; message?: string };

export type TokenSignResult =
  | { ok: true; token: string }
  | TokenSignFailure;

export type TokenVerifyFailure =
  | { ok: false; reason: 'malformed'; message?: string }
  | { ok: false; reason: 'invalid-signature'; message?: string }
  | { ok: false; reason: 'invalid-public-key'; message?: string }
  | { ok: false; reason: 'unsupported-tier'; message?: string }
  | { ok: false; reason: 'subtle-unavailable'; message?: string };

export type TokenVerifyResult =
  | { ok: true; payload: LicensePayload; keyIndex: number }
  | TokenVerifyFailure;

const SUPPORTED_TIERS: ReadonlySet<LicensePayload['tier']> = new Set([
  'pro',
  'pro_lifetime',
  'team',
  'trial',
  'education',
]);
const MAX_LICENSE_PUBLIC_KEYS = 3;

function isEd25519PublicJwk(value: unknown): value is JsonWebKey {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as JsonWebKey;
  return (
    candidate.kty === 'OKP' &&
    candidate.crv === 'Ed25519' &&
    typeof candidate.x === 'string' &&
    candidate.x.length > 0 &&
    candidate.d === undefined
  );
}

/** Parse a backward-compatible single JWK or an ordered rotation keyring. */
export function parseLicensePublicKeyring(raw: string | undefined): readonly JsonWebKey[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const candidates = Array.isArray(parsed) ? parsed : [parsed];
  if (candidates.length === 0 || candidates.length > MAX_LICENSE_PUBLIC_KEYS) return [];
  if (!candidates.every(isEd25519PublicJwk)) return [];
  const identities = candidates.map(
    (candidate) => `${candidate.kty}:${candidate.crv}:${candidate.x}`
  );
  if (new Set(identities).size !== identities.length) return [];
  return candidates;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=+$/u, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value: string): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const padLength = (4 - (value.length % 4)) % 4;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  try {
    const binary = atob(normalized);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isValidPayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.licenseId !== undefined &&
    (typeof candidate.licenseId !== 'string' || candidate.licenseId.length === 0)
  ) {
    return false;
  }
  if (typeof candidate.productId !== 'string' || candidate.productId.length === 0) return false;
  if (typeof candidate.tier !== 'string') return false;
  if (typeof candidate.issuedTo !== 'string' || candidate.issuedTo.length === 0) return false;
  if (!isIsoTimestamp(candidate.issuedAt)) return false;
  if (!isIsoTimestamp(candidate.supportWindowEndsAt)) return false;
  if (!isStringArray(candidate.entitlements)) return false;
  return SUPPORTED_TIERS.has(candidate.tier as LicensePayload['tier']);
}

function getSubtle(): SubtleCrypto | null {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
  return null;
}

/**
 * Sign a payload with the issuer's Ed25519 private key (JWK format).
 * Returns the canonical `<payloadPart>.<signaturePart>` token string,
 * or a tagged-union failure shape.
 *
 * implementation callers:
 * - Polar webhook handler (mints a fresh token on `order.paid` and
 *   `subscription.created`).
 * - Polar webhook handler (re-mints on `subscription.updated` so the
 *   client picks up a refreshed `expires_at` via `/licenses/status`).
 *
 * Future implementation callers:
 * - `/trials/start` — mints `tier: 'trial'`.
 * - `/education/start` + `/education/renew` — mints `tier: 'education'`.
 * - `/licenses/recover` — re-emits the existing `licenses.token` row,
 *   does not call this signer (recovery does not change the token).
 */
export async function signLicenseToken(
  payload: LicensePayload,
  privateKeyJwk: JsonWebKey
): Promise<TokenSignResult> {
  const subtle = getSubtle();
  if (!subtle) {
    return { ok: false, reason: 'subtle-unavailable' };
  }

  let key: CryptoKey;
  try {
    key = await subtle.importKey('jwk', privateKeyJwk, { name: 'Ed25519' }, false, ['sign']);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-private-key',
      message: error instanceof Error ? error.message : 'Failed to import private key.',
    };
  }

  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadPart = base64UrlEncode(payloadBytes);
  const signingInput = new TextEncoder().encode(payloadPart);

  let signature: ArrayBuffer;
  try {
    signature = await subtle.sign({ name: 'Ed25519' }, key, signingInput as BufferSource);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-private-key',
      message: error instanceof Error ? error.message : 'Signing threw.',
    };
  }

  return { ok: true, token: `${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}` };
}

/**
 * Verify a token against the issuer's Ed25519 public key (JWK format).
 * Returns the parsed payload on success, or a tagged-union failure
 * shape that mirrors `src/shared/license.ts:LicenseFailureReason`.
 *
 * The `expires_at` window is NOT enforced here — the server treats
 * verification as "is this the issuer's signature on a well-formed
 * payload" only, and lets handlers decide whether the underlying
 * license row is still active. The client-side verifier (renderer +
 * main) handles the active/grace/expired window for offline gating.
 */
export async function verifyLicenseToken(
  token: string,
  publicKeyJwk: JsonWebKey | readonly JsonWebKey[]
): Promise<TokenVerifyResult> {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed', message: 'Token is empty.' };
  }
  const [payloadPart, signaturePart, ...rest] = token.split('.');
  if (!payloadPart || !signaturePart || rest.length > 0) {
    return { ok: false, reason: 'malformed', message: 'Expected payload.signature format.' };
  }

  const payloadBytes = base64UrlDecode(payloadPart);
  const signatureBytes = base64UrlDecode(signaturePart);
  if (!payloadBytes || !signatureBytes) {
    return { ok: false, reason: 'malformed', message: 'Token segments are not valid base64url.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: 'malformed', message: 'Payload is not valid JSON.' };
  }

  if (!isValidPayload(parsed)) {
    const maybeTier = (parsed as { tier?: unknown } | null)?.tier;
    if (typeof maybeTier === 'string' && !SUPPORTED_TIERS.has(maybeTier as LicensePayload['tier'])) {
      return { ok: false, reason: 'unsupported-tier', message: `Unknown tier "${maybeTier}".` };
    }
    return { ok: false, reason: 'malformed', message: 'Payload shape failed validation.' };
  }

  const subtle = getSubtle();
  if (!subtle) {
    return { ok: false, reason: 'subtle-unavailable' };
  }

  const signingInput = new TextEncoder().encode(payloadPart);
  const keyring = Array.isArray(publicKeyJwk) ? publicKeyJwk : [publicKeyJwk];
  if (keyring.length === 0) {
    return { ok: false, reason: 'invalid-public-key', message: 'Public keyring is empty.' };
  }

  let verified = false;
  let verifiedKeyIndex = -1;
  let importError: string | undefined;
  let verifyError: string | undefined;
  for (const [keyIndex, candidate] of keyring.entries()) {
    let key: CryptoKey;
    try {
      key = await subtle.importKey('jwk', candidate, { name: 'Ed25519' }, false, ['verify']);
    } catch (error) {
      importError ??= error instanceof Error ? error.message : 'Failed to import public key.';
      continue;
    }

    try {
      verified = await subtle.verify(
        { name: 'Ed25519' },
        key,
        signatureBytes as BufferSource,
        signingInput as BufferSource
      );
    } catch (error) {
      verifyError ??= error instanceof Error ? error.message : 'Verify threw.';
      continue;
    }
    if (verified) {
      verifiedKeyIndex = keyIndex;
      break;
    }
  }

  if (!verified) {
    if (keyring.length === 1 && importError) {
      return { ok: false, reason: 'invalid-public-key', message: importError };
    }
    if (keyring.length === 1 && verifyError) {
      return { ok: false, reason: 'invalid-signature', message: verifyError };
    }
    return { ok: false, reason: 'invalid-signature' };
  }

  return { ok: true, payload: parsed, keyIndex: verifiedKeyIndex };
}

/** Exposed only for tests that decode payloads without a public key. */
export { base64UrlDecode, base64UrlEncode };

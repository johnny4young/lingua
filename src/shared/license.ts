/**
 * License-token verification for RL-059.
 *
 * A Lingua license is a compact two-part string: `<payload>.<signature>` where
 * both parts are base64url-encoded. The payload is a JSON document produced
 * by the issuer and signed with Ed25519. The app embeds only the public key.
 *
 * Verification is split into:
 * - `decodeLicenseToken` — pure parsing (no crypto), returns the raw payload
 *   object or a discriminated failure. Handy for debugging and tests.
 * - `verifyLicenseToken` — decodes, signature-verifies with WebCrypto, and
 *   resolves entitlement state and, for a Pro Lifetime token, a separate
 *   included-updates window using the caller's timestamps.
 *
 * Never throws — every failure surface is represented by a discriminated
 * result so the renderer and main verifiers can handle them the same way.
 */

/**
 * Closed tier list accepted by every verifier. Keep this in sync with the
 * issuer and entitlement mapping; unknown string tiers are a hard reject so a
 * stale client never accidentally treats a new paid tier as Free.
 */
export const LICENSE_TIERS = ['free', 'pro', 'pro_lifetime', 'team', 'trial', 'education'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

/**
 * RL-059 hardening (audit B-3) — bind a token to the Lingua product
 * family. The signing key may issue tokens for more than one product;
 * without this a token minted for a DIFFERENT product under the same key
 * would satisfy the shape check and grant Lingua entitlements. Every
 * Lingua product id is namespaced under this prefix (`lingua`,
 * `lingua-desktop`, …), so a prefix match accepts the whole family while
 * rejecting a foreign `productId`. Exact-match is intentionally avoided
 * so new Lingua surfaces don't need a verifier change.
 */
export const LINGUA_PRODUCT_ID_PREFIX = 'lingua';

/** True when a productId belongs to the Lingua product family. */
export function isLinguaProductId(productId: string): boolean {
  return (
    productId === LINGUA_PRODUCT_ID_PREFIX ||
    productId.startsWith(`${LINGUA_PRODUCT_ID_PREFIX}-`) ||
    productId.startsWith(`${LINGUA_PRODUCT_ID_PREFIX}_`)
  );
}

export interface LicensePayload {
  /** Stable server-side license row id. Present on server-minted tokens. */
  licenseId?: string;
  productId: string;
  tier: LicenseTier;
  issuedTo: string;
  issuedAt: string;
  supportWindowEndsAt: string;
  entitlements: readonly string[];
}

export interface LicenseVerificationOptions {
  /** Milliseconds since epoch used as "now". Defaults to Date.now(). */
  now?: number;
  /**
   * How far past `supportWindowEndsAt` a license still verifies as `grace`
   * instead of `expired`. Defaults to 14 days (RL-059 default grace window).
   */
  gracePeriodMs?: number;
  /**
   * Clock-skew tolerance applied to the `issuedAt` field. Defaults to 24h;
   * tokens issued more than this ahead of `now` are rejected as clock-skew.
   */
  clockSkewMs?: number;
  /**
   * Build timestamp for the running app. It is advisory only: Pro Lifetime
   * entitlement never expires, but a build newer than its included-updates
   * window can show a non-blocking renewal notice.
   */
  buildDate?: string | number | null;
}

export type LicenseFailureReason =
  | 'malformed'
  | 'invalid-signature'
  | 'expired'
  | 'clock-skew'
  | 'unsupported-tier'
  | 'no-public-key';

export type LicenseVerificationResult =
  | {
      ok: true;
      payload: LicensePayload;
      /** `active` entitlement, or time-bound-tier offline grace. */
      state: 'active' | 'grace';
      supportWindowEndsAt: number;
      /**
       * Pro Lifetime's included-update cutoff. `null` for every other tier:
       * their entitlement is itself time-bound, so a separate update window
       * would be misleading.
       */
      updatesIncludedUntil: number | null;
      /**
       * True only for Pro Lifetime when the running build post-dates its
       * included-update cutoff. This is informational and never blocks Pro
       * entitlements.
       */
      updatesLapsed: boolean;
    }
  | {
      ok: false;
      reason: LicenseFailureReason;
      message?: string;
    };

export type DecodedLicense =
  | { ok: true; payload: LicensePayload; signature: Uint8Array; signingInput: Uint8Array }
  | { ok: false; reason: Extract<LicenseFailureReason, 'malformed' | 'unsupported-tier'>; message?: string };

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_GRACE_PERIOD_MS = 14 * DAY_MS;
const DEFAULT_CLOCK_SKEW_MS = DAY_MS;

/**
 * Decode unpadded RFC 4648 section 5 base64url. Returns null instead of
 * throwing so malformed user-pasted tokens stay on the discriminated
 * `malformed` path.
 */
function base64UrlDecode(value: string): Uint8Array | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  const padLength = (4 - (value.length % 4)) % 4;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLength);
  try {
    const binary = typeof atob === 'function' ? atob(normalized) : Buffer.from(normalized, 'base64').toString('binary');
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Encode without padding because license tokens are pasted and stored as
 * compact URL-safe strings. Exported for issuer/dev-token helpers and tests.
 */
export function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  const base64 =
    typeof btoa === 'function' ? btoa(binary) : Buffer.from(binary, 'binary').toString('base64');
  return base64.replace(/=+$/u, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const ms = Date.parse(value);
  return Number.isFinite(ms);
}

function parseTimestamp(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/**
 * Minimal structural validator for the signed JSON payload. It deliberately
 * does not interpret dates beyond "parseable ISO timestamp"; temporal policy
 * lives in `verifyLicenseToken` so tests and callers can control `now`.
 */
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
  // Bind the token to the Lingua product family (audit B-3): a token
  // minted for another product under the same signing key must not grant
  // Lingua entitlements.
  if (!isLinguaProductId(candidate.productId)) return false;
  if (typeof candidate.tier !== 'string') return false;
  if (typeof candidate.issuedTo !== 'string' || candidate.issuedTo.length === 0) return false;
  if (!isIsoTimestamp(candidate.issuedAt)) return false;
  if (!isIsoTimestamp(candidate.supportWindowEndsAt)) return false;
  if (!isStringArray(candidate.entitlements)) return false;
  return (LICENSE_TIERS as readonly string[]).includes(candidate.tier);
}

/**
 * Parse the two-segment token and validate signed payload shape without doing
 * crypto. `signingInput` is the original base64url payload segment, not the
 * decoded JSON bytes; Ed25519 must verify exactly the bytes the issuer signed.
 */
export function decodeLicenseToken(token: string): DecodedLicense {
  if (typeof token !== 'string' || token.length === 0) {
    return { ok: false, reason: 'malformed', message: 'License token is empty.' };
  }

  const [payloadPart, signaturePart, ...rest] = token.split('.');
  if (!payloadPart || !signaturePart || rest.length > 0) {
    return { ok: false, reason: 'malformed', message: 'Expected payload.signature format.' };
  }

  const payloadBytes = base64UrlDecode(payloadPart);
  const signature = base64UrlDecode(signaturePart);
  if (!payloadBytes || !signature) {
    return { ok: false, reason: 'malformed', message: 'License segments are not valid base64url.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return { ok: false, reason: 'malformed', message: 'Payload is not valid JSON.' };
  }

  if (!isValidPayload(parsed)) {
    const maybeTier = (parsed as { tier?: unknown } | null)?.tier;
    if (typeof maybeTier === 'string' && !(LICENSE_TIERS as readonly string[]).includes(maybeTier)) {
      return { ok: false, reason: 'unsupported-tier', message: `Unknown tier "${maybeTier}".` };
    }
    return { ok: false, reason: 'malformed', message: 'Payload shape failed validation.' };
  }

  return {
    ok: true,
    payload: parsed,
    signature,
    signingInput: new TextEncoder().encode(payloadPart),
  };
}

/**
 * Resolve WebCrypto from both browser/Electron globals and Node test globals.
 * Returning null keeps unsupported runtimes on a typed failure path.
 */
async function getSubtleCrypto(): Promise<SubtleCrypto | null> {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
}

/**
 * RFC 7638 §3 thumbprint of the embedded Ed25519 license public key:
 * SHA-256 over the canonical JSON holding only the required OKP members in
 * lexicographic order (`crv`, `kty`, `x`), base64url without padding
 * (43 chars). This is the stable key id used by the rotation registry
 * (`docs/security/license-key-registry.json`), the release-time rotation
 * guard, and the Settings → License fingerprint row. Must stay byte-equal
 * with `computeJwkThumbprint` in `scripts/lib/licenseKeyRotation.mjs` —
 * the twin equivalence is pinned by `tests/scripts/licenseKeyRotation.test.ts`.
 *
 * Returns null when the JWK is not the Ed25519 OKP public-key shape or
 * WebCrypto is unavailable, so UI callers hide the surface instead of
 * throwing.
 */
export async function computeLicenseJwkThumbprint(jwk: JsonWebKey): Promise<string | null> {
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string') return null;
  const subtle = await getSubtleCrypto();
  if (!subtle) return null;
  const canonical = `{"crv":${JSON.stringify(jwk.crv)},"kty":${JSON.stringify(jwk.kty)},"x":${JSON.stringify(jwk.x)}}`;
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Strip every JWK field that is not in RFC 8037 §2 for Ed25519
 * (`kty`, `crv`, `x`). Node 22+ webcrypto `exportKey('jwk', …)` adds
 * `alg: "Ed25519"`, `key_ops`, and `ext` to the public key; some
 * runtimes (notably Cloudflare Workers) reject `alg: "Ed25519"`
 * because the JOSE registry only defines `EdDSA` for this curve, and
 * `importKey` then fails with a vague `DataError`.
 *
 * The renderer + main share this verifier, so historical `.env`
 * values that still carry the foot-gun fields keep working after a
 * silent normalize. Mirrors `normalizeEd25519PublicJwk` in
 * `scripts/dev-license-shared.mjs` and the worker's
 * `license-server/src/lib/sign.ts` strip pattern.
 */
function normalizeEd25519PublicJwk(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x };
}

/**
 * Full verifier shared by renderer and main-process license paths. Signature
 * validity is checked before any clock-window decision so tampered-but-expired
 * tokens still report `invalid-signature`, not a misleading expiry state.
 */
export async function verifyLicenseToken(
  token: string,
  publicKeyJwk: JsonWebKey,
  options: LicenseVerificationOptions = {}
): Promise<LicenseVerificationResult> {
  const decoded = decodeLicenseToken(token);
  if (!decoded.ok) {
    return { ok: false, reason: decoded.reason, message: decoded.message };
  }

  const subtle = await getSubtleCrypto();
  if (!subtle) {
    return {
      ok: false,
      reason: 'invalid-signature',
      message: 'WebCrypto SubtleCrypto is not available in this environment.',
    };
  }

  let key: CryptoKey;
  try {
    // Defensive normalize before importKey — see
    // `normalizeEd25519PublicJwk` doc-comment for the Node 22+ /
    // Cloudflare Workers JWK divergence this protects against.
    const normalized = normalizeEd25519PublicJwk(publicKeyJwk);
    key = await subtle.importKey('jwk', normalized, { name: 'Ed25519' }, false, ['verify']);
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-signature',
      message: error instanceof Error ? error.message : 'Failed to import Ed25519 public key.',
    };
  }

  let verified: boolean;
  try {
    // `as BufferSource` keeps Node 20's SubtleCrypto typing quiet about Uint8Array<ArrayBufferLike>.
    verified = await subtle.verify(
      { name: 'Ed25519' },
      key,
      decoded.signature as BufferSource,
      decoded.signingInput as BufferSource
    );
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid-signature',
      message: error instanceof Error ? error.message : 'Signature verification threw.',
    };
  }

  if (!verified) {
    return { ok: false, reason: 'invalid-signature' };
  }

  const now = options.now ?? Date.now();
  const gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
  const clockSkewMs = options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS;

  const issuedAt = Date.parse(decoded.payload.issuedAt);
  const supportWindowEndsAt = Date.parse(decoded.payload.supportWindowEndsAt);

  if (issuedAt - clockSkewMs > now) {
    return { ok: false, reason: 'clock-skew', message: 'Token issuedAt is in the future.' };
  }

  const isLifetime = decoded.payload.tier === 'pro_lifetime';
  const updatesIncludedUntil = isLifetime ? supportWindowEndsAt : null;
  const buildDate = parseTimestamp(options.buildDate);
  const updatesLapsed =
    updatesIncludedUntil !== null && buildDate !== null && buildDate > updatesIncludedUntil;

  // A Pro Lifetime token grants perpetual Pro entitlement. Its support-window
  // timestamp is intentionally *not* an entitlement expiry: it only limits
  // the releases included with the original purchase. Revocation stays
  // authoritative through the license server when the app can sync.
  if (isLifetime) {
    return {
      ok: true,
      payload: decoded.payload,
      state: 'active',
      supportWindowEndsAt,
      updatesIncludedUntil,
      updatesLapsed,
    };
  }

  if (now > supportWindowEndsAt + gracePeriodMs) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    payload: decoded.payload,
    state: now <= supportWindowEndsAt ? 'active' : 'grace',
    supportWindowEndsAt,
    updatesIncludedUntil: null,
    updatesLapsed: false,
  };
}

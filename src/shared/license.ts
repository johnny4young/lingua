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
 *   resolves the window state (active / grace / expired) using the caller's
 *   "now" timestamp and a configurable grace window.
 *
 * Never throws — every failure surface is represented by a discriminated
 * result so the renderer and main verifiers can handle them the same way.
 */

export const LICENSE_TIERS = ['free', 'pro', 'pro_lifetime', 'team', 'trial', 'education'] as const;
export type LicenseTier = (typeof LICENSE_TIERS)[number];

export interface LicensePayload {
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
      /**
       * `active` when now is within the support window, `grace` when now is
       * between `supportWindowEndsAt` and `supportWindowEndsAt + grace`.
       */
      state: 'active' | 'grace';
      supportWindowEndsAt: number;
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

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isValidPayload(value: unknown): value is LicensePayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.productId !== 'string' || candidate.productId.length === 0) return false;
  if (typeof candidate.tier !== 'string') return false;
  if (typeof candidate.issuedTo !== 'string' || candidate.issuedTo.length === 0) return false;
  if (!isIsoTimestamp(candidate.issuedAt)) return false;
  if (!isIsoTimestamp(candidate.supportWindowEndsAt)) return false;
  if (!isStringArray(candidate.entitlements)) return false;
  return (LICENSE_TIERS as readonly string[]).includes(candidate.tier);
}

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

async function getSubtleCrypto(): Promise<SubtleCrypto | null> {
  if (typeof crypto !== 'undefined' && crypto.subtle) return crypto.subtle;
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
}

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
    key = await subtle.importKey('jwk', publicKeyJwk, { name: 'Ed25519' }, false, ['verify']);
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

  if (now > supportWindowEndsAt + gracePeriodMs) {
    return { ok: false, reason: 'expired' };
  }

  return {
    ok: true,
    payload: decoded.payload,
    state: now <= supportWindowEndsAt ? 'active' : 'grace',
    supportWindowEndsAt,
  };
}

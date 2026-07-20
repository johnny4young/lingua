/**
 * internal — JWT decode / verify / sign helper.
 *
 * Pure, offline, renderer-side. Wraps the Web Crypto API (available in
 * jsdom for tests, in Chromium for the web build, and in Electron's
 * Chromium renderer) so the same entry points work in every shell.
 *
 * This module is the extraction of `decodeJwt` (previously inlined in
 * `developerUtilities.ts`) plus the `verifyJwt` and `signJwt`
 * surfaces covering the full JWS algorithm families:
 *
 *   - HS256 / HS384 / HS512 — HMAC-SHA, shared secret pasted as string.
 *   - RS256 / RS384 / RS512 — RSASSA-PKCS1-v1_5 with the matching SHA
 *     hash, key pasted as JWK object.
 *   - ES256 / ES384 / ES512 — ECDSA with the matching curve
 *     (P-256 / P-384 / P-521 — the 512 name is a JWT spec quirk; the
 *     underlying curve is P-521). JWK pasted as JSON.
 *   - PS256 / PS384 / PS512 — RSA-PSS with the matching hash + salt
 *     length equal to the hash output in bytes (RFC 7518 §3.5).
 *     JWK pasted as JSON.
 *
 * The verify/sign surfaces return a tagged union so the panel can
 * render a pass/fail indicator without a try/catch wrapper. Unknown
 * errors surface as `{ ok: false, kind: 'unknown', message }` — the
 * panel translates to a localized copy; we never leak `DOMException`
 * text to end users.
 */

export interface JwtAnalysis {
  header: Record<string, unknown> | null;
  payload: Record<string, unknown> | null;
  signature: string | null;
  errorKey: string | null;
}

export const JWT_SUPPORTED_ALGORITHMS = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'ES256',
  'ES384',
  'ES512',
  'PS256',
  'PS384',
  'PS512',
] as const;

export type JwtAlgorithm = (typeof JWT_SUPPORTED_ALGORITHMS)[number];

export function isJwtAlgorithm(value: unknown): value is JwtAlgorithm {
  return (JWT_SUPPORTED_ALGORITHMS as readonly string[]).includes(value as string);
}

export type JwtVerifyError =
  | { kind: 'empty-token' }
  | { kind: 'malformed-token' }
  | { kind: 'empty-key' }
  | { kind: 'invalid-jwk' }
  | { kind: 'missing-alg' }
  | { kind: 'unsupported-algorithm'; claimed: string }
  | { kind: 'algorithm-mismatch'; claimed: string; expected: JwtAlgorithm }
  | { kind: 'signature-invalid' }
  | { kind: 'unknown'; message: string };

export type JwtVerifyWarning = { kind: 'weak-hs-key'; minBytes: number };

/**
 * Verify result mirrors Sign: on `ok: true` the caller always gets the
 * header + payload back, with an optional `warning` when the signature
 * validated but the key material is below best-practice. That way a
 * weak-key token still surfaces its decoded claims in the UI instead
 * of being dropped on the floor.
 */
export type JwtVerifyResult =
  | {
      ok: true;
      header: Record<string, unknown>;
      payload: Record<string, unknown>;
      warning?: JwtVerifyWarning;
    }
  | ({ ok: false } & JwtVerifyError);

export type JwtSignError =
  | { kind: 'invalid-header' }
  | { kind: 'invalid-payload' }
  | { kind: 'empty-key' }
  | { kind: 'invalid-jwk' }
  | { kind: 'unsupported-algorithm'; claimed: string }
  | { kind: 'unknown'; message: string };

export type JwtSignWarning = { kind: 'weak-hs-key'; minBytes: number };

export type JwtSignResult =
  | { ok: true; token: string; warning?: JwtSignWarning }
  | ({ ok: false } & JwtSignError);

/**
 * Minimum secret length for HS256/384/512 in bytes. RFC 7518 §3.2 says
 * the HMAC key MUST be the same length as the hash output (32/48/64
 * bytes). Under that we return `weak-hs-key` rather than refuse — the
 * library will still sign and verify correctly, but the panel surfaces
 * a warning so users don't ship dev tokens with a 6-byte secret.
 */
const HS_MIN_KEY_BYTES: Readonly<Record<'HS256' | 'HS384' | 'HS512', number>> = {
  HS256: 32,
  HS384: 48,
  HS512: 64,
};

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded =
    padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function textToBytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function hsHashAlgorithm(algorithm: 'HS256' | 'HS384' | 'HS512'): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  if (algorithm === 'HS256') return 'SHA-256';
  if (algorithm === 'HS384') return 'SHA-384';
  return 'SHA-512';
}

// Algorithm-family guards. Every JWS algorithm maps to exactly one
// family (HS / RS / ES / PS); the tuple order is intentional so
// `JWT_SUPPORTED_ALGORITHMS[i]` for a known prefix resolves in O(1).
function isHsAlgorithm(algorithm: JwtAlgorithm): algorithm is 'HS256' | 'HS384' | 'HS512' {
  return algorithm.startsWith('HS');
}

type EsAlgorithm = 'ES256' | 'ES384' | 'ES512';
function isEsAlgorithm(algorithm: JwtAlgorithm): algorithm is EsAlgorithm {
  return algorithm.startsWith('ES');
}

type PsAlgorithm = 'PS256' | 'PS384' | 'PS512';
function isPsAlgorithm(algorithm: JwtAlgorithm): algorithm is PsAlgorithm {
  return algorithm.startsWith('PS');
}

type RsAlgorithm = 'RS256' | 'RS384' | 'RS512';

// RS-family guard covering the full RSASSA-PKCS1-v1_5 set. Narrows via
// the RS prefix so any future additions need a matching case in
// rsaHashForAlgorithm / importRsaKey rather than falling through to the
// exhaustive `never` tail.
function isRsAlgorithm(algorithm: JwtAlgorithm): algorithm is RsAlgorithm {
  return algorithm.startsWith('RS');
}

function esCurveForAlgorithm(algorithm: EsAlgorithm): 'P-256' | 'P-384' | 'P-521' {
  if (algorithm === 'ES256') return 'P-256';
  if (algorithm === 'ES384') return 'P-384';
  // ES512 pairs with curve P-521 (JWT spec quirk — the name refers to
  // the SHA-512 hash, not the 512-bit curve). RFC 7518 §3.4 pins this.
  return 'P-521';
}

function esHashForAlgorithm(algorithm: EsAlgorithm): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  if (algorithm === 'ES256') return 'SHA-256';
  if (algorithm === 'ES384') return 'SHA-384';
  return 'SHA-512';
}

function psHashForAlgorithm(algorithm: PsAlgorithm): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  if (algorithm === 'PS256') return 'SHA-256';
  if (algorithm === 'PS384') return 'SHA-384';
  return 'SHA-512';
}

/**
 * Salt length for RSA-PSS in bytes. RFC 7518 §3.5 requires the salt
 * length to equal the hash output — 32 for SHA-256, 48 for SHA-384,
 * 64 for SHA-512. Web Crypto defaults to the same value, but we pass
 * it explicitly so the intent is visible on the line and future
 * test-vector compat stays trivial to verify.
 */
function psSaltLengthForAlgorithm(algorithm: PsAlgorithm): number {
  if (algorithm === 'PS256') return 32;
  if (algorithm === 'PS384') return 48;
  return 64;
}

// ---------------------------------------------------------------------------
// Decode (extracted from developerUtilities.ts — identical semantics)
// ---------------------------------------------------------------------------

export function decodeJwt(value: string): JwtAnalysis {
  const trimmed = value.trim();
  if (!trimmed) {
    return { header: null, payload: null, signature: null, errorKey: null };
  }

  const [headerPart, payloadPart, signaturePart] = trimmed.split('.');
  if (!headerPart || !payloadPart) {
    return {
      header: null,
      payload: null,
      signature: null,
      errorKey: 'utilities.tool.jwt.errorSegments',
    };
  }

  try {
    const header = parseJsonObject(new TextDecoder().decode(base64UrlToBytes(headerPart)));
    const payload = parseJsonObject(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
    if (!header || !payload) {
      return {
        header,
        payload,
        signature: signaturePart ?? null,
        errorKey: 'utilities.tool.jwt.errorObject',
      };
    }
    return {
      header,
      payload,
      signature: signaturePart ?? null,
      errorKey: null,
    };
  } catch {
    return {
      header: null,
      payload: null,
      signature: signaturePart ?? null,
      errorKey: 'utilities.tool.jwt.error',
    };
  }
}

// ---------------------------------------------------------------------------
// Verify
// ---------------------------------------------------------------------------

/**
 * Verify `token` against `key` + `expectedAlgorithm`. Returns
 * `{ ok: true, header, payload }` on success; tagged-union errors
 * otherwise. `key` is a string for HS*, a JWK JSON string for RS256.
 */
export async function verifyJwt(
  token: string,
  key: string,
  expectedAlgorithm: JwtAlgorithm
): Promise<JwtVerifyResult> {
  const trimmedToken = token.trim();
  if (!trimmedToken) return { ok: false, kind: 'empty-token' };
  if (!key) return { ok: false, kind: 'empty-key' };

  const parts = trimmedToken.split('.');
  if (parts.length !== 3) return { ok: false, kind: 'malformed-token' };
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) {
    return { ok: false, kind: 'malformed-token' };
  }

  let header: Record<string, unknown> | null;
  let payload: Record<string, unknown> | null;
  try {
    header = parseJsonObject(new TextDecoder().decode(base64UrlToBytes(headerPart)));
    payload = parseJsonObject(new TextDecoder().decode(base64UrlToBytes(payloadPart)));
  } catch (error) {
    return {
      ok: false,
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
  if (!header || !payload) return { ok: false, kind: 'malformed-token' };

  const alg = typeof header['alg'] === 'string' ? (header['alg'] as string) : null;
  if (!alg) return { ok: false, kind: 'missing-alg' };
  if (!isJwtAlgorithm(alg)) return { ok: false, kind: 'unsupported-algorithm', claimed: alg };
  if (alg !== expectedAlgorithm) {
    return { ok: false, kind: 'algorithm-mismatch', claimed: alg, expected: expectedAlgorithm };
  }

  const signingInput = textToBytes(`${headerPart}.${payloadPart}`);
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlToBytes(signaturePart);
  } catch {
    return { ok: false, kind: 'malformed-token' };
  }

  try {
    if (isHsAlgorithm(expectedAlgorithm)) {
      const keyBytes = textToBytes(key);
      const minBytes = HS_MIN_KEY_BYTES[expectedAlgorithm];
      const valid = await runHmacVerify(expectedAlgorithm, keyBytes, signatureBytes, signingInput);
      if (!valid) return { ok: false, kind: 'signature-invalid' };
      // Signature validated. If the key was shorter than the hash
      // length, still hand back header + payload — the panel decorates
      // with a weak-key warning alongside the decoded claims instead of
      // dropping the verified token on the floor.
      if (keyBytes.byteLength < minBytes) {
        return { ok: true, header, payload, warning: { kind: 'weak-hs-key', minBytes } };
      }
      return { ok: true, header, payload };
    }

    if (isEsAlgorithm(expectedAlgorithm)) {
      const jwk = parseJsonObject(key);
      if (!jwk) return { ok: false, kind: 'invalid-jwk' };
      const cryptoKey = await importEcdsaKey(jwk, expectedAlgorithm, ['verify']);
      const valid = await crypto.subtle.verify(
        { name: 'ECDSA', hash: { name: esHashForAlgorithm(expectedAlgorithm) } },
        cryptoKey,
        signatureBytes as BufferSource,
        signingInput as BufferSource
      );
      if (!valid) return { ok: false, kind: 'signature-invalid' };
      return { ok: true, header, payload };
    }

    if (isPsAlgorithm(expectedAlgorithm)) {
      const jwk = parseJsonObject(key);
      if (!jwk) return { ok: false, kind: 'invalid-jwk' };
      const cryptoKey = await importRsaPssKey(jwk, expectedAlgorithm, ['verify']);
      const valid = await crypto.subtle.verify(
        { name: 'RSA-PSS', saltLength: psSaltLengthForAlgorithm(expectedAlgorithm) },
        cryptoKey,
        signatureBytes as BufferSource,
        signingInput as BufferSource
      );
      if (!valid) return { ok: false, kind: 'signature-invalid' };
      return { ok: true, header, payload };
    }

    if (isRsAlgorithm(expectedAlgorithm)) {
      // RSASSA-PKCS1-v1_5 for the full RS family (RS256 / RS384 / RS512).
      // rsaHashForAlgorithm picks the hash per algorithm and importRsaKey
      // embeds it at key-import time, so the verify / sign call itself
      // needs no hash parameter.
      const jwk = parseJsonObject(key);
      if (!jwk) return { ok: false, kind: 'invalid-jwk' };
      const cryptoKey = await importRsaKey(jwk, expectedAlgorithm, ['verify']);
      const valid = await crypto.subtle.verify(
        { name: 'RSASSA-PKCS1-v1_5' },
        cryptoKey,
        signatureBytes as BufferSource,
        signingInput as BufferSource
      );
      if (!valid) return { ok: false, kind: 'signature-invalid' };
      return { ok: true, header, payload };
    }

    // Exhaustive: every member of JWT_SUPPORTED_ALGORITHMS has a
    // branch above. This throw is a belt-and-braces guard for runtime —
    // TypeScript narrows `expectedAlgorithm` to `never` here.
    const _exhaustive: never = expectedAlgorithm;
    throw new Error(`Unhandled JWT algorithm: ${_exhaustive as string}`);
  } catch (error) {
    // importKey rejects malformed JWK with a DOMException — classify as
    // invalid-jwk to give the user an actionable message instead.
    if (error instanceof Error && /JWK|key/i.test(error.message)) {
      return { ok: false, kind: 'invalid-jwk' };
    }
    return {
      ok: false,
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runHmacVerify(
  algorithm: 'HS256' | 'HS384' | 'HS512',
  keyBytes: Uint8Array,
  signature: Uint8Array,
  data: Uint8Array
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    'raw',
    keyBytes as BufferSource,
    { name: 'HMAC', hash: { name: hsHashAlgorithm(algorithm) } },
    false,
    ['verify']
  );
  return crypto.subtle.verify(
    { name: 'HMAC' },
    key,
    signature as BufferSource,
    data as BufferSource
  );
}

// Narrowed to the RS* literal union so any future RS-family addition
// needs an explicit case here — the exhaustive switch turns a missing
// branch into a compile-time error instead of a runtime throw.
function rsaHashForAlgorithm(algorithm: RsAlgorithm): 'SHA-256' | 'SHA-384' | 'SHA-512' {
  if (algorithm === 'RS256') return 'SHA-256';
  if (algorithm === 'RS384') return 'SHA-384';
  return 'SHA-512';
}

async function importRsaKey(
  jwk: Record<string, unknown>,
  algorithm: RsAlgorithm,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSASSA-PKCS1-v1_5', hash: { name: rsaHashForAlgorithm(algorithm) } },
    false,
    usages
  );
}

async function importEcdsaKey(
  jwk: Record<string, unknown>,
  algorithm: EsAlgorithm,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  // The JWK itself carries `crv` (P-256 / P-384 / P-521). If the user
  // pastes a JWK whose curve disagrees with the selected algorithm,
  // Web Crypto rejects the import with a DOMException — the
  // outer catch translates that to `invalid-jwk` for the panel.
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'ECDSA', namedCurve: esCurveForAlgorithm(algorithm) },
    false,
    usages
  );
}

async function importRsaPssKey(
  jwk: Record<string, unknown>,
  algorithm: PsAlgorithm,
  usages: KeyUsage[]
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'jwk',
    jwk as JsonWebKey,
    { name: 'RSA-PSS', hash: { name: psHashForAlgorithm(algorithm) } },
    false,
    usages
  );
}

// ---------------------------------------------------------------------------
// Sign
// ---------------------------------------------------------------------------

/**
 * Sign an arbitrary header + payload (parsed JSON objects) with the
 * given key + algorithm. The caller is responsible for making sure the
 * header's `alg` claim matches `algorithm` — the helper overrides it
 * anyway so a stale claim cannot produce a bogus token.
 *
 * `headerJson` and `payloadJson` are the raw strings the user typed in
 * the panel; we parse them here so the panel can forward typo-level
 * errors (invalid JSON) as tagged-union results.
 */
export async function signJwt(
  headerJson: string,
  payloadJson: string,
  key: string,
  algorithm: JwtAlgorithm
): Promise<JwtSignResult> {
  const header = parseJsonObject(headerJson);
  if (!header) return { ok: false, kind: 'invalid-header' };
  const payload = parseJsonObject(payloadJson);
  if (!payload) return { ok: false, kind: 'invalid-payload' };
  if (!key) return { ok: false, kind: 'empty-key' };
  if (!isJwtAlgorithm(algorithm)) {
    return { ok: false, kind: 'unsupported-algorithm', claimed: algorithm };
  }

  // Always overwrite the header's `alg` claim so it matches the signing
  // algorithm. This prevents the class of bug where a copy-pasted header
  // still says HS256 but the user picked RS256 in the dropdown.
  const finalHeader = { ...header, alg: algorithm, typ: header['typ'] ?? 'JWT' };
  const headerPart = bytesToBase64Url(textToBytes(JSON.stringify(finalHeader)));
  const payloadPart = bytesToBase64Url(textToBytes(JSON.stringify(payload)));
  const signingInput = textToBytes(`${headerPart}.${payloadPart}`);

  try {
    let signatureBytes: Uint8Array;
    let warning: JwtSignWarning | undefined;

    if (isHsAlgorithm(algorithm)) {
      const keyBytes = textToBytes(key);
      const minBytes = HS_MIN_KEY_BYTES[algorithm];
      if (keyBytes.byteLength < minBytes) {
        warning = { kind: 'weak-hs-key', minBytes };
      }
      const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyBytes as BufferSource,
        { name: 'HMAC', hash: { name: hsHashAlgorithm(algorithm) } },
        false,
        ['sign']
      );
      const sig = await crypto.subtle.sign({ name: 'HMAC' }, cryptoKey, signingInput as BufferSource);
      signatureBytes = new Uint8Array(sig);
    } else if (isEsAlgorithm(algorithm)) {
      // ECDSA JWK with `d` (private key). Web Crypto emits IEEE P1363
      // raw-r-s concatenation — that's exactly what JWS (RFC 7515 §3.3)
      // requires, so no DER conversion is needed.
      const jwk = parseJsonObject(key);
      if (!jwk) return { ok: false, kind: 'invalid-jwk' };
      const cryptoKey = await importEcdsaKey(jwk, algorithm, ['sign']);
      const sig = await crypto.subtle.sign(
        { name: 'ECDSA', hash: { name: esHashForAlgorithm(algorithm) } },
        cryptoKey,
        signingInput as BufferSource
      );
      signatureBytes = new Uint8Array(sig);
    } else if (isPsAlgorithm(algorithm)) {
      // RSA-PSS JWK with `d` (private key). Salt length = hash output
      // in bytes per RFC 7518 §3.5.
      const jwk = parseJsonObject(key);
      if (!jwk) return { ok: false, kind: 'invalid-jwk' };
      const cryptoKey = await importRsaPssKey(jwk, algorithm, ['sign']);
      const sig = await crypto.subtle.sign(
        { name: 'RSA-PSS', saltLength: psSaltLengthForAlgorithm(algorithm) },
        cryptoKey,
        signingInput as BufferSource
      );
      signatureBytes = new Uint8Array(sig);
    } else if (isRsAlgorithm(algorithm)) {
      // RSASSA-PKCS1-v1_5 for the full RS family (RS256 / RS384 / RS512).
      // rsaHashForAlgorithm picks the hash per algorithm and importRsaKey
      // embeds it at key-import time, so the verify / sign call itself
      // needs no hash parameter.
      const jwk = parseJsonObject(key);
      if (!jwk) return { ok: false, kind: 'invalid-jwk' };
      const cryptoKey = await importRsaKey(jwk, algorithm, ['sign']);
      const sig = await crypto.subtle.sign(
        { name: 'RSASSA-PKCS1-v1_5' },
        cryptoKey,
        signingInput as BufferSource
      );
      signatureBytes = new Uint8Array(sig);
    } else {
      // Exhaustive: every member of JWT_SUPPORTED_ALGORITHMS has a
      // branch above. Narrow to `never` so a future addition is a
      // compile-time error if the author forgets to extend this switch.
      const _exhaustive: never = algorithm;
      return { ok: false, kind: 'unsupported-algorithm', claimed: _exhaustive as string };
    }

    const token = `${headerPart}.${payloadPart}.${bytesToBase64Url(signatureBytes)}`;
    // Always return the token on success. `warning` is optional so the
    // panel can still show a "weak key" notice without losing the
    // usable output — refusing to sign over a length check would
    // throw away a correct signature.
    return warning ? { ok: true, token, warning } : { ok: true, token };
  } catch (error) {
    if (error instanceof Error && /JWK|key/i.test(error.message)) {
      return { ok: false, kind: 'invalid-jwk' };
    }
    return {
      ok: false,
      kind: 'unknown',
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

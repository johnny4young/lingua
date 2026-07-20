/**
 * Test-only helpers for exercising the internal license verifier. Kept out of
 * `src/shared/license.ts` so a signing primitive can never accidentally
 * ship in the renderer or main bundle — only the verifier is allowed to
 * live in production code.
 */

import { base64UrlEncode, type LicensePayload } from '../../src/shared/license';

/**
 * Produce a signed license token from a payload + Ed25519 keypair JWK.
 * Mirrors the issuer's signing contract so test fixtures can stand in for
 * the real back-end without embedding real keys in the repo.
 */
export async function signLicenseTokenForTest(
  payload: LicensePayload,
  privateKeyJwk: JsonWebKey
): Promise<string> {
  const subtle = crypto.subtle;
  if (!subtle) {
    throw new Error('WebCrypto SubtleCrypto is required to sign test tokens.');
  }
  const key = await subtle.importKey('jwk', privateKeyJwk, { name: 'Ed25519' }, false, ['sign']);
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const payloadPart = base64UrlEncode(payloadBytes);
  const signingInput = new TextEncoder().encode(payloadPart);
  const signature = await subtle.sign({ name: 'Ed25519' }, key, signingInput as BufferSource);
  return `${payloadPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

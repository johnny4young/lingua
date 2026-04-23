import { describe, expect, it } from 'vitest';
import {
  JWT_SUPPORTED_ALGORITHMS,
  decodeJwt,
  isJwtAlgorithm,
  signJwt,
  verifyJwt,
  type JwtAlgorithm,
} from '@/utils/jwt';

const HS_SECRET_32 = 'this-secret-is-exactly-32-bytes!';
const HS_SECRET_48 = 'a-much-longer-48-byte-secret-for-hs384-round-trip';
const HS_SECRET_64 =
  'and-an-even-longer-64-byte-secret-for-hs512-round-trip-use-ok!!!';

/** Generate an RSA JWK keypair for RS256 sign/verify coverage. */
async function generateRsaJwkPair(): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { privateJwk, publicJwk };
}

describe('isJwtAlgorithm + JWT_SUPPORTED_ALGORITHMS', () => {
  it('enumerates HS256 / HS384 / HS512 / RS256 and rejects unknowns', () => {
    expect([...JWT_SUPPORTED_ALGORITHMS]).toEqual(['HS256', 'HS384', 'HS512', 'RS256']);
    for (const alg of JWT_SUPPORTED_ALGORITHMS) expect(isJwtAlgorithm(alg)).toBe(true);
    expect(isJwtAlgorithm('ES256')).toBe(false);
    expect(isJwtAlgorithm('none')).toBe(false);
    expect(isJwtAlgorithm(null)).toBe(false);
  });
});

describe('decodeJwt (extracted module)', () => {
  it('decodes a well-formed HS256 token into header + payload', () => {
    // Hand-crafted token so decode is isolated from sign.
    const token =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMiLCJuYW1lIjoiSmFuZSJ9.ignored';
    const result = decodeJwt(token);
    expect(result.header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
    expect(result.payload).toMatchObject({ sub: '123', name: 'Jane' });
    expect(result.errorKey).toBeNull();
  });

  it('returns a blank result for an empty input without error flagging', () => {
    expect(decodeJwt('')).toEqual({
      header: null,
      payload: null,
      signature: null,
      errorKey: null,
    });
  });

  it('flags a malformed token with the segment error key', () => {
    const result = decodeJwt('not-a-jwt');
    expect(result.errorKey).toBe('utilities.tool.jwt.errorSegments');
  });
});

describe('signJwt', () => {
  it('produces a 3-segment HS256 token the RFC recognizes', async () => {
    const result = await signJwt('{"alg":"HS256","typ":"JWT"}', '{"sub":"test"}', HS_SECRET_32, 'HS256');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.token.split('.')).toHaveLength(3);
      expect(result.warning).toBeUndefined();
      const decoded = decodeJwt(result.token);
      expect(decoded.header).toMatchObject({ alg: 'HS256', typ: 'JWT' });
      expect(decoded.payload).toMatchObject({ sub: 'test' });
    }
  });

  it('overwrites a stale `alg` claim in the header to match the signing algorithm', async () => {
    const result = await signJwt(
      // Header says HS256 but caller selected HS512 — we must not trust
      // the stale claim; the sign path rewrites it.
      '{"alg":"HS256","typ":"JWT"}',
      '{"sub":"test"}',
      HS_SECRET_64,
      'HS512'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      const decoded = decodeJwt(result.token);
      expect(decoded.header).toMatchObject({ alg: 'HS512' });
    }
  });

  it('refuses an invalid-JSON header with the discriminated union', async () => {
    const result = await signJwt('not json', '{"sub":"test"}', HS_SECRET_32, 'HS256');
    expect(result).toMatchObject({ ok: false, kind: 'invalid-header' });
  });

  it('refuses an invalid-JSON payload', async () => {
    const result = await signJwt('{}', 'not json', HS_SECRET_32, 'HS256');
    expect(result).toMatchObject({ ok: false, kind: 'invalid-payload' });
  });

  it('refuses an empty key', async () => {
    const result = await signJwt('{}', '{}', '', 'HS256');
    expect(result).toMatchObject({ ok: false, kind: 'empty-key' });
  });

  it('attaches a weak-hs-key warning when the secret is under the hash length', async () => {
    const result = await signJwt('{}', '{}', 'too-short', 'HS256');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warning).toMatchObject({ kind: 'weak-hs-key', minBytes: 32 });
      expect(result.token.split('.')).toHaveLength(3);
    }
  });

  it('refuses a non-JWK string in the RSA slot with invalid-jwk', async () => {
    const result = await signJwt('{}', '{}', 'not a jwk', 'RS256');
    expect(result).toMatchObject({ ok: false, kind: 'invalid-jwk' });
  });
});

describe('verifyJwt', () => {
  it('round-trips sign → verify for every HS variant', async () => {
    const cases: [JwtAlgorithm, string][] = [
      ['HS256', HS_SECRET_32],
      ['HS384', HS_SECRET_48],
      ['HS512', HS_SECRET_64],
    ];
    for (const [algorithm, key] of cases) {
      const signed = await signJwt('{}', '{"sub":"round"}', key, algorithm);
      expect(signed.ok).toBe(true);
      if (!signed.ok) continue;
      const verified = await verifyJwt(signed.token, key, algorithm);
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload).toMatchObject({ sub: 'round' });
      }
    }
  });

  it('fails a tampered payload with signature-invalid', async () => {
    const signed = await signJwt('{}', '{"sub":"ok"}', HS_SECRET_32, 'HS256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const [h, _p, s] = signed.token.split('.');
    // Swap the middle segment to a different payload. The signature
    // was computed over the original — verification must refuse.
    const tamperedPayload = Buffer.from('{"sub":"evil"}').toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    const result = await verifyJwt(tampered, HS_SECRET_32, 'HS256');
    expect(result).toMatchObject({ ok: false, kind: 'signature-invalid' });
  });

  it('fails with algorithm-mismatch when the header claim does not match the expected algorithm', async () => {
    const signed = await signJwt('{}', '{}', HS_SECRET_32, 'HS256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const result = await verifyJwt(signed.token, HS_SECRET_32, 'HS512');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'algorithm-mismatch') {
      expect(result.claimed).toBe('HS256');
      expect(result.expected).toBe('HS512');
    }
  });

  it('rejects a token with a missing alg claim', async () => {
    // Header { typ: JWT } — no alg.
    const header = Buffer.from('{"typ":"JWT"}').toString('base64url');
    const payload = Buffer.from('{}').toString('base64url');
    const sig = Buffer.from('anything').toString('base64url');
    const result = await verifyJwt(`${header}.${payload}.${sig}`, HS_SECRET_32, 'HS256');
    expect(result).toMatchObject({ ok: false, kind: 'missing-alg' });
  });

  it('rejects a token whose claimed alg is outside the supported set', async () => {
    const header = Buffer.from('{"alg":"ES256"}').toString('base64url');
    const payload = Buffer.from('{}').toString('base64url');
    const sig = Buffer.from('anything').toString('base64url');
    const result = await verifyJwt(`${header}.${payload}.${sig}`, HS_SECRET_32, 'HS256');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'unsupported-algorithm') {
      expect(result.claimed).toBe('ES256');
    }
  });

  it('still returns ok: true with the payload when the HS key is weak, attaching a warning', async () => {
    const signed = await signJwt('{}', '{"sub":"weak"}', 'too-short', 'HS256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const result = await verifyJwt(signed.token, 'too-short', 'HS256');
    // Weak-key branch: signature is valid so we keep ok: true and
    // surface the warning alongside the payload. The panel decorates
    // the PASS indicator with the warning without dropping the claims.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload).toMatchObject({ sub: 'weak' });
      expect(result.warning).toMatchObject({ kind: 'weak-hs-key', minBytes: 32 });
    }
  });

  it('refuses an empty token / empty key up front', async () => {
    expect(await verifyJwt('', HS_SECRET_32, 'HS256')).toMatchObject({
      ok: false,
      kind: 'empty-token',
    });
    expect(await verifyJwt('a.b.c', '', 'HS256')).toMatchObject({
      ok: false,
      kind: 'empty-key',
    });
  });

  it('refuses a malformed (non-3-segment) token', async () => {
    const result = await verifyJwt('a.b', HS_SECRET_32, 'HS256');
    expect(result).toMatchObject({ ok: false, kind: 'malformed-token' });
  });

  it('round-trips sign → verify for RS256 with a generated JWK keypair', async () => {
    const { privateJwk, publicJwk } = await generateRsaJwkPair();
    const signed = await signJwt('{}', '{"sub":"rsa"}', JSON.stringify(privateJwk), 'RS256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const verified = await verifyJwt(signed.token, JSON.stringify(publicJwk), 'RS256');
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.payload).toMatchObject({ sub: 'rsa' });
    }
  }, 15_000);

  it('rejects RS256 verify with invalid-jwk when the key is not parseable JSON', async () => {
    // Build a well-formed RS256 token so we reach the JWK import path
    // (a malformed token would short-circuit earlier with
    // malformed-token or unknown before we ever look at the key).
    const { privateJwk } = await generateRsaJwkPair();
    const signed = await signJwt('{}', '{"sub":"x"}', JSON.stringify(privateJwk), 'RS256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const result = await verifyJwt(signed.token, 'not a jwk', 'RS256');
    expect(result).toMatchObject({ ok: false, kind: 'invalid-jwk' });
  }, 15_000);
});

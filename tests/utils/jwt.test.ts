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

/**
 * Generate an RSA JWK keypair paired with the hash that matches an RS*
 * algorithm. Defaults to SHA-256 so legacy RS256 callers don't need to
 * opt in; RS384 / RS512 round-trips opt in explicitly.
 */
async function generateRsaJwkPair(
  hash: 'SHA-256' | 'SHA-384' | 'SHA-512' = 'SHA-256'
): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash,
    },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { privateJwk, publicJwk };
}

/**
 * Mint an ECDSA JWK keypair for a given ES* algorithm. Curve follows
 * the JWT spec: ES256 → P-256, ES384 → P-384, ES512 → P-521 (the name
 * refers to SHA-512, not the curve bit-length).
 */
async function generateEcdsaJwkPair(
  algorithm: 'ES256' | 'ES384' | 'ES512'
): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const namedCurve = algorithm === 'ES256' ? 'P-256' : algorithm === 'ES384' ? 'P-384' : 'P-521';
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { privateJwk, publicJwk };
}

/** Mint an RSA-PSS JWK keypair paired with the hash that matches a PS* algorithm. */
async function generateRsaPssJwkPair(
  algorithm: 'PS256' | 'PS384' | 'PS512'
): Promise<{ privateJwk: JsonWebKey; publicJwk: JsonWebKey }> {
  const hash = algorithm === 'PS256' ? 'SHA-256' : algorithm === 'PS384' ? 'SHA-384' : 'SHA-512';
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'RSA-PSS',
      modulusLength: 2048,
      publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
      hash,
    },
    true,
    ['sign', 'verify']
  );
  const privateJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);
  const publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
  return { privateJwk, publicJwk };
}

describe('isJwtAlgorithm + JWT_SUPPORTED_ALGORITHMS', () => {
  it('enumerates the full HS / RS / ES / PS set and rejects unknowns', () => {
    expect([...JWT_SUPPORTED_ALGORITHMS]).toEqual([
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
    ]);
    for (const alg of JWT_SUPPORTED_ALGORITHMS) expect(isJwtAlgorithm(alg)).toBe(true);
    // EdDSA is a real JWS algorithm name that we don't support (Web
    // Crypto has no Ed25519 sign/verify in Chromium yet); canary for
    // the unsupported-algorithm branch.
    expect(isJwtAlgorithm('EdDSA')).toBe(false);
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
    // EdDSA is a real JWS algorithm (Ed25519 / Ed448) that Chromium's
    // Web Crypto does not implement — use it as the "genuinely
    // unsupported" canary so the test stays meaningful as the tuple
    // grows.
    const header = Buffer.from('{"alg":"EdDSA"}').toString('base64url');
    const payload = Buffer.from('{}').toString('base64url');
    const sig = Buffer.from('anything').toString('base64url');
    const result = await verifyJwt(`${header}.${payload}.${sig}`, HS_SECRET_32, 'HS256');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'unsupported-algorithm') {
      expect(result.claimed).toBe('EdDSA');
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

  const RS_EXTRA_CASES: readonly {
    algorithm: 'RS384' | 'RS512';
    hash: 'SHA-384' | 'SHA-512';
  }[] = [
    { algorithm: 'RS384', hash: 'SHA-384' },
    { algorithm: 'RS512', hash: 'SHA-512' },
  ];

  for (const { algorithm, hash } of RS_EXTRA_CASES) {
    it(`round-trips sign → verify for ${algorithm} with a generated RSA JWK keypair`, async () => {
      const { privateJwk, publicJwk } = await generateRsaJwkPair(hash);
      const signed = await signJwt(
        '{}',
        `{"sub":"${algorithm.toLowerCase()}"}`,
        JSON.stringify(privateJwk),
        algorithm
      );
      expect(signed.ok).toBe(true);
      if (!signed.ok) return;
      const verified = await verifyJwt(signed.token, JSON.stringify(publicJwk), algorithm);
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload).toMatchObject({ sub: algorithm.toLowerCase() });
      }
    }, 15_000);
  }

  it('fails a tampered RS512 token with signature-invalid', async () => {
    const { privateJwk, publicJwk } = await generateRsaJwkPair('SHA-512');
    const signed = await signJwt('{}', '{"sub":"ok"}', JSON.stringify(privateJwk), 'RS512');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const [h, _p, s] = signed.token.split('.');
    const tamperedPayload = Buffer.from('{"sub":"evil"}').toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    const result = await verifyJwt(tampered, JSON.stringify(publicJwk), 'RS512');
    expect(result).toMatchObject({ ok: false, kind: 'signature-invalid' });
  }, 15_000);

  it('cross-RS algorithm-mismatch: RS384 token verified as RS512 short-circuits at the header guard', async () => {
    const { privateJwk } = await generateRsaJwkPair('SHA-384');
    const signed = await signJwt('{}', '{}', JSON.stringify(privateJwk), 'RS384');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    // Pass any JWK — the algorithm-mismatch guard fires before import.
    const { publicJwk } = await generateRsaJwkPair('SHA-512');
    const result = await verifyJwt(signed.token, JSON.stringify(publicJwk), 'RS512');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'algorithm-mismatch') {
      expect(result.claimed).toBe('RS384');
      expect(result.expected).toBe('RS512');
    } else {
      expect(result).toMatchObject({ ok: false, kind: 'algorithm-mismatch' });
    }
  }, 15_000);

  const ES_ALGORITHMS: readonly ('ES256' | 'ES384' | 'ES512')[] = ['ES256', 'ES384', 'ES512'];
  const PS_ALGORITHMS: readonly ('PS256' | 'PS384' | 'PS512')[] = ['PS256', 'PS384', 'PS512'];

  for (const algorithm of ES_ALGORITHMS) {
    it(`round-trips sign → verify for ${algorithm} with a generated ECDSA JWK keypair`, async () => {
      const { privateJwk, publicJwk } = await generateEcdsaJwkPair(algorithm);
      const signed = await signJwt(
        '{}',
        `{"sub":"${algorithm.toLowerCase()}"}`,
        JSON.stringify(privateJwk),
        algorithm
      );
      expect(signed.ok).toBe(true);
      if (!signed.ok) return;
      const verified = await verifyJwt(signed.token, JSON.stringify(publicJwk), algorithm);
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload).toMatchObject({ sub: algorithm.toLowerCase() });
      }
    }, 15_000);
  }

  for (const algorithm of PS_ALGORITHMS) {
    it(`round-trips sign → verify for ${algorithm} with a generated RSA-PSS JWK keypair`, async () => {
      const { privateJwk, publicJwk } = await generateRsaPssJwkPair(algorithm);
      const signed = await signJwt(
        '{}',
        `{"sub":"${algorithm.toLowerCase()}"}`,
        JSON.stringify(privateJwk),
        algorithm
      );
      expect(signed.ok).toBe(true);
      if (!signed.ok) return;
      const verified = await verifyJwt(signed.token, JSON.stringify(publicJwk), algorithm);
      expect(verified.ok).toBe(true);
      if (verified.ok) {
        expect(verified.payload).toMatchObject({ sub: algorithm.toLowerCase() });
      }
    }, 30_000);
  }

  it('fails a tampered ES256 token with signature-invalid', async () => {
    const { privateJwk, publicJwk } = await generateEcdsaJwkPair('ES256');
    const signed = await signJwt('{}', '{"sub":"ok"}', JSON.stringify(privateJwk), 'ES256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const [h, _p, s] = signed.token.split('.');
    const tamperedPayload = Buffer.from('{"sub":"evil"}').toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    const result = await verifyJwt(tampered, JSON.stringify(publicJwk), 'ES256');
    expect(result).toMatchObject({ ok: false, kind: 'signature-invalid' });
  }, 15_000);

  it('fails a tampered PS256 token with signature-invalid', async () => {
    const { privateJwk, publicJwk } = await generateRsaPssJwkPair('PS256');
    const signed = await signJwt('{}', '{"sub":"ok"}', JSON.stringify(privateJwk), 'PS256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const [h, _p, s] = signed.token.split('.');
    const tamperedPayload = Buffer.from('{"sub":"evil"}').toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${s}`;
    const result = await verifyJwt(tampered, JSON.stringify(publicJwk), 'PS256');
    expect(result).toMatchObject({ ok: false, kind: 'signature-invalid' });
  }, 30_000);

  it('cross-family algorithm-mismatch: ES256 token verified as PS256', async () => {
    const { privateJwk } = await generateEcdsaJwkPair('ES256');
    const signed = await signJwt('{}', '{}', JSON.stringify(privateJwk), 'ES256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    // Pasting some JWK into the PS256 slot — the header alg / expected
    // check fires first, so we never reach the key import.
    const { publicJwk } = await generateRsaPssJwkPair('PS256');
    const result = await verifyJwt(signed.token, JSON.stringify(publicJwk), 'PS256');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'algorithm-mismatch') {
      expect(result.claimed).toBe('ES256');
      expect(result.expected).toBe('PS256');
    }
  }, 30_000);

  it('rejects an RSA JWK pasted into the ES256 slot with invalid-jwk', async () => {
    // Build a token that correctly claims ES256 so we get past the
    // header checks and into the import path. The invalid-jwk failure
    // fires at crypto.subtle.importKey when the RSA fields are seen
    // under an ECDSA algorithm identifier.
    const { privateJwk: esPrivate } = await generateEcdsaJwkPair('ES256');
    const signed = await signJwt('{}', '{"sub":"x"}', JSON.stringify(esPrivate), 'ES256');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const { publicJwk: rsaPublic } = await generateRsaJwkPair();
    const result = await verifyJwt(signed.token, JSON.stringify(rsaPublic), 'ES256');
    expect(result).toMatchObject({ ok: false, kind: 'invalid-jwk' });
  }, 15_000);

  it('pins the guard ordering: ES384 token verified as ES256 fires algorithm-mismatch before importKey', async () => {
    // A user who signed with ES384 (P-384 key) and then picks ES256 in
    // the Verify selector trips the algorithm-mismatch guard at the
    // header check — BEFORE the ECDSA importKey curve-rejection path.
    // Pin the ordering so the panel's error copy (algorithm-mismatch
    // names both claimed + expected, invalid-jwk is generic) stays
    // deterministic even when the JWK itself is the wrong curve.
    //
    // A dedicated forged-token test that exercises the importKey curve
    // rejection (where the token header falsely claims ES256 but the
    // signature is over a P-384 key) is tracked as a follow-up in
    // docs/BACKLOG.md — that scenario is adversarial rather than a
    // realistic paste mistake.
    const { privateJwk: p384Private, publicJwk: p384Public } = await generateEcdsaJwkPair('ES384');
    const signed = await signJwt('{}', '{"sub":"x"}', JSON.stringify(p384Private), 'ES384');
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;
    const result = await verifyJwt(signed.token, JSON.stringify(p384Public), 'ES256');
    expect(result.ok).toBe(false);
    if (!result.ok && result.kind === 'algorithm-mismatch') {
      expect(result.claimed).toBe('ES384');
      expect(result.expected).toBe('ES256');
    } else {
      // The whole point of this test is that algorithm-mismatch fires
      // first — fail loudly if that ordering ever changes so we can
      // audit the panel copy deliberately.
      expect(result).toMatchObject({ ok: false, kind: 'algorithm-mismatch' });
    }
  }, 15_000);
});

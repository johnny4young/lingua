import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { computeLicenseJwkThumbprint, verifyLicenseToken } from '../../src/shared/license';

/**
 * End-to-end test for `scripts/mint-dev-license.mjs`. Runs the script as a
 * subprocess and verifies the emitted token against the emitted public key,
 * proving that the dev workflow documented in AGENTS.md actually works. If
 * this test breaks, the "paste a dev license" instructions in AGENTS.md are
 * also broken and must be fixed in the same commit.
 */
describe('scripts/mint-dev-license.mjs', () => {
  it('produces a token that verifies against the emitted Ed25519 public key', async () => {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/mint-dev-license.mjs', '--tier', 'pro', '--days', '7', '--issued-to', 'ci@local'],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout) as {
      publicKeyJwk: string;
      publicKeyJwkThumbprint: string;
      token: string;
      payload: { tier: string; issuedTo: string };
    };

    expect(parsed.payload.tier).toBe('pro');
    expect(parsed.payload.issuedTo).toBe('ci@local');

    const publicKey = JSON.parse(parsed.publicKeyJwk) as JsonWebKey;
    const result = await verifyLicenseToken(parsed.token, publicKey);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.tier).toBe('pro');
      expect(result.state).toBe('active');
    }

    // internal — the emitted thumbprint must be the RFC 7638 value of the
    // emitted key, i.e. exactly what Settings → License renders for a
    // session built with it (the stale-5174 eyeball check).
    expect(parsed.publicKeyJwkThumbprint).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(parsed.publicKeyJwkThumbprint).toBe(await computeLicenseJwkThumbprint(publicKey));
  });

  it('rejects an unsupported --tier without writing output', () => {
    let threw = false;
    try {
      execFileSync(
        process.execPath,
        ['scripts/mint-dev-license.mjs', '--tier', 'admin'],
        { stdio: 'pipe' }
      );
    } catch (error) {
      threw = true;
      const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? '';
      expect(stderr).toMatch(/Unknown --tier/);
    }
    expect(threw).toBe(true);
  });

  it('accepts --days 0 and still emits a valid signed token payload', async () => {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/mint-dev-license.mjs', '--tier', 'pro', '--days', '0'],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout) as {
      publicKeyJwk: string;
      token: string;
      payload: { supportWindowEndsAt: string };
    };

    expect(parsed.payload.supportWindowEndsAt).toMatch(/T/);

    const publicKey = JSON.parse(parsed.publicKeyJwk) as JsonWebKey;
    const result = await verifyLicenseToken(parsed.token, publicKey);
    expect(result.ok).toBe(true);
  });

  it('emits JWKs with ONLY the RFC 8037 §2 fields — strips Node 22+ extras like `alg: "Ed25519"` that Cloudflare Workers WebCrypto rejects', () => {
    // Pinning the keypair shape so a future change to the mint helper
    // (or a Node version bump that adds new fields to exportKey output)
    // can't silently break license-server uploads. See
    // `scripts/dev-license-shared.mjs` `normalizeEd25519*Jwk` helpers.
    const stdout = execFileSync(
      process.execPath,
      [
        'scripts/mint-dev-license.mjs',
        '--tier',
        'pro',
        '--days',
        '7',
        '--issued-to',
        'ci@local',
      ],
      { encoding: 'utf8' }
    );
    const parsed = JSON.parse(stdout) as {
      publicKeyJwk: string;
      privateKeyJwkDoNotShip: string;
    };

    const publicKey = JSON.parse(parsed.publicKeyJwk) as Record<string, unknown>;
    expect(Object.keys(publicKey).sort()).toEqual(['crv', 'kty', 'x']);
    expect(publicKey.kty).toBe('OKP');
    expect(publicKey.crv).toBe('Ed25519');

    const privateKey = JSON.parse(parsed.privateKeyJwkDoNotShip) as Record<string, unknown>;
    expect(Object.keys(privateKey).sort()).toEqual(['crv', 'd', 'kty', 'x']);
    expect(privateKey.kty).toBe('OKP');
    expect(privateKey.crv).toBe('Ed25519');

    // Spot-check: the foot-gun fields must not leak through. If any of
    // these are present, Cloudflare Workers' importKey will throw a
    // DataError and `license-server/src/lib/sign.ts` surfaces it as
    // `invalid-private-key` — exactly the bug this guard exists to
    // prevent regressing.
    for (const forbidden of ['alg', 'key_ops', 'ext']) {
      expect(publicKey, `publicKeyJwk leaked ${forbidden}`).not.toHaveProperty(forbidden);
      expect(privateKey, `privateKeyJwkDoNotShip leaked ${forbidden}`).not.toHaveProperty(
        forbidden
      );
    }
  });
});

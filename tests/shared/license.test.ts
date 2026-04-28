/**
 * Covers the RL-059 shared license verifier: signature validity, tampered
 * payloads, clock skew, grace/expired windows, and the malformed/token-shape
 * failure branches. Tokens are produced against a freshly generated Ed25519
 * key pair so the suite does not need a fixture on disk.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LICENSE_TIERS,
  decodeLicenseToken,
  verifyLicenseToken,
  type LicensePayload,
} from '../../src/shared/license';
import { signLicenseTokenForTest } from '../__fixtures__/license';

const DAY_MS = 24 * 60 * 60 * 1000;

interface KeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

async function generateEd25519KeyPair(): Promise<KeyPair> {
  const key = (await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const publicKey = await crypto.subtle.exportKey('jwk', key.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', key.privateKey);
  return { publicKey, privateKey };
}

let keys: KeyPair;

function buildPayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    productId: 'lingua-desktop',
    tier: 'pro',
    issuedTo: 'acme@example.com',
    issuedAt: new Date('2026-01-01T00:00:00.000Z').toISOString(),
    supportWindowEndsAt: new Date('2026-06-01T00:00:00.000Z').toISOString(),
    entitlements: ['plugins', 'ai'],
    ...overrides,
  };
}

beforeAll(async () => {
  keys = await generateEd25519KeyPair();
});

afterAll(() => {
  // nothing to clean — keys live in-memory
});

describe('decodeLicenseToken', () => {
  it('rejects empty and mis-shaped tokens', () => {
    expect(decodeLicenseToken('').ok).toBe(false);
    expect(decodeLicenseToken('only-one-segment').ok).toBe(false);
    expect(decodeLicenseToken('a.b.c').ok).toBe(false);
  });

  it('rejects non-base64url payloads', () => {
    const result = decodeLicenseToken('!!!.!!!');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('reports unsupported tiers with a dedicated reason', async () => {
    const payload = { ...buildPayload(), tier: 'galaxy-brain' as unknown as LicensePayload['tier'] };
    const token = await signLicenseTokenForTest(payload as LicensePayload, keys.privateKey);
    const result = decodeLicenseToken(token);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-tier');
  });

  it('parses valid tokens and exposes the signature + signing input', async () => {
    const token = await signLicenseTokenForTest(buildPayload(), keys.privateKey);
    const result = decodeLicenseToken(token);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.productId).toBe('lingua-desktop');
      expect(result.signature.byteLength).toBeGreaterThan(0);
      expect(result.signingInput.byteLength).toBeGreaterThan(0);
    }
  });
});

describe('verifyLicenseToken', () => {
  const now = Date.parse('2026-03-15T00:00:00.000Z');

  it('accepts a valid token inside the support window as active', async () => {
    const token = await signLicenseTokenForTest(
      buildPayload({ licenseId: 'lic_shared_contract' }),
      keys.privateKey
    );
    const result = await verifyLicenseToken(token, keys.publicKey, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toBe('active');
      expect(result.payload.licenseId).toBe('lic_shared_contract');
      expect(result.payload.tier).toBe('pro');
    }
  });

  it.each(['trial', 'education'] as const)('accepts server-minted %s tokens as paid tiers', async (tier) => {
    const token = await signLicenseTokenForTest(
      buildPayload({
        productId: tier === 'trial' ? 'lingua_trial' : 'lingua_education',
        tier,
      }),
      keys.privateKey
    );

    const result = await verifyLicenseToken(token, keys.publicKey, { now });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state).toBe('active');
      expect(result.payload.tier).toBe(tier);
    }
  });

  it('accepts a token inside the grace window as grace', async () => {
    const token = await signLicenseTokenForTest(
      buildPayload({ supportWindowEndsAt: new Date(now - DAY_MS).toISOString() }),
      keys.privateKey
    );
    const result = await verifyLicenseToken(token, keys.publicKey, { now });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toBe('grace');
  });

  it('rejects tokens past the grace window as expired', async () => {
    const token = await signLicenseTokenForTest(
      buildPayload({ supportWindowEndsAt: new Date(now - 30 * DAY_MS).toISOString() }),
      keys.privateKey
    );
    const result = await verifyLicenseToken(token, keys.publicKey, {
      now,
      gracePeriodMs: 14 * DAY_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('keeps the grace window upper bound inclusive (now === end + grace is still grace)', async () => {
    const supportWindowEndsAt = new Date(now - 14 * DAY_MS).toISOString();
    const token = await signLicenseTokenForTest(
      buildPayload({ supportWindowEndsAt }),
      keys.privateKey
    );
    const result = await verifyLicenseToken(token, keys.publicKey, {
      now,
      gracePeriodMs: 14 * DAY_MS,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.state).toBe('grace');

    // One millisecond past the inclusive bound should flip to expired.
    const resultOneMsPast = await verifyLicenseToken(token, keys.publicKey, {
      now: now + 1,
      gracePeriodMs: 14 * DAY_MS,
    });
    expect(resultOneMsPast.ok).toBe(false);
  });

  it('rejects tokens issued beyond the clock-skew tolerance as clock-skew', async () => {
    const token = await signLicenseTokenForTest(
      buildPayload({ issuedAt: new Date(now + 7 * DAY_MS).toISOString() }),
      keys.privateKey
    );
    const result = await verifyLicenseToken(token, keys.publicKey, {
      now,
      clockSkewMs: DAY_MS,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('clock-skew');
  });

  it('rejects tokens signed by a different key as invalid-signature', async () => {
    const other = await generateEd25519KeyPair();
    const token = await signLicenseTokenForTest(buildPayload(), other.privateKey);
    const result = await verifyLicenseToken(token, keys.publicKey, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-signature');
  });

  it('rejects tokens whose payload has been swapped under the signature', async () => {
    const token = await signLicenseTokenForTest(buildPayload(), keys.privateKey);
    const [, signaturePart] = token.split('.');
    const tampered = `${Buffer.from(
      JSON.stringify(buildPayload({ tier: 'team', entitlements: ['all'] })),
      'utf-8'
    )
      .toString('base64')
      .replace(/=+$/u, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')}.${signaturePart}`;
    const result = await verifyLicenseToken(tampered, keys.publicKey, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-signature');
  });

  it('surfaces malformed tokens through a distinct reason', async () => {
    const result = await verifyLicenseToken('not-a-token', keys.publicKey, { now });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('malformed');
  });

  it('keeps the tier whitelist exhaustive', () => {
    expect([...LICENSE_TIERS].sort()).toEqual([
      'education',
      'free',
      'pro',
      'pro_lifetime',
      'team',
      'trial',
    ]);
  });
});

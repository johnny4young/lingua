import { beforeAll, describe, expect, it } from 'vitest';
import {
  signLicenseToken,
  verifyLicenseToken,
  type LicensePayload,
} from '../src/lib/sign';
import { generateEd25519Keypair } from './helpers';

let keys: { publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey };
let otherKeys: { publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey };

beforeAll(async () => {
  keys = await generateEd25519Keypair();
  otherKeys = await generateEd25519Keypair();
});

function freshPayload(overrides: Partial<LicensePayload> = {}): LicensePayload {
  return {
    productId: 'lingua_lifetime',
    tier: 'pro_lifetime',
    issuedTo: 'buyer@example.com',
    issuedAt: '2026-04-26T00:00:00.000Z',
    supportWindowEndsAt: '2031-04-26T00:00:00.000Z',
    entitlements: ['tabs', 'snippets'],
    ...overrides,
  };
}

describe('signLicenseToken + verifyLicenseToken', () => {
  it('round-trips a valid payload — signed token verifies back to the same payload object', async () => {
    const signed = await signLicenseToken(freshPayload(), keys.privateKeyJwk);
    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error('unreachable');

    const verified = await verifyLicenseToken(signed.token, keys.publicKeyJwk);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error('unreachable');
    expect(verified.payload.productId).toBe('lingua_lifetime');
    expect(verified.payload.tier).toBe('pro_lifetime');
    expect(verified.payload.issuedTo).toBe('buyer@example.com');
  });

  it('rejects a token signed by a different keypair as invalid-signature', async () => {
    const signed = await signLicenseToken(freshPayload(), keys.privateKeyJwk);
    if (!signed.ok) throw new Error('unreachable');

    const verified = await verifyLicenseToken(signed.token, otherKeys.publicKeyJwk);
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error('unreachable');
    expect(verified.reason).toBe('invalid-signature');
  });

  it('rejects a tampered payload portion as invalid-signature (signature stays bound to original payload)', async () => {
    const signed = await signLicenseToken(freshPayload(), keys.privateKeyJwk);
    if (!signed.ok) throw new Error('unreachable');
    const [, signaturePart] = signed.token.split('.');
    const tamperedPayload = btoa(
      JSON.stringify(freshPayload({ tier: 'team' }))
    )
      .replace(/=+$/u, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const tampered = `${tamperedPayload}.${signaturePart}`;

    const verified = await verifyLicenseToken(tampered, keys.publicKeyJwk);
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error('unreachable');
    expect(verified.reason).toBe('invalid-signature');
  });

  it('rejects a malformed token (no dot separator) as malformed', async () => {
    const verified = await verifyLicenseToken('not-a-token', keys.publicKeyJwk);
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error('unreachable');
    expect(verified.reason).toBe('malformed');
  });

  it('rejects an empty token as malformed', async () => {
    const verified = await verifyLicenseToken('', keys.publicKeyJwk);
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error('unreachable');
    expect(verified.reason).toBe('malformed');
  });

  it('classifies an unknown tier as unsupported-tier rather than malformed (so future Lingua tiers do not look like signature failures)', async () => {
    // We sign a payload whose tier string is outside the supported
    // enum but otherwise valid. Verification decodes the payload,
    // checks the tier whitelist, and surfaces unsupported-tier — the
    // signature itself is still valid against the right key.
    const payload = { ...freshPayload(), tier: 'galaxy-brain' as LicensePayload['tier'] };
    const signed = await signLicenseToken(payload, keys.privateKeyJwk);
    expect(signed.ok).toBe(true);
    if (!signed.ok) throw new Error('unreachable');

    const verified = await verifyLicenseToken(signed.token, keys.publicKeyJwk);
    expect(verified.ok).toBe(false);
    if (verified.ok) throw new Error('unreachable');
    expect(verified.reason).toBe('unsupported-tier');
  });

  it('accepts tier=trial and tier=education (server-minted SKUs that are not Polar products)', async () => {
    for (const tier of ['trial', 'education'] as const) {
      const signed = await signLicenseToken(freshPayload({ tier }), keys.privateKeyJwk);
      expect(signed.ok).toBe(true);
      if (!signed.ok) throw new Error('unreachable');
      const verified = await verifyLicenseToken(signed.token, keys.publicKeyJwk);
      expect(verified.ok).toBe(true);
      if (!verified.ok) throw new Error('unreachable');
      expect(verified.payload.tier).toBe(tier);
    }
  });
});

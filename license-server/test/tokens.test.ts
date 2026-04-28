import { beforeAll, describe, expect, it } from 'vitest';
import {
  buildLicensePayload,
  mintAndSignToken,
  PAID_ENTITLEMENTS,
  tierForProduct,
} from '../src/lib/tokens';
import { verifyLicenseToken } from '../src/lib/sign';
import { generateEd25519Keypair } from './helpers';

let keys: { publicKeyJwk: JsonWebKey; privateKeyJwk: JsonWebKey };

beforeAll(async () => {
  keys = await generateEd25519Keypair();
});

describe('buildLicensePayload', () => {
  it('maps each LicenseProductId to the canonical tier', () => {
    expect(tierForProduct('lingua_monthly')).toBe('pro');
    expect(tierForProduct('lingua_lifetime')).toBe('pro_lifetime');
    expect(tierForProduct('lingua_team')).toBe('team');
    expect(tierForProduct('lingua_trial')).toBe('trial');
    expect(tierForProduct('lingua_education')).toBe('education');
  });

  it('lowercases + trims the issuedTo email so D1 + email comparisons stay deterministic', () => {
    const payload = buildLicensePayload({
      licenseId: 'lic_monthly',
      productId: 'lingua_monthly',
      issuedTo: '  Buyer@Example.COM  ',
      issuedAt: 1700000000,
      expiresAt: 1730000000,
      supportWindowEndsAt: 1730000000,
    });
    expect(payload.licenseId).toBe('lic_monthly');
    expect(payload.issuedTo).toBe('buyer@example.com');
  });

  it('emits the full PAID_ENTITLEMENTS set so future feature flags do not require re-mint', () => {
    const payload = buildLicensePayload({
      licenseId: 'lic_lifetime',
      productId: 'lingua_lifetime',
      issuedTo: 'buyer@example.com',
      issuedAt: 1700000000,
      expiresAt: null,
      supportWindowEndsAt: 1900000000,
    });
    expect(payload.entitlements).toEqual(PAID_ENTITLEMENTS);
  });

  it('encodes timestamps as ISO so the renderer-side `Date.parse` works without coercion', () => {
    const payload = buildLicensePayload({
      licenseId: 'lic_monthly',
      productId: 'lingua_monthly',
      issuedTo: 'buyer@example.com',
      issuedAt: 1700000000,
      expiresAt: 1730000000,
      supportWindowEndsAt: 1730000000,
    });
    expect(payload.issuedAt).toBe(new Date(1700000000 * 1000).toISOString());
    expect(payload.supportWindowEndsAt).toBe(new Date(1730000000 * 1000).toISOString());
  });
});

describe('mintAndSignToken', () => {
  it('mints a token whose signature verifies + payload round-trips with the same shape', async () => {
    const result = await mintAndSignToken(
      {
        licenseId: 'lic_monthly',
        productId: 'lingua_monthly',
        issuedTo: 'buyer@example.com',
        issuedAt: 1700000000,
        expiresAt: 1730000000,
        supportWindowEndsAt: 1730000000,
      },
      keys.privateKeyJwk
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');

    const verified = await verifyLicenseToken(result.token, keys.publicKeyJwk);
    expect(verified.ok).toBe(true);
    if (!verified.ok) throw new Error('unreachable');
    expect(verified.payload.licenseId).toBe('lic_monthly');
    expect(verified.payload.productId).toBe('lingua_monthly');
    expect(verified.payload.tier).toBe('pro');
    expect(verified.payload.issuedTo).toBe('buyer@example.com');
  });
});

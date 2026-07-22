import { beforeAll, describe, expect, it } from 'vitest';
import { resolveLicenseSigningKey } from '../../src/lib/licenseKeys';
import { generateEd25519Keypair } from '../helpers';

let currentPrivateKey: JsonWebKey;
let nextPrivateKey: JsonWebKey;

beforeAll(async () => {
  currentPrivateKey = (await generateEd25519Keypair()).privateKeyJwk;
  nextPrivateKey = (await generateEd25519Keypair()).privateKeyJwk;
});

function env(overrides: Record<string, string | undefined> = {}) {
  return {
    LINGUA_LICENSE_PRIVATE_KEY_JWK: JSON.stringify(currentPrivateKey),
    LINGUA_LICENSE_NEXT_PRIVATE_KEY_JWK: JSON.stringify(nextPrivateKey),
    LINGUA_LICENSE_SIGNING_KEY_SLOT: 'current',
    ...overrides,
  };
}

describe('resolveLicenseSigningKey', () => {
  it('defaults to the existing current secret', () => {
    const resolved = resolveLicenseSigningKey(env({ LINGUA_LICENSE_SIGNING_KEY_SLOT: undefined }));
    expect(resolved?.slot).toBe('current');
    expect(resolved?.privateKeyJwk.x).toBe(currentPrivateKey.x);
  });

  it('promotes the prepared next secret only when the selector changes', () => {
    const resolved = resolveLicenseSigningKey(env({ LINGUA_LICENSE_SIGNING_KEY_SLOT: 'next' }));
    expect(resolved?.slot).toBe('next');
    expect(resolved?.privateKeyJwk.x).toBe(nextPrivateKey.x);
  });

  it('fails closed for an unknown slot, absent selected key, or public-only material', () => {
    expect(resolveLicenseSigningKey(env({ LINGUA_LICENSE_SIGNING_KEY_SLOT: 'other' }))).toBeNull();
    expect(
      resolveLicenseSigningKey(
        env({
          LINGUA_LICENSE_SIGNING_KEY_SLOT: 'next',
          LINGUA_LICENSE_NEXT_PRIVATE_KEY_JWK: undefined,
        })
      )
    ).toBeNull();
    expect(
      resolveLicenseSigningKey(
        env({
          LINGUA_LICENSE_PRIVATE_KEY_JWK: JSON.stringify({
            kty: 'OKP',
            crv: 'Ed25519',
            x: currentPrivateKey.x,
          }),
        })
      )
    ).toBeNull();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The store reads `import.meta.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK` at
// module init time. We inject a valid key pair before importing the store so
// verification runs end-to-end against a deterministic keypair.
const keyPair = (await crypto.subtle.generateKey(
  { name: 'Ed25519' },
  true,
  ['sign', 'verify']
)) as CryptoKeyPair;
const publicKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
const privateKeyJwk = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

// Vitest's `import.meta.env` is replayed after the module graph resolves, so
// we stash the key on globalThis and monkey-patch the module-level reader.
import.meta.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK = JSON.stringify(publicKeyJwk);

const { signLicenseTokenForTest } = await import('../__fixtures__/license');
const { useLicenseStore } = await import('../../src/renderer/stores/licenseStore');

describe('licenseStore', () => {
  const initial = useLicenseStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useLicenseStore.setState(initial, true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the free tier with no persisted token', () => {
    const state = useLicenseStore.getState();
    expect(state.token).toBeNull();
    expect(state.status.kind).toBe('free');
  });

  it('verifies a valid token and exposes an active status', async () => {
    const token = await signLicenseTokenForTest(
      {
        productId: 'lingua-desktop',
        tier: 'pro',
        issuedTo: 'user@example.com',
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        supportWindowEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        entitlements: ['plugins'],
      },
      privateKeyJwk
    );
    const status = await useLicenseStore.getState().setLicenseToken(token);
    expect(status.kind).toBe('active');
    if (status.kind === 'active') {
      expect(status.verification.payload.tier).toBe('pro');
    }
    expect(useLicenseStore.getState().token).toBe(token);
  });

  it('drops the token and surfaces the reason when signature verification fails', async () => {
    const status = await useLicenseStore.getState().setLicenseToken('aaa.bbb');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('malformed');
    expect(useLicenseStore.getState().token).toBeNull();
  });

  it('keeps the previous active token when a replacement token fails verification', async () => {
    const token = await signLicenseTokenForTest(
      {
        productId: 'lingua-desktop',
        tier: 'pro',
        issuedTo: 'user@example.com',
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        supportWindowEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        entitlements: ['plugins'],
      },
      privateKeyJwk
    );
    await useLicenseStore.getState().setLicenseToken(token);

    const status = await useLicenseStore.getState().setLicenseToken('aaa.bbb');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('malformed');
    expect(useLicenseStore.getState().token).toBe(token);
    expect(useLicenseStore.getState().status.kind).toBe('active');
  });

  it('rejects empty tokens with a malformed reason and never persists them', async () => {
    const status = await useLicenseStore.getState().setLicenseToken('   ');
    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('malformed');
    expect(useLicenseStore.getState().token).toBeNull();
  });

  it('clearLicense resets to the free tier even after activation', async () => {
    const token = await signLicenseTokenForTest(
      {
        productId: 'lingua-desktop',
        tier: 'pro_lifetime',
        issuedTo: 'user@example.com',
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        supportWindowEndsAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
        entitlements: ['plugins'],
      },
      privateKeyJwk
    );
    await useLicenseStore.getState().setLicenseToken(token);
    expect(useLicenseStore.getState().status.kind).toBe('active');

    useLicenseStore.getState().clearLicense();
    const state = useLicenseStore.getState();
    expect(state.token).toBeNull();
    expect(state.status.kind).toBe('free');
  });

  it('rehydrates a persisted token and revalidates it back to an active status', async () => {
    const token = await signLicenseTokenForTest(
      {
        productId: 'lingua-desktop',
        tier: 'pro',
        issuedTo: 'user@example.com',
        issuedAt: new Date(Date.now() - 1000).toISOString(),
        supportWindowEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        entitlements: ['plugins'],
      },
      privateKeyJwk
    );

    await useLicenseStore.getState().setLicenseToken(token);
    expect(localStorage.getItem('lingua-license')).toBeTruthy();

    vi.resetModules();
    import.meta.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK = JSON.stringify(publicKeyJwk);
    const { useLicenseStore: rehydratedStore } = await import('../../src/renderer/stores/licenseStore');

    await vi.waitFor(() => {
      expect(rehydratedStore.getState().status.kind).toBe('active');
    });
    expect(rehydratedStore.getState().token).toBe(token);
  });
});

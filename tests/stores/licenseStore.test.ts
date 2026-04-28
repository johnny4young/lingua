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

/**
 * RL-061 Slice 2.5 — server-aware web branch.
 *
 * The base test block above keeps `VITE_LINGUA_LICENSE_SERVER_URL`
 * unset so the store runs in local-verify-only mode (the
 * `dev:web:pro` flow). This block opts the store into the server
 * path by setting the env var before re-importing, then mocks
 * `fetch` per-case to drive each setLicenseToken / revalidate /
 * clearLicense branch the plan calls out.
 */
describe('licenseStore — server-aware web branch (Slice 2.5)', () => {
  const SERVER_URL = 'https://licenses.test.local';

  function buildPayload(overrides: Partial<{ tier: string; issuedAt: string; supportWindowEndsAt: string }> = {}) {
    return {
      productId: 'lingua-desktop',
      tier: 'pro' as const,
      issuedTo: 'user@example.com',
      issuedAt: overrides.issuedAt ?? new Date(Date.now() - 1000).toISOString(),
      supportWindowEndsAt:
        overrides.supportWindowEndsAt ?? new Date(Date.now() + 30 * 86_400_000).toISOString(),
      entitlements: ['plugins'],
    };
  }

  async function importFreshStore() {
    vi.resetModules();
    import.meta.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK = JSON.stringify(publicKeyJwk);
    import.meta.env.VITE_LINGUA_LICENSE_SERVER_URL = SERVER_URL;
    const { useLicenseStore: store } = await import('../../src/renderer/stores/licenseStore');
    return store;
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (import.meta.env as Record<string, string | undefined>).VITE_LINGUA_LICENSE_SERVER_URL;
  });

  it('flips through verifying → active and POSTs to /licenses/activate with surface: web', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [], web: [] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    const status = await store.getState().setLicenseToken(token);

    expect(status.kind).toBe('active');
    expect(store.getState().serverSync).toBe('synced');
    // Filter to only the activate URL — `vi.resetModules` leaves prior
    // store instances alive in memory with their cross-tab listeners
    // still attached to `window`, so unrelated calls from prior tests'
    // stores can leak into the spy. The contract we actually care about
    // is that THIS store hit /licenses/activate exactly once with the
    // expected body.
    const activateCalls = fetchMock.mock.calls.filter(
      ([url]) => url === `${SERVER_URL}/licenses/activate`
    );
    expect(activateCalls).toHaveLength(1);
    const [, init] = activateCalls[0]!;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.surface).toBe('web');
    expect(typeof body.deviceId).toBe('string');
    expect(body.deviceId.length).toBeGreaterThan(20);
  });

  it('falls back to local-verify with serverSync=unreachable when the server cannot be reached', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    const status = await store.getState().setLicenseToken(token);

    expect(status.kind).toBe('active');
    expect(store.getState().token).toBe(token);
    expect(store.getState().serverSync).toBe('unreachable');
  });

  it('surfaces server-side `exhausted` as invalid:devices-exhausted and KEEPS the token so Slice 3 can remediate', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: false,
            reason: 'exhausted',
            surface: 'web',
            devices: { desktop: [], web: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    const status = await store.getState().setLicenseToken(token);

    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('devices-exhausted');
    // Token kept so a future Slice 3 modal can remove a device + retry
    // without forcing the user to paste again.
    expect(store.getState().token).toBe(token);
  });

  it('wipes the token on server-side `license-refunded` even though the signature is locally valid', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: false, reason: 'license-refunded' }), { status: 401 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    const status = await store.getState().setLicenseToken(token);

    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('license-refunded');
    expect(store.getState().token).toBeNull();
  });

  it('revalidate replaces the local token when /licenses/status returns a strictly-newer refreshedToken (Monthly renewal pickup)', async () => {
    const oldPayload = buildPayload({ issuedAt: new Date(Date.now() - 60_000).toISOString() });
    const newPayload = buildPayload({ issuedAt: new Date(Date.now() - 100).toISOString() });
    const oldToken = await signLicenseTokenForTest(oldPayload, privateKeyJwk);
    const newToken = await signLicenseTokenForTest(newPayload, privateKeyJwk);

    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // First call is the activate that lands the old token.
        return new Response(
          JSON.stringify({
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [], web: [] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        );
      }
      // Second call is the revalidate — server has a newer token in D1
      // so it surfaces it via refreshedToken.
      return new Response(
        JSON.stringify({
          ok: true,
          licenseId: 'lic_1',
          status: 'active',
          tier: 'pro',
          expiresAt: Math.floor(Date.now() / 1000) + 60 * 86_400,
          supportWindowEndsAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
          deviceRegistered: true,
          refreshedToken: newToken,
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    await store.getState().setLicenseToken(oldToken);
    expect(store.getState().token).toBe(oldToken);

    await store.getState().revalidate();
    expect(store.getState().token).toBe(newToken);
    expect(store.getState().status.kind).toBe('active');
  });

  it('does NOT replace the token when refreshedToken has an OLDER issuedAt (defends against a stale-replica response)', async () => {
    const newPayload = buildPayload({ issuedAt: new Date(Date.now() - 100).toISOString() });
    const olderPayload = buildPayload({ issuedAt: new Date(Date.now() - 60_000).toISOString() });
    const newToken = await signLicenseTokenForTest(newPayload, privateKeyJwk);
    const olderToken = await signLicenseTokenForTest(olderPayload, privateKeyJwk);

    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [], web: [] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          ok: true,
          licenseId: 'lic_1',
          status: 'active',
          tier: 'pro',
          expiresAt: null,
          supportWindowEndsAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
          deviceRegistered: true,
          refreshedToken: olderToken,
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    await store.getState().setLicenseToken(newToken);
    await store.getState().revalidate();
    expect(store.getState().token).toBe(newToken);
  });

  it('clearLicense fires removeDevice with keepalive: true and wipes local state', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [], web: [] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);
    expect(store.getState().token).toBe(token);

    fetchMock.mockClear();
    fetchMock.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            licenseId: 'lic_1',
            removed: true,
            devices: { desktop: [], web: [] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        )
    );

    await store.getState().clearLicense();
    expect(store.getState().token).toBeNull();
    expect(store.getState().status.kind).toBe('free');

    // Allow the fire-and-forget removeDevice to land before assertions.
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${SERVER_URL}/licenses/devices/remove`);
    expect(init?.keepalive).toBe(true);
  });
});

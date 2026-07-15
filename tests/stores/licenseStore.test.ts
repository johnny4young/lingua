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
            protocolVersion: 1,
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
    expect(activateCalls.length).toBeGreaterThanOrEqual(1);
    const matchingActivate = activateCalls.find(([, init]) => {
      if (typeof init?.body !== 'string') return false;
      return JSON.parse(init.body).surface === 'web';
    });
    expect(matchingActivate).toBeDefined();
    const [, init] = matchingActivate!;
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

  it('fails closed and clears the token when the server uses a future protocol version', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ protocolVersion: 999, ok: true }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    const status = await store.getState().setLicenseToken(token);

    expect(status).toEqual({ kind: 'invalid', reason: 'unsupported-protocol' });
    expect(store.getState().token).toBeNull();
    expect(store.getState().serverSync).toBe('synced');
  });

  it('clears cached devices when a replacement activation falls back to local verification', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            protocolVersion: 1,
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [], web: [{ id: 'stale', deviceId: 'stale-uuid' }] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        );
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const firstToken = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    const secondToken = await signLicenseTokenForTest(
      buildPayload({ issuedAt: new Date().toISOString() }),
      privateKeyJwk
    );
    await store.getState().setLicenseToken(firstToken);
    expect(store.getState().devices?.web.length).toBe(1);

    await store.getState().setLicenseToken(secondToken);

    expect(store.getState().token).toBe(secondToken);
    expect(store.getState().serverSync).toBe('unreachable');
    expect(store.getState().devices).toBeNull();
    expect(store.getState().deviceLimit).toBeNull();
  });

  it('surfaces server-side `exhausted` as invalid:devices-exhausted and KEEPS the token so Slice 3 can remediate', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            protocolVersion: 1,
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
        new Response(JSON.stringify({ protocolVersion: 1, ok: false, reason: 'license-refunded' }), { status: 401 })
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
            protocolVersion: 1,
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
          protocolVersion: 1,
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
            protocolVersion: 1,
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
          protocolVersion: 1,
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

  it('persists devices + deviceLimit on activate-success so Slice 3 UI can render the bucket', async () => {
    const desktopDevice = {
      id: 'dev_d1',
      deviceId: 'd-uuid-1',
      deviceName: 'MacBook Pro',
      os: 'macOS',
      surface: 'desktop' as const,
      activatedAt: 1_700_000_000,
      lastSeenAt: 1_700_000_500,
    };
    const webDevice = {
      id: 'dev_w1',
      deviceId: 'w-uuid-1',
      deviceName: 'Chrome on macOS',
      os: 'web-chrome',
      surface: 'web' as const,
      activatedAt: 1_700_000_100,
      lastSeenAt: 1_700_000_900,
    };
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            protocolVersion: 1,
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [desktopDevice], web: [webDevice] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);

    const state = store.getState();
    expect(state.devices?.desktop).toEqual([desktopDevice]);
    expect(state.devices?.web).toEqual([webDevice]);
    expect(state.deviceLimit).toEqual({ desktop: 3, web: 3 });
  });

  it('persists devices + deviceLimit on the exhausted branch so the modal can list candidates to remove', async () => {
    const webDevices = ['a', 'b', 'c'].map((id) => ({
      id: `dev_${id}`,
      deviceId: `w-uuid-${id}`,
      deviceName: `Browser ${id}`,
      os: 'web-chrome',
      surface: 'web' as const,
      activatedAt: 1_700_000_000,
      lastSeenAt: 1_700_000_900,
    }));
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            protocolVersion: 1,
            ok: false,
            reason: 'exhausted',
            surface: 'web',
            devices: { desktop: [], web: webDevices },
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
    expect(store.getState().token).toBe(token);
    expect(store.getState().devices?.web).toEqual(webDevices);
    expect(store.getState().deviceLimit).toEqual({ desktop: 3, web: 3 });
  });

  it('refreshes devices + deviceLimit on revalidate-success', async () => {
    let call = 0;
    const refreshedDevice = {
      id: 'dev_w2',
      deviceId: 'w-uuid-2',
      deviceName: 'Firefox on macOS',
      os: 'web-firefox',
      surface: 'web' as const,
      activatedAt: 1_700_001_000,
      lastSeenAt: 1_700_001_500,
    };
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // Activate.
        return new Response(
          JSON.stringify({
            protocolVersion: 1,
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
      // Status.
      return new Response(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          licenseId: 'lic_1',
          status: 'active',
          tier: 'pro',
          expiresAt: null,
          supportWindowEndsAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
          devices: { desktop: [], web: [refreshedDevice] },
          deviceLimit: { desktop: 3, web: 3 },
          deviceRegistered: true,
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);
    await store.getState().revalidate();

    expect(store.getState().devices?.web).toEqual([refreshedDevice]);
  });

  it('revalidate registers the browser when /licenses/status says the current device is missing', async () => {
    let activateCall = 0;
    const registeredDevice = {
      id: 'dev_current',
      deviceId: 'current-uuid',
      deviceName: 'Chrome on macOS',
      os: 'web-chrome',
      surface: 'web' as const,
      activatedAt: 1_700_002_000,
      lastSeenAt: 1_700_002_500,
    };
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        activateCall += 1;
        return new Response(
          JSON.stringify({
            protocolVersion: 1,
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: activateCall > 1,
            devices: { desktop: [], web: activateCall > 1 ? [registeredDevice] : [] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          licenseId: 'lic_1',
          status: 'active',
          tier: 'pro',
          expiresAt: null,
          supportWindowEndsAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
          deviceRegistered: false,
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);
    const status = await store.getState().revalidate();

    expect(status.kind).toBe('active');
    const activateCalls = fetchMock.mock.calls.filter(
      ([url]) => url === `${SERVER_URL}/licenses/activate`
    );
    expect(activateCalls).toHaveLength(2);
    expect(store.getState().devices?.web).toEqual([registeredDevice]);
  });

  it('revalidate keeps the token invalid when a missing current device hits the server cap', async () => {
    let activateCall = 0;
    const activeDevices = ['a', 'b', 'c'].map((id) => ({
      id: `dev_${id}`,
      deviceId: `w-uuid-${id}`,
      deviceName: `Browser ${id}`,
      os: 'web-chrome',
      surface: 'web' as const,
      activatedAt: 1_700_000_000,
      lastSeenAt: 1_700_000_900,
    }));
    const fetchMock = vi.fn(async (url: Parameters<typeof fetch>[0]) => {
      const requestUrl = String(url);
      if (requestUrl === `${SERVER_URL}/licenses/activate`) {
        activateCall += 1;
        if (activateCall === 1) {
          return new Response(
            JSON.stringify({
              protocolVersion: 1,
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
            protocolVersion: 1,
            ok: false,
            reason: 'exhausted',
            surface: 'web',
            devices: { desktop: [], web: activeDevices },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        );
      }
      return new Response(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          licenseId: 'lic_1',
          status: 'active',
          tier: 'pro',
          expiresAt: null,
          supportWindowEndsAt: Math.floor(Date.now() / 1000) + 90 * 86_400,
          devices: { desktop: [], web: activeDevices },
          deviceLimit: { desktop: 3, web: 3 },
          deviceRegistered: false,
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);
    const status = await store.getState().revalidate();

    expect(status.kind).toBe('invalid');
    if (status.kind === 'invalid') expect(status.reason).toBe('devices-exhausted');
    expect(store.getState().token).toBe(token);
    expect(store.getState().devices?.web).toEqual(activeDevices);
  });

  it('removeDevice POSTs to /licenses/devices/remove and refreshes the cached bucket on success', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        // Initial activate populates the bucket so removeDevice has
        // somewhere to start.
        return new Response(
          JSON.stringify({
            protocolVersion: 1,
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [], web: [{ id: 'old', deviceId: 'old-uuid' }] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        );
      }
      // Remove device — server returns the post-removal bucket.
      return new Response(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          licenseId: 'lic_1',
          removed: true,
          devices: { desktop: [], web: [] },
          deviceLimit: { desktop: 3, web: 3 },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);
    expect(store.getState().devices?.web.length).toBe(1);

    const result = await store.getState().removeDevice('old-uuid');
    expect(result.ok).toBe(true);
    expect(store.getState().devices?.web).toEqual([]);

    // The remove call hit the right URL with the right body — ignore the
    // earlier activate request.
    const removeCalls = fetchMock.mock.calls.filter(
      ([url]) => url === `${SERVER_URL}/licenses/devices/remove`
    );
    expect(removeCalls).toHaveLength(1);
    const [, init] = removeCalls[0]!;
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body.deviceIdToRemove).toBe('old-uuid');
  });

  it('removeDevice preserves the cached bucket on transient unreachable failure so the user can retry', async () => {
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({
            protocolVersion: 1,
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: {
              desktop: [],
              web: [{ id: 'keepme', deviceId: 'keep-uuid' }],
            },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        );
      }
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);

    const result = await store.getState().removeDevice('keep-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unreachable');
    // Bucket survives the failure.
    expect(store.getState().devices?.web.length).toBe(1);
  });

  it('clearLicense resets devices + deviceLimit to null', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            protocolVersion: 1,
            ok: true,
            licenseId: 'lic_1',
            activated: true,
            idempotent: false,
            devices: { desktop: [], web: [{ id: 'a', deviceId: 'a-uuid' }] },
            deviceLimit: { desktop: 3, web: 3 },
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal('fetch', fetchMock);

    const store = await importFreshStore();
    const token = await signLicenseTokenForTest(buildPayload(), privateKeyJwk);
    await store.getState().setLicenseToken(token);
    expect(store.getState().devices).not.toBeNull();

    await store.getState().clearLicense();
    expect(store.getState().devices).toBeNull();
    expect(store.getState().deviceLimit).toBeNull();
  });

  it('clearLicense fires removeDevice with keepalive: true and wipes local state', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            protocolVersion: 1,
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
            protocolVersion: 1,
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

/**
 * RL-061 Slice 3.5 — desktop branch with the extended bridge contract.
 *
 * The desktop branch detects `window.lingua.license` at module-load
 * time and routes every action through it. Slice 3.5 makes the bridge
 * snapshot carry `serverSync` / `devices` / `deviceLimit` so the
 * Devices section can render under the same gate the web build uses.
 * These tests stub the bridge with a controllable mock to assert that
 * the snapshot mirrors all six fields and that `removeDevice`
 * delegates correctly.
 */
describe('licenseStore — desktop bridge branch (Slice 3.5)', () => {
  type LicenseSnapshotMock = {
    token: string | null;
    status:
      | { kind: 'free' }
      | { kind: 'invalid'; reason: string; message?: string }
      | { kind: 'active' | 'grace'; verification: unknown };
    deviceId: string;
    lastVerifiedAt: number | null;
    serverSync: 'synced' | 'unreachable' | 'disabled';
    devices: { desktop: unknown[]; web: unknown[] } | null;
    deviceLimit: { desktop: number; web: number } | null;
  };

  type BridgeMock = {
    getState: ReturnType<typeof vi.fn>;
    applyToken: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
    revalidate: ReturnType<typeof vi.fn>;
    removeDevice: ReturnType<typeof vi.fn>;
  };

  function freeBridgeSnapshot(): LicenseSnapshotMock {
    return {
      token: null,
      status: { kind: 'free' },
      deviceId: 'd-uuid-from-main',
      lastVerifiedAt: null,
      serverSync: 'disabled',
      devices: null,
      deviceLimit: null,
    };
  }

  function activeBridgeSnapshot(token: string, devices: unknown[]): LicenseSnapshotMock {
    return {
      token,
      status: {
        kind: 'active',
        verification: {
          ok: true,
          state: 'active',
          supportWindowEndsAt: Date.now() + 30 * 86_400_000,
          payload: {
            productId: 'lingua-desktop',
            tier: 'pro',
            issuedTo: 'user@example.com',
            issuedAt: new Date().toISOString(),
            supportWindowEndsAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
            entitlements: [],
          },
        },
      },
      deviceId: 'd-uuid-from-main',
      lastVerifiedAt: Date.now(),
      serverSync: 'synced',
      devices: { desktop: devices, web: [] },
      deviceLimit: { desktop: 3, web: 3 },
    };
  }

  function installBridge(bridge: BridgeMock): void {
    vi.stubGlobal('window', {
      ...((globalThis as Record<string, unknown>).window ?? {}),
      lingua: { license: bridge },
      addEventListener: () => undefined,
    });
  }

  async function importFreshStore() {
    vi.resetModules();
    return import('../../src/renderer/stores/licenseStore');
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('mirrors all six snapshot fields (token + status + lastVerifiedAt + serverSync + devices + deviceLimit) on bootstrap', async () => {
    const desktopDevice = {
      id: 'd1',
      deviceId: 'd-uuid-from-main',
      deviceName: 'host',
      os: 'darwin',
      surface: 'desktop',
      activatedAt: 1,
      lastSeenAt: 2,
    };
    const bootstrap = activeBridgeSnapshot('rehydrated.token', [desktopDevice]);
    const bridge: BridgeMock = {
      getState: vi.fn().mockResolvedValue(bootstrap),
      applyToken: vi.fn(),
      clear: vi.fn(),
      revalidate: vi.fn(),
      removeDevice: vi.fn(),
    };
    installBridge(bridge);

    const { useLicenseStore } = await importFreshStore();
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBe('rehydrated.token');
    });
    const state = useLicenseStore.getState();
    expect(state.serverSync).toBe('synced');
    expect(state.devices?.desktop).toEqual([desktopDevice]);
    expect(state.deviceLimit).toEqual({ desktop: 3, web: 3 });
  });

  it('removeDevice delegates to the bridge and applies the returned snapshot', async () => {
    const initial = activeBridgeSnapshot('tok', [
      { id: 'd1', deviceId: 'd-uuid-current', deviceName: 'host', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 },
      { id: 'd2', deviceId: 'd-uuid-other', deviceName: 'other', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 },
    ]);
    const after = activeBridgeSnapshot('tok', [
      { id: 'd1', deviceId: 'd-uuid-current', deviceName: 'host', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 },
    ]);

    const bridge: BridgeMock = {
      getState: vi.fn().mockResolvedValue(initial),
      applyToken: vi.fn(),
      clear: vi.fn(),
      revalidate: vi.fn(),
      removeDevice: vi.fn().mockResolvedValue({
        ok: true,
        data: { removed: true, snapshot: after },
      }),
    };
    installBridge(bridge);

    const { useLicenseStore } = await importFreshStore();
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().devices?.desktop.length).toBe(2);
    });

    const result = await useLicenseStore.getState().removeDevice('d-uuid-other');
    expect(result.ok).toBe(true);
    expect(bridge.removeDevice).toHaveBeenCalledWith('d-uuid-other');
    expect(useLicenseStore.getState().devices?.desktop.length).toBe(1);
  });

  it('removeDevice forwards a tagged-union failure shape so renderer notices fire correctly', async () => {
    const initial = activeBridgeSnapshot('tok', []);
    const bridge: BridgeMock = {
      getState: vi.fn().mockResolvedValue(initial),
      applyToken: vi.fn(),
      clear: vi.fn(),
      revalidate: vi.fn(),
      removeDevice: vi.fn().mockResolvedValue({
        ok: false,
        reason: 'unreachable',
        message: 'Network error',
        issues: ['upstream-timeout'],
      }),
    };
    installBridge(bridge);

    const { useLicenseStore } = await importFreshStore();
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBe('tok');
    });

    const result = await useLicenseStore.getState().removeDevice('d-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unreachable');
      expect(result.issues).toEqual(['upstream-timeout']);
    }
    // Cached bucket survives transient failures.
    expect(useLicenseStore.getState().devices).not.toBeNull();
  });

  it('removeDevice without a token returns invalid-input without calling the bridge', async () => {
    const bridge: BridgeMock = {
      getState: vi.fn().mockResolvedValue(freeBridgeSnapshot()),
      applyToken: vi.fn(),
      clear: vi.fn(),
      revalidate: vi.fn(),
      removeDevice: vi.fn(),
    };
    installBridge(bridge);

    const { useLicenseStore } = await importFreshStore();
    await vi.waitFor(() => {
      expect(useLicenseStore.getState().token).toBeNull();
    });

    const result = await useLicenseStore.getState().removeDevice('d-uuid');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-input');
    expect(bridge.removeDevice).not.toHaveBeenCalled();
  });
});

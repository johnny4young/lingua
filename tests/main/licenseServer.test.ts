/**
 * Unit tests for the RL-061 Slice 3.5 main-side license-server fetch
 * wrappers (`src/main/licenseServer.ts`).
 *
 * Mirror of the renderer wrapper suite (`tests/services/licenseServer.test.ts`)
 * with two key differences:
 *   1. The base URL comes from the build-time
 *      `__LINGUA_LICENSE_SERVER_URL__` define (mocked here via a
 *      runtime env override) rather than `import.meta.env.VITE_*`.
 *   2. There is no `keepalive: true` — main runs in a long-lived
 *      process where the renderer's tab-close edge case cannot
 *      happen.
 *
 * Both wrappers share the canonical shapes from
 * `src/shared/licenseServerTypes.ts`, so the response-mapping tests
 * stay aligned across surfaces.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const BASE_URL = 'https://licenses.test.local';

type FetchMock = Mock<typeof fetch>;

function setServerEnv(url: string | undefined): void {
  // The wrapper checks `process.env.LINGUA_LICENSE_SERVER_URL` first
  // before falling back to the build-time define; in vitest land we
  // just override the env var per test so the runtime path is
  // exercised exactly the way `dev:desktop:prod` would.
  if (url === undefined || url === '') {
    delete process.env.LINGUA_LICENSE_SERVER_URL;
  } else {
    process.env.LINGUA_LICENSE_SERVER_URL = url;
  }
}

async function importService(): Promise<typeof import('../../src/main/licenseServer')> {
  vi.resetModules();
  return import('../../src/main/licenseServer');
}

function mockFetch(): FetchMock {
  const fetchMock = vi.fn() as FetchMock;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ protocolVersion: 1, ...(body as Record<string, unknown>) }), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
  });
}

beforeEach(() => {
  setServerEnv(BASE_URL);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setServerEnv(undefined);
});

describe('isLicenseServerEnabled', () => {
  it('returns true when LINGUA_LICENSE_SERVER_URL is set', async () => {
    const { isLicenseServerEnabled } = await importService();
    expect(isLicenseServerEnabled()).toBe(true);
  });

  it('returns false when the env var is empty', async () => {
    setServerEnv('');
    const { isLicenseServerEnabled } = await importService();
    expect(isLicenseServerEnabled()).toBe(false);
  });

  it('strips trailing slashes off the base URL so duplicate `//licenses/...` paths cannot land', async () => {
    setServerEnv(`${BASE_URL}/`);
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(jsonResponse({ ok: true, licenseId: 'lic_1', activated: true, idempotent: false, devices: { desktop: [], web: [] }, deviceLimit: { desktop: 3, web: 3 } }));

    const { activate } = await importService();
    await activate({
      token: 'tok',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });

    const [url] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/licenses/activate`);
  });
});

describe('activate', () => {
  it('returns disabled when the server URL is unset (dev:desktop with no env)', async () => {
    setServerEnv('');
    const { activate } = await importService();
    const result = await activate({
      token: 'tok',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });

  it('POSTs surface: desktop with the right body shape and returns the success payload', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        activated: true,
        idempotent: false,
        devices: { desktop: [{ id: 'd1', deviceId: 'dev-uuid', deviceName: 'MacBook', os: 'darwin', surface: 'desktop', activatedAt: 1, lastSeenAt: 2 }], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
      })
    );
    const { activate } = await importService();
    const result = await activate({
      token: 'tok-payload',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.licenseId).toBe('lic_1');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/licenses/activate`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({
      token: 'tok-payload',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });
    // Main wrapper does NOT use keepalive — this is desktop, not a
    // browser tab that could close mid-request.
    expect(init?.keepalive).toBeUndefined();
  });

  it('maps a network error to reason: unreachable so the runtime falls back to local-verify', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const { activate } = await importService();
    const result = await activate({
      token: 'tok',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unreachable');
  });

  it('returns the exhausted payload when the server reports the desktop bucket is full', async () => {
    const fetchMock = mockFetch();
    const exhaustedDevices = ['a', 'b', 'c'].map((id) => ({
      id: `dev_${id}`,
      deviceId: `d-uuid-${id}`,
      deviceName: `Mac ${id}`,
      os: 'darwin',
      surface: 'desktop' as const,
      activatedAt: 1,
      lastSeenAt: 2,
    }));
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: false,
        reason: 'exhausted',
        surface: 'desktop',
        devices: { desktop: exhaustedDevices, web: [] },
        deviceLimit: { desktop: 3, web: 3 },
      })
    );
    const { activate } = await importService();
    const result = await activate({
      token: 'tok',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'exhausted') {
      expect(result.devices.desktop).toEqual(exhaustedDevices);
      expect(result.deviceLimit).toEqual({ desktop: 3, web: 3 });
    }
  });

  it('fails closed as unsupported-protocol before interpreting an unversioned 5xx', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      new Response('Internal Server Error', { status: 503 })
    );
    const { activate } = await importService();
    const result = await activate({
      token: 'tok',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-protocol');
  });

  it('forwards the issues array on invalid-input so runtime can console.warn the validator drift', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          reason: 'invalid-input',
          issues: ['os must be lowercase letters/digits with optional hyphens'],
        },
        { status: 400 }
      )
    );
    const { activate } = await importService();
    const result = await activate({
      token: 'tok',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'BadOs',
      surface: 'desktop',
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'invalid-input') {
      expect(result.issues).toEqual([
        'os must be lowercase letters/digits with optional hyphens',
      ]);
    }
  });
});

describe('status', () => {
  it('puts the token in the Authorization header (never the URL query)', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        status: 'active',
        tier: 'pro',
        expiresAt: null,
        supportWindowEndsAt: 1_700_000_000,
        devices: { desktop: [], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
        deviceRegistered: true,
      })
    );
    const { status } = await importService();
    await status({
      token: 'sensitive.token.value',
      deviceId: 'dev-uuid',
      surface: 'desktop',
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/licenses/status');
    // Query string carries non-secret deviceId + surface only.
    expect(String(url)).toContain('deviceId=dev-uuid');
    expect(String(url)).toContain('surface=desktop');
    expect(String(url)).not.toContain('sensitive.token.value');
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer sensitive.token.value');
  });

  it('returns the StatusSuccess payload including refreshedToken when present', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        status: 'active',
        tier: 'pro',
        expiresAt: null,
        supportWindowEndsAt: 1_700_000_000,
        devices: { desktop: [], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
        deviceRegistered: false,
        refreshedToken: 'new.token',
      })
    );
    const { status } = await importService();
    const result = await status({ token: 't', deviceId: 'd', surface: 'desktop' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.deviceRegistered).toBe(false);
      expect(result.refreshedToken).toBe('new.token');
    }
  });
});

describe('removeDevice', () => {
  it('POSTs to /licenses/devices/remove with token + deviceIdToRemove and NO keepalive', async () => {
    const fetchMock = mockFetch();
    fetchMock.mockResolvedValue(
      jsonResponse({
        ok: true,
        licenseId: 'lic_1',
        removed: true,
        devices: { desktop: [], web: [] },
        deviceLimit: { desktop: 3, web: 3 },
      })
    );
    const { removeDevice } = await importService();
    const result = await removeDevice({
      token: 'tok',
      deviceIdToRemove: 'd-uuid-victim',
    });
    expect(result.ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/licenses/devices/remove`);
    expect(init?.method).toBe('POST');
    const body = JSON.parse(init?.body as string);
    expect(body).toEqual({ token: 'tok', deviceIdToRemove: 'd-uuid-victim' });
    expect(init?.keepalive).toBeUndefined();
  });

  it('falls back to disabled when no server URL is configured', async () => {
    setServerEnv('');
    const { removeDevice } = await importService();
    const result = await removeDevice({ token: 't', deviceIdToRemove: 'd' });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
  });
});

describe('fetch unavailable (Electron without Node 22 fetch global)', () => {
  it('returns disabled instead of crashing when global fetch is missing', async () => {
    // Stub fetch to undefined so the wrapper's `typeof fetch !==
    // 'function'` guard triggers. Mirrors a hypothetical older
    // Electron bundle.
    vi.stubGlobal('fetch', undefined);
    const { activate } = await importService();
    const result = await activate({
      token: 'tok',
      deviceId: 'dev-uuid',
      deviceName: 'MacBook',
      os: 'darwin',
      surface: 'desktop',
    });
    expect(result).toEqual({
      ok: false,
      reason: 'disabled',
      message: 'global fetch is not available in this runtime',
    });
  });
});

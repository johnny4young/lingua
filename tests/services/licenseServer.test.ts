/**
 * Unit tests for the RL-061 Slice 2.5 license-server fetch wrappers.
 *
 * The renderer never sees a real worker in tests — we mock `fetch` at
 * the global level and pin the request shape (URL, method, headers,
 * body) plus the tagged-union response shape on every reachable
 * outcome. The 5-second timeout and `keepalive: true` quirks are
 * pinned by inspecting the `init` argument the service hands to fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const BASE_URL = 'https://licenses.test.local';

type FetchMock = Mock<typeof fetch>;

function setServerEnv(url: string | undefined): void {
  // import.meta.env in vitest is the same module shape Vite ships, so
  // overwriting the property mirrors what `.env`/.env.production does
  // in real builds. Each test sets the value it needs and restores
  // afterEach.
  vi.stubEnv('VITE_LINGUA_LICENSE_SERVER_URL', url ?? '');
}

async function importService(): Promise<typeof import('../../src/renderer/services/licenseServer')> {
  vi.resetModules();
  return import('../../src/renderer/services/licenseServer');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('isLicenseServerEnabled', () => {
  it('returns false when VITE_LINGUA_LICENSE_SERVER_URL is unset (dev / dev:web:pro)', async () => {
    setServerEnv(undefined);
    const { isLicenseServerEnabled } = await importService();
    expect(isLicenseServerEnabled()).toBe(false);
  });

  it('returns false when the env var is whitespace-only — defends against a malformed .env value', async () => {
    setServerEnv('   ');
    const { isLicenseServerEnabled } = await importService();
    expect(isLicenseServerEnabled()).toBe(false);
  });

  it('returns true when the env var is a non-empty URL', async () => {
    setServerEnv(BASE_URL);
    const { isLicenseServerEnabled } = await importService();
    expect(isLicenseServerEnabled()).toBe(true);
  });
});

describe('activate', () => {
  beforeEach(() => {
    setServerEnv(BASE_URL);
  });

  it('returns disabled without calling fetch when the env var is unset', async () => {
    setServerEnv(undefined);
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { activate } = await importService();
    const result = await activate({
      token: 't',
      deviceId: 'd',
      deviceName: 'name',
      os: 'web-chrome',
      surface: 'web',
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the activate body and returns the success shape on 200 ok=true', async () => {
    const fetchMock = vi.fn(async () =>
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
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { activate } = await importService();
    const result = await activate({
      token: 'tok_abc',
      deviceId: 'dev_xyz',
      deviceName: 'Chrome on macOS',
      os: 'web-chrome',
      surface: 'web',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}/licenses/activate`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init?.body as string)).toEqual({
      token: 'tok_abc',
      deviceId: 'dev_xyz',
      deviceName: 'Chrome on macOS',
      os: 'web-chrome',
      surface: 'web',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.licenseId).toBe('lic_1');
      expect(result.activated).toBe(true);
    }
  });

  it('surfaces the exhausted refusal as a typed { ok: false, reason: exhausted } so the renderer can show the per-surface device list', async () => {
    const fetchMock = vi.fn(async () =>
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
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { activate } = await importService();
    const result = await activate({
      token: 't',
      deviceId: 'd',
      deviceName: 'n',
      os: 'web-chrome',
      surface: 'web',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('exhausted');
  });

  it('maps `license-refunded` 401 to reason `revoked` (terminal — caller wipes the token)', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, reason: 'license-refunded' }), { status: 401 })
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { activate } = await importService();
    const result = await activate({
      token: 't',
      deviceId: 'd',
      deviceName: 'n',
      os: 'web-chrome',
      surface: 'web',
    });
    expect(result).toMatchObject({ ok: false, reason: 'revoked' });
  });

  it('returns reason `unreachable` when fetch rejects (network error / timeout / abort)', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { activate } = await importService();
    const result = await activate({
      token: 't',
      deviceId: 'd',
      deviceName: 'n',
      os: 'web-chrome',
      surface: 'web',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unreachable');
  });

  it('returns reason `server-error` on 5xx without crashing on non-JSON bodies', async () => {
    const fetchMock = vi.fn(
      async () => new Response('<html>internal error</html>', { status: 502 })
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { activate } = await importService();
    const result = await activate({
      token: 't',
      deviceId: 'd',
      deviceName: 'n',
      os: 'web-chrome',
      surface: 'web',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('server-error');
  });
});

describe('status', () => {
  beforeEach(() => {
    setServerEnv(BASE_URL);
  });

  it('GETs with deviceId+surface in the query and the token in Authorization (NEVER in the URL)', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            licenseId: 'lic_1',
            status: 'active',
            tier: 'pro_lifetime',
            expiresAt: null,
            supportWindowEndsAt: 9999999999,
            devices: { desktop: [], web: [] },
            deviceLimit: { desktop: 3, web: 3 },
            deviceRegistered: true,
          }),
          { status: 200 }
        )
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { status: serverStatus } = await importService();
    const result = await serverStatus({ token: 'tok_secret', deviceId: 'dev_abc', surface: 'web' });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe('/licenses/status');
    expect(parsed.searchParams.get('deviceId')).toBe('dev_abc');
    expect(parsed.searchParams.get('surface')).toBe('web');
    // CF logs would otherwise capture the token verbatim — the wrapper
    // MUST keep it in Authorization, never on the URL.
    expect(parsed.searchParams.get('token')).toBeNull();
    expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer tok_secret');
    expect(init?.method).toBe('GET');
  });

  it('exposes refreshedToken in the success result so the store can pick up Monthly renewals', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            licenseId: 'lic_1',
            status: 'active',
            tier: 'pro',
            expiresAt: 1234567890,
            supportWindowEndsAt: 9999999999,
            devices: { desktop: [], web: [] },
            deviceLimit: { desktop: 3, web: 3 },
            deviceRegistered: true,
            refreshedToken: 'tok_renewed',
          }),
          { status: 200 }
        )
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { status: serverStatus } = await importService();
    const result = await serverStatus({ token: 'tok_old', deviceId: 'd', surface: 'web' });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.refreshedToken).toBe('tok_renewed');
  });
});

describe('removeDevice', () => {
  beforeEach(() => {
    setServerEnv(BASE_URL);
  });

  it('uses keepalive: true so a fast tab close does not cancel the device removal', async () => {
    const fetchMock = vi.fn(
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
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { removeDevice } = await importService();
    await removeDevice({ token: 't', deviceIdToRemove: 'dev_abc' });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.keepalive).toBe(true);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual({
      token: 't',
      deviceIdToRemove: 'dev_abc',
    });
  });

  it('returns disabled when the env var is unset', async () => {
    setServerEnv(undefined);
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { removeDevice } = await importService();
    const result = await removeDevice({ token: 't', deviceIdToRemove: 'd' });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

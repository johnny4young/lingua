/**
 * `license:start-trial`, `license:start-education`, `license:renew-education`
 * and `license:start-recovery`: input validation in main, the fixed request
 * main sends, and how transport failures map onto each flow's union.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LicenseRuntime } from '../../src/main/license';

const BASE_URL = 'https://licenses.test.local';

const ipcHandlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) => {
      ipcHandlers.set(channel, handler);
    },
  },
}));

type FetchMock = Mock<typeof fetch>;

const TRIAL_INPUT = { email: 'me@example.com', deviceId: 'dev-1', deviceName: 'MacBook', os: 'darwin' };

const FLOWS = [
  {
    channel: 'license:start-trial',
    path: '/trials/start',
    input: TRIAL_INPUT,
    success: { ok: true, licenseId: 'lic_1', token: 'tok.sig', tier: 'trial', expiresAt: 1, emailDelivered: true },
  },
  {
    channel: 'license:start-education',
    path: '/education/start',
    input: TRIAL_INPUT,
    success: { ok: true, pending: true, message: 'check email', expiresAt: 1, emailDelivered: true },
  },
  {
    channel: 'license:renew-education',
    path: '/education/renew',
    input: { token: 'tok.sig', email: 'me@uni.edu' },
    success: { ok: true, licenseId: 'lic_1', refreshedToken: 'tok2.sig', expiresAt: 2, emailDelivered: true },
  },
  {
    channel: 'license:start-recovery',
    path: '/licenses/recover/start',
    input: { email: 'me@example.com' },
    success: { ok: true, pending: true, message: 'if it matched' },
  },
] as const;

function setServerEnv(url: string | undefined): void {
  if (url === undefined) delete process.env.LINGUA_LICENSE_SERVER_URL;
  else process.env.LINGUA_LICENSE_SERVER_URL = url;
}

function mockFetch(): FetchMock {
  const fetchMock = vi.fn() as FetchMock;
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify({ protocolVersion: 1, ...(body as Record<string, unknown>) }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function register(runtime: Promise<LicenseRuntime> = new Promise(() => {})): Promise<void> {
  const { registerLicenseHandlers } = await import('../../src/main/ipc/license');
  registerLicenseHandlers(runtime);
}

async function invoke(channel: string, ...args: unknown[]): Promise<Record<string, unknown>> {
  const handler = ipcHandlers.get(channel);
  if (!handler) throw new Error(`no handler for ${channel}`);
  return (await handler({}, ...args)) as Record<string, unknown>;
}

beforeEach(() => {
  ipcHandlers.clear();
  vi.resetModules();
  setServerEnv(BASE_URL);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  setServerEnv(undefined);
});

describe.each(FLOWS)('$channel', ({ channel, path, input, success }) => {
  it('POSTs only the named, trimmed fields to the fixed endpoint', async () => {
    const fetchMock = mockFetch().mockResolvedValue(jsonResponse(success));
    await register();
    const padded = Object.fromEntries(Object.entries(input).map(([key, value]) => [key, `  ${value} `]));

    const result = await invoke(channel, { ...padded, extra: 'dropped', url: 'https://evil.test' });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(`${BASE_URL}${path}`);
    expect(init?.method).toBe('POST');
    expect(JSON.parse(init?.body as string)).toEqual(input);
  });

  it.each([
    ['a non-object', 'tok'],
    ['null', null],
    ['an array', [input]],
  ])('rejects %s before any request', async (_label, bad) => {
    const fetchMock = mockFetch();
    await register();

    const result = await invoke(channel, bad);

    expect(result).toMatchObject({ ok: false, reason: 'invalid-input', issues: ['input must be an object'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('names every missing, blank or non-string field', async () => {
    const fetchMock = mockFetch();
    await register();
    const fields = Object.keys(input);
    const bad = Object.fromEntries(fields.map((field, index) => [field, index % 2 === 0 ? '   ' : 42]));

    const result = await invoke(channel, bad);

    expect(result).toMatchObject({ ok: false, reason: 'invalid-input' });
    expect(result.issues).toEqual(fields.map(field => `${field} is required`));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('enforces the Worker byte caps in UTF-8 bytes', async () => {
    const fetchMock = mockFetch();
    await register();
    // 128 characters but 256 bytes: under the cap if it counted characters.
    const result = await invoke(channel, { ...input, email: 'é'.repeat(128) });

    expect(result).toMatchObject({ ok: false, reason: 'invalid-input', issues: ['email exceeds 254 byte cap'] });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a huge string before trimming or encoding it', async () => {
    const fetchMock = mockFetch();
    await register();
    const encode = vi.spyOn(TextEncoder.prototype, 'encode');

    const result = await invoke(channel, { ...input, email: 'a'.repeat(1_000_000) });

    expect(result).toMatchObject({ ok: false, reason: 'invalid-input', issues: ['email exceeds 254 byte cap'] });
    expect(encode).not.toHaveBeenCalledWith(expect.stringMatching(/^a{255,}$/));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns disabled without a configured server', async () => {
    setServerEnv(undefined);
    const fetchMock = mockFetch();
    await register();

    await expect(invoke(channel, input)).resolves.toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a cleartext non-loopback server URL', async () => {
    setServerEnv('http://licenses.test.local');
    const fetchMock = mockFetch();
    await register();

    await expect(invoke(channel, input)).resolves.toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('maps a network error to unreachable', async () => {
    mockFetch().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND'));
    await register();

    await expect(invoke(channel, input)).resolves.toEqual({
      ok: false,
      reason: 'unreachable',
      message: 'getaddrinfo ENOTFOUND',
    });
  });

  it('maps a 5xx to server-error', async () => {
    mockFetch().mockResolvedValue(jsonResponse({ ok: false, reason: 'boom' }, 503));
    await register();

    await expect(invoke(channel, input)).resolves.toMatchObject({
      ok: false,
      reason: 'server-error',
      message: 'HTTP 503',
    });
  });

  it('maps an unknown worker reason to server-error', async () => {
    mockFetch().mockResolvedValue(jsonResponse({ ok: false, reason: 'brand-new-reason' }, 400));
    await register();

    await expect(invoke(channel, input)).resolves.toMatchObject({ ok: false, reason: 'server-error' });
  });

  it('turns an unexpected throw into server-error instead of rejecting the invoke', async () => {
    const broken = {
      ok: true,
      json: async () => ({ protocolVersion: 1, ...success }),
      get status(): number {
        throw new Error('response exploded');
      },
    } as unknown as Response;
    mockFetch().mockResolvedValue(broken);
    await register();

    await expect(invoke(channel, input)).resolves.toEqual({
      ok: false,
      reason: 'server-error',
      message: 'response exploded',
    });
  });

  it('answers while the license runtime failed to start', async () => {
    mockFetch().mockResolvedValue(jsonResponse(success));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { registerLicenseHandlers } = await import('../../src/main/ipc/license');
    registerLicenseHandlers(Promise.reject(new Error('runtime unavailable')));

    await expect(invoke(channel, input)).resolves.toMatchObject({ ok: true });
  });
});

describe('protocol handshake', () => {
  it.each(['license:start-trial', 'license:start-recovery'])(
    '%s fails closed on an unversioned response',
    async channel => {
      mockFetch().mockResolvedValue(
        new Response(JSON.stringify({ ok: true, pending: true }), { status: 200 })
      );
      await register();
      const input = channel === 'license:start-trial' ? TRIAL_INPUT : { email: 'me@example.com' };

      await expect(invoke(channel, input)).resolves.toEqual({ ok: false, reason: 'unsupported-protocol' });
    }
  );
});

describe('license:start-trial failure detail', () => {
  it('keeps canRecover, retryAfter and issues from the worker', async () => {
    mockFetch().mockResolvedValue(
      jsonResponse({ ok: false, reason: 'trial-unavailable', canRecover: true, retryAfter: 30, issues: ['dup'] })
    );
    await register();

    await expect(invoke('license:start-trial', TRIAL_INPUT)).resolves.toMatchObject({
      ok: false,
      reason: 'trial-unavailable',
      canRecover: true,
      retryAfter: 30,
      issues: ['dup'],
    });
  });
});

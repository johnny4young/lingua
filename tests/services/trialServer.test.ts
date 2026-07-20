/**
 * Unit tests for the renderer's `POST /trials/start` wrapper
 * . Mirrors the licenseServer.test.ts pattern: stub
 * `import.meta.env`, mock `fetch`, pin request + response shapes.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const BASE_URL = 'https://licenses.test.local';

type FetchMock = Mock<typeof fetch>;

function setServerEnv(url: string | undefined): void {
  vi.stubEnv('VITE_LINGUA_LICENSE_SERVER_URL', url ?? '');
}

async function importService(): Promise<typeof import('../../src/renderer/services/trialServer')> {
  vi.resetModules();
  return import('../../src/renderer/services/trialServer');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('startTrial', () => {
  beforeEach(() => {
    setServerEnv(BASE_URL);
  });

  it('returns disabled without calling fetch when the env var is unset', async () => {
    setServerEnv(undefined);
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startTrial } = await importService();
    const result = await startTrial({
      email: 'me@example.com',
      deviceId: 'd',
      deviceName: 'n',
      os: 'web-chrome',
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the trial body and returns the success shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          licenseId: 'lic_1',
          token: 'tok_1.signature',
          tier: 'trial',
          expiresAt: 1234567890,
          emailDelivered: false,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startTrial } = await importService();
    const result = await startTrial({
      email: 'me@example.com',
      deviceId: 'd-1',
      deviceName: 'MacBook',
      os: 'darwin',
    });
    // The transport envelope is stripped after the handshake: the returned
    // payload matches the declared TrialStartSuccess exactly, with no
    // protocolVersion riding along into renderer state.
    expect(result).toEqual({
      ok: true,
      licenseId: 'lic_1',
      token: 'tok_1.signature',
      tier: 'trial',
      expiresAt: 1234567890,
      emailDelivered: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/trials/start`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    );
  });

  it('maps trial-unavailable + canRecover through to the failure shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ protocolVersion: 1, ok: false, reason: 'trial-unavailable', canRecover: true }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startTrial } = await importService();
    const result = await startTrial({
      email: 'taken@example.com',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('trial-unavailable');
      expect(result.canRecover).toBe(true);
    }
  });

  it('collapses legacy duplicate reasons to server-error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ protocolVersion: 1, ok: false, reason: 'trial-exists-device' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startTrial } = await importService();
    const result = await startTrial({
      email: 'me@example.com',
      deviceId: 'used',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result).toMatchObject({ ok: false, reason: 'server-error' });
  });

  it('maps rate-limited with retryAfter', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ protocolVersion: 1, ok: false, reason: 'rate-limited', retryAfter: 1234 }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startTrial } = await importService();
    const result = await startTrial({
      email: 'me@example.com',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('rate-limited');
      expect(result.retryAfter).toBe(1234);
    }
  });

  it('fails closed as unsupported-protocol on an unversioned 5xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('boom', { status: 500 }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startTrial } = await importService();
    const result = await startTrial({
      email: 'me@example.com',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result).toMatchObject({ ok: false, reason: 'unsupported-protocol' });
  });

  it('returns unreachable when fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down')) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startTrial } = await importService();
    const result = await startTrial({
      email: 'me@example.com',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unreachable');
    }
  });
});

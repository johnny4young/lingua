/**
 * Unit tests for `/licenses/recover/start` wrapper .
 *
 * The worker is no-info-leak: every successful call returns the
 * same neutral pending shape. The renderer service mirrors this
 * shape exactly.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const BASE_URL = 'https://licenses.test.local';

type FetchMock = Mock<typeof fetch>;

function setServerEnv(url: string | undefined): void {
  vi.stubEnv('VITE_LINGUA_LICENSE_SERVER_URL', url ?? '');
}

async function importService(): Promise<typeof import('../../src/renderer/services/recoveryServer')> {
  vi.resetModules();
  return import('../../src/renderer/services/recoveryServer');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('startRecovery', () => {
  beforeEach(() => {
    setServerEnv(BASE_URL);
  });

  it('returns disabled without calling fetch when env unset', async () => {
    setServerEnv(undefined);
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startRecovery } = await importService();
    const result = await startRecovery({ email: 'me@example.com' });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the body and returns the neutral pending shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          protocolVersion: 1,
          ok: true,
          pending: true,
          message: 'If that email matches a Lingua license...',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startRecovery } = await importService();
    const result = await startRecovery({ email: 'me@example.com' });
    expect(result).toMatchObject({ ok: true, pending: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/licenses/recover/start`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('returns invalid-input when worker rejects shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ protocolVersion: 1, ok: false, reason: 'invalid-input', issues: ['email is required'] }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startRecovery } = await importService();
    const result = await startRecovery({ email: '' });
    expect(result).toMatchObject({ ok: false, reason: 'invalid-input' });
  });

  it('fails closed as unsupported-protocol on an unversioned 5xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('boom', { status: 503 }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startRecovery } = await importService();
    const result = await startRecovery({ email: 'me@example.com' });
    expect(result).toMatchObject({ ok: false, reason: 'unsupported-protocol' });
  });

  it('returns unreachable on network error', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline')) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startRecovery } = await importService();
    const result = await startRecovery({ email: 'me@example.com' });
    expect(result).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

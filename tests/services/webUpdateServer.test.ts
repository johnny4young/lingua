/**
 * RL-061 Slice 5 — pin the `/web/version` fetch wrapper contract.
 *
 * Renderer never sees a real worker in tests. We mock `fetch` at the
 * global level and pin (a) the request URL, (b) the happy path
 * response shape, (c) the 204-as-null mapping the renderer relies
 * on, and (d) the silent failure modes (network error, malformed
 * JSON, 5xx).
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

type FetchMock = Mock<typeof fetch>;

function setEnv(url: string | undefined): void {
  vi.stubEnv('VITE_LINGUA_UPDATE_SERVER_URL', url ?? '');
}

async function importService() {
  vi.resetModules();
  return import('../../src/renderer/services/webUpdateServer');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('fetchLatestWebVersion', () => {
  it('returns the version on a 200 response', async () => {
    setEnv('https://updates.test.local');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '0.2.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLatestWebVersion } = await importService();
    const result = await fetchLatestWebVersion();

    expect(result).toEqual({ version: '0.2.1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://updates.test.local/web/version',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('falls back to the production base URL when env is unset', async () => {
    setEnv(undefined);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '1.0.0' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLatestWebVersion } = await importService();
    await fetchLatestWebVersion();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://updates.linguacode.dev/web/version',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('returns null on a 204 (no releases yet)', async () => {
    setEnv('https://updates.test.local');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(null, { status: 204 }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLatestWebVersion } = await importService();
    expect(await fetchLatestWebVersion()).toBeNull();
  });

  it('returns null on a 5xx response', async () => {
    setEnv('https://updates.test.local');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('boom', { status: 503 }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLatestWebVersion } = await importService();
    expect(await fetchLatestWebVersion()).toBeNull();
  });

  it('returns null on a network error', async () => {
    setEnv('https://updates.test.local');
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down')) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLatestWebVersion } = await importService();
    expect(await fetchLatestWebVersion()).toBeNull();
  });

  it('returns null when the body is not the expected shape', async () => {
    setEnv('https://updates.test.local');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ tag: '0.2.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLatestWebVersion } = await importService();
    expect(await fetchLatestWebVersion()).toBeNull();
  });

  it('strips a trailing slash from the configured base URL', async () => {
    setEnv('https://updates.test.local/');
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '0.2.1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);

    const { fetchLatestWebVersion } = await importService();
    await fetchLatestWebVersion();

    expect(fetchMock).toHaveBeenCalledWith(
      'https://updates.test.local/web/version',
      expect.anything(),
    );
  });
});

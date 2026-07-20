/**
 * Unit tests for `/education/start` + `/education/renew` wrappers
 * .
 */

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const BASE_URL = 'https://licenses.test.local';

type FetchMock = Mock<typeof fetch>;

function setServerEnv(url: string | undefined): void {
  vi.stubEnv('VITE_LINGUA_LICENSE_SERVER_URL', url ?? '');
}

async function importService(): Promise<typeof import('../../src/renderer/services/educationServer')> {
  vi.resetModules();
  return import('../../src/renderer/services/educationServer');
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('startEducation', () => {
  beforeEach(() => {
    setServerEnv(BASE_URL);
  });

  it('returns disabled without fetch when env unset', async () => {
    setServerEnv(undefined);
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startEducation } = await importService();
    const result = await startEducation({
      email: 'me@school.edu',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the start body and returns the pending shape on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ ok: true, pending: true, message: 'check your email' }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startEducation } = await importService();
    const result = await startEducation({
      email: 'me@stanford.edu',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result).toMatchObject({ ok: true, pending: true });
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE_URL}/education/start`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('maps not-educational onto the tagged failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, reason: 'not-educational' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startEducation } = await importService();
    const result = await startEducation({
      email: 'me@gmail.com',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result).toMatchObject({ ok: false, reason: 'not-educational' });
  });

  it('maps confirmation-email-failed onto the tagged failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          reason: 'confirmation-email-failed',
          emailReason: 'no-api-key',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startEducation } = await importService();
    const result = await startEducation({
      email: 'me@stanford.edu',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result).toMatchObject({ ok: false, reason: 'confirmation-email-failed' });
  });

  it('maps education-unavailable + canRecover through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          reason: 'education-unavailable',
          canRecover: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { startEducation } = await importService();
    const result = await startEducation({
      email: 'enrolled@school.edu',
      deviceId: 'd',
      deviceName: 'n',
      os: 'darwin',
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'education-unavailable',
      canRecover: true,
    });
  });
});

describe('renewEducation', () => {
  beforeEach(() => {
    setServerEnv(BASE_URL);
  });

  it('returns disabled without fetch when env unset', async () => {
    setServerEnv(undefined);
    const fetchMock = vi.fn() as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { renewEducation } = await importService();
    const result = await renewEducation({
      token: 't',
      email: 'me@school.edu',
    });
    expect(result).toEqual({ ok: false, reason: 'disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('POSTs the renew body and returns refreshedToken on success', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          licenseId: 'lic_2',
          refreshedToken: 'new.token',
          expiresAt: 1234567890,
          emailDelivered: true,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { renewEducation } = await importService();
    const result = await renewEducation({
      token: 'old.token',
      email: 'me@school.edu',
    });
    expect(result).toMatchObject({
      ok: true,
      licenseId: 'lic_2',
      refreshedToken: 'new.token',
    });
  });

  it('maps email-mismatch through', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, reason: 'email-mismatch' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      }),
    ) as FetchMock;
    vi.stubGlobal('fetch', fetchMock);
    const { renewEducation } = await importService();
    const result = await renewEducation({
      token: 't',
      email: 'wrong@school.edu',
    });
    expect(result).toMatchObject({ ok: false, reason: 'email-mismatch' });
  });
});

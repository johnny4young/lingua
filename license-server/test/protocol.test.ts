import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import app, { buildInternalErrorResponse } from '../src/index';
import { LICENSE_SERVER_PROTOCOL_VERSION, stampLicenseServerProtocol } from '../src/lib/protocol';

describe('license-server protocol envelope', () => {
  it.each(['/licenses/activate', '/licenses/recover/start', '/trials/start'])(
    'stamps machine-readable %s responses with the authoritative version',
    path => {
      expect(
        stampLicenseServerProtocol(path, {
          ok: true,
          protocolVersion: 999,
        })
      ).toEqual({
        ok: true,
        protocolVersion: LICENSE_SERVER_PROTOCOL_VERSION,
      });
    }
  );

  it.each(['/health', '/education/start', '/webhooks/polar'])(
    'does not extend the RL-141 contract to %s',
    path => {
      const body = { ok: true };
      expect(stampLicenseServerProtocol(path, body)).toBe(body);
    }
  );

  it('versions method and not-found errors under the licensed JSON routes', async () => {
    const methodResponse = await app.request('/licenses/status', { method: 'POST' });
    expect(await methodResponse.json()).toMatchObject({
      ok: false,
      reason: 'method-not-allowed',
      protocolVersion: 1,
    });

    const notFoundResponse = await app.request('/trials/unknown');
    expect(await notFoundResponse.json()).toMatchObject({
      ok: false,
      reason: 'not-found',
      protocolVersion: 1,
    });
  });

  it('versions an unhandled internal error under a licensed JSON path', async () => {
    const probe = new Hono();
    probe.get('/licenses/probe', () => {
      throw new Error('probe failure');
    });
    probe.onError((_error, c) => buildInternalErrorResponse(c));

    const response = await probe.request('/licenses/probe');
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      reason: 'internal-error',
      message: 'Unexpected server error.',
      protocolVersion: 1,
    });
  });
});

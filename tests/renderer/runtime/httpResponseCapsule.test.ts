/**
 * implementation — `httpResponseCapsule.ts` mapping rules.
 *
 * Pinned coverage:
 *   - 2xx → capsule status 'success'.
 *   - 4xx / 5xx → 'error'.
 *   - network-error / cors-error → 'error'.
 *   - timeout → 'timeout'.
 *   - `environment.runner === 'http-client'`.
 *   - `tab.language === 'http'`.
 *   - Source content is a deterministic serialization (method + URL +
 *     sorted headers + body).
 */

import { describe, expect, it } from 'vitest';
import { buildHttpResponseCapsule } from '../../../src/renderer/runtime/httpResponseCapsule';
import {
  createBlankHttpRequest,
  type HttpRequestV1,
  type HttpResponseV1,
} from '../../../src/shared/httpWorkspace';

function makeReq(overrides: Partial<HttpRequestV1> = {}): HttpRequestV1 {
  return {
    ...createBlankHttpRequest({
      id: 'r1',
      now: '2026-05-26T00:00:00.000Z',
      name: 'My request',
    }),
    method: 'POST',
    url: 'https://example.com/api',
    ...overrides,
  };
}

function makeRes(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://example.com/api',
    finalUrl: 'https://example.com/api',
    headers: [],
    body: '{}',
    contentType: 'application/json',
    sizeBytes: 2,
    durationMs: 100,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildHttpResponseCapsule (implementation note bridge)', () => {
  const ARGS = {
    appVersion: '0.4.0',
    requestName: 'My request',
    platform: 'web' as const,
  };

  it('maps 2xx response to capsule status "success"', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq(),
      response: makeRes({ status: 200, kind: 'success' }),
    });
    expect(capsule.result.status).toBe('success');
  });

  it('maps 4xx response to capsule status "error"', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq(),
      response: makeRes({ status: 404, kind: 'client-error' }),
    });
    expect(capsule.result.status).toBe('error');
  });

  it('maps 5xx response to capsule status "error"', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq(),
      response: makeRes({ status: 500, kind: 'server-error' }),
    });
    expect(capsule.result.status).toBe('error');
  });

  it('maps network-error to "error"', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq(),
      response: makeRes({
        status: 0,
        kind: 'network-error',
        errorMessage: 'Failed to fetch',
      }),
    });
    expect(capsule.result.status).toBe('error');
    expect(capsule.result.stderr).toBe('Failed to fetch');
  });

  it('maps timeout to capsule status "timeout"', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq(),
      response: makeRes({ status: 0, kind: 'timeout' }),
    });
    expect(capsule.result.status).toBe('timeout');
  });

  it('pins tab.language and environment.runner', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq(),
      response: makeRes(),
    });
    expect(capsule.tab.language).toBe('http');
    expect(capsule.environment.runner).toBe('http-client');
  });

  it('serializes headers in lexicographic order (content-hash stability)', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq({
        headers: [
          { name: 'Z-Last', value: 'z', enabled: true },
          { name: 'A-First', value: 'a', enabled: true },
        ],
      }),
      response: makeRes(),
    });
    const aIdx = capsule.source.content.indexOf('A-First: a');
    const zIdx = capsule.source.content.indexOf('Z-Last: z');
    expect(aIdx).toBeGreaterThan(-1);
    expect(zIdx).toBeGreaterThan(aIdx);
  });

  it('redacts sensitive header values in source.content', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq({
        headers: [
          {
            name: 'Authorization',
            value: 'Bearer sk-secret-token',
            enabled: true,
          },
          { name: 'X-Custom-Token', value: 'plain-text', enabled: true },
        ],
      }),
      response: makeRes(),
      userSensitiveHeaders: ['x-custom-token'],
    });
    // Baseline name (Authorization) — value redacted regardless of user list.
    expect(capsule.source.content).toContain('Authorization: <redacted>');
    expect(capsule.source.content).not.toContain('Bearer sk-secret-token');
    // User-added name — value redacted because the user listed it.
    expect(capsule.source.content).toContain('X-Custom-Token: <redacted>');
    expect(capsule.source.content).not.toContain('plain-text');
  });

  it('redacts an apiKey auth value even under a CUSTOM header name not in any list (leak regression)', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq({
        auth: {
          kind: 'apiKey',
          apiKeyHeader: 'X-Custom-Auth',
          apiKeyValue: 'super-secret-key',
        },
      }),
      response: makeRes(),
      // The user did NOT list X-Custom-Auth as sensitive — the auth
      // injection must redact it on its own.
      userSensitiveHeaders: [],
    });
    expect(capsule.source.content).toContain('X-Custom-Auth: <redacted>');
    expect(capsule.source.content).not.toContain('super-secret-key');
  });

  it('redacts a Bearer token injected via the Auth tab (no manual header row)', async () => {
    const capsule = await buildHttpResponseCapsule({
      ...ARGS,
      request: makeReq({
        auth: { kind: 'bearer', token: 'sk-bearer-secret' },
      }),
      response: makeRes(),
      userSensitiveHeaders: [],
    });
    expect(capsule.source.content).toContain('Authorization: <redacted>');
    expect(capsule.source.content).not.toContain('sk-bearer-secret');
  });
});

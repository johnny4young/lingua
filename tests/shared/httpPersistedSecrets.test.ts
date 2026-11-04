import { describe, expect, it } from 'vitest';
import { maskPersistedHttpData, secretCaptureValues } from '@/../shared/httpPersistedSecrets';
import { chainValue } from '@/../shared/httpChain';
import type { HttpCaptureRule, HttpRequestV1, HttpResponseV1 } from '@/../shared/httpWorkspaceSchema';

const TOKEN = 'tok_0123456789abcdef';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';

const rule = (targetVariable: string, path = 'access'): HttpCaptureRule => ({ id: targetVariable, source: 'body-json', path, targetVariable, enabled: true });

const response = (body: unknown): HttpResponseV1 => ({
  kind: 'success',
  status: 200,
  statusText: 'OK',
  url: 'https://api.test/login',
  finalUrl: 'https://api.test/login',
  headers: [],
  body: JSON.stringify(body),
  contentType: 'application/json',
  durationMs: 1,
  recordedAt: '2026-11-03T00:00:00.000Z',
} as unknown as HttpResponseV1);

const request = (over: Partial<HttpRequestV1> = {}): HttpRequestV1 => ({ id: 'login', ...over } as unknown as HttpRequestV1);

const data = (req: HttpRequestV1, list: HttpResponseV1[]) => ({
  requests: [req],
  responsesByRequestId: { login: list },
  environments: [],
  collectionVariables: [],
});

describe('what the HTTP store writes to disk', () => {
  it('masks a token a capture surfaced, in the response and the snapshot', () => {
    const snapshot = { version: 1 as const, status: 200, body: JSON.stringify({ access: TOKEN }), recordedAt: '', scrubbers: {} as never };
    const out = maskPersistedHttpData(data(request({ captures: [rule('access_token')], snapshot }), [response({ access: TOKEN, name: 'ada' })]));
    expect(out.responsesByRequestId.login![0]!.body).toBe('{"access":"<redacted>","name":"ada"}');
    expect(out.requests[0]!.snapshot!.body).toBe('{"access":"<redacted>"}');
  });

  it('finds the token in a snapshot whose response is gone', () => {
    const snapshot = { version: 1 as const, status: 200, body: JSON.stringify({ access: TOKEN }), recordedAt: '', scrubbers: {} as never };
    const out = maskPersistedHttpData(data(request({ captures: [rule('jwt')], snapshot }), []));
    expect(out.requests[0]!.snapshot!.body).not.toContain(TOKEN);
  });

  it('gives a chain tag no value from the stored copy', () => {
    const tag = { capture: rule('access_token') } as never;
    const out = maskPersistedHttpData(data(request({ captures: [rule('access_token')] }), [response({ access: TOKEN })]));
    expect(chainValue(tag, response({ access: TOKEN }))).toBe(TOKEN);
    expect(chainValue(tag, out.responsesByRequestId.login![0])).toBeNull();
  });

  it('masks secret rows of every scope, longest first', () => {
    const out = maskPersistedHttpData({
      requests: [request({ variables: [{ id: 'r', key: 'r', value: 'request-secret', secret: true }] })],
      responsesByRequestId: {
        login: [response({ a: 'env-secret-long', b: 'env-secret', c: 'coll-secret', d: 'request-secret', e: 'plain-value' })],
      },
      environments: [{ variables: [
        { id: 'e', key: 'e', value: 'env-secret', secret: true },
        { id: 'l', key: 'l', value: 'env-secret-long', secret: true },
        { id: 'p', key: 'p', value: 'plain-value', secret: false },
      ] } as never],
      collectionVariables: [{ id: 'c', key: 'c', value: 'coll-secret', secret: true }],
    });
    expect(JSON.parse(out.responsesByRequestId.login![0]!.body)).toEqual({ a: '<redacted>', b: '<redacted>', c: '<redacted>', d: '<redacted>', e: 'plain-value' });
  });

  it('leaves the caller state untouched and plain requests as they are', () => {
    const list = [response({ access: TOKEN })];
    const plain = request();
    const out = maskPersistedHttpData(data(plain, list));
    expect(out.requests[0]).toBe(plain);
    expect(list[0]!.body).toContain(TOKEN);
  });
});

describe('secretCaptureValues', () => {
  const body = response({ access: TOKEN, flag: 'true', shape: JWT, name: 'ada lovelace' });

  it('takes a secret name, a marked key or a token shape', () => {
    expect(secretCaptureValues(body, [rule('session', 'access')], new Set())).toEqual([TOKEN]);
    expect(secretCaptureValues(body, [rule('owner', 'name')], new Set(['owner']))).toEqual(['ada lovelace']);
    expect(secretCaptureValues(body, [rule('anything', 'shape')], new Set())).toEqual([JWT]);
  });

  it('skips plain names and short values', () => {
    expect(secretCaptureValues(body, [rule('owner', 'name')], new Set())).toEqual([]);
    expect(secretCaptureValues(body, [rule('auth', 'flag')], new Set())).toEqual([]);
  });
});

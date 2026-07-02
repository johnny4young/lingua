/**
 * T2 — HTTP request chaining. Pure tests for the capture model:
 * extraction per source, the apply-rules reducer, and persistence
 * round-tripping through parseHttpRequest.
 */

import { describe, expect, it } from 'vitest';
import {
  applyCaptureRules,
  createBlankCaptureRule,
  extractCaptureValue,
  parseHttpRequest,
  type HttpCaptureRule,
  type HttpResponseV1,
} from '../../src/shared/httpWorkspace';

function response(overrides: Partial<HttpResponseV1> = {}): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 201,
    statusText: 'Created',
    url: 'https://api.example.com/login',
    finalUrl: 'https://api.example.com/login',
    headers: [
      { name: 'content-type', value: 'application/json', redacted: false },
      { name: 'X-Request-Id', value: 'req-42', redacted: false },
    ],
    body: JSON.stringify({
      data: { token: 'abc.def', count: 3, ok: true, nested: null },
      items: [{ id: 'i-0' }, { id: 'i-1' }],
    }),
    contentType: 'application/json',
    sizeBytes: 80,
    durationMs: 12,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-05-26T00:00:00.000Z',
    ...overrides,
  };
}

function rule(overrides: Partial<HttpCaptureRule> = {}): HttpCaptureRule {
  return {
    id: 'r1',
    source: 'body-json',
    path: 'data.token',
    targetVariable: 'TOKEN',
    enabled: true,
    ...overrides,
  };
}

describe('extractCaptureValue — body-json', () => {
  it('reads a nested string value', () => {
    expect(extractCaptureValue(response(), rule({ path: 'data.token' }))).toBe(
      'abc.def'
    );
  });

  it('stringifies numbers and booleans', () => {
    expect(extractCaptureValue(response(), rule({ path: 'data.count' }))).toBe('3');
    expect(extractCaptureValue(response(), rule({ path: 'data.ok' }))).toBe('true');
  });

  it('reads an array element by both index forms', () => {
    expect(extractCaptureValue(response(), rule({ path: 'items[1].id' }))).toBe(
      'i-1'
    );
    expect(extractCaptureValue(response(), rule({ path: 'items.0.id' }))).toBe(
      'i-0'
    );
  });

  it('returns null for a missing path', () => {
    expect(extractCaptureValue(response(), rule({ path: 'data.nope' }))).toBeNull();
    expect(extractCaptureValue(response(), rule({ path: 'items[9].id' }))).toBeNull();
  });

  it('returns null when the value is an object/array or JSON null', () => {
    expect(extractCaptureValue(response(), rule({ path: 'data' }))).toBeNull();
    expect(extractCaptureValue(response(), rule({ path: 'items' }))).toBeNull();
    expect(extractCaptureValue(response(), rule({ path: 'data.nested' }))).toBeNull();
  });

  it('returns null when the body is not JSON', () => {
    expect(
      extractCaptureValue(response({ body: 'not json' }), rule({ path: 'data.token' }))
    ).toBeNull();
  });

  it('returns null for an empty path', () => {
    expect(extractCaptureValue(response(), rule({ path: '' }))).toBeNull();
  });
});

describe('extractCaptureValue — header + status', () => {
  it('reads a header case-insensitively', () => {
    expect(
      extractCaptureValue(response(), rule({ source: 'header', path: 'x-request-id' }))
    ).toBe('req-42');
  });

  it('returns null for a missing header', () => {
    expect(
      extractCaptureValue(response(), rule({ source: 'header', path: 'x-nope' }))
    ).toBeNull();
  });

  it('reads the numeric status (path ignored)', () => {
    expect(
      extractCaptureValue(response(), rule({ source: 'status', path: '' }))
    ).toBe('201');
  });
});

describe('applyCaptureRules', () => {
  it('collects writes for enabled, targeted, resolving rules only', () => {
    const writes = applyCaptureRules(response(), [
      rule({ id: 'a', path: 'data.token', targetVariable: 'TOKEN' }),
      rule({ id: 'b', path: 'data.token', targetVariable: 'X', enabled: false }),
      rule({ id: 'c', path: 'data.token', targetVariable: '  ' }),
      rule({ id: 'd', path: 'data.miss', targetVariable: 'Y' }),
      rule({ id: 'e', source: 'status', path: '', targetVariable: ' CODE ' }),
    ]);
    expect(writes).toEqual([
      { targetVariable: 'TOKEN', value: 'abc.def' },
      { targetVariable: 'CODE', value: '201' },
    ]);
  });

  it('returns an empty list when nothing resolves', () => {
    expect(applyCaptureRules(response(), [])).toEqual([]);
  });
});

describe('parseHttpRequest — captures persistence', () => {
  const base = {
    version: 1 as const,
    id: 'req-1',
    name: 'Login',
    method: 'POST' as const,
    url: 'https://api.example.com/login',
    headers: [],
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
  };

  it('round-trips valid capture rules', () => {
    const captures: HttpCaptureRule[] = [rule()];
    const parsed = parseHttpRequest({ ...base, captures });
    expect(parsed?.captures).toEqual(captures);
  });

  it('is back-compat: absent captures parse to a request without the field', () => {
    const parsed = parseHttpRequest(base);
    expect(parsed).not.toBeNull();
    expect(parsed?.captures).toBeUndefined();
  });

  it('rejects an invalid capture source', () => {
    expect(
      parseHttpRequest({ ...base, captures: [{ ...rule(), source: 'xml-path' }] })
    ).toBeNull();
  });

  it('rejects a non-array captures field', () => {
    expect(parseHttpRequest({ ...base, captures: 'nope' })).toBeNull();
  });
});

describe('createBlankCaptureRule', () => {
  it('produces an enabled body-json rule with empty path/target', () => {
    const blank = createBlankCaptureRule();
    expect(blank).toMatchObject({
      source: 'body-json',
      path: '',
      targetVariable: '',
      enabled: true,
    });
    expect(blank.id.length).toBeGreaterThan(0);
  });
});

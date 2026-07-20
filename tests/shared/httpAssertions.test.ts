/**
 * internal — HTTP response assertions. Pure tests for the assertion model:
 * per-source extraction, every comparator, the runAssertions reducer,
 * and persistence round-tripping through parseHttpRequest.
 */

import { describe, expect, it } from 'vitest';
import {
  createBlankAssertion,
  createBlankHttpRequest,
  evaluateAssertion,
  parseHttpRequest,
  runAssertions,
  type HttpAssertion,
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
    body: JSON.stringify({ data: { token: 'abc.def', count: 3 }, items: [{ id: 'i-0' }] }),
    contentType: 'application/json',
    sizeBytes: 80,
    durationMs: 42,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  };
}

function assertion(overrides: Partial<HttpAssertion> = {}): HttpAssertion {
  return { ...createBlankAssertion(), id: 'a1', ...overrides };
}

describe('evaluateAssertion', () => {
  it('status equals', () => {
    expect(
      evaluateAssertion(response(), assertion({ source: 'status', comparator: 'equals', expected: '201' })).pass
    ).toBe(true);
    expect(
      evaluateAssertion(response(), assertion({ source: 'status', comparator: 'equals', expected: '200' })).pass
    ).toBe(false);
  });

  it('header exists / not-exists', () => {
    expect(
      evaluateAssertion(response(), assertion({ source: 'header', path: 'x-request-id', comparator: 'exists' })).pass
    ).toBe(true);
    expect(
      evaluateAssertion(response(), assertion({ source: 'header', path: 'x-missing', comparator: 'not-exists' })).pass
    ).toBe(true);
  });

  it('body-json path contains + equals + reports the actual value', () => {
    const contains = evaluateAssertion(
      response(),
      assertion({ source: 'body-json', path: 'data.token', comparator: 'contains', expected: 'abc' })
    );
    expect(contains.pass).toBe(true);
    expect(contains.actual).toBe('abc.def');
    expect(
      evaluateAssertion(response(), assertion({ source: 'body-json', path: 'data.count', comparator: 'equals', expected: '3' })).pass
    ).toBe(true);
  });

  it('response-time less-than / greater-than reads durationMs', () => {
    expect(
      evaluateAssertion(response({ durationMs: 42 }), assertion({ source: 'response-time', comparator: 'less-than', expected: '100' })).pass
    ).toBe(true);
    expect(
      evaluateAssertion(response({ durationMs: 250 }), assertion({ source: 'response-time', comparator: 'less-than', expected: '100' })).pass
    ).toBe(false);
    expect(
      evaluateAssertion(response({ durationMs: 250 }), assertion({ source: 'response-time', comparator: 'greater-than', expected: '100' })).pass
    ).toBe(true);
  });

  it('numeric comparators fail cleanly on non-numeric actual/expected', () => {
    expect(
      evaluateAssertion(response(), assertion({ source: 'body-json', path: 'data.token', comparator: 'less-than', expected: '5' })).pass
    ).toBe(false);
  });

  it('not-equals passes on a miss (null actual)', () => {
    expect(
      evaluateAssertion(response(), assertion({ source: 'body-json', path: 'nope.missing', comparator: 'not-equals', expected: 'x' })).pass
    ).toBe(true);
  });
});

describe('runAssertions', () => {
  it('skips disabled rows and preserves order', () => {
    const results = runAssertions(response(), [
      assertion({ id: 'a', source: 'status', comparator: 'equals', expected: '201' }),
      assertion({ id: 'b', enabled: false, source: 'status', comparator: 'equals', expected: '500' }),
      assertion({ id: 'c', source: 'header', path: 'x-request-id', comparator: 'equals', expected: 'req-42' }),
    ]);
    expect(results.map((r) => r.id)).toEqual(['a', 'c']);
    expect(results.every((r) => r.pass)).toBe(true);
  });
});

describe('assertions persistence', () => {
  it('round-trips through parseHttpRequest', () => {
    const req = {
      ...createBlankHttpRequest({ id: crypto.randomUUID(), name: 'r' }),
      assertions: [assertion({ source: 'status', comparator: 'equals', expected: '200' })],
    };
    const parsed = parseHttpRequest(JSON.parse(JSON.stringify(req)));
    expect(parsed).not.toBeNull();
    expect(parsed?.assertions).toHaveLength(1);
    expect(parsed?.assertions?.[0]?.comparator).toBe('equals');
  });

  it('rejects a structurally invalid assertion row', () => {
    const req = {
      ...createBlankHttpRequest({ id: crypto.randomUUID(), name: 'r' }),
      assertions: [{ id: 'x', source: 'nope', path: '', comparator: 'equals', expected: '', enabled: true }],
    };
    expect(parseHttpRequest(JSON.parse(JSON.stringify(req)))).toBeNull();
  });

  it('loads a request with no assertions field (back-compat)', () => {
    const req = createBlankHttpRequest({ id: crypto.randomUUID(), name: 'r' });
    const parsed = parseHttpRequest(JSON.parse(JSON.stringify(req)));
    expect(parsed).not.toBeNull();
    expect(parsed?.assertions).toBeUndefined();
  });
});

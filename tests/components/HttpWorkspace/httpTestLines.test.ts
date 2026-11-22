import { describe, expect, it } from 'vitest';
import { answerAssertion, assertionExpression, isIncomplete } from '../../../src/renderer/components/HttpWorkspace/httpTestLines';
import type { HttpAssertion, HttpResponseV1 } from '../../../src/shared/httpWorkspaceSchema';

const check = (patch: Partial<HttpAssertion>): HttpAssertion => ({ id: 'a', source: 'status', path: '', comparator: 'equals', expected: '200', enabled: true, ...patch });
const response = { status: 200, durationMs: 141.6, headers: [{ name: 'etag', value: 'W/1' }] } as HttpResponseV1;
const body = { value: { items: [{ status: 'healthy' }], total: 4, meta: { a: 1 } } };

describe('assertionExpression', () => {
  it('writes each check as one line of code', () => {
    expect(assertionExpression(check({}))).toBe('status == 200');
    expect(assertionExpression(check({ source: 'response-time', comparator: 'less-than', expected: '300' }))).toBe('duration < 300 ms');
    expect(assertionExpression(check({ source: 'body-json', path: 'items[0].status', expected: 'healthy' }))).toBe('body.items[0].status == "healthy"');
    expect(assertionExpression(check({ source: 'body-json', path: '[0].id', comparator: 'not-equals', expected: 'null' }))).toBe('body[0].id != null');
    expect(assertionExpression(check({ source: 'header', path: 'content-type', comparator: 'contains', expected: 'json' }))).toBe('header content-type contains "json"');
    expect(assertionExpression(check({ source: 'body-json', path: 'next', comparator: 'not-exists' }))).toBe('body.next not exists');
  });

  it('knows a row that still needs its fields', () => {
    expect(isIncomplete(check({ expected: '' }))).toBe(true);
    expect(isIncomplete(check({ source: 'body-json', path: '' }))).toBe(true);
    expect(isIncomplete(check({ comparator: 'exists', expected: '' }))).toBe(false);
  });
});

describe('answerAssertion', () => {
  const pass = { id: 'a', pass: true, actual: null };
  it('reads the value with its type and gauges a numeric comparison', () => {
    expect(answerAssertion(response, null, check({}), pass)).toEqual({ tag: 'status', value: 200 });
    expect(answerAssertion(response, null, check({ source: 'response-time', comparator: 'less-than', expected: '300' }), pass)).toEqual({
      tag: 'ms',
      value: 142,
      gauge: { fill: (142 / 300) * 100, mark: 100 },
    });
    expect(answerAssertion(response, body, check({ source: 'body-json', path: 'total', comparator: 'greater-than', expected: '0' }), pass)).toEqual({ tag: 'number', value: 4 });
    expect(answerAssertion(response, body, check({ source: 'body-json', path: 'meta' }), pass)).toEqual({ tag: 'object·1', value: { a: 1 } });
    expect(answerAssertion(response, body, check({ source: 'body-json', path: 'items.0.status' }), pass).value).toBe('healthy');
    expect(answerAssertion(response, body, check({ source: 'body-json', path: 'gone' }), pass)).toEqual({ tag: 'body' });
    expect(answerAssertion(response, null, check({ source: 'header', path: 'etag' }), { ...pass, actual: 'W/1' })).toEqual({ tag: 'header', value: 'W/1' });
  });
});

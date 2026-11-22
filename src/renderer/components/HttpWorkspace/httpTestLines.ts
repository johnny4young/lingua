/**
 * Assertion lines for the Tests tab: each check written as code, and the
 * value the response actually gave it, typed, with a gauge for a numeric
 * comparison against its threshold.
 */

import { readJsonPath } from '../../../shared/httpWorkspaceCaptures';
import type { HttpAssertion, HttpAssertionComparator, HttpAssertionResult, HttpAssertionSource, HttpResponseV1 } from '../../../shared/httpWorkspaceSchema';
import { isContainer } from './httpJsonTreeModel';

const OPERATOR: Record<HttpAssertionComparator, string> = {
  equals: '==',
  'not-equals': '!=',
  contains: 'contains',
  exists: 'exists',
  'not-exists': 'not exists',
  'less-than': '<',
  'greater-than': '>',
};

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

function subject(assertion: Pick<HttpAssertion, 'source' | 'path'>): string {
  const path = assertion.path.trim();
  switch (assertion.source) {
    case 'status':
      return 'status';
    case 'response-time':
      return 'duration';
    case 'header':
      return `header ${path}`;
    case 'body-json':
      return path.startsWith('[') ? `body${path}` : `body.${path}`;
  }
}

/** The check as one line of code: `status == 200`, `duration < 300 ms`, `body.items[0].status == "healthy"`. */
export function assertionExpression(assertion: Pick<HttpAssertion, 'source' | 'path' | 'comparator' | 'expected'>): string {
  const head = `${subject(assertion)} ${OPERATOR[assertion.comparator]}`;
  if (assertion.comparator === 'exists' || assertion.comparator === 'not-exists') return head;
  const expected = assertion.expected.trim();
  const shown = NUMERIC.test(expected) || expected === 'true' || expected === 'false' || expected === 'null' ? expected : JSON.stringify(expected);
  return `${head} ${shown}${assertion.source === 'response-time' ? ' ms' : ''}`;
}

/** Sources that read a path: a header name or a JSON path. */
export const usesPath = (source: HttpAssertionSource) => source === 'header' || source === 'body-json';

/** Comparators that compare with an expected value. */
export const usesExpected = (comparator: HttpAssertionComparator) => comparator !== 'exists' && comparator !== 'not-exists';

/** Whether a row still needs its fields filled before it reads as a check. */
export function isIncomplete(assertion: HttpAssertion): boolean {
  return (
    (usesPath(assertion.source) && assertion.path.trim().length === 0) ||
    (usesExpected(assertion.comparator) && assertion.expected.trim().length === 0)
  );
}

export interface AssertionAnswer {
  /** The value's kind: `status`, `ms`, `header`, or the JSON type. */
  readonly tag: string;
  /** The value read, typed; undefined when the response had none. */
  readonly value?: unknown;
  /** Fill and threshold mark, 0–100 of the track, for a numeric comparison. */
  readonly gauge?: { readonly fill: number; readonly mark: number };
}

function jsonTag(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `array·${value.length}`;
  if (isContainer(value)) return `object·${Object.keys(value).length}`;
  return typeof value;
}

function gaugeOf(assertion: HttpAssertion, actual: number): AssertionAnswer['gauge'] {
  if (assertion.comparator !== 'less-than' && assertion.comparator !== 'greater-than') return undefined;
  const threshold = Number(assertion.expected.trim());
  if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(actual) || actual < 0) return undefined;
  const top = Math.max(threshold, actual);
  return { fill: (actual / top) * 100, mark: (threshold / top) * 100 };
}

/**
 * What the response gave an assertion, read with the type it has in the
 * response. `body` is the response body parsed once, or null when it is not JSON.
 */
export function answerAssertion(
  response: HttpResponseV1,
  body: { value: unknown } | null,
  assertion: HttpAssertion,
  result: HttpAssertionResult
): AssertionAnswer {
  switch (assertion.source) {
    case 'status':
      return { tag: 'status', value: response.status };
    case 'response-time': {
      const ms = Math.round(response.durationMs);
      return { tag: 'ms', value: ms, gauge: gaugeOf(assertion, ms) };
    }
    case 'header':
      return result.actual === null ? { tag: 'header' } : { tag: 'header', value: result.actual };
    case 'body-json': {
      const read = body ? readJsonPath(body.value, assertion.path) : { found: false };
      if (!read.found) return { tag: 'body' };
      const gauge = typeof read.value === 'number' ? gaugeOf(assertion, read.value) : undefined;
      return { tag: jsonTag(read.value), value: read.value, ...(gauge ? { gauge } : {}) };
    }
  }
}

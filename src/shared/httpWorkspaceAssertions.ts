/**
 * HTTP response assertions.
 *
 * Assertions reuse the response selectors from the capture leaf while
 * remaining independent from the full HTTP workspace facade.
 */

import { extractCaptureValue } from './httpWorkspaceCaptures';
import type { HttpAssertion, HttpAssertionResult, HttpResponseV1 } from './httpWorkspaceSchema';

/** A fresh assertion row: status equals an empty expected value. */
export function createBlankAssertion(): HttpAssertion {
  return {
    id: crypto.randomUUID(),
    source: 'status',
    path: '',
    comparator: 'equals',
    expected: '',
    enabled: true,
  };
}

/** Read the value checked by an assertion. */
function extractAssertionValue(
  response: HttpResponseV1,
  assertion: HttpAssertion
): string | null {
  if (assertion.source === 'response-time') {
    return String(Math.round(response.durationMs));
  }
  return extractCaptureValue(response, {
    id: assertion.id,
    source: assertion.source,
    path: assertion.path,
    targetVariable: '',
    enabled: true,
  });
}

/** Evaluate one assertion. Pure and non-throwing. */
export function evaluateAssertion(
  response: HttpResponseV1,
  assertion: HttpAssertion
): HttpAssertionResult {
  const actual = extractAssertionValue(response, assertion);
  const expected = assertion.expected.trim();

  let pass: boolean;
  switch (assertion.comparator) {
    case 'exists':
      pass = actual !== null;
      break;
    case 'not-exists':
      pass = actual === null;
      break;
    case 'equals':
      pass = actual !== null && actual === expected;
      break;
    case 'not-equals':
      pass = actual === null || actual !== expected;
      break;
    case 'contains':
      pass = actual !== null && actual.includes(expected);
      break;
    case 'less-than':
    case 'greater-than': {
      const actualNum = actual === null ? Number.NaN : Number(actual);
      const expectedNum = Number(expected);
      if (Number.isNaN(actualNum) || Number.isNaN(expectedNum)) {
        pass = false;
      } else {
        pass =
          assertion.comparator === 'less-than' ? actualNum < expectedNum : actualNum > expectedNum;
      }
      break;
    }
    default:
      pass = false;
  }

  return { id: assertion.id, pass, actual };
}

/** Evaluate enabled assertions in request order. */
export function runAssertions(
  response: HttpResponseV1,
  assertions: ReadonlyArray<HttpAssertion>
): HttpAssertionResult[] {
  const results: HttpAssertionResult[] = [];
  for (const assertion of assertions) {
    if (!assertion.enabled) continue;
    results.push(evaluateAssertion(response, assertion));
  }
  return results;
}

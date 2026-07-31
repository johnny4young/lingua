/**
 * HTTP response capture rules.
 *
 * This dependency-light module lets request-chaining UI and runtime callers
 * create and evaluate captures without loading unrelated HTTP behavior.
 */

import type { HttpCaptureRule, HttpResponseV1 } from './httpWorkspaceSchema';

/** A fresh capture rule for the Capture tab. */
export function createBlankCaptureRule(): HttpCaptureRule {
  return {
    id: crypto.randomUUID(),
    source: 'body-json',
    path: '',
    targetVariable: '',
    enabled: true,
  };
}

/**
 * Walk a JSON body by a dot/bracket path (`data.token`, `items[0].id`,
 * `items.0.id` — both index forms accepted). Returns a JSON primitive as a
 * string and `null` for invalid JSON, misses, objects, or arrays.
 */
function extractJsonPath(body: string, rawPath: string): string | null {
  let current: unknown;
  try {
    current = JSON.parse(body);
  } catch {
    return null;
  }
  const keys = rawPath
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map(key => key.trim())
    .filter(key => key.length > 0);
  if (keys.length === 0) return null;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return null;
    current = (current as Record<string, unknown>)[key];
  }
  if (current === null || current === undefined) return null;
  if (typeof current === 'object') return null;
  if (typeof current === 'string') return current;
  if (typeof current === 'number' || typeof current === 'boolean') {
    return String(current);
  }
  return null;
}

/** Resolve one capture rule against a response. */
export function extractCaptureValue(
  response: HttpResponseV1,
  rule: HttpCaptureRule
): string | null {
  switch (rule.source) {
    case 'status':
      return String(response.status);
    case 'header': {
      const target = rule.path.trim().toLowerCase();
      if (target.length === 0) return null;
      const match = response.headers.find(header => header.name.toLowerCase() === target);
      return match ? match.value : null;
    }
    case 'body-json':
      return extractJsonPath(response.body, rule.path);
    default:
      return null;
  }
}

/** Resolve every enabled, targeted capture that produced a value. */
export function applyCaptureRules(
  response: HttpResponseV1,
  rules: ReadonlyArray<HttpCaptureRule>
): Array<{ targetVariable: string; value: string }> {
  const writes: Array<{ targetVariable: string; value: string }> = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const target = rule.targetVariable.trim();
    if (target.length === 0) continue;
    const value = extractCaptureValue(response, rule);
    if (value === null) continue;
    writes.push({ targetVariable: target, value });
  }
  return writes;
}

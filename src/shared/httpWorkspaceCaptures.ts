/**
 * HTTP response capture rules.
 *
 * This dependency-light module lets request-chaining UI and runtime callers
 * create and evaluate captures without loading unrelated HTTP behavior.
 */

import type { HttpCaptureRule, HttpResponseV1 } from './httpWorkspaceSchema';

/** What a capture rule reads; a stored snapshot has no headers to offer. */
type HttpCaptureSource = Pick<HttpResponseV1, 'status' | 'headers' | 'body'>;

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

let lastBody: string | undefined;
let lastParsed: { value: unknown } | null = null;

/** A body parsed as JSON, or null; the last body is kept, so every check on one response parses it once. */
export function parseJsonBodyOnce(body: string): { value: unknown } | null {
  if (body === lastBody) return lastParsed;
  lastBody = body;
  try {
    lastParsed = { value: JSON.parse(body) as unknown };
  } catch {
    lastParsed = null;
  }
  return lastParsed;
}

/**
 * Walk a parsed JSON value by a dot/bracket path (`data.token`, `items[0].id`,
 * `items.0.id` — both index forms accepted, and `items.length`).
 */
export function readJsonPath(root: unknown, rawPath: string): { found: boolean; value?: unknown } {
  const keys = rawPath
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .map(key => key.trim())
    .filter(key => key.length > 0);
  if (keys.length === 0) return { found: false };
  let current = root;
  for (const key of keys) {
    if (current === null || typeof current !== 'object') return { found: false };
    current = (current as Record<string, unknown>)[key];
  }
  return current === undefined || typeof current === 'function' ? { found: false } : { found: true, value: current };
}

/** A JSON primitive at a path as a string; `null` for invalid JSON, misses, nulls, objects, or arrays. */
function extractJsonPath(body: string, rawPath: string): string | null {
  const parsed = parseJsonBodyOnce(body);
  if (!parsed) return null;
  const { value } = readJsonPath(parsed.value, rawPath);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Resolve one capture rule against a response. */
export function extractCaptureValue(
  response: HttpCaptureSource,
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
  response: HttpCaptureSource,
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

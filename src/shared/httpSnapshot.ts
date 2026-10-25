/**
 * Snapshot assertions: a request keeps one recorded response as its baseline
 * and every later response is diffed against it. Scrubbers run on both sides
 * at compare time, so values that change on every call (timestamps, UUIDs,
 * ids) never count as a change, and changing a scrubber applies at once.
 */

import type { HttpAssertion, HttpResponseSnapshot, HttpResponseV1, HttpSnapshotScrubbers } from './httpWorkspaceSchema';

/** The largest body a snapshot keeps; a larger response cannot be snapshotted. */
export const SNAPSHOT_MAX_BODY_BYTES = 256 * 1024;

export const DEFAULT_SNAPSHOT_SCRUBBERS: HttpSnapshotScrubbers = {
  timestamps: true,
  uuids: true,
  ids: true,
  hostname: false,
  regex: '',
};

const SNAPSHOT_PLACEHOLDERS = {
  timestamp: '‹timestamp›',
  uuid: '‹uuid›',
  id: '‹scrubbed›',
  host: '‹host›',
  regex: '‹scrubbed›',
} as const;

const TIMESTAMP = /\b\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?\b/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const URL_HOST = /\b(https?:\/\/)([^/\s:?#]+)/gi;
// `*_id`: the snake and camel suffixes, never a bare `id`.
const ID_KEY = /(?:_id|[a-z]Id)$/;

function customPattern(source: string): RegExp | null {
  if (source.trim().length === 0) return null;
  try {
    return new RegExp(source, 'g');
  } catch {
    return null;
  }
}

/** One string with the enabled scrubbers applied. */
export function scrubText(text: string, scrubbers: HttpSnapshotScrubbers): string {
  let out = text;
  if (scrubbers.timestamps) out = out.replace(TIMESTAMP, SNAPSHOT_PLACEHOLDERS.timestamp);
  if (scrubbers.uuids) out = out.replace(UUID, SNAPSHOT_PLACEHOLDERS.uuid);
  if (scrubbers.hostname) out = out.replace(URL_HOST, `$1${SNAPSHOT_PLACEHOLDERS.host}`);
  const custom = customPattern(scrubbers.regex);
  if (custom) out = out.replace(custom, SNAPSHOT_PLACEHOLDERS.regex);
  return out;
}

function scrubJson(value: unknown, scrubbers: HttpSnapshotScrubbers, key: string | null): unknown {
  if (scrubbers.ids && key !== null && ID_KEY.test(key) && (value === null || typeof value !== 'object')) return SNAPSHOT_PLACEHOLDERS.id;
  if (typeof value === 'string') return scrubText(value, scrubbers);
  if (Array.isArray(value)) return value.map((entry) => scrubJson(entry, scrubbers, null));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([name, entry]) => [name, scrubJson(entry, scrubbers, name)]));
  }
  return value;
}

export type SnapshotChange =
  | { readonly kind: 'changed'; readonly path: string; readonly before: string; readonly after: string }
  | { readonly kind: 'added'; readonly path: string; readonly after: string }
  | { readonly kind: 'removed'; readonly path: string; readonly before: string };

const show = (value: unknown) => JSON.stringify(value);
const childPath = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : path ? `${path}.${key}` : key);

function diffJson(before: unknown, after: unknown, path: string, out: SnapshotChange[]): void {
  const bothObjects = before !== null && after !== null && typeof before === 'object' && typeof after === 'object';
  if (bothObjects && Array.isArray(before) === Array.isArray(after)) {
    const keys = Array.isArray(before)
      ? Array.from({ length: Math.max(before.length, (after as unknown[]).length) }, (_, index) => index)
      : [...new Set([...Object.keys(before), ...Object.keys(after)])];
    for (const key of keys) {
      const a = (before as Record<string | number, unknown>)[key];
      const b = (after as Record<string | number, unknown>)[key];
      const inBefore = Array.isArray(before) ? (key as number) < before.length : Object.hasOwn(before, key);
      const inAfter = Array.isArray(after) ? (key as number) < (after as unknown[]).length : Object.hasOwn(after, key);
      const next = childPath(path, key);
      if (!inAfter) out.push({ kind: 'removed', path: next, before: show(a) });
      else if (!inBefore) out.push({ kind: 'added', path: next, after: show(b) });
      else diffJson(a, b, next, out);
    }
    return;
  }
  if (show(before) !== show(after)) out.push({ kind: 'changed', path: path || '$', before: show(before), after: show(after) });
}

function parse(body: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

/** Removed and added lines between two texts, in order; equal lines are skipped. */
function diffLines(before: string, after: string, out: SnapshotChange[]): void {
  const a = before.split('\n');
  const b = after.split('\n');
  const max = Math.max(a.length, b.length);
  for (let index = 0; index < max; index += 1) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    const path = `line ${index + 1}`;
    if (left === undefined) out.push({ kind: 'added', path, after: right ?? '' });
    else if (right === undefined) out.push({ kind: 'removed', path, before: left });
    else out.push({ kind: 'changed', path, before: left, after: right });
  }
}

/**
 * What changed between the snapshot and a response, after scrubbing both:
 * the status, then each JSON path (or each line of a non-JSON body).
 */
export function snapshotChanges(snapshot: HttpResponseSnapshot, response: Pick<HttpResponseV1, 'status' | 'body'>): SnapshotChange[] {
  const out: SnapshotChange[] = [];
  if (snapshot.status !== response.status) out.push({ kind: 'changed', path: 'status', before: String(snapshot.status), after: String(response.status) });
  const before = parse(snapshot.body);
  const after = parse(response.body);
  if (before.ok && after.ok) {
    diffJson(scrubJson(before.value, snapshot.scrubbers, null), scrubJson(after.value, snapshot.scrubbers, null), '', out);
  } else {
    diffLines(scrubText(snapshot.body, snapshot.scrubbers), scrubText(response.body, snapshot.scrubbers), out);
  }
  return out;
}

/** A snapshot of a response, or null when its body is too large to keep. */
export function takeSnapshot(response: HttpResponseV1, scrubbers: HttpSnapshotScrubbers): HttpResponseSnapshot | null {
  if (response.tooLarge || new TextEncoder().encode(response.body).length > SNAPSHOT_MAX_BODY_BYTES) return null;
  return { version: 1, status: response.status, body: response.body, recordedAt: response.recordedAt, scrubbers };
}

/**
 * One-click assertions the response supports: its status, its JSON content
 * type, and up to three top-level primitive fields that are neither ids nor
 * values that change on every call.
 */
export function suggestAssertions(response: HttpResponseV1, existing: readonly HttpAssertion[]): Omit<HttpAssertion, 'id'>[] {
  const out: Omit<HttpAssertion, 'id'>[] = [];
  const has = (candidate: Omit<HttpAssertion, 'id'>) =>
    existing.some((row) => row.source === candidate.source && row.path === candidate.path && row.comparator === candidate.comparator);
  const add = (candidate: Omit<HttpAssertion, 'id'>) => {
    if (!has(candidate)) out.push(candidate);
  };
  if (response.status > 0) add({ source: 'status', path: '', comparator: 'equals', expected: String(response.status), enabled: true });
  if (/\bjson\b/i.test(response.contentType)) add({ source: 'header', path: 'content-type', comparator: 'contains', expected: 'json', enabled: true });
  const body = parse(response.body);
  if (body.ok && body.value !== null && typeof body.value === 'object' && !Array.isArray(body.value)) {
    let fields = 0;
    for (const [key, value] of Object.entries(body.value)) {
      if (fields === 3) break;
      if (ID_KEY.test(key) || key === 'id' || value === null || typeof value === 'object') continue;
      // A value that changes on every call would make the suggestion fail next time.
      if (typeof value === 'string' && scrubText(value, DEFAULT_SNAPSHOT_SCRUBBERS) !== value) continue;
      add({ source: 'body-json', path: key, comparator: 'equals', expected: String(value), enabled: true });
      fields += 1;
    }
  }
  return out;
}

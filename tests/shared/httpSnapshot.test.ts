import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SNAPSHOT_SCRUBBERS,
  SNAPSHOT_MAX_BODY_BYTES,
  isUsableScrubPattern,
  scrubText,
  snapshotChanges,
  suggestAssertions,
  takeSnapshot,
} from '../../src/shared/httpSnapshot';
import { createBlankHttpRequest, parseHttpRequest, type HttpResponseV1 } from '../../src/shared/httpWorkspace';

const NOW = '2026-10-25T00:00:00.000Z';
const response = (body: unknown, extra: Partial<HttpResponseV1> = {}): HttpResponseV1 => ({
  version: 1,
  kind: 'success',
  status: 200,
  statusText: 'OK',
  url: 'https://api.example.com',
  finalUrl: 'https://api.example.com',
  headers: [],
  body: typeof body === 'string' ? body : JSON.stringify(body),
  contentType: 'application/json; charset=utf-8',
  sizeBytes: 10,
  durationMs: 12,
  tooLarge: false,
  redactedHeaders: [],
  recordedAt: NOW,
  ...extra,
});
const repo = (extra: Record<string, unknown> = {}) => ({
  id: 1220924684,
  name: 'janusly',
  stargazers_count: 12,
  updated_at: '2026-10-24T18:02:11Z',
  node_id: 'R_kgDOH',
  request: '8b0c1f9a-3c2d-4e5f-9a8b-7c6d5e4f3a2b',
  html_url: 'https://github.com/octocat/janusly',
  ...extra,
});

describe('snapshot diff', () => {
  const snapshot = takeSnapshot(response(repo()), DEFAULT_SNAPSHOT_SCRUBBERS)!;

  it('ignores scrubbed values and reports what really changed', () => {
    const next = response(repo({ stargazers_count: 14, updated_at: '2026-10-25T09:00:00Z', node_id: 'R_other', request: '00000000-1111-4222-8333-444444444444', topics: ['ai', 'workflows'] }));
    expect(snapshotChanges(snapshot, next)).toEqual([
      { kind: 'changed', path: 'stargazers_count', before: '12', after: '14' },
      { kind: 'added', path: 'topics', after: '["ai","workflows"]' },
    ]);
  });

  it('applies a scrubber change to both sides at once', () => {
    const moved = response(repo({ html_url: 'https://mirror.example/octocat/janusly' }));
    expect(snapshotChanges(snapshot, moved)).toHaveLength(1);
    expect(snapshotChanges({ ...snapshot, scrubbers: { ...snapshot.scrubbers, hostname: true } }, moved)).toEqual([]);
    expect(snapshotChanges({ ...snapshot, scrubbers: { ...snapshot.scrubbers, timestamps: false } }, response(repo({ updated_at: 'x' })))[0]?.path).toBe('updated_at');
  });

  it('reports a status change, removed keys and array items', () => {
    const base = takeSnapshot(response({ items: [1, 2, 3], keep: true, gone: 'x' }), DEFAULT_SNAPSHOT_SCRUBBERS)!;
    expect(snapshotChanges(base, response({ items: [1, 5], keep: true }, { status: 201 }))).toEqual([
      { kind: 'changed', path: 'status', before: '200', after: '201' },
      { kind: 'changed', path: 'items[1]', before: '2', after: '5' },
      { kind: 'removed', path: 'items[2]', before: '3' },
      { kind: 'removed', path: 'gone', before: '"x"' },
    ]);
  });

  it('diffs a text body by line', () => {
    const base = takeSnapshot(response('ok\nrequest 8b0c1f9a-3c2d-4e5f-9a8b-7c6d5e4f3a2b\nend', { contentType: 'text/plain' }), DEFAULT_SNAPSHOT_SCRUBBERS)!;
    expect(snapshotChanges(base, response('ok\nrequest 00000000-1111-4222-8333-444444444444\nfinish'))).toEqual([
      { kind: 'changed', path: 'line 3', before: 'end', after: 'finish' },
    ]);
  });

  it('diffs JSON nested past the depth limit by line instead of overflowing', () => {
    const deep = (leaf: number) => '['.repeat(5000) + leaf + ']'.repeat(5000);
    const base = takeSnapshot(response(deep(1)), DEFAULT_SNAPSHOT_SCRUBBERS)!;
    expect(snapshotChanges(base, response(deep(2)))).toEqual([{ kind: 'changed', path: 'line 1', before: deep(1), after: deep(2) }]);
  });

  it('never lets a pattern that matches nothing at all fill the text', () => {
    expect(scrubText('abc', { ...DEFAULT_SNAPSHOT_SCRUBBERS, regex: 'x*' })).toBe('abc');
    expect(scrubText('x'.repeat(5000), { ...DEFAULT_SNAPSHOT_SCRUBBERS, regex: 'x' })).toBe('x'.repeat(5000));
  });

  it('counts one inserted text line as one change', () => {
    const base = takeSnapshot(response('a\nb\nc', { contentType: 'text/plain' }), DEFAULT_SNAPSHOT_SCRUBBERS)!;
    expect(snapshotChanges(base, response('new\na\nb\nc'))).toEqual([{ kind: 'added', path: 'line 1', after: 'new' }]);
  });

  it('scrubs id keys in any case', () => {
    const base = takeSnapshot(response({ USER_ID: 1, requestID: 'a', userId: 2, id: 3 }), DEFAULT_SNAPSHOT_SCRUBBERS)!;
    expect(snapshotChanges(base, response({ USER_ID: 9, requestID: 'b', userId: 8, id: 3 }))).toEqual([]);
    expect(snapshotChanges(base, response({ USER_ID: 1, requestID: 'a', userId: 2, id: 4 }))).toHaveLength(1);
  });

  it('uses a custom pattern and ignores one that does not compile', () => {
    expect(scrubText('order A-123 shipped', { ...DEFAULT_SNAPSHOT_SCRUBBERS, regex: 'A-\\d+' })).toBe('order ‹scrubbed› shipped');
    expect(scrubText('order A-123', { ...DEFAULT_SNAPSHOT_SCRUBBERS, regex: '(' })).toBe('order A-123');
  });

  it('ignores custom patterns that could backtrack for long', () => {
    for (const pattern of ['(a+)+$', '(a|aa)*', '(\\w+\\s?)*', '((ab)+)+', '((a+))+', '\\d*\\d*\\d*x', '(.)\\1', '(?<x>a)\\k<x>']) {
      expect(isUsableScrubPattern(pattern), pattern).toBe(false);
    }
    for (const pattern of ['v\\d+', 'req-[a-z0-9+*]+', '(foo|bar)', '(ab)+', 'v\\d+\\.\\d+']) {
      expect(isUsableScrubPattern(pattern), pattern).toBe(true);
    }
  });

  it('refuses a body larger than the cap, here and when stored', () => {
    expect(takeSnapshot(response('x'.repeat(SNAPSHOT_MAX_BODY_BYTES + 1)), DEFAULT_SNAPSHOT_SCRUBBERS)).toBeNull();
    expect(takeSnapshot(response('{}', { tooLarge: true }), DEFAULT_SNAPSHOT_SCRUBBERS)).toBeNull();
    const big = { version: 1, status: 200, body: 'x'.repeat(SNAPSHOT_MAX_BODY_BYTES + 1), recordedAt: NOW, scrubbers: DEFAULT_SNAPSHOT_SCRUBBERS };
    expect(parseHttpRequest({ ...createBlankHttpRequest({ id: 'r', now: NOW }), snapshot: big })).not.toHaveProperty('snapshot');
  });
});

describe('suggested assertions', () => {
  it('offers the status, a JSON content type and a few plain fields, skipping ids and existing rows', () => {
    const suggestions = suggestAssertions(response(repo({ private: false })), [
      { id: 'a', source: 'status', path: '', comparator: 'equals', expected: '200', enabled: true },
    ]);
    expect(suggestions.map(({ source, path, comparator, expected }) => `${source} ${path} ${comparator} ${expected}`)).toEqual([
      'header content-type contains json',
      'body-json name equals janusly',
      'body-json stargazers_count equals 12',
      'body-json html_url equals https://github.com/octocat/janusly',
    ]);
  });

  it('never suggests a field that looks like a secret', () => {
    const paths = suggestAssertions(response({ access_token: 'eyJhbGciOi', apiKey: 'k', name: 'janusly' }), []).map((row) => row.path);
    expect(paths).toEqual(['', 'content-type', 'name']);
  });
});

describe('snapshot persistence', () => {
  it('keeps a well-formed snapshot and drops a malformed one', () => {
    const snapshot = takeSnapshot(response(repo()), DEFAULT_SNAPSHOT_SCRUBBERS)!;
    const request = { ...createBlankHttpRequest({ id: 'r', now: NOW }), snapshot };
    expect(parseHttpRequest(request)?.snapshot).toEqual(snapshot);
    expect(parseHttpRequest({ ...request, snapshot: { ...snapshot, scrubbers: { ...snapshot.scrubbers, ids: 'yes' } } })).not.toHaveProperty('snapshot');
    expect(parseHttpRequest({ ...request, snapshot: { ...snapshot, version: 2 } })).not.toHaveProperty('snapshot');
    expect(parseHttpRequest({ ...request, snapshot: { ...snapshot, recordedAt: 'yesterday' } })).not.toHaveProperty('snapshot');
    expect(parseHttpRequest({ ...request, snapshot: { ...snapshot, status: 200.5 } })).not.toHaveProperty('snapshot');
  });
});

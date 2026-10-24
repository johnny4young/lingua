import { describe, expect, it } from 'vitest';
import {
  capturedByPath,
  capturePath,
  countJsonNodes,
  jsonPointer,
  nestsDeeperThan,
  normalizeCapturePath,
  searchJson,
  suggestCaptureName,
  truncateText,
  type JsonSegment,
} from '../../../src/renderer/components/HttpWorkspace/httpJsonTreeModel';
import { looksSecret } from '../../../src/shared/httpEnvironment';
import { extractCaptureValue } from '../../../src/shared/httpWorkspaceCaptures';
import type { HttpCaptureRule, HttpResponseV1 } from '../../../src/shared/httpWorkspaceSchema';

const body = {
  items: [
    { id: 101, name: 'runtime', tags: ['a', 'b'] },
    { id: 102, name: 'editor', 'a.b': 1, ' pad': 2, 'x[0]': 3 },
  ],
  page: 1,
  ok: true,
  none: null,
};

function response(json: unknown): HttpResponseV1 {
  return {
    version: 1,
    kind: 'success',
    status: 200,
    statusText: 'OK',
    url: 'https://x.dev',
    finalUrl: 'https://x.dev',
    headers: [],
    body: JSON.stringify(json),
    contentType: 'application/json',
    sizeBytes: 1,
    durationMs: 1,
    tooLarge: false,
    redactedHeaders: [],
    recordedAt: '2026-10-24T00:00:00.000Z',
  };
}

const rule = (path: string, overrides: Partial<HttpCaptureRule> = {}): HttpCaptureRule => ({
  id: path,
  source: 'body-json',
  path,
  targetVariable: 'v',
  enabled: true,
  ...overrides,
});

describe('capture paths', () => {
  it('writes a path the capture walker reads back to the same value', () => {
    const cases: Array<[JsonSegment[], unknown]> = [
      [['items', 0, 'id'], 101],
      [['items', 1, 'name'], 'editor'],
      [['items', 0, 'tags', 1], 'b'],
      [['page'], 1],
      [['ok'], true],
    ];
    for (const [segments, value] of cases) {
      const path = capturePath(segments)!;
      expect(extractCaptureValue(response(body), rule(path)), path).toBe(String(value));
    }
    expect(capturePath(['items', 0, 'id'])).toBe('items[0].id');
    expect(capturePath([3, 'id'])).toBe('[3].id');
    expect(extractCaptureValue(response([{ id: 7 }]), rule(capturePath([0, 'id'])!))).toBe('7');
  });

  it('offers no path for keys the walker cannot address, or for the root', () => {
    expect(capturePath(['items', 1, 'a.b'])).toBeNull();
    expect(capturePath(['items', 1, ' pad'])).toBeNull();
    expect(capturePath(['items', 1, 'x[0]'])).toBeNull();
    expect(capturePath(['', 'x'])).toBeNull();
    expect(capturePath([])).toBeNull();
  });

  it('compares paths in the form the walker reads them', () => {
    expect(normalizeCapturePath('items[0].id')).toBe('items.0.id');
    expect(normalizeCapturePath(' items . 0 . id ')).toBe('items.0.id');
    const marked = capturedByPath([
      rule('items.0.id', { targetVariable: 'lastId' }),
      rule('page', { enabled: false }),
      rule('ok', { targetVariable: '  ' }),
      rule('content-type', { source: 'header' }),
    ]);
    expect([...marked]).toEqual([['items.0.id', 'lastId']]);
  });

  it('names a capture after its last key, unique among the request variables', () => {
    expect(suggestCaptureName(['items', 0, 'id'], new Set())).toBe('id');
    expect(suggestCaptureName(['items', 0, 'id'], new Set(['id', 'id_2']))).toBe('id_3');
    expect(suggestCaptureName([0, 1], new Set())).toBe('value');
    expect(suggestCaptureName(['first name!'], new Set())).toBe('first_name_');
  });

  it('keeps a secret-looking name secret through the suffix and the length cut', () => {
    const suffixed = suggestCaptureName(['auth', 'access_token'], new Set(['access_token']));
    expect(suffixed).toBe('2_access_token');
    expect(looksSecret(suffixed)).toBe(true);
    expect(looksSecret(suggestCaptureName(['apiKey'], new Set(['apiKey'])))).toBe(true);
    const long = suggestCaptureName([`${'x'.repeat(39)}_session_token`], new Set());
    expect(long).toHaveLength(40);
    expect(looksSecret(long)).toBe(true);
    expect(suggestCaptureName(['id'], new Set(['id']))).toBe('id_2');
  });
});

describe('searchJson', () => {
  it('counts matches in keys and values and opens the way to each', () => {
    const search = searchJson(body, 'EDIT');
    expect(search.count).toBe(1);
    expect([...search.hits]).toEqual([jsonPointer(['items', 1, 'name'])]);
    expect([...search.open].sort()).toEqual(['', '/items', '/items/1']);
    const keys = searchJson(body, 'name');
    expect(keys.count).toBe(2);
  });

  it('matches values as the tree shows them and stops at the limit', () => {
    expect(searchJson(body, 'null').count).toBe(1);
    expect(searchJson(body, '"runtime"').count).toBe(1);
    expect(searchJson(Array.from({ length: 50 }, () => 'x'), 'x', 10).count).toBe(10);
    expect(searchJson(body, '').hits.size).toBe(0);
  });

  it('escapes pointers so keys with slashes stay distinct', () => {
    expect(jsonPointer(['a/b', 'c~d'])).toBe('/a~1b/c~0d');
  });
});

describe('countJsonNodes', () => {
  it('counts every node up to the cap', () => {
    expect(countJsonNodes(body, 1_000)).toBe(17);
    expect(countJsonNodes(Array.from({ length: 5_000 }, (_, i) => i), 1_001)).toBe(1_001);
    expect(countJsonNodes('x', 10)).toBe(1);
  });
});

describe('truncateText', () => {
  it('cuts at the limit with an ellipsis and never splits a surrogate pair', () => {
    expect(truncateText('abcdef', 10)).toBe('abcdef');
    expect(truncateText('abcdef', 4)).toBe('abc…');
    const emoji = `ab${'😀'}cd`;
    expect(truncateText(emoji, 4)).toBe('ab…');
    expect(truncateText(emoji, 5)).toBe(`ab${'😀'}…`);
  });
});

describe('hostile depth', () => {
  const chain = (depth: number): unknown => JSON.parse(`${'['.repeat(depth)}"needle"${']'.repeat(depth)}`);

  it('searches a very deep document in linear time and opens every level once', () => {
    const search = searchJson(chain(20_000), 'needle');
    expect(search.count).toBe(1);
    expect(search.open.size).toBe(20_000);
    expect(search.hits.size).toBe(1);
  });

  it('measures depth without recursion', () => {
    expect(nestsDeeperThan(chain(300), 256)).toBe(true);
    expect(nestsDeeperThan(chain(256), 256)).toBe(false);
    expect(nestsDeeperThan(chain(200_000), 256)).toBe(true);
    expect(nestsDeeperThan('flat', 0)).toBe(false);
  });
});

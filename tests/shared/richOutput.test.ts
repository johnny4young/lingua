import { describe, expect, it } from 'vitest';

import {
  detectAutoTable,
  forceTablePayload,
  formatPayloadInlineSummary,
  isExtendedRichKind,
  isRichOutputPayload,
  serializeRichValue,
  tryParseJsonForPayload,
  wrapAsRawText,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
} from '../../src/shared/richOutput';

describe('serializeRichValue', () => {
  it('preserves primitives via the scope serializer', () => {
    expect(serializeRichValue('hello')).toEqual({
      kind: 'primitive',
      type: 'string',
      repr: '"hello"',
    });
    expect(serializeRichValue(42)).toEqual({
      kind: 'primitive',
      type: 'number',
      repr: '42',
    });
    expect(serializeRichValue(true)).toEqual({
      kind: 'primitive',
      type: 'boolean',
      repr: 'true',
    });
    expect(serializeRichValue(null)).toEqual({
      kind: 'primitive',
      type: 'null',
      repr: 'null',
    });
    expect(serializeRichValue(undefined)).toEqual({
      kind: 'primitive',
      type: 'undefined',
      repr: 'undefined',
    });
  });

  it('emits a Date payload for Date instances', () => {
    const date = new Date('2026-05-18T12:00:00.000Z');
    const payload = serializeRichValue(date);
    expect(payload).toEqual({ kind: 'date', iso: '2026-05-18T12:00:00.000Z' });
  });

  it('handles invalid Date safely', () => {
    const payload = serializeRichValue(new Date('not a date'));
    expect(payload).toEqual({ kind: 'date', iso: 'Invalid Date' });
  });

  it('emits a Map payload with size + entries', () => {
    const map = new Map<string, number>([
      ['a', 1],
      ['b', 2],
    ]);
    const payload = serializeRichValue(map);
    expect(payload.kind).toBe('map');
    if (payload.kind !== 'map') throw new Error('expected map');
    expect(payload.size).toBe(2);
    expect(payload.entries).toHaveLength(2);
    expect(payload.entries[0]).toEqual({
      key: { kind: 'primitive', type: 'string', repr: '"a"' },
      value: { kind: 'primitive', type: 'number', repr: '1' },
    });
    expect(payload.truncatedCount).toBeUndefined();
  });

  it('truncates Map past the cap', () => {
    const entries: Array<[number, number]> = [];
    for (let i = 0; i < 150; i += 1) entries.push([i, i * 2]);
    const map = new Map(entries);
    const payload = serializeRichValue(map);
    if (payload.kind !== 'map') throw new Error('expected map');
    expect(payload.size).toBe(150);
    expect(payload.entries).toHaveLength(100);
    expect(payload.truncatedCount).toBe(50);
  });

  it('emits a Set payload with size + entries', () => {
    const set = new Set([1, 2, 3]);
    const payload = serializeRichValue(set);
    expect(payload.kind).toBe('set');
    if (payload.kind !== 'set') throw new Error('expected set');
    expect(payload.size).toBe(3);
    expect(payload.entries).toHaveLength(3);
  });

  it('flags Promise instances without awaiting', () => {
    const pending = new Promise(() => {});
    const payload = serializeRichValue(pending);
    expect(payload).toEqual({ kind: 'promise', state: 'pending' });
  });

  it('flags thenable objects as promises', () => {
    const fakePromise = { then: () => fakePromise };
    const payload = serializeRichValue(fakePromise);
    expect(payload.kind).toBe('promise');
  });

  it('upgrades arrays of plain objects to a table payload', () => {
    const rows = [
      { name: 'alice', age: 30 },
      { name: 'bob', age: 25 },
    ];
    const payload = serializeRichValue(rows);
    expect(payload.kind).toBe('table');
    if (payload.kind !== 'table') throw new Error('expected table');
    expect(payload.columns).toEqual(['name', 'age']);
    expect(payload.rows).toHaveLength(2);
    expect(payload.rows[0]?.[0]).toEqual({ kind: 'primitive', type: 'string', repr: '"alice"' });
    expect(payload.rows[0]?.[1]).toEqual({ kind: 'primitive', type: 'number', repr: '30' });
  });

  it('falls back to ScopeValue for unrelated shapes', () => {
    const payload = serializeRichValue({ a: 1, b: 'two' });
    expect(payload.kind).toBe('object');
    if (payload.kind !== 'object') throw new Error('expected object');
    expect(payload.previewType).toBe('Object');
    expect(payload.entries).toHaveLength(2);
  });
});

describe('detectAutoTable', () => {
  it('returns null for non-arrays', () => {
    expect(detectAutoTable({})).toBeNull();
    expect(detectAutoTable('abc')).toBeNull();
    expect(detectAutoTable(null)).toBeNull();
  });

  it('returns null for empty arrays', () => {
    expect(detectAutoTable([])).toBeNull();
  });

  it('returns null for arrays of primitives', () => {
    expect(detectAutoTable([1, 2, 3])).toBeNull();
    expect(detectAutoTable(['a', 'b'])).toBeNull();
  });

  it('returns null for arrays mixing objects and primitives', () => {
    expect(detectAutoTable([{ a: 1 }, 2])).toBeNull();
  });

  it('returns null when the key union exceeds the column cap', () => {
    const wide: Record<string, number>[] = [];
    for (let i = 0; i < MAX_TABLE_COLUMNS + 5; i += 1) {
      wide.push({ [`k${i}`]: i });
    }
    expect(detectAutoTable(wide)).toBeNull();
  });

  it('detects a homogeneous row-set', () => {
    const table = detectAutoTable([
      { a: 1, b: 'x' },
      { a: 2, b: 'y' },
    ]);
    expect(table).not.toBeNull();
    expect(table?.columns).toEqual(['a', 'b']);
    expect(table?.rows).toHaveLength(2);
  });

  it('fills missing keys with undefined cells', () => {
    const table = detectAutoTable([{ a: 1 }, { b: 2 }]);
    expect(table?.columns).toEqual(['a', 'b']);
    expect(table?.rows[0]?.[1]).toEqual({
      kind: 'primitive',
      type: 'undefined',
      repr: 'undefined',
    });
  });

  it('truncates beyond MAX_TABLE_ROWS', () => {
    const big = Array.from({ length: MAX_TABLE_ROWS + 50 }, (_, i) => ({ idx: i }));
    const table = detectAutoTable(big);
    expect(table?.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(table?.truncatedRowCount).toBe(50);
  });
});

describe('forceTablePayload', () => {
  it('uses the auto-table layout when the input fits the heuristic', () => {
    const payload = forceTablePayload([{ a: 1 }, { a: 2 }]);
    expect(payload.columns).toEqual(['a']);
    expect(payload.rows).toHaveLength(2);
  });

  it('wraps a primitive in a single-cell table', () => {
    const payload = forceTablePayload(42);
    expect(payload.columns).toEqual(['value']);
    expect(payload.rows).toHaveLength(1);
    expect(payload.rows[0]?.[0]).toEqual({ kind: 'primitive', type: 'number', repr: '42' });
  });

  it('wraps an array of primitives in one column keyed value', () => {
    const payload = forceTablePayload([1, 2, 3]);
    expect(payload.columns).toEqual(['value']);
    expect(payload.rows).toHaveLength(3);
  });

  it('renders a plain object as a single-row table', () => {
    const payload = forceTablePayload({ a: 1, b: 'two' });
    expect(payload.columns).toEqual(['a', 'b']);
    expect(payload.rows).toHaveLength(1);
  });

  it('truncates long arrays of primitives', () => {
    const payload = forceTablePayload(Array.from({ length: MAX_TABLE_ROWS + 10 }, (_, i) => i));
    expect(payload.rows).toHaveLength(MAX_TABLE_ROWS);
    expect(payload.truncatedRowCount).toBe(10);
  });

  it('returns an empty table for an empty plain object', () => {
    const payload = forceTablePayload({});
    expect(payload).toEqual({ kind: 'table', columns: [], rows: [] });
  });
});

describe('tryParseJsonForPayload', () => {
  it('parses well-formed JSON', () => {
    const result = tryParseJsonForPayload('[{"a":1}]');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value).toEqual([{ a: 1 }]);
  });

  it('skips non-JSON-shaped strings', () => {
    expect(tryParseJsonForPayload('hello world').ok).toBe(false);
    expect(tryParseJsonForPayload('').ok).toBe(false);
    expect(tryParseJsonForPayload('   ').ok).toBe(false);
  });

  it('handles bare numbers', () => {
    const result = tryParseJsonForPayload('42');
    expect(result.ok).toBe(true);
  });

  it('accepts JSON literals true / false / null', () => {
    expect(tryParseJsonForPayload('true')).toEqual({ ok: true, value: true });
    expect(tryParseJsonForPayload('false')).toEqual({ ok: true, value: false });
    expect(tryParseJsonForPayload('null')).toEqual({ ok: true, value: null });
  });

  it('returns ok=false on malformed JSON', () => {
    expect(tryParseJsonForPayload('[1, 2').ok).toBe(false);
    expect(tryParseJsonForPayload('{"a":').ok).toBe(false);
  });
});

describe('formatPayloadInlineSummary', () => {
  it('formats a table payload with row/column counts and column names', () => {
    const summary = formatPayloadInlineSummary({
      kind: 'table',
      columns: ['name', 'age'],
      rows: [[], [], []],
    });
    expect(summary).toEqual({
      display: 'Table(3×2) — name, age',
      kindLabel: 'table',
    });
  });

  it('reports the elided rows in the count when truncated', () => {
    const summary = formatPayloadInlineSummary({
      kind: 'table',
      columns: ['x'],
      rows: [[], []],
      truncatedRowCount: 8,
    });
    expect(summary?.display).toBe('Table(10×1) — x');
  });

  it('handles an empty table without column names', () => {
    const summary = formatPayloadInlineSummary({
      kind: 'table',
      columns: [],
      rows: [],
    });
    expect(summary?.display).toBe('Table(0×0)');
  });

  it.each([
    ['map' as const, { kind: 'map' as const, size: 5, entries: [] }, 'Map(5)'],
    ['set' as const, { kind: 'set' as const, size: 7, entries: [] }, 'Set(7)'],
    ['date' as const, { kind: 'date' as const, iso: '2026-05-18T00:00:00.000Z' }, '2026-05-18T00:00:00.000Z'],
    [
      'promise' as const,
      { kind: 'promise' as const, state: 'pending' as const },
      'Promise (pending)',
    ],
  ])('formats %s payloads', (_kind, payload, expected) => {
    const summary = formatPayloadInlineSummary(payload);
    expect(summary?.display).toBe(expected);
  });

  it('returns null for payload kinds that have no inline summary', () => {
    expect(
      formatPayloadInlineSummary({ kind: 'primitive', type: 'string', repr: '"a"' })
    ).toBeNull();
    expect(formatPayloadInlineSummary({ kind: 'rawText', text: 'hi' })).toBeNull();
    expect(
      formatPayloadInlineSummary({ kind: 'object', previewType: 'Object', entries: [] })
    ).toBeNull();
  });
});

describe('payload identity helpers', () => {
  it('isRichOutputPayload only accepts objects with a known discriminant', () => {
    expect(isRichOutputPayload({ kind: 'rawText', text: 'hi' })).toBe(true);
    expect(isRichOutputPayload({ kind: 'table', columns: [], rows: [] })).toBe(true);
    expect(isRichOutputPayload({ kind: 'primitive', type: 'string', repr: '"a"' })).toBe(true);
    expect(isRichOutputPayload({})).toBe(false);
    expect(isRichOutputPayload(null)).toBe(false);
    expect(isRichOutputPayload('string')).toBe(false);
    // internal reviewer follow-up — unknown discriminants must NOT
    // pass the type-guard so renderer dispatch switches can rely on
    // exhaustiveness when implementation widen the union.
    expect(isRichOutputPayload({ kind: 'widget' })).toBe(false);
    expect(isRichOutputPayload({ kind: 'somethingElse' })).toBe(false);
  });

  it('isExtendedRichKind separates ScopeValue from the new variants', () => {
    expect(isExtendedRichKind({ kind: 'table', columns: [], rows: [] })).toBe(true);
    expect(isExtendedRichKind({ kind: 'rawText', text: 'hi' })).toBe(true);
    expect(isExtendedRichKind({ kind: 'primitive', type: 'string', repr: '"a"' })).toBe(false);
    expect(
      isExtendedRichKind({ kind: 'object', previewType: 'Object', entries: [] })
    ).toBe(false);
  });
});

describe('wrapAsRawText', () => {
  it('wraps a string as a rawText payload', () => {
    expect(wrapAsRawText('hi there')).toEqual({ kind: 'rawText', text: 'hi there' });
  });
});

describe('RichOutputOrigin ', () => {
  it('accepts an origin field on every kind without breaking the discriminant', () => {
    const datePayload = { kind: 'date', iso: '2026-05-22T00:00:00.000Z', origin: { line: 7 } };
    const tablePayload = {
      kind: 'table',
      columns: ['a'],
      rows: [],
      origin: { line: 12, column: 4 },
    };
    const rawTextPayload = { kind: 'rawText', text: 'x', origin: { line: 3 } };
    expect(isRichOutputPayload(datePayload)).toBe(true);
    expect(isRichOutputPayload(tablePayload)).toBe(true);
    expect(isRichOutputPayload(rawTextPayload)).toBe(true);
  });

  it('preserves origin through a JSON round-trip (postMessage simulation)', () => {
    const original = { kind: 'rawText', text: 'hello', origin: { line: 42, column: 8 } };
    const transported = JSON.parse(JSON.stringify(original));
    expect(transported).toEqual(original);
    expect(transported.origin.line).toBe(42);
    expect(transported.origin.column).toBe(8);
  });

  it('serializeRichValue does not stamp origin on its own (callers attach after)', () => {
    const payload = serializeRichValue(42);
    expect(payload).toEqual({ kind: 'primitive', type: 'number', repr: '42' });
    expect((payload as { origin?: unknown }).origin).toBeUndefined();
  });

  it('callers can stamp origin onto any payload variant', () => {
    const payload = serializeRichValue([1, 2, 3]);
    (payload as { origin?: { line: number; column?: number } }).origin = { line: 5 };
    expect((payload as { origin?: { line: number } }).origin?.line).toBe(5);
  });
});

/**
 * RL-020 Slice 9 — shared scope-snapshot helpers.
 *
 * Covers the pure layer of the variable inspector:
 *   - `serializeScopeValue` recurses 1 level by default, deeper
 *     when asked, with the same truncation behavior used by the
 *     workers.
 *   - Object / array entry caps emit `truncatedCount`.
 *   - Circular references surface as `kind: 'error'`.
 *   - `bucketVariableCount` matches the closed-enum buckets.
 *   - `finalizeScopeSnapshot` caps at `MAX_TOP_LEVEL_VARS` and
 *     gracefully handles oversized payloads.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_OBJECT_ENTRIES,
  MAX_TOP_LEVEL_VARS,
  VARIABLE_COUNT_BUCKETS,
  bucketVariableCount,
  finalizeScopeSnapshot,
  serializeScopeValue,
} from '../../src/shared/scopeSnapshot';

const identityTruncate = (input: string) => input;

describe('RL-020 Slice 9 — serializeScopeValue', () => {
  it('renders primitives with the right kind + repr', () => {
    expect(serializeScopeValue(1, { truncate: identityTruncate })).toEqual({
      kind: 'primitive',
      type: 'number',
      repr: '1',
    });
    expect(serializeScopeValue('hi', { truncate: identityTruncate })).toEqual({
      kind: 'primitive',
      type: 'string',
      repr: '"hi"',
    });
    expect(serializeScopeValue(null, { truncate: identityTruncate })).toEqual({
      kind: 'primitive',
      type: 'null',
      repr: 'null',
    });
    expect(
      serializeScopeValue(undefined, { truncate: identityTruncate })
    ).toEqual({ kind: 'primitive', type: 'undefined', repr: 'undefined' });
    expect(serializeScopeValue(true, { truncate: identityTruncate })).toEqual({
      kind: 'primitive',
      type: 'boolean',
      repr: 'true',
    });
  });

  it('renders functions as `kind: function` with the name', () => {
    function greet() {}
    expect(serializeScopeValue(greet, { truncate: identityTruncate })).toEqual({
      kind: 'function',
      name: 'greet',
    });
  });

  it('renders arrays with 1-level entries by default', () => {
    const result = serializeScopeValue([1, 2, 3], { truncate: identityTruncate });
    if (result.kind !== 'array') throw new Error('expected array');
    expect(result.length).toBe(3);
    expect(result.entries.map((entry) => entry.value)).toEqual([
      { kind: 'primitive', type: 'number', repr: '1' },
      { kind: 'primitive', type: 'number', repr: '2' },
      { kind: 'primitive', type: 'number', repr: '3' },
    ]);
  });

  it('renders objects with 1-level entries by default', () => {
    const result = serializeScopeValue(
      { a: 1, b: 'hi' },
      { truncate: identityTruncate }
    );
    if (result.kind !== 'object') throw new Error('expected object');
    expect(result.entries).toEqual([
      { key: 'a', value: { kind: 'primitive', type: 'number', repr: '1' } },
      { key: 'b', value: { kind: 'primitive', type: 'string', repr: '"hi"' } },
    ]);
  });

  it('caps deeper nesting at depth 1 by default (nested object collapses)', () => {
    const result = serializeScopeValue(
      { outer: { inner: 1 } },
      { truncate: identityTruncate }
    );
    if (result.kind !== 'object') throw new Error('expected object');
    expect(result.entries[0]?.key).toBe('outer');
    if (result.entries[0]?.value.kind !== 'object') {
      throw new Error('expected nested object');
    }
    // Default maxDepth=1 — nested entries should be empty.
    expect(result.entries[0]?.value.entries).toEqual([]);
  });

  it('honors maxDepth=2 for recursive expansion', () => {
    const result = serializeScopeValue(
      { outer: { inner: 1 } },
      { truncate: identityTruncate, maxDepth: 2 }
    );
    if (result.kind !== 'object') throw new Error('expected object');
    const outer = result.entries[0]?.value;
    if (!outer || outer.kind !== 'object') throw new Error('expected outer');
    expect(outer.entries[0]).toEqual({
      key: 'inner',
      value: { kind: 'primitive', type: 'number', repr: '1' },
    });
  });

  it('emits truncatedCount when an object has more entries than the cap', () => {
    const big: Record<string, number> = {};
    for (let i = 0; i < MAX_OBJECT_ENTRIES + 5; i += 1) big[`k${i}`] = i;
    const result = serializeScopeValue(big, { truncate: identityTruncate });
    if (result.kind !== 'object') throw new Error('expected object');
    expect(result.entries.length).toBe(MAX_OBJECT_ENTRIES);
    expect(result.truncatedCount).toBe(5);
  });

  it('detects circular references and emits kind: error', () => {
    const a: Record<string, unknown> = {};
    a.self = a;
    const result = serializeScopeValue(a, {
      truncate: identityTruncate,
      maxDepth: 2,
    });
    if (result.kind !== 'object') throw new Error('expected object');
    expect(result.entries[0]?.key).toBe('self');
    expect(result.entries[0]?.value.kind).toBe('error');
  });

  it('does not treat shared references as circular references', () => {
    const shared = { value: 1 };
    const result = serializeScopeValue(
      { first: shared, second: shared },
      { truncate: identityTruncate, maxDepth: 2 }
    );
    if (result.kind !== 'object') throw new Error('expected object');
    expect(result.entries[0]?.value.kind).toBe('object');
    expect(result.entries[1]?.value.kind).toBe('object');
  });

  it('renders Error instances as `kind: error`', () => {
    const result = serializeScopeValue(new TypeError('boom'), {
      truncate: identityTruncate,
    });
    expect(result.kind).toBe('error');
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.message).toContain('TypeError');
    expect(result.message).toContain('boom');
  });
});

describe('RL-020 Slice 9 — bucketVariableCount', () => {
  it('maps each count to the closed-enum bucket', () => {
    expect(bucketVariableCount(0)).toBe('0');
    expect(bucketVariableCount(1)).toBe('1-5');
    expect(bucketVariableCount(5)).toBe('1-5');
    expect(bucketVariableCount(6)).toBe('6-20');
    expect(bucketVariableCount(20)).toBe('6-20');
    expect(bucketVariableCount(21)).toBe('21-50');
    expect(bucketVariableCount(50)).toBe('21-50');
    expect(bucketVariableCount(51)).toBe('51+');
    expect(bucketVariableCount(9999)).toBe('51+');
  });

  it('only emits values in the closed enum', () => {
    for (const count of [0, 5, 6, 20, 21, 50, 51, 5000]) {
      expect(VARIABLE_COUNT_BUCKETS).toContain(bucketVariableCount(count));
    }
  });
});

describe('RL-020 Slice 9 — finalizeScopeSnapshot', () => {
  it('caps top-level variables at MAX_TOP_LEVEL_VARS', () => {
    const variables = Array.from({ length: MAX_TOP_LEVEL_VARS + 25 }, (_, index) => ({
      name: `v${index}`,
      value: {
        kind: 'primitive' as const,
        type: 'number' as const,
        repr: String(index),
      },
    }));
    const snapshot = finalizeScopeSnapshot('javascript', variables);
    expect(snapshot.variables.length).toBe(MAX_TOP_LEVEL_VARS);
    expect(snapshot.truncatedCount).toBe(25);
  });

  it('passes through small snapshots unchanged', () => {
    const snapshot = finalizeScopeSnapshot('python', [
      {
        name: 'x',
        value: { kind: 'primitive', type: 'number', repr: '1' },
      },
    ]);
    expect(snapshot.language).toBe('python');
    expect(snapshot.variables.length).toBe(1);
    expect(snapshot.truncatedCount).toBeUndefined();
    expect(typeof snapshot.capturedAt).toBe('number');
  });
});

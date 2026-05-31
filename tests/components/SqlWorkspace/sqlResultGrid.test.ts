/**
 * SQL workspace USABILITY upgrade — pure grid helper tests.
 *
 * Covers the in-memory sort (asc/desc/off toggle + type-aware
 * ordering + stability) and the result filter (substring match across
 * cells, what-you-see stringification).
 */

import { describe, expect, it } from 'vitest';
import {
  filterRows,
  nextSortState,
  sortRows,
  type SqlSortState,
} from '../../../src/renderer/components/SqlWorkspace/sqlResultGrid';

const UNSORTED: SqlSortState = { column: null, direction: 'asc' };

describe('nextSortState', () => {
  it('first click on a column sorts ascending', () => {
    expect(nextSortState(UNSORTED, 'a')).toEqual({
      column: 'a',
      direction: 'asc',
    });
  });

  it('second click on the same column flips to descending', () => {
    expect(nextSortState({ column: 'a', direction: 'asc' }, 'a')).toEqual({
      column: 'a',
      direction: 'desc',
    });
  });

  it('third click on the same column clears the sort', () => {
    expect(nextSortState({ column: 'a', direction: 'desc' }, 'a')).toEqual({
      column: null,
      direction: 'asc',
    });
  });

  it('clicking a different column resets to ascending on the new column', () => {
    expect(nextSortState({ column: 'a', direction: 'desc' }, 'b')).toEqual({
      column: 'b',
      direction: 'asc',
    });
  });
});

describe('sortRows', () => {
  it('returns rows unchanged when the sort column is null', () => {
    const rows = [{ a: 3 }, { a: 1 }, { a: 2 }];
    expect(sortRows(rows, UNSORTED)).toEqual(rows);
  });

  it('sorts numbers numerically ascending', () => {
    const rows = [{ a: 10 }, { a: 2 }, { a: 1 }];
    expect(sortRows(rows, { column: 'a', direction: 'asc' })).toEqual([
      { a: 1 },
      { a: 2 },
      { a: 10 },
    ]);
  });

  it('sorts numbers numerically descending', () => {
    const rows = [{ a: 1 }, { a: 10 }, { a: 2 }];
    expect(sortRows(rows, { column: 'a', direction: 'desc' })).toEqual([
      { a: 10 },
      { a: 2 },
      { a: 1 },
    ]);
  });

  it('sorts strings lexically and keeps nulls last when ascending', () => {
    const rows = [{ a: 'banana' }, { a: null }, { a: 'apple' }];
    expect(sortRows(rows, { column: 'a', direction: 'asc' })).toEqual([
      { a: 'apple' },
      { a: 'banana' },
      { a: null },
    ]);
  });

  it('orders bigint columns numerically', () => {
    const rows = [{ a: 100n }, { a: 9n }, { a: 50n }];
    expect(sortRows(rows, { column: 'a', direction: 'asc' })).toEqual([
      { a: 9n },
      { a: 50n },
      { a: 100n },
    ]);
  });

  it('is stable for equal keys', () => {
    const rows = [
      { a: 1, id: 'x' },
      { a: 1, id: 'y' },
      { a: 1, id: 'z' },
    ];
    expect(
      sortRows(rows, { column: 'a', direction: 'asc' }).map((r) => r.id)
    ).toEqual(['x', 'y', 'z']);
  });

  it('does not mutate the input array', () => {
    const rows = [{ a: 2 }, { a: 1 }];
    const copy = [...rows];
    sortRows(rows, { column: 'a', direction: 'asc' });
    expect(rows).toEqual(copy);
  });
});

describe('filterRows', () => {
  const rows = [
    { name: 'lingua', kind: 'app' },
    { name: 'duckdb', kind: 'engine' },
    { name: 'react', kind: 'lib' },
  ];

  it('returns all rows for an empty needle', () => {
    expect(filterRows(rows, '')).toEqual(rows);
    expect(filterRows(rows, '   ')).toEqual(rows);
  });

  it('matches a substring across any cell, case-insensitively', () => {
    expect(filterRows(rows, 'ENGINE')).toEqual([
      { name: 'duckdb', kind: 'engine' },
    ]);
  });

  it('matches numeric and boolean cells via their rendered form', () => {
    const mixed = [
      { a: 42, ok: true },
      { a: 7, ok: false },
    ];
    expect(filterRows(mixed, '42')).toEqual([{ a: 42, ok: true }]);
    expect(filterRows(mixed, 'false')).toEqual([{ a: 7, ok: false }]);
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterRows(rows, 'zzz')).toEqual([]);
  });
});

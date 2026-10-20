import { describe, expect, it } from 'vitest';
import { arrowTypeToDuckDb } from '../../src/shared/sqlTypeNames';

describe('arrowTypeToDuckDb', () => {
  it.each([
    ['Utf8', 'VARCHAR'],
    ['LargeUtf8', 'VARCHAR'],
    ['Int32', 'INTEGER'],
    ['Int64', 'BIGINT'],
    ['Uint64', 'UBIGINT'],
    ['Float64', 'DOUBLE'],
    ['Bool', 'BOOLEAN'],
    ['Decimal[6e+2]', 'DECIMAL(6,2)'],
    ['Decimal[18e0]', 'DECIMAL(18,0)'],
    ['Date32<DAY>', 'DATE'],
    ['Time64<MICROSECOND>', 'TIME'],
    ['Timestamp<MICROSECOND>', 'TIMESTAMP'],
    ['Timestamp<SECOND>', 'TIMESTAMP_S'],
    ['Timestamp<MICROSECOND, UTC>', 'TIMESTAMP WITH TIME ZONE'],
    ['Interval<DAY_TIME>', 'INTERVAL'],
    ['Binary', 'BLOB'],
    ['List<Int32>', 'INTEGER[]'],
    ['Struct<{a:Int32, b:List<Utf8>}>', 'STRUCT(a INTEGER, b VARCHAR[])'],
    ['Map<{key:Utf8, value:Int32}>', 'MAP(VARCHAR, INTEGER)'],
    ['Dictionary<Int32, Utf8>', 'ENUM'],
  ])('%s → %s', (arrow, duck) => {
    expect(arrowTypeToDuckDb(arrow)).toBe(duck);
  });

  it('returns unknown shapes unchanged', () => {
    expect(arrowTypeToDuckDb('SparseUnion<Int32>')).toBe('SparseUnion<Int32>');
    expect(arrowTypeToDuckDb('unknown')).toBe('unknown');
  });
});

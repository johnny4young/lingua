import { describe, expect, it } from 'vitest';
import { clickhouseType, isPlainHttpReply } from '../../../src/main/sqlHost/clickhouse';
import { editDeadline, expectOneRow } from '../../../src/main/sqlHost/driver';
import { ROW_EDIT_BUDGET_MS } from '../../../src/shared/sqlRowEdits';

describe('edit transaction guards', () => {
  it('stops a transaction that runs past its budget, which main outlasts', () => {
    let now = 1_000;
    const inTime = editDeadline(() => now);
    now += ROW_EDIT_BUDGET_MS;
    expect(inTime).not.toThrow();
    now += 1;
    expect(inTime).toThrow('took too long, so nothing was saved');
  });

  it('accepts exactly one touched row per statement', () => {
    expect(() => expectOneRow(0, 1)).not.toThrow();
    expect(() => expectOneRow(1, 0)).toThrow('Change 2 would touch 0 rows');
    expect(() => expectOneRow(2, null)).toThrow('Change 3 would touch 0 rows');
  });
});

describe('ClickHouse types', () => {
  it('maps ClickHouse types to the names the grid knows, unwrapping Nullable and LowCardinality', () => {
    expect(['UInt64', 'Nullable(Int32)', 'LowCardinality(String)', 'Decimal(10, 2)', 'Decimal64(4)', 'DateTime64(3)', 'Array(Float64)', 'Map(String, UInt8)'].map(clickhouseType)).toEqual([
      'UBIGINT',
      'INTEGER',
      'VARCHAR',
      'DECIMAL(10,2)',
      'DECIMAL(18,4)',
      'TIMESTAMP',
      'DOUBLE[]',
      'Map(String, UInt8)',
    ]);
  });
});

describe('ClickHouse TLS fallback', () => {
  it('reads a plain HTTP reply in OpenSSL and BoringSSL wording, and never a reset', () => {
    expect(isPlainHttpReply({ code: 'EPROTO', message: 'ssl3_get_record:wrong version number' })).toBe(true);
    expect(isPlainHttpReply({ code: 'EPROTO', message: 'write EPROTO error:100000f7:SSL routines:OPENSSL_internal:WRONG_VERSION_NUMBER' })).toBe(true);
    expect(isPlainHttpReply({ code: 'ECONNRESET', message: 'socket hang up' })).toBe(false);
    expect(isPlainHttpReply({ code: 'EPROTO', message: 'write EPROTO' })).toBe(false);
  });
});

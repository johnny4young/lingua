/**
 * RL-097 Slice 2 — sqlWorkspace.ts unit tests.
 *
 * Exercises: parsers (happy path + every shape rejection), bucketing
 * helper, caps, closed-enum lock.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_QUERY_BYTES,
  MAX_RESULT_PREVIEW_BYTES,
  MAX_RESULT_ROWS,
  SQL_QUERY_STATUSES,
  SQL_DURATION_BUCKETS,
  bucketSqlDuration,
  createBlankSqlQuery,
  parseSqlQuery,
  parseSqlResponse,
  utf8ByteLength,
  type SqlQueryV1,
  type SqlResponseV1,
} from '../../src/shared/sqlWorkspace';

function validQuery(): SqlQueryV1 {
  return {
    version: 1,
    id: '00000000-0000-4000-8000-000000000001',
    name: 'sample',
    query: 'SELECT 1;',
    createdAt: '2026-05-26T00:00:00.000Z',
    updatedAt: '2026-05-26T00:00:00.000Z',
  };
}

function validResponse(): SqlResponseV1 {
  return {
    version: 1,
    status: 'success',
    rows: [{ a: 1 }],
    columns: [{ name: 'a', type: 'INTEGER' }],
    rowCount: 1,
    durationMs: 5,
    tooLarge: false,
    statementCount: 1,
    recordedAt: '2026-05-26T00:00:00.000Z',
  };
}

describe('SQL_QUERY_STATUSES', () => {
  it('is a closed five-status enum', () => {
    expect([...SQL_QUERY_STATUSES].sort()).toEqual([
      'engine-load-failed',
      'sql-error',
      'success',
      'timeout',
      'too-large',
    ]);
  });
});

describe('SQL_DURATION_BUCKETS', () => {
  it('is a closed six-bucket enum from <10ms to >=30s', () => {
    expect([...SQL_DURATION_BUCKETS]).toEqual([
      '<10ms',
      '<100ms',
      '<1s',
      '<5s',
      '<30s',
      '>=30s',
    ]);
  });
});

describe('bucketSqlDuration', () => {
  it('classifies fast queries as <10ms', () => {
    expect(bucketSqlDuration(0)).toBe('<10ms');
    expect(bucketSqlDuration(9)).toBe('<10ms');
  });
  it('classifies the 10–100ms band as <100ms', () => {
    expect(bucketSqlDuration(10)).toBe('<100ms');
    expect(bucketSqlDuration(99)).toBe('<100ms');
  });
  it('classifies very-slow queries as >=30s', () => {
    expect(bucketSqlDuration(30_000)).toBe('>=30s');
    expect(bucketSqlDuration(60_000)).toBe('>=30s');
  });
  it('defensively returns <10ms for negative input', () => {
    expect(bucketSqlDuration(-1)).toBe('<10ms');
    expect(bucketSqlDuration(Number.NaN)).toBe('<10ms');
  });
});

describe('caps', () => {
  it('MAX_QUERY_BYTES is 256 KiB', () => {
    expect(MAX_QUERY_BYTES).toBe(256 * 1024);
  });
  it('MAX_RESULT_ROWS is 10k', () => {
    expect(MAX_RESULT_ROWS).toBe(10_000);
  });
  it('MAX_RESULT_PREVIEW_BYTES is 256 KiB', () => {
    expect(MAX_RESULT_PREVIEW_BYTES).toBe(256 * 1024);
  });
  it('utf8ByteLength counts UTF-8 not UTF-16 code units', () => {
    // 4-byte UTF-8 emoji vs 2 UTF-16 code units.
    expect(utf8ByteLength('🚀')).toBe(4);
  });
});

describe('parseSqlQuery', () => {
  it('round-trips a valid query', () => {
    const parsed = parseSqlQuery(validQuery());
    expect(parsed).not.toBeNull();
    expect(parsed?.id).toBe(validQuery().id);
  });

  it('rejects null + non-object input', () => {
    expect(parseSqlQuery(null)).toBeNull();
    expect(parseSqlQuery('not-an-object')).toBeNull();
    expect(parseSqlQuery([])).toBeNull();
  });

  it('rejects wrong version', () => {
    expect(parseSqlQuery({ ...validQuery(), version: 2 })).toBeNull();
  });

  it('rejects missing id', () => {
    expect(parseSqlQuery({ ...validQuery(), id: '' })).toBeNull();
  });

  it('rejects non-string query field', () => {
    expect(parseSqlQuery({ ...validQuery(), query: 123 })).toBeNull();
  });

  it('rejects query text exceeding MAX_QUERY_BYTES', () => {
    const oversized = { ...validQuery(), query: 'x'.repeat(MAX_QUERY_BYTES + 1) };
    expect(parseSqlQuery(oversized)).toBeNull();
  });

  it('clamps timeoutMs to MAX_QUERY_TIMEOUT_MS on parse', () => {
    const parsed = parseSqlQuery({ ...validQuery(), timeoutMs: 10 * 60 * 1000 });
    expect(parsed?.timeoutMs).toBe(5 * 60 * 1000);
  });

  it('rejects negative timeoutMs', () => {
    expect(parseSqlQuery({ ...validQuery(), timeoutMs: -1 })).toBeNull();
  });
});

describe('parseSqlResponse', () => {
  it('round-trips a valid response', () => {
    const parsed = parseSqlResponse(validResponse());
    expect(parsed?.status).toBe('success');
    expect(parsed?.rows).toHaveLength(1);
  });

  it('rejects unknown status', () => {
    expect(
      parseSqlResponse({ ...validResponse(), status: 'unknown' as unknown })
    ).toBeNull();
  });

  it('rejects more rows than MAX_RESULT_ROWS', () => {
    const big = {
      ...validResponse(),
      rows: Array.from({ length: MAX_RESULT_ROWS + 1 }, () => ({ a: 1 })),
    };
    expect(parseSqlResponse(big)).toBeNull();
  });

  it('rejects persisted previews above MAX_RESULT_PREVIEW_BYTES', () => {
    const row = { a: 'x'.repeat(MAX_RESULT_PREVIEW_BYTES) };
    expect(parseSqlResponse({ ...validResponse(), rows: [row] })).toBeNull();
  });

  it('rejects rowCount values smaller than the preview row count', () => {
    const parsed = parseSqlResponse({
      ...validResponse(),
      rows: [{ a: 1 }, { a: 2 }],
      rowCount: 1,
    });
    expect(parsed).toBeNull();
  });

  it('rejects a row that is not an object', () => {
    const broken = { ...validResponse(), rows: ['not-an-object'] };
    expect(parseSqlResponse(broken)).toBeNull();
  });

  it('rejects malformed column metadata', () => {
    const broken = {
      ...validResponse(),
      columns: [{ name: 'a', type: 123 as unknown as string }],
    };
    expect(parseSqlResponse(broken)).toBeNull();
  });

  it('preserves errorMessage when present', () => {
    const err = {
      ...validResponse(),
      status: 'sql-error' as const,
      errorMessage: 'syntax error near FORM',
    };
    const parsed = parseSqlResponse(err);
    expect(parsed?.errorMessage).toBe('syntax error near FORM');
  });
});

describe('createBlankSqlQuery', () => {
  it('builds a versioned query with the supplied id', () => {
    const q = createBlankSqlQuery({ id: 'abc' });
    expect(q.version).toBe(1);
    expect(q.id).toBe('abc');
    expect(q.query).toBe('');
    expect(q.createdAt).toBe(q.updatedAt);
  });

  it('accepts a custom now timestamp', () => {
    const q = createBlankSqlQuery({ id: 'x', now: '2026-01-01T00:00:00.000Z' });
    expect(q.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });
});

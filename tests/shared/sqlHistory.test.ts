import { describe, expect, it } from 'vitest';
import {
  MAX_SQL_HISTORY_SQL_BYTES,
  capHistorySql,
  filterSqlHistory,
  parseSqlHistoryEntry,
  type SqlHistoryEntryV1,
} from '../../src/shared/sqlHistory';
import { utf8ByteLength } from '../../src/shared/utf8';

const entry = (overrides: Partial<SqlHistoryEntryV1> = {}): SqlHistoryEntryV1 => ({
  version: 1,
  id: 'h1',
  sql: 'SELECT 1',
  status: 'success',
  durationMs: 3,
  rowCount: 1,
  recordedAt: '2026-10-20T10:00:00.000Z',
  ...overrides,
});

describe('capHistorySql', () => {
  it('keeps SQL under the cap as it is', () => {
    expect(capHistorySql('SELECT 1')).toEqual({ sql: 'SELECT 1', truncated: false });
  });

  it('cuts at the byte cap without splitting a character', () => {
    const capped = capHistorySql(`SELECT '${'é'.repeat(3000)}🙂'`);
    expect(capped.truncated).toBe(true);
    expect(utf8ByteLength(capped.sql)).toBeLessThanOrEqual(MAX_SQL_HISTORY_SQL_BYTES);
    expect(utf8ByteLength(capped.sql)).toBeGreaterThan(MAX_SQL_HISTORY_SQL_BYTES - 2);
    expect(capped.sql).not.toContain('�');
  });
});

describe('parseSqlHistoryEntry', () => {
  it('accepts a well-formed entry and recaps oversized SQL', () => {
    expect(parseSqlHistoryEntry(entry())).toEqual(entry());
    const parsed = parseSqlHistoryEntry(entry({ sql: 'x'.repeat(MAX_SQL_HISTORY_SQL_BYTES + 10) }));
    expect(parsed).toMatchObject({ truncated: true });
    expect(parsed?.sql).toHaveLength(MAX_SQL_HISTORY_SQL_BYTES);
  });

  it.each([
    ['an unknown status', { status: 'exploded' }],
    ['a negative duration', { durationMs: -1 }],
    ['a missing id', { id: '' }],
    ['another version', { version: 2 }],
  ])('drops %s', (_label, overrides) => {
    expect(parseSqlHistoryEntry({ ...entry(), ...overrides })).toBeNull();
  });

  it('never carries rows', () => {
    expect(parseSqlHistoryEntry({ ...entry(), rows: [{ secret: 1 }] })).not.toHaveProperty('rows');
  });
});

describe('filterSqlHistory', () => {
  it('matches the SQL text ignoring case', () => {
    const entries = [entry({ id: 'a', sql: 'SELECT * FROM Orders' }), entry({ id: 'b', sql: 'SELECT 2' })];
    expect(filterSqlHistory(entries, ' orders ').map((item) => item.id)).toEqual(['a']);
    expect(filterSqlHistory(entries, '')).toHaveLength(2);
  });

  it('keeps the runs of one connection, counting entries without one as Local', () => {
    const entries = [entry({ id: 'local' }), entry({ id: 'dev', connectionId: 'c_dev' }), entry({ id: 'prod', connectionId: 'c_prod' })];
    expect(filterSqlHistory(entries, '').map((item) => item.id)).toEqual(['local']);
    expect(filterSqlHistory(entries, 'select', 'c_dev').map((item) => item.id)).toEqual(['dev']);
  });

  it('keeps a well-formed connection id from the store and drops any other', () => {
    expect(parseSqlHistoryEntry(entry({ connectionId: 'c_dev' }))?.connectionId).toBe('c_dev');
    expect(parseSqlHistoryEntry({ ...entry(), connectionId: '../c' })).not.toHaveProperty('connectionId');
    expect(parseSqlHistoryEntry({ ...entry(), connectionId: 7 })).not.toHaveProperty('connectionId');
  });
});

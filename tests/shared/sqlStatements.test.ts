import { describe, expect, it } from 'vitest';
import {
  isReadOnlySqlStatement,
  splitSqlStatements,
  statementAtOffset,
} from '../../src/shared/sqlStatements';

const texts = (sql: string) => splitSqlStatements(sql).map((statement) => statement.text);

describe('splitSqlStatements', () => {
  it.each([
    ['SELECT 1; SELECT 2;', ['SELECT 1', 'SELECT 2']],
    ['SELECT 1', ['SELECT 1']],
    ["SELECT 'a;b'; SELECT 'it''s; fine'", ["SELECT 'a;b'", "SELECT 'it''s; fine'"]],
    ["SELECT E'a\\';b'; SELECT 2", ["SELECT E'a\\';b'", 'SELECT 2']],
    ['SELECT "odd;name" FROM t; SELECT 2', ['SELECT "odd;name" FROM t', 'SELECT 2']],
    ['SELECT 1 -- not; here\n; SELECT 2', ['SELECT 1 -- not; here', 'SELECT 2']],
    ['SELECT /* a; /* nested; */ b; */ 1; SELECT 2', ['SELECT /* a; /* nested; */ b; */ 1', 'SELECT 2']],
    ['SELECT $$a;b$$; SELECT $fn$ x; $$ y $fn$', ['SELECT $$a;b$$', 'SELECT $fn$ x; $$ y $fn$']],
    ['  ;; -- only a comment\n; /* and this */ ;', []],
    ['SELECT 1;\n\n-- trailing note', ['SELECT 1']],
  ])('splits %j', (sql, expected) => {
    expect(texts(sql)).toEqual(expected);
  });

  it('keeps offsets and the first line of each statement', () => {
    const sql = 'SELECT 1;\n\n  SELECT\n  2;';
    const [first, second] = splitSqlStatements(sql);
    expect(first).toMatchObject({ start: 0, end: 9, startLine: 1 });
    expect(second).toMatchObject({ start: 13, startLine: 3 });
    expect(sql.slice(second!.start, second!.end)).toBe('SELECT\n  2;');
  });

  it('does not read $ inside identifiers or a column ref as a dollar quote', () => {
    expect(texts('SELECT price$usd; SELECT $1')).toEqual(['SELECT price$usd', 'SELECT $1']);
  });
});

describe('statementAtOffset', () => {
  const sql = 'SELECT 1;\n\nSELECT 2;\nSELECT 3';
  const statements = splitSqlStatements(sql);

  it('picks the statement the cursor is in, or the one it just left', () => {
    expect(statementAtOffset(statements, 3)?.index).toBe(0);
    expect(statementAtOffset(statements, 9)?.index).toBe(0);
    expect(statementAtOffset(statements, 10)?.index).toBe(0);
    expect(statementAtOffset(statements, sql.indexOf('SELECT 2') + 2)?.index).toBe(1);
    expect(statementAtOffset(statements, sql.length)?.index).toBe(2);
  });

  it('falls back to the first statement before any code, and to null without statements', () => {
    expect(statementAtOffset(splitSqlStatements('\n\nSELECT 1'), 0)?.index).toBe(0);
    expect(statementAtOffset([], 0)).toBeNull();
  });
});

describe('isReadOnlySqlStatement', () => {
  it.each([
    ['SELECT * FROM t', true],
    ['  -- note\n  select 1', true],
    ['WITH x AS (SELECT 1) SELECT * FROM x', true],
    ["SELECT 'drop table t' AS label", true],
    ['FROM t LIMIT 5', true],
    ['INSERT INTO t VALUES (1)', false],
    ['WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x', false],
    ["COPY (SELECT 1) TO 'out.csv'", false],
    ['CREATE TABLE t AS SELECT 1', false],
    ['SELECT 1; DROP TABLE t', false],
    ['SET threads = 1', false],
  ])('%j reads only: %s', (sql, expected) => {
    expect(isReadOnlySqlStatement(sql)).toBe(expected);
  });
});

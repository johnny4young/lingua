import { describe, expect, it } from 'vitest';
import {
  isReadOnlySqlStatement,
  isSqlServerReadBatch,
  isWriteSqlStatement,
  isWriteSqlStatementOn,
  provesReadsOnly,
  redactSqlSecrets,
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

  // DuckDB splits each of these into separate statements; hiding one would let it run unseen.
  it.each([
    ['SELECT 1 AS x$$$; DROP TABLE t; SELECT 1 AS y$$$', 3],
    ['SELECT 1 AS é$$; DROP TABLE t; SELECT 1 AS ó$$', 3],
    ['SELECT 1 --note\r; DROP TABLE t', 2],
    ['SELECT $é$ a;b $é$; SELECT 2', 2],
  ])('matches DuckDB on %j', (sql, count) => {
    expect(splitSqlStatements(sql)).toHaveLength(count);
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

describe('redactSqlSecrets', () => {
  it.each([
    ["CREATE SECRET s3 (TYPE S3, KEY_ID 'AKIA1', SECRET 'shh')", "CREATE SECRET s3 (TYPE S3, KEY_ID '•••', SECRET '•••')"],
    ["create or replace persistent secret (type http, bearer_token 'tok')", "create or replace persistent secret (type http, bearer_token '•••')"],
    ["SET s3_secret_access_key = 'shh'", "SET s3_secret_access_key = '•••'"],
    ["SET azure_storage_connection_string = 'AccountName=a;AccountKey=k'", "SET azure_storage_connection_string = '•••'"],
    ["PRAGMA some_setting = 'value'", "PRAGMA some_setting = '•••'"],
    ["SELECT * FROM read_csv('az://c/x.csv?sv=1;SharedAccessSignature=abc')", "SELECT * FROM read_csv('•••')"],
    ["COPY t TO 'x' (CONN 'Endpoint=e;AccountKey=k')", "COPY t TO 'x' (CONN '•••')"],
    ["ATTACH 'md:db?motherduck_token=abc' AS md", "ATTACH '•••' AS md"],
    ["SELECT * FROM read_csv('https://user:pw@host/x.csv')", "SELECT * FROM read_csv('•••')"],
    ["SELECT * FROM read_parquet('https://b.s3.amazonaws.com/x?X-Amz-Signature=abc')", "SELECT * FROM read_parquet('•••')"],
    ["CREATE LOGIN app WITH PASSWORD = 'S3cret!'", "CREATE LOGIN app WITH PASSWORD = '•••'"],
    ["CREATE USER app IDENTIFIED WITH sha256_password BY 'S3cret'", "CREATE USER app IDENTIFIED WITH sha256_password BY '•••'"],
    ["SELECT * FROM remote('db:9000', 'logs', 'events', 'reader', 'S3cret')", "SELECT * FROM remote('•••', '•••', '•••', '•••', '•••')"],
    ["SELECT * FROM s3('https://b/x.csv', 'AKIA1', 'shh')", "SELECT * FROM s3('•••', '•••', '•••')"],
  ])('masks %j', (sql, expected) => {
    expect(redactSqlSecrets(sql)).toBe(expected);
  });

  it('keeps ordinary SQL, including strings that only look nearby', () => {
    const sql = "SELECT 'secret garden' AS title, 'https://example.com/a' AS url -- key=1";
    expect(redactSqlSecrets(sql)).toBe(sql);
  });
});

describe('isWriteSqlStatement', () => {
  it('treats plain reads as reads', () => {
    for (const sql of ['SELECT * FROM orders', 'with x as (select 1) select * from x', 'SHOW TABLES', 'EXPLAIN SELECT 1', "SELECT 'delete' AS word -- update"]) {
      expect(isWriteSqlStatement(sql)).toBe(false);
    }
  });

  it('flags writes, hidden writes and anything it cannot place', () => {
    for (const sql of [
      'DELETE FROM orders',
      'with d as (delete from orders returning *) select * from d',
      'SELECT * INTO backup FROM orders',
      'SELECT * FROM orders FOR UPDATE',
      'EXPLAIN ANALYZE DELETE FROM orders',
      'EXPLAIN (ANALYZE, FORMAT JSON) SELECT 1',
      'SET search_path = x',
      'CALL refresh()',
      'VACUUM',
      'GRANT SELECT ON t TO u',
      'EXPLAIN ANALYSE DELETE FROM orders',
      'EXPLAIN (FORMAT JSON,\n ANALYZE) DELETE FROM orders',
      'EXECUTE wipe_orders',
      'SELECT 1 /*!, (SELECT 1) */',
    ]) {
      expect(isWriteSqlStatement(sql)).toBe(true);
    }
  });
});

describe('SQL Server batches', () => {
  it.each([
    'SELECT 1 EXEC dbo.purge',
    "SELECT 1; COMMIT; EXEC('DELETE FROM dbo.users')",
    "SELECT 1 AS [a']; DELETE FROM t; --']",
    'SELECT 1 GRANT CONTROL ON SCHEMA::dbo TO public',
    'SELECT 1 COMMIT DELETE FROM t',
    'SELECT * INTO dbo.copy FROM dbo.orders',
    "SELECT * FROM OPENROWSET('SQLNCLI', 'Server=x;Trusted_Connection=yes', 'SELECT 1')",
    'DECLARE @x int = 1 SELECT @x',
    "SELECT 'unclosed",
    'WITH a AS (SELECT 1 AS n) DELETE FROM t',
    'SELECT 1 /* nested /* comment */ still */ ; DROP TABLE t',
  ])('counts %j as a write, since it is not one proven query', (sql) => {
    expect(isSqlServerReadBatch(sql)).toBe(false);
    expect(isWriteSqlStatementOn('sqlserver', sql)).toBe(true);
  });

  it.each([
    'SELECT id, total FROM dbo.orders ORDER BY id OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY;',
    'WITH recent AS (SELECT * FROM dbo.orders WHERE placed > DATEADD(day, -7, GETDATE())) SELECT COUNT(*) FROM recent',
    "SELECT [delete], [exec] FROM dbo.[update] WHERE note = 'EXEC dbo.purge; COMMIT'",
    'SELECT TOP (10) * FROM dbo.orders -- DELETE later',
  ])('lets %j through as a read', (sql) => {
    expect(isSqlServerReadBatch(sql)).toBe(true);
    expect(isWriteSqlStatementOn('sqlserver', sql)).toBe(false);
  });

  it('treats Lingua\'s Explain as a plan, and keeps the shared check for other engines', () => {
    expect(isWriteSqlStatementOn('sqlserver', 'EXPLAIN DELETE FROM dbo.orders')).toBe(false);
    expect(isWriteSqlStatementOn('postgres', 'SELECT 1 EXEC x')).toBe(true);
    expect(isWriteSqlStatementOn('postgres', 'SELECT 1')).toBe(false);
  });
});

describe('D1 reads', () => {
  it('counts only one SELECT, WITH or VALUES statement with no write as a read', () => {
    for (const read of ['SELECT * FROM users', "SELECT replace(name, 'a', 'b') FROM users", 'WITH x AS (SELECT 1) SELECT * FROM x', 'VALUES (1)', "SELECT 'a; DELETE FROM t'"]) {
      expect(isWriteSqlStatementOn('d1', read), read).toBe(false);
    }
    for (const write of ['SELECT 1; SELECT 2', 'SELECT 1; DELETE FROM t', 'WITH x AS (SELECT 1) REPLACE INTO t SELECT * FROM x', 'PRAGMA foreign_keys = OFF', 'PRAGMA table_list', 'EXPLAIN SELECT 1', 'DELETE FROM t']) {
      expect(isWriteSqlStatementOn('d1', write), write).toBe(true);
    }
    expect(provesReadsOnly('d1')).toBe(true);
    expect(provesReadsOnly('libsql')).toBe(false);
  });
});

describe('SQLite family writes', () => {
  // Postgres hides code in nested comments, $$ bodies and E'' strings; SQLite has none of them.
  const smuggled = [
    'WITH x AS (SELECT 1) /* /* */ DELETE FROM t -- */',
    'SELECT 1 /* /* */; DROP TABLE t -- */',
    'SELECT $$; DROP TABLE t; --$$',
    'WITH x AS (SELECT $$) DELETE FROM t --$$',
    "SELECT E'\\'; DELETE FROM t; --'",
  ];

  it('reads text by SQLite rules, so nothing Postgres-shaped hides a write on D1, libSQL or a SQLite file', () => {
    for (const engine of ['d1', 'libsql', 'sqlite'] as const) {
      for (const sql of smuggled) expect(isWriteSqlStatementOn(engine, sql), `${engine}: ${sql}`).toBe(true);
    }
  });

  it('keeps names and strings as SQLite quotes them', () => {
    for (const read of ['SELECT "a;b", [c;d], `e;f` FROM t', "SELECT 'it''s; fine' FROM t", 'SELECT 1; ', 'SELECT 1 -- trailing; DELETE']) {
      expect(isWriteSqlStatementOn('d1', read), read).toBe(false);
      expect(isWriteSqlStatementOn('libsql', read), read).toBe(false);
    }
    expect(isWriteSqlStatementOn('libsql', 'SELECT 1; SELECT 2')).toBe(true);
  });
});

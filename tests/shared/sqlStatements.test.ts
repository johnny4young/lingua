import { describe, expect, it } from 'vitest';
import {
  isReadOnlySqlStatement,
  isSqlServerReadBatch,
  isWriteSqlStatement,
  isWriteSqlStatementOn,
  provesReadsOnly,
  redactSqlSecrets,
  redactSqlSecretsOnAnyEngine,
  splitSqlStatements,
  statementAtOffset,
} from '../../src/shared/sqlStatements';

const texts = (sql: string) => splitSqlStatements(sql).map((statement) => statement.text);

describe('redactSqlSecretsOnAnyEngine', () => {
  it.each([
    ['CREATE USER app IDENTIFIED BY "hunter2"', "CREATE USER app IDENTIFIED BY '•••'"],
    ["ALTER USER app IDENTIFIED BY 'hun\\'ter2'", "ALTER USER app IDENTIFIED BY '•••'"],
    ["ALTER ROLE app PASSWORD 'hunter2'", "ALTER ROLE app PASSWORD '•••'"],
  ])('masks %s', (sql, masked) => {
    expect(redactSqlSecretsOnAnyEngine(sql)).toBe(masked);
  });

  it('leaves an ordinary query alone', () => {
    expect(redactSqlSecretsOnAnyEngine("SELECT 'a', \"b\" FROM t")).toBe("SELECT 'a', \"b\" FROM t");
  });
});

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
    ["ALTER USER app PASSWORD 'S3cret'", "ALTER USER app PASSWORD '•••'"],
    ["CREATE ROLE app WITH LOGIN PASSWORD 'S3cret'", "CREATE ROLE app WITH LOGIN PASSWORD '•••'"],
    ["SELECT 1; alter role app password 'S3cret'", "SELECT 1; alter role app password '•••'"],
    ["CREATE USER MAPPING FOR app SERVER s OPTIONS (password 'S3cret')", "CREATE USER MAPPING FOR app SERVER s OPTIONS (password '•••')"],
    ["ALTER SERVER s OPTIONS (SET password 'S3cret')", "ALTER SERVER s OPTIONS (SET password '•••')"],
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

  it.each([
    ["SELECT * FROM read_csv('https://h/x?api_key=abc')", "SELECT * FROM read_csv('•••')"],
    ["SELECT * FROM read_csv('https://h/x?secret=abc')", "SELECT * FROM read_csv('•••')"],
    ["SELECT * FROM read_csv('https://h/x?client_secret=abc')", "SELECT * FROM read_csv('•••')"],
    ["SELECT * FROM postgres_scan('host=h password=x', 'public', 't')", "SELECT * FROM postgres_scan('•••', 'public', 't')"],
    ["SELECT * FROM conn_scan('Server=h;Pwd=x', 't')", "SELECT * FROM conn_scan('•••', 't')"],
    ['SELECT * FROM "https://u:x@h/f.csv"', 'SELECT * FROM "https://•••@h/f.csv"'],
    ['SELECT * FROM "https://h/f.csv?token=abc"', 'SELECT * FROM "https://h/f.csv?token=•••"'],
    ['SELECT 1 /* token=abc */', 'SELECT 1 /* token=••• */'],
    ['SELECT 1 -- password=abc', 'SELECT 1 -- password=•••'],
    [`SELECT * FROM t WHERE "password" = 'hunter2' AND "name" = 'ada'`, `SELECT * FROM t WHERE "password" = '•••' AND "name" = 'ada'`],
    [`SELECT * FROM t WHERE "api_key" = 'abc123'`, `SELECT * FROM t WHERE "api_key" = '•••'`],
    [`SELECT * FROM t WHERE t."authToken" LIKE 'abc%'`, `SELECT * FROM t WHERE t."authToken" LIKE '•••'`],
    [`SELECT * FROM t WHERE t.password = 'x'`, `SELECT * FROM t WHERE t.password = '•••'`],
    [`SELECT * FROM t WHERE "user.password" = 'x'`, `SELECT * FROM t WHERE "user.password" = '•••'`],
    [`SELECT * FROM t WHERE "api key" = 'x'`, `SELECT * FROM t WHERE "api key" = '•••'`],
    [`SELECT * FROM t WHERE session_id IN ('a', 'b')`, `SELECT * FROM t WHERE session_id IN ('•••', '•••')`],
    [`SELECT * FROM t WHERE note = 'Bearer eyJabc'`, `SELECT * FROM t WHERE note = '•••'`],
    [`SELECT * FROM t WHERE note = 'eyJhbGci.eyJzdWIi.sig'`, `SELECT * FROM t WHERE note = '•••'`],
  ])('closes %j', (sql, expected) => {
    expect(redactSqlSecrets(sql)).toBe(expected);
  });

  it('keeps values on columns that only look nearby', () => {
    for (const sql of [
      `SELECT * FROM t WHERE "author" = 'ada'`,
      `SELECT * FROM t WHERE "tokens_used" = '5'`,
      `SELECT * FROM t WHERE "keyword" = 'x'`,
      `SELECT * FROM t WHERE "name" IN ('a', 'b')`,
      `SELECT password FROM t WHERE name = 'ada'`,
    ]) {
      expect(redactSqlSecrets(sql)).toBe(sql);
    }
  });

  it.each([
    ['sqlserver', "SELECT [it's], 'https://a:x@h/x'", "SELECT [it's], '•••'"],
    ['sqlite', "SELECT [it's], 'https://a:x@h/x'", "SELECT [it's], '•••'"],
    ['sqlserver', "SELECT [a]]'b], 'https://h/x?api_key=abc'", "SELECT [a]]'b], '•••'"],
    ['sqlserver', "SELECT * FROM #tmp WHERE [password] = 'x'", "SELECT * FROM #tmp WHERE [password] = '•••'"],
    ['sqlite', "SELECT `it's`, 'https://a:x@h/x'", "SELECT `it's`, '•••'"],
    ['mysql', "SELECT 1 /* token=abc */", "SELECT 1 /* token=••• */"],
    ['clickhouse', "SELECT \"https://u:x@h\" -- password=abc", "SELECT \"https://•••@h\" -- password=•••"],
  ] as const)('reads %s quoting: %j', (engine, sql, expected) => {
    expect(redactSqlSecrets(sql, engine)).toBe(expected);
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

describe('MySQL and ClickHouse writes', () => {
  // Each reads as one SELECT by Postgres rules, while MySQL sees INTO OUTFILE as code.
  const mysqlSmuggled = [
    "SELECT 1 --1 INTO OUTFILE '/tmp/x'",
    "SELECT 1 /* /* */ INTO OUTFILE '/tmp/x' /* */",
    'SELECT "\\"" INTO OUTFILE \'/tmp/x\' FIELDS TERMINATED BY ""',
    "SELECT 'a\\'' , 1 INTO OUTFILE '/tmp/x' -- '",
    "SELECT 1 AS `'`, 2 INTO OUTFILE \"/tmp/x\" FIELDS TERMINATED BY `'`",
    'SELECT 1 AS $$, 2 INTO OUTFILE "/tmp/x" FIELDS TERMINATED BY "$$"',
    "SELECT 1 # '\n INTO OUTFILE '/tmp/x' -- '",
  ];

  it('reads text by MySQL rules, so no Postgres-shaped token hides a write', () => {
    for (const sql of mysqlSmuggled) expect(isWriteSqlStatementOn('mysql', sql), sql).toBe(true);
    expect(isWriteSqlStatementOn('mysql', 'SELECT 1 --1; DELETE FROM t')).toBe(true);
  });

  it('checks every sql_mode reading of the quotes on MySQL', () => {
    // Under NO_BACKSLASH_ESCAPES the string ends at the second quote and INTO is code.
    expect(isWriteSqlStatementOn('mysql', "SELECT 'a\\' INTO OUTFILE '/tmp/x' -- '")).toBe(true);
    // Under ANSI_QUOTES a double-quoted name takes no backslash escape.
    expect(isWriteSqlStatementOn('mysql', 'SELECT "a\\" INTO OUTFILE \'/tmp/x\' -- "')).toBe(true);
  });

  it('counts MySQL locking reads, assignments and named locks as writes', () => {
    for (const sql of ['SELECT * FROM t LOCK IN SHARE MODE', 'SELECT * FROM t FOR SHARE', 'SELECT @a := 1', "SELECT GET_LOCK('x', 10)", 'SELECT RELEASE_ALL_LOCKS()']) {
      expect(isWriteSqlStatementOn('mysql', sql), sql).toBe(true);
    }
  });

  it('counts unclosed text, several statements and executable comments as writes', () => {
    for (const engine of ['mysql', 'clickhouse'] as const) {
      for (const sql of ["SELECT 'open", 'SELECT 1 /* open', 'SELECT 1; SELECT 2', 'SELECT 1 /*!, (SELECT 1) */', 'SELECT 1 /*M! , 2 */', '']) {
        expect(isWriteSqlStatementOn(engine, sql), `${engine}: ${sql}`).toBe(true);
      }
    }
  });

  it('reads ClickHouse text by its own rules: nested comments, heredocs and backslash escapes', () => {
    for (const sql of [
      "SELECT 1 /* /* */ FROM t INTO OUTFILE 'x' /* */",
      "SELECT 'a\\'' , 1 FROM t INTO OUTFILE 'x' -- '",
      'SELECT `a\\`` , 1 FROM t INTO OUTFILE \'x\' -- `',
      "SELECT $x$ $$ $x$, 1 INTO OUTFILE 'x'",
    ]) {
      expect(isWriteSqlStatementOn('clickhouse', sql), sql).toBe(true);
    }
  });

  it('lets reads through as each server quotes them', () => {
    for (const [engine, sql] of [
      ['mysql', "SELECT 'it''s; DELETE', \"a;\"\" DROP\" FROM t"],
      ['mysql', 'SELECT `del;ete` FROM `update` # ; DELETE FROM t'],
      ['mysql', 'SELECT 1 -- ; DELETE FROM t'],
      ['mysql', 'SELECT a$b FROM t;'],
      ['clickhouse', 'SELECT 1 --; DELETE FROM t'],
      ['clickhouse', 'SELECT 1 /* outer /* inner */ ; DELETE */'],
      ['clickhouse', 'SELECT $q$; DELETE FROM t$q$, a$b$c FROM t'],
      ['clickhouse', 'SELECT count() FROM events SETTINGS max_threads = 2'],
    ] as const) {
      expect(isWriteSqlStatementOn(engine, sql), `${engine}: ${sql}`).toBe(false);
    }
  });
});

describe('redactSqlSecrets on MySQL and ClickHouse', () => {
  it.each([
    ['mysql', 'CREATE USER app IDENTIFIED BY "hunter2"', "CREATE USER app IDENTIFIED BY '•••'"],
    ['mysql', "ALTER USER app IDENTIFIED BY 'hun\\'ter2'", "ALTER USER app IDENTIFIED BY '•••'"],
    ['mysql', 'SELECT * FROM t WHERE dsn = "mysql://root:hunter2@db/x"', "SELECT * FROM t WHERE dsn = '•••'"],
    ['mysql', "SET PASSWORD = 'hunter2'", "SET PASSWORD = '•••'"],
    ['clickhouse', "SELECT * FROM mysql('db:3306', 'x', 't', 'root', 'hun\\'ter2')", "SELECT * FROM mysql('•••', '•••', '•••', '•••', '•••')"],
    ['clickhouse', 'SELECT * FROM url($$https://u:pw@h/x.csv$$)', "SELECT * FROM url('•••')"],
    ['clickhouse', "CREATE USER app IDENTIFIED BY 'open", "CREATE USER app IDENTIFIED BY '•••'"],
  ] as const)('%s masks %j', (engine, sql, expected) => {
    expect(redactSqlSecrets(sql, engine)).toBe(expected);
  });

  it('keeps ordinary strings and names', () => {
    expect(redactSqlSecrets('SELECT \'plain\', "also", `name` FROM t', 'mysql')).toBe('SELECT \'plain\', "also", `name` FROM t');
    expect(redactSqlSecrets('SELECT "col" FROM t WHERE x = \'y\'', 'clickhouse')).toBe('SELECT "col" FROM t WHERE x = \'y\'');
  });
});

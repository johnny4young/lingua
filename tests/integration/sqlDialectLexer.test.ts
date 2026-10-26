/**
 * The MySQL and ClickHouse write checks against the servers' own parsers:
 * each case shows the server running, or refusing, the code the check sees.
 * Runs when LINGUA_TEST_MYSQL_URL / LINGUA_TEST_CLICKHOUSE_URL point at
 * disposable servers; skipped otherwise.
 */

import mysql from 'mysql2/promise';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { isWriteSqlStatement, isWriteSqlStatementOn, redactSqlSecrets } from '../../src/shared/sqlStatements';

const mysqlUrl = process.env.LINGUA_TEST_MYSQL_URL;
const clickhouseUrl = process.env.LINGUA_TEST_CLICKHOUSE_URL;

describe.skipIf(!mysqlUrl)('MySQL reads text as the write check does', () => {
  const url = new URL(mysqlUrl ?? 'mysql://x@localhost/x');
  const options = { host: url.hostname, port: Number(url.port), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
  let connection: mysql.Connection;
  const scalar = async (sql: string) => ((await connection.query(sql))[0] as Array<Record<string, unknown>>)[0];

  beforeAll(async () => {
    connection = await mysql.createConnection({ ...options, multipleStatements: false });
  });
  afterAll(() => connection?.end());
  beforeEach(async () => {
    await connection.query('SET SESSION sql_mode = DEFAULT');
    await connection.query('SET @lingua_lexer = NULL');
  });

  // Postgres rules read each as one plain SELECT; MySQL runs the INTO they hide.
  it.each([
    'SELECT 1 --1 INTO @lingua_lexer',
    'SELECT 1 /* /* */ INTO @lingua_lexer /* */',
    'SELECT "\\"" INTO @lingua_lexer FROM (SELECT 1 AS a) AS t WHERE "" = ""',
    "SELECT 'a\\'' INTO @lingua_lexer -- '",
    "SELECT 1 AS `'` INTO @lingua_lexer FROM (SELECT 1 AS `'`) AS t",
    "SELECT 1 # '\n INTO @lingua_lexer -- '",
  ])('runs the INTO hidden in %j, and the check counts it as a write', async (sql) => {
    expect(isWriteSqlStatement(sql)).toBe(false);
    await connection.query(sql);
    expect((await scalar('SELECT @lingua_lexer AS v'))?.v).not.toBeNull();
    expect(isWriteSqlStatementOn('mysql', sql)).toBe(true);
  });

  it('ends strings at the backslash under NO_BACKSLASH_ESCAPES, which the check also reads', async () => {
    const sql = "SELECT 'a\\' INTO @lingua_lexer -- '";
    await connection.query("SET SESSION sql_mode = 'NO_BACKSLASH_ESCAPES'");
    await connection.query(sql);
    expect((await scalar('SELECT @lingua_lexer AS v'))?.v).toBe('a\\');
    expect(isWriteSqlStatementOn('mysql', sql)).toBe(true);
  });

  it.each([
    "SELECT 'it''s; DELETE' AS a, \"a;\"\" DROP\" AS b",
    'SELECT `del;ete` FROM (SELECT 1 AS `del;ete`) AS t # ; DELETE FROM t',
    'SELECT 1 AS one -- ; DELETE FROM t',
    'SELECT 1 AS a$b;',
  ])('runs %j as one read, and the check lets it through', async (sql) => {
    await expect(connection.query(sql)).resolves.toBeTruthy();
    expect(isWriteSqlStatementOn('mysql', sql)).toBe(false);
  });

  it('masks the whole password the server stores, quotes and escapes included', async () => {
    await connection.query('DROP USER IF EXISTS lingua_lexer');
    const sql = 'CREATE USER lingua_lexer IDENTIFIED BY "hun\\"ter2"';
    await connection.query(sql);
    try {
      const login = await mysql.createConnection({ ...options, user: 'lingua_lexer', password: 'hun"ter2', database: undefined });
      await login.end();
      expect(redactSqlSecrets(sql, 'mysql')).toBe("CREATE USER lingua_lexer IDENTIFIED BY '•••'");
    } finally {
      await connection.query('DROP USER IF EXISTS lingua_lexer');
    }
  });
});

describe.skipIf(!clickhouseUrl)('ClickHouse reads text as the write check does', () => {
  const url = new URL(clickhouseUrl ?? 'clickhouse://x@localhost/x');
  const endpoint = `http://${url.hostname}:${url.port}/?database=${url.pathname.slice(1)}&default_format=JSONCompact`;
  const authorization = `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`;
  const run = async (sql: string) => {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization }, body: sql });
    const text = await response.text();
    return response.ok ? { data: (JSON.parse(text) as { data: unknown[][] }).data } : { error: text };
  };

  it('parses the INTO OUTFILE a backslash escape hides from Postgres rules, and the check counts it as a write', async () => {
    const sql = "SELECT 'a\\'' , 1 INTO OUTFILE 'x' -- '";
    expect(isWriteSqlStatement(sql)).toBe(false);
    expect((await run(sql)).error).toContain('INTO_OUTFILE_NOT_ALLOWED');
    expect(isWriteSqlStatementOn('clickhouse', sql)).toBe(true);
  });

  it.each([
    ['SELECT 1 /* outer /* inner */ , 2 */', [[1]]],
    ['SELECT 1 --, 2', [[1]]],
    ['SELECT $q$; DELETE FROM t$q$', [['; DELETE FROM t']]],
    ['SELECT a$b$c FROM (SELECT 1 AS a$b$c)', [[1]]],
  ])('runs %j as one read, and the check lets it through', async (sql, rows) => {
    expect((await run(sql)).data).toEqual(rows);
    expect(isWriteSqlStatementOn('clickhouse', sql)).toBe(false);
  });

  it('masks a heredoc the server reads as a string', async () => {
    const sql = 'SELECT $$https://u:pw@h/x.csv$$';
    expect((await run(sql)).data).toEqual([['https://u:pw@h/x.csv']]);
    expect(redactSqlSecrets(sql, 'clickhouse')).toBe("SELECT '•••'");
  });
});

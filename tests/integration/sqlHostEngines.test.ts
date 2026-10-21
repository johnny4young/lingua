/**
 * The SQL host against real Postgres and MySQL servers. Runs when
 * LINGUA_TEST_PG_URL / LINGUA_TEST_MYSQL_URL point at disposable servers
 * (Docker locally, service containers in CI); skipped otherwise.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createSqlHost } from '../../src/main/sqlHost/host';
import { openMysql } from '../../src/main/sqlHost/mysql';
import { openPostgres } from '../../src/main/sqlHost/postgres';
import type { HostRequest, HostSessionConfig } from '../../src/main/sqlHost/protocol';
import { openSqlite } from '../../src/main/sqlHost/sqlite';

const host = createSqlHost({ postgres: openPostgres, mysql: openMysql, sqlite: openSqlite });
afterAll(() => host.dispose());

let id = 0;
const send = (body: Omit<HostRequest, 'id'>) => host.handle({ id: ++id, ...body } as HostRequest);
const window = { maxRows: 1_000, maxBytes: 256 * 1024 };

function configFrom(url: string | undefined, engine: 'postgres' | 'mysql', connectionId: string, readOnly = false): HostSessionConfig | null {
  if (!url) return null;
  const parsed = new URL(url);
  return {
    connectionId,
    engine,
    address: parsed.hostname,
    port: Number(parsed.port),
    database: parsed.pathname.slice(1),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ssl: { mode: 'prefer' },
    readOnly,
  };
}

async function ok<T>(body: Omit<HostRequest, 'id'>): Promise<T> {
  const response = await send(body);
  if (!response.ok) throw new Error(response.error.message);
  return response.result as T;
}

for (const [engine, url] of [
  ['postgres', process.env.LINGUA_TEST_PG_URL],
  ['mysql', process.env.LINGUA_TEST_MYSQL_URL],
] as const) {
  const rw = configFrom(url, engine, `${engine}-rw`);
  const ro = configFrom(url, engine, `${engine}-ro`, true);
  describe.skipIf(!rw)(`${engine} host`, () => {
    const config = rw!;
    const readOnly = ro!;
    const table = `lingua_it_${engine}`;

    it('tests the connection with every step timed and the server version', async () => {
      const result = await ok<{ tcpMs: number; connectMs: number; serverVersion: string }>({ type: 'test', config });
      expect(result.tcpMs).toBeGreaterThanOrEqual(0);
      expect(result.serverVersion).toMatch(engine === 'postgres' ? /^PostgreSQL \d+/ : /^(MySQL|MariaDB) \d+/);
    });

    it('creates a table, reads a window and pages through the rest', async () => {
      await ok({ type: 'execute', config, runId: 'd', sql: `DROP TABLE IF EXISTS ${table}`, readWrite: false, window });
      const created =
        engine === 'postgres'
          ? `CREATE TABLE ${table} AS SELECT g AS id, 'city ' || (g % 7) AS city, (g * 1.25)::numeric(12,2) AS total, 9007199254740993::bigint AS big, timestamp '2026-10-01 00:00:00' + g * interval '1 minute' AS at, '{"a":1}'::jsonb AS meta FROM generate_series(1, 2500) g`
          : `CREATE TABLE ${table} (id INT PRIMARY KEY, city VARCHAR(20), total DECIMAL(12,2), big BIGINT, at DATETIME, meta JSON)`;
      await ok({ type: 'execute', config, runId: 'c', sql: created, readWrite: false, window });
      if (engine === 'mysql') {
        await ok({ type: 'execute', config, runId: 'depth', sql: 'SET SESSION cte_max_recursion_depth = 5000', readWrite: false, window });
        await ok({
          type: 'execute',
          config,
          runId: 'i',
          sql: `INSERT INTO ${table} WITH RECURSIVE g(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM g WHERE n < 2500) SELECT n, CONCAT('city ', n % 7), n * 1.25, 9007199254740993, TIMESTAMP('2026-10-01') + INTERVAL n MINUTE, JSON_OBJECT('a', 1) FROM g`,
          readWrite: false,
          window,
        });
      }
      const first = await ok<{ columns: Array<{ name: string; type: string }>; rows: Array<Record<string, unknown>>; hasMore: boolean }>({
        type: 'execute',
        config,
        runId: 'q',
        sql: `SELECT * FROM ${table} ORDER BY id`,
        readWrite: false,
        window,
      });
      expect(first.columns.map((c) => c.type)).toEqual(
        engine === 'postgres'
          ? ['INTEGER', 'TEXT', 'DECIMAL(12,2)', 'BIGINT', 'TIMESTAMP', 'JSONB']
          : ['INTEGER', 'VARCHAR', 'DECIMAL(12,2)', 'BIGINT', 'DATETIME', 'JSON']
      );
      expect(first.rows).toHaveLength(1_000);
      expect(first.rows[0]).toMatchObject({ total: '1.25', big: '9007199254740993', at: expect.stringMatching(/^2026-10-01 00:01:00/) });
      expect(String(first.rows[0]!.meta)).toMatch(/"a": ?1/);
      expect(first.hasMore).toBe(true);
      const rest = await ok<{ rows: unknown[]; done: boolean }>({ type: 'fetch', runId: 'q', limit: 5_000, maxBytes: 1e9 });
      expect(rest.rows).toHaveLength(1_500);
      expect(rest.done).toBe(true);
    });

    it('refuses a write on a read-only connection on the server side, and lifts it for one run', async () => {
      const refused = await send({ type: 'execute', config: readOnly, runId: 'w', sql: `DELETE FROM ${table} WHERE id = 1`, readWrite: false, window });
      expect(refused).toMatchObject({ ok: false, error: { message: expect.stringMatching(/read.only/i) } });
      const estimate = await ok<number | null>({ type: 'estimate', config: readOnly, sql: `DELETE FROM ${table} WHERE id < 100` });
      expect(estimate).toBeGreaterThan(0);
      const lifted = await ok<{ affectedRows: number }>({ type: 'execute', config: readOnly, runId: 'w2', sql: `DELETE FROM ${table} WHERE id = 1`, readWrite: true, window });
      expect(lifted.affectedRows).toBe(1);
      // The session is read-only again after the run.
      expect(await send({ type: 'execute', config: readOnly, runId: 'w3', sql: `DELETE FROM ${table} WHERE id = 2`, readWrite: false, window })).toMatchObject({ ok: false });
    });

    it('keeps read-only per run, so a statement that changes the session default cannot open writes', async () => {
      const flip =
        engine === 'postgres' ? 'SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE' : 'SET SESSION TRANSACTION READ WRITE';
      await send({ type: 'execute', config: readOnly, runId: 'flip', sql: flip, readWrite: false, window });
      expect(await send({ type: 'execute', config: readOnly, runId: 'after', sql: `DELETE FROM ${table} WHERE id = 3`, readWrite: false, window })).toMatchObject({
        ok: false,
        error: { message: expect.stringMatching(/read.only/i) },
      });
      const begin = engine === 'postgres' ? 'BEGIN READ WRITE' : 'START TRANSACTION READ WRITE';
      await send({ type: 'execute', config: readOnly, runId: 'begin', sql: begin, readWrite: false, window });
      expect(await send({ type: 'execute', config: readOnly, runId: 'after2', sql: `DELETE FROM ${table} WHERE id = 3`, readWrite: false, window })).toMatchObject({
        ok: false,
      });
      const kept = await ok<{ rows: Array<{ n: unknown }> }>({ type: 'execute', config, runId: 'count3', sql: `SELECT COUNT(*) AS n FROM ${table} WHERE id = 3`, readWrite: false, window });
      expect(Number(kept.rows[0]?.n)).toBe(1);
    });

    it('estimates one statement and never runs a second one hidden behind it', async () => {
      const before = await ok<{ rows: Array<{ n: unknown }> }>({ type: 'execute', config, runId: 'c1', sql: `SELECT COUNT(*) AS n FROM ${table}`, readWrite: false, window });
      expect(await ok<number | null>({ type: 'estimate', config, sql: `SELECT 1; DELETE FROM ${table}` })).toBeNull();
      const after = await ok<{ rows: Array<{ n: unknown }> }>({ type: 'execute', config, runId: 'c2', sql: `SELECT COUNT(*) AS n FROM ${table}`, readWrite: false, window });
      expect(Number(after.rows[0]?.n)).toBe(Number(before.rows[0]?.n));
    });

    it('stops the server when a result is closed unread, instead of reading the rest', async () => {
      // About 10 s of rows: closing must not wait for them.
      const big =
        engine === 'postgres'
          ? 'SELECT g, pg_sleep(0.004) AS s FROM generate_series(1, 2500) g'
          : // Rows wider than the server's 16 KB net buffer reach the client as they are made.
            `SELECT id, REPEAT('x', 20000) AS pad, SLEEP(0.004) AS s FROM ${table}`;
      await ok({ type: 'execute', config, runId: 'big', sql: big, readWrite: false, window: { maxRows: 100, maxBytes: 256 * 1024 } });
      const started = performance.now();
      const next = await ok<{ rows: Array<{ one: unknown }> }>({ type: 'execute', config, runId: 'next', sql: 'SELECT 1 AS one', readWrite: false, window });
      expect(Number(next.rows[0]?.one)).toBe(1);
      expect(performance.now() - started).toBeLessThan(5_000);
    });

    it('cancels a long statement from a side connection', async () => {
      const sleep = engine === 'postgres' ? 'SELECT pg_sleep(30)' : 'SELECT SLEEP(30)';
      const running = send({ type: 'execute', config, runId: 'long', sql: sleep, readWrite: false, window });
      await new Promise((resolve) => setTimeout(resolve, 500));
      // The run is registered once the statement starts streaming; cancel through the session either way.
      const started = performance.now();
      await send({ type: 'cancel', runId: 'long' });
      const outcome = await running;
      expect(performance.now() - started).toBeLessThan(10_000);
      if (engine === 'postgres') expect(outcome).toMatchObject({ ok: false, error: { message: expect.stringMatching(/cancel/i) } });
    });

    it('names the auth step on a wrong password', async () => {
      const result = await send({ type: 'test', config: { ...config, connectionId: `${engine}-bad`, password: 'wrong' } });
      expect(result).toMatchObject({ ok: false, error: { step: 'auth', fix: 'auth' } });
    });
  });
}

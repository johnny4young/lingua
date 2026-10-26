// @vitest-environment node
/**
 * Copy to Local end to end: rows from real Postgres and MySQL servers go
 * through the SQL host's paged runs into a real DuckDB-WASM table, which then
 * joins with the other copy. Runs with LINGUA_TEST_PG_URL and
 * LINGUA_TEST_MYSQL_URL; skipped otherwise.
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DriverFactory } from '../../src/main/sqlHost/driver';
import { createSqlHost } from '../../src/main/sqlHost/host';
import { openMysql } from '../../src/main/sqlHost/mysql';
import { openPostgres } from '../../src/main/sqlHost/postgres';
import type { HostExecuteResult, HostFetchResult, HostRequest, HostSessionConfig } from '../../src/main/sqlHost/protocol';
import { __setDuckDbEngineFactoryForTests, type DuckDbEngineHandle } from '../../src/renderer/runtime/duckdbClient';
import { copyConnectionResultToLocal } from '../../src/renderer/runtime/sqlCopyToLocal';
import { parseLocalCopyOrigin } from '../../src/shared/sqlCopyToLocal';
import type { SqlDbBridge, SqlDbRunResult } from '../../src/shared/sqlDb';

const pgUrl = process.env.LINGUA_TEST_PG_URL;
const myUrl = process.env.LINGUA_TEST_MYSQL_URL;

const unused: DriverFactory = () => Promise.reject(new Error('not in this suite'));
const host = createSqlHost({ postgres: openPostgres, mysql: openMysql, sqlite: unused, sqlserver: unused, clickhouse: unused, libsql: unused, neon: unused, d1: unused });
let id = 0;
async function ok<T>(body: Omit<HostRequest, 'id'>): Promise<T> {
  const response = await host.handle({ id: ++id, ...body } as HostRequest);
  if (!response.ok) throw new Error(response.error.message);
  return response.result as T;
}

function configFrom(url: string, engine: 'postgres' | 'mysql', connectionId: string, readOnly = true): HostSessionConfig {
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

const run = (config: HostSessionConfig, sql: string) => ok<HostExecuteResult>({ type: 'execute', config, runId: `seed-${++id}`, sql, readWrite: true, window: { maxRows: 10, maxBytes: 4096 } });

/** The renderer's bridge over the host, as main serves it: small windows so paging is exercised. */
function bridgeFor(configs: Record<string, HostSessionConfig>): SqlDbBridge {
  return {
    async execute(runId, connectionId, sql) {
      const config = configs[connectionId]!;
      const result = await ok<HostExecuteResult>({ type: 'execute', config, runId, sql, readWrite: false, window: { maxRows: 700, maxBytes: 256 * 1024 } });
      return { ...result, status: result.tooLarge ? 'too-large' : 'success', engine: config.engine, durationMs: 1 } satisfies SqlDbRunResult;
    },
    fetch: (runId, limit, maxBytes) => ok<HostFetchResult>({ type: 'fetch', runId, limit, maxBytes }),
    closeRun: async (runId) => {
      await ok({ type: 'close-run', runId });
      return { ok: true as const };
    },
    cancel: async () => ({ cancelled: true }),
  } as unknown as SqlDbBridge;
}

type Blocking = {
  createDuckDB: (bundles: unknown, logger: unknown, runtime: unknown) => Promise<{
    instantiate(): Promise<void>;
    connect(): { query(sql: string): { toArray(): Array<{ toJSON(): Record<string, unknown> }>; schema: { fields: Array<{ name: string }> } }; close(): void };
    registerFileText(name: string, text: string): void;
    dropFile(name: string): void;
  }>;
  ConsoleLogger: new (level: number) => unknown;
  LogLevel: { ERROR: number };
  NODE_RUNTIME: unknown;
};

let localQuery: (sql: string) => Array<Record<string, unknown>>;

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
  const dist = path.dirname(entry);
  const duck = require(entry) as Blocking;
  const db = await duck.createDuckDB(
    { mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: '' }, eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: '' } },
    new duck.ConsoleLogger(duck.LogLevel.ERROR),
    duck.NODE_RUNTIME
  );
  await db.instantiate();
  const toRows = (table: ReturnType<ReturnType<typeof db.connect>['query']>) =>
    table.toArray().map((row) => JSON.parse(JSON.stringify(row.toJSON(), (_key, value) => (typeof value === 'bigint' ? value.toString() : value))) as Record<string, unknown>);
  // The Local engine as the renderer's client sees it, over the real DuckDB.
  const engine: DuckDbEngineHandle = {
    connect: async () => {
      const connection = db.connect();
      return {
        query: async (sql: string) => {
          const rows = toRows(connection.query(sql));
          return { columns: [], rows, rowCount: rows.length, tooLarge: false };
        },
        close: async () => connection.close(),
      };
    },
    terminate: async () => undefined,
    // The Node build reads registered text; the browser's async client takes the buffer itself.
    registerFile: async (name, data) => db.registerFileText(name, new TextDecoder().decode(data)),
    dropFile: async (name) => db.dropFile(name),
  };
  __setDuckDbEngineFactoryForTests(async () => engine);
  const shared = db.connect();
  localQuery = (sql) => toRows(shared.query(sql));
});

afterAll(async () => {
  __setDuckDbEngineFactoryForTests(null);
  await host.dispose();
});

describe.skipIf(!pgUrl || !myUrl)('Copy to Local from Postgres and MySQL', () => {
  // The suite's own tables, written on read-write sessions; the copies read them read-only.
  beforeAll(async () => {
    const pg = configFrom(pgUrl!, 'postgres', 'pg-seed', false);
    await run(pg, 'DROP TABLE IF EXISTS lingua_copy_orders');
    await run(pg, 'CREATE TABLE lingua_copy_orders (id bigint PRIMARY KEY, customer_id bigint NOT NULL, total numeric(12,2) NOT NULL, created_at timestamptz NOT NULL)');
    await run(pg, "INSERT INTO lingua_copy_orders SELECT g, g % 300 + 1, (g % 1000) / 4.0, timestamptz '2026-10-01 00:00:00+00' + g * interval '1 minute' FROM generate_series(1, 2500) g");
    const my = configFrom(myUrl!, 'mysql', 'my-seed', false);
    await run(my, 'DROP TABLE IF EXISTS lingua_copy_customers');
    await run(my, 'CREATE TABLE lingua_copy_customers (id bigint PRIMARY KEY, name varchar(40) NOT NULL, city varchar(40))');
    await run(my, "INSERT INTO lingua_copy_customers WITH RECURSIVE n (i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 300) SELECT i, CONCAT('customer ', i), IF(i % 2 = 0, 'Lima', 'Cali') FROM n");
  });

  it('copies both results with their types, pages and origin, and joins them on Local', async () => {
    const configs = { pg: configFrom(pgUrl!, 'postgres', 'pg'), my: configFrom(myUrl!, 'mysql', 'my') };
    const db = bridgeFor(configs);
    const at = () => new Date('2026-10-23T10:00:00Z');
    const pgCopy = await copyConnectionResultToLocal({
      db,
      connectionId: 'pg',
      connectionName: 'orders-dev',
      sql: "SELECT id, customer_id, total, created_at, 'x'::bytea AS raw, total > 50 AS big FROM lingua_copy_orders",
      table: 'pg_orders',
      timeoutMs: 30_000,
      now: at,
    });
    expect(pgCopy).toEqual({ rowCount: 2500, truncated: false });
    const myCopy = await copyConnectionResultToLocal({ db, connectionId: 'my', connectionName: 'billing', sql: 'SELECT id, name, city FROM lingua_copy_customers', table: 'my_customers', timeoutMs: 30_000, now: at });
    expect(myCopy).toEqual({ rowCount: 300, truncated: false });

    const types = localQuery("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pg_orders' ORDER BY ordinal_position");
    expect(types).toEqual([
      { column_name: 'id', data_type: 'BIGINT' },
      { column_name: 'customer_id', data_type: 'BIGINT' },
      { column_name: 'total', data_type: 'DECIMAL(12,2)' },
      { column_name: 'created_at', data_type: 'TIMESTAMP WITH TIME ZONE' },
      { column_name: 'raw', data_type: 'BLOB' },
      { column_name: 'big', data_type: 'BOOLEAN' },
    ]);
    // The same numbers on both sides: the server's own count and sum against the copy's.
    const [server] = (await ok<HostExecuteResult>({ type: 'execute', config: configs.pg, runId: 'check', sql: 'SELECT count(*) AS n, sum(total)::text AS revenue FROM lingua_copy_orders', readWrite: false, window: { maxRows: 10, maxBytes: 4096 } })).rows;
    const [local] = localQuery('SELECT count(*)::VARCHAR AS n, sum(total)::VARCHAR AS revenue, hex(any_value(raw)) AS raw FROM pg_orders');
    expect(local).toEqual({ n: String(server!.n), revenue: server!.revenue, raw: '78' });

    // Every order has its customer; half the customers are in Lima.
    expect(localQuery("SELECT count(*)::VARCHAR AS n, count(*) FILTER (WHERE c.city = 'Lima')::VARCHAR AS lima FROM pg_orders o JOIN my_customers c ON c.id = o.customer_id")).toEqual([{ n: '2500', lima: '1250' }]);
    const [comment] = localQuery("SELECT comment FROM duckdb_tables() WHERE table_name = 'pg_orders'");
    expect(parseLocalCopyOrigin(comment!.comment)).toEqual({ connection: 'orders-dev', at: '2026-10-23T10:00:00.000Z' });
  });
});

/**
 * The SQL host against real SQL Server and ClickHouse servers. Runs when
 * LINGUA_TEST_MSSQL_URL / LINGUA_TEST_CLICKHOUSE_URL point at disposable
 * servers (Docker locally, service containers in CI); skipped otherwise.
 */

import net, { type AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { openClickHouse } from '../../src/main/sqlHost/clickhouse';
import { createSqlHost } from '../../src/main/sqlHost/host';
import { openMysql } from '../../src/main/sqlHost/mysql';
import { openPostgres } from '../../src/main/sqlHost/postgres';
import type { HostRequest, HostSessionConfig } from '../../src/main/sqlHost/protocol';
import { openSqlite } from '../../src/main/sqlHost/sqlite';
import { openSqlServer } from '../../src/main/sqlHost/sqlserver';
import type { SqlDbIntrospectResult } from '../../src/shared/sqlDb';
import { rowEditStatements, type RowEditTable } from '../../src/shared/sqlRowEdits';
import { startBastion, type Bastion } from './sshBastion';

const host = createSqlHost({ postgres: openPostgres, mysql: openMysql, sqlite: openSqlite, sqlserver: openSqlServer, clickhouse: openClickHouse });
afterAll(() => host.dispose());

let id = 0;
const send = (body: Omit<HostRequest, 'id'>) => host.handle({ id: ++id, ...body } as HostRequest);
const window = { maxRows: 1_000, maxBytes: 256 * 1024 };

async function ok<T>(body: Omit<HostRequest, 'id'>): Promise<T> {
  const response = await send(body);
  if (!response.ok) throw new Error(response.error.message);
  return response.result as T;
}

type Rows = { rows: Array<Record<string, unknown>>; columns: Array<{ name: string; type: string }>; hasMore: boolean; affectedRows?: number };

function configFrom(url: string | undefined, engine: 'sqlserver' | 'clickhouse', connectionId: string, readOnly = false): HostSessionConfig | null {
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
    // The test server's certificate is self-signed; ClickHouse's container speaks plain HTTP.
    ssl: { mode: engine === 'sqlserver' ? 'require' : 'disable' },
    readOnly,
  };
}

const mssql = configFrom(process.env.LINGUA_TEST_MSSQL_URL, 'sqlserver', 'mssql-rw');
const mssqlReadOnly = configFrom(process.env.LINGUA_TEST_MSSQL_URL, 'sqlserver', 'mssql-ro', true);

describe.skipIf(!mssql)('sqlserver host', () => {
  const config = mssql!;
  const run = (sql: string, readWrite = false, target = config) =>
    ok<Rows>({ type: 'execute', config: target, runId: `m-${++id}`, sql, readWrite, window });

  beforeAll(async () => {
    // The database the URL names is made here, from master.
    const master = { ...config, connectionId: 'mssql-master', database: 'master' };
    await run(`IF DB_ID(N'${config.database}') IS NULL CREATE DATABASE [${config.database}]`, false, master);
    await run('DROP TABLE IF EXISTS dbo.lingua_it_lines', false);
    await run('DROP TABLE IF EXISTS dbo.lingua_it_orders', false);
    await run(
      'CREATE TABLE dbo.lingua_it_orders (id INT NOT NULL CONSTRAINT pk_orders PRIMARY KEY, city NVARCHAR(40) NULL, total DECIMAL(10,2) NULL, placed DATETIME2 NULL)'
    );
    await run('CREATE TABLE dbo.lingua_it_lines (id INT PRIMARY KEY, order_id INT NOT NULL REFERENCES dbo.lingua_it_orders(id))');
    await run(
      "WITH n AS (SELECT TOP (2500) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS i FROM sys.all_objects a CROSS JOIN sys.all_objects b) INSERT INTO dbo.lingua_it_orders (id, city, total, placed) SELECT i, N'Medellín ' + CAST(i AS NVARCHAR(10)), i * 1.5, DATEADD(day, i, '2026-01-01') FROM n"
    );
    await run('CREATE OR ALTER VIEW dbo.lingua_it_big AS SELECT id, total FROM dbo.lingua_it_orders WHERE total > 100');
    await run('CREATE OR ALTER PROCEDURE dbo.lingua_it_proc AS SELECT 1 AS one');
  }, 60_000);

  it('tests the connection with every step timed and the server version', async () => {
    const result = await ok<{ serverVersion: string; tcpMs: number; connectMs: number; encrypted?: boolean }>({ type: 'test', config });
    expect(result.serverVersion).toMatch(/^SQL Server \d+\./);
    expect(result.tcpMs).toBeGreaterThanOrEqual(0);
    expect(result.encrypted).toBe(true);
  });

  it('reads a window, pages through the rest, and keeps types and text as the server holds them', async () => {
    const first = await ok<Rows>({ type: 'execute', config, runId: 'm-page', sql: 'SELECT id, city, total, placed FROM dbo.lingua_it_orders ORDER BY id', readWrite: false, window });
    expect(first.rows).toHaveLength(1_000);
    expect(first.hasMore).toBe(true);
    expect(first.columns).toEqual([
      { name: 'id', type: 'INTEGER' },
      { name: 'city', type: 'VARCHAR' },
      { name: 'total', type: 'DECIMAL(10,2)' },
      { name: 'placed', type: 'TIMESTAMP' },
    ]);
    expect(first.rows[0]).toEqual({ id: 1, city: 'Medellín 1', total: 1.5, placed: '2026-01-02 00:00:00.000' });
    let seen = first.rows.length;
    for (;;) {
      const page = await ok<{ rows: unknown[]; done: boolean }>({ type: 'fetch', runId: 'm-page', limit: 1_000, maxBytes: 256 * 1024 });
      seen += page.rows.length;
      if (page.done) break;
    }
    expect(seen).toBe(2_500);
    const write = await run("UPDATE dbo.lingua_it_orders SET city = N'Envigado' WHERE id = 1");
    expect(write.affectedRows).toBe(1);
  });

  it('lists the catalog level by level and details a table, a view and a procedure', async () => {
    const schemas = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'schemas' } });
    expect(schemas.schemas?.[0]?.name).toBe('dbo');
    const objects = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'objects', schema: 'dbo' } });
    expect(objects.objects).toEqual(
      expect.arrayContaining([
        { kind: 'table', name: 'lingua_it_orders', rowEstimate: 2_500 },
        { kind: 'view', name: 'lingua_it_big' },
        { kind: 'procedure', name: 'lingua_it_proc' },
      ])
    );
    const table = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'detail', schema: 'dbo', name: 'lingua_it_orders', kind: 'table' } });
    expect(table.detail?.columns[0]).toEqual({ name: 'id', type: 'int', nullable: false, primaryKey: true });
    expect(table.detail?.columns[1]).toMatchObject({ name: 'city', type: 'nvarchar(40)', nullable: true });
    expect(table.detail?.indexes[0]).toEqual({ name: 'pk_orders', columns: ['id'], unique: true, primary: true });
    expect(table.detail?.ddl).toContain('CONSTRAINT [pk_orders] PRIMARY KEY ([id])');
    const lines = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'detail', schema: 'dbo', name: 'lingua_it_lines', kind: 'table' } });
    expect(lines.detail?.columns[1]?.references).toEqual({ schema: 'dbo', table: 'lingua_it_orders', column: 'id' });
    const view = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'detail', schema: 'dbo', name: 'lingua_it_big', kind: 'view' } });
    expect(view.detail?.ddl).toMatch(/CREATE\s+(OR ALTER\s+)?VIEW/i);
    const proc = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'detail', schema: 'dbo', name: 'lingua_it_proc', kind: 'procedure' } });
    expect(proc.detail?.ddl).toContain('SELECT 1 AS one');
  });

  it('keeps a catalog name that closes a bracket a name, never SQL', async () => {
    await run('DROP TABLE IF EXISTS dbo.[we]]ird]');
    await run('CREATE TABLE dbo.[we]]ird] (id INT PRIMARY KEY)');
    const detail = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'detail', schema: 'dbo', name: 'we]ird', kind: 'table' } });
    expect(detail.detail?.columns.map((column) => column.name)).toEqual(['id']);
    expect(detail.detail?.ddl).toContain('[we]]ird]');
    await run('DROP TABLE dbo.[we]]ird]');
  });

  it('rolls back every run on a read-only connection, and lets a confirmed write through', async () => {
    const readOnly = mssqlReadOnly!;
    await ok({ type: 'execute', config: readOnly, runId: 'm-ro', sql: "UPDATE dbo.lingua_it_orders SET city = N'never' WHERE id = 2", readWrite: false, window });
    await ok({ type: 'close-run', runId: 'm-ro' });
    const kept = await run('SELECT city FROM dbo.lingua_it_orders WHERE id = 2');
    expect(kept.rows[0]?.city).toBe('Medellín 2');
    await ok({ type: 'execute', config: readOnly, runId: 'm-rw', sql: "UPDATE dbo.lingua_it_orders SET city = N'confirmed' WHERE id = 2", readWrite: true, window });
    const changed = await run('SELECT city FROM dbo.lingua_it_orders WHERE id = 2');
    expect(changed.rows[0]?.city).toBe('confirmed');
  });

  it('explains a statement with its estimated plan instead of running it, and estimates its rows', async () => {
    const plan = await run('EXPLAIN DELETE FROM dbo.lingua_it_orders WHERE id > 2000');
    expect(plan.columns.map((column) => column.name)).toEqual(expect.arrayContaining(['StmtText', 'EstimateRows']));
    const still = await run('SELECT COUNT(*) AS n FROM dbo.lingua_it_orders');
    expect(still.rows[0]?.n).toBe(2_500);
    const estimate = await ok<number | null>({ type: 'estimate', config, sql: 'SELECT * FROM dbo.lingua_it_orders WHERE id > 2000' });
    expect(estimate).toBeGreaterThan(0);
  });

  it('stops the server when a result is closed unread, and cancels a long statement', async () => {
    await ok({ type: 'execute', config, runId: 'm-big', sql: 'SELECT a.object_id FROM sys.all_objects a CROSS JOIN sys.all_objects b', readWrite: false, window });
    const started = Date.now();
    await ok({ type: 'close-run', runId: 'm-big' });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect((await run('SELECT 1 AS one')).rows).toEqual([{ one: 1 }]);
    const slow = send({ type: 'execute', config, runId: 'm-slow', sql: "WAITFOR DELAY '00:00:30'", readWrite: false, window });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await ok({ type: 'cancel', runId: 'm-slow' })).toEqual({ cancelled: true });
    expect(await slow).toMatchObject({ ok: false });
  }, 30_000);

  it('applies staged edits in one transaction, and rolls them all back when one touches no row', async () => {
    const table: RowEditTable = { engine: 'sqlserver', schema: 'dbo', name: 'lingua_it_orders', columns: ['id', 'city', 'total', 'placed'], key: { kind: 'pk', columns: ['id'] } };
    const statements = rowEditStatements(
      table,
      { updates: [{ key: { id: '3' }, values: { city: "O'Brien", total: null } }], deletes: [{ key: { id: '4' } }], inserts: [{ values: { id: '9001', city: 'Bogotá', total: '40.25' } }] },
      false
    );
    expect(statements[0]?.sql).toBe('UPDATE [dbo].[lingua_it_orders] SET [city] = @p1, [total] = @p2 WHERE [id] = @p3');
    expect(await ok({ type: 'apply-edits', config, statements })).toEqual({ applied: 3 });
    const after = await run('SELECT id, city, total FROM dbo.lingua_it_orders WHERE id IN (3, 4, 9001) ORDER BY id');
    expect(after.rows).toEqual([
      { id: 3, city: "O'Brien", total: null },
      { id: 9001, city: 'Bogotá', total: 40.25 },
    ]);
    const conflict = rowEditStatements(table, { updates: [{ key: { id: '3' }, values: { city: 'changed' } }], deletes: [{ key: { id: '4' } }], inserts: [] }, false);
    expect(await send({ type: 'apply-edits', config, statements: conflict })).toMatchObject({ ok: false, error: { edit: { kind: 'conflict', change: 2, touched: 0 } } });
    expect((await run('SELECT city FROM dbo.lingua_it_orders WHERE id = 3')).rows[0]?.city).toBe("O'Brien");
  });

  it('rolls an edit back when another session holds its row, well before main stops waiting', async () => {
    await run('BEGIN TRANSACTION');
    await run("UPDATE dbo.lingua_it_orders SET city = N'held' WHERE id = 5");
    try {
      const table: RowEditTable = { engine: 'sqlserver', schema: 'dbo', name: 'lingua_it_orders', columns: ['id', 'city'], key: { kind: 'pk', columns: ['id'] } };
      const started = Date.now();
      const statements = rowEditStatements(table, { updates: [{ key: { id: '5' }, values: { city: 'mine' } }], deletes: [], inserts: [] }, false);
      expect(await send({ type: 'apply-edits', config, statements })).toMatchObject({ ok: false });
      expect(Date.now() - started).toBeLessThan(20_000);
    } finally {
      await run('ROLLBACK');
    }
  }, 30_000);

  it('shows the first result set of a batch, and lets go of a session the server ended', async () => {
    const both = await run('SELECT 1 AS a SELECT 2 AS b');
    expect(both.columns.map((column) => column.name)).toEqual(['a']);
    expect(both.rows).toEqual([{ a: 1 }]);
    const driver = await openSqlServer({ ...config, connectionId: 'mssql-ended' });
    const own = await driver.run('SELECT @@SPID AS spid', { readWrite: false });
    const spid = Number((await own.next(1)).rows[0]?.spid);
    await own.close();
    await run(`KILL ${spid}`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    // Closing a connection the server already ended settles instead of waiting for an end that never comes.
    const closed = await Promise.race([driver.close().then(() => 'closed'), new Promise((resolve) => setTimeout(() => resolve('hung'), 5_000))]);
    expect(closed).toBe('closed');
  }, 30_000);

  it('names the auth step on a wrong password and the database step on a missing database', async () => {
    const wrong = await send({ type: 'test', config: { ...config, connectionId: 'mssql-wrong', password: 'nope' } });
    expect(wrong).toMatchObject({ ok: false, error: { step: 'auth', fix: 'auth' } });
    const missing = await send({ type: 'test', config: { ...config, connectionId: 'mssql-missing', database: 'lingua_no_such_db' } });
    expect(missing).toMatchObject({ ok: false, error: { step: 'auth', fix: 'database' } });
  });
});

const clickhouse = configFrom(process.env.LINGUA_TEST_CLICKHOUSE_URL, 'clickhouse', 'ch-rw');
const clickhouseReadOnly = configFrom(process.env.LINGUA_TEST_CLICKHOUSE_URL, 'clickhouse', 'ch-ro', true);

describe.skipIf(!clickhouse)('clickhouse host', () => {
  const config = clickhouse!;
  const run = (sql: string, readWrite = false, target = config) =>
    ok<Rows>({ type: 'execute', config: target, runId: `c-${++id}`, sql, readWrite, window });

  beforeAll(async () => {
    await run('DROP TABLE IF EXISTS lingua_it_events');
    await run('DROP VIEW IF EXISTS lingua_it_recent');
    await run('CREATE TABLE lingua_it_events (id UInt64, city LowCardinality(String), amount Decimal(10, 2), at DateTime) ENGINE = MergeTree ORDER BY id');
    await run("INSERT INTO lingua_it_events SELECT number + 1, concat('Cali ', toString(number + 1)), (number + 1) * 1.5, toDateTime('2026-01-01 00:00:00') + number FROM numbers(2500)");
    await run('CREATE VIEW lingua_it_recent AS SELECT id, amount FROM lingua_it_events WHERE id > 2000');
  }, 60_000);

  it('tests the connection and reports the server version', async () => {
    const result = await ok<{ serverVersion: string }>({ type: 'test', config });
    expect(result.serverVersion).toMatch(/^ClickHouse \d+\./);
  });

  it('reads a window, pages through the rest, and keeps wide numbers as text', async () => {
    const first = await ok<Rows>({ type: 'execute', config, runId: 'c-page', sql: 'SELECT id, city, amount, at FROM lingua_it_events ORDER BY id', readWrite: false, window });
    expect(first.rows).toHaveLength(1_000);
    expect(first.columns).toEqual([
      { name: 'id', type: 'UBIGINT' },
      { name: 'city', type: 'VARCHAR' },
      { name: 'amount', type: 'DECIMAL(10,2)' },
      { name: 'at', type: 'TIMESTAMP' },
    ]);
    expect(first.rows[0]).toEqual({ id: '1', city: 'Cali 1', amount: '1.5', at: '2026-01-01 00:00:00' });
    let seen = first.rows.length;
    for (;;) {
      const page = await ok<{ rows: unknown[]; done: boolean }>({ type: 'fetch', runId: 'c-page', limit: 1_000, maxBytes: 256 * 1024 });
      seen += page.rows.length;
      if (page.done) break;
    }
    expect(seen).toBe(2_500);
  });

  it('lists databases, tables and views, and details a table with its sorting key and DDL', async () => {
    const schemas = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'schemas' } });
    expect(schemas.schemas?.[0]?.name).toBe(config.database);
    const objects = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'objects', schema: config.database! } });
    expect(objects.objects).toEqual(expect.arrayContaining([{ kind: 'table', name: 'lingua_it_events', rowEstimate: 2_500 }, { kind: 'view', name: 'lingua_it_recent' }]));
    const table = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'detail', schema: config.database!, name: 'lingua_it_events', kind: 'table' } });
    expect(table.detail?.columns[0]).toEqual({ name: 'id', type: 'UInt64', nullable: false, primaryKey: true });
    expect(table.detail?.indexes[0]).toEqual({ name: 'PRIMARY KEY', columns: ['id'], unique: false, primary: true });
    expect(table.detail?.ddl).toMatch(/^CREATE TABLE/);
    const quoted = await ok<SqlDbIntrospectResult>({ type: 'introspect', config, request: { level: 'detail', schema: config.database!, name: "x' OR '1'='1", kind: 'table' } });
    expect(quoted.detail?.columns).toEqual([]);
  });

  it('refuses a write on a read-only connection on the server side, and lifts it for one confirmed run', async () => {
    const readOnly = clickhouseReadOnly!;
    const refused = await send({ type: 'execute', config: readOnly, runId: 'c-ro', sql: 'INSERT INTO lingua_it_events VALUES (9001, \'x\', 1, now())', readWrite: false, window });
    expect(refused).toMatchObject({ ok: false, error: { message: expect.stringMatching(/readonly/i) } });
    // The statement cannot lift readonly itself.
    for (const sql of ["INSERT INTO lingua_it_events SETTINGS readonly = 0 VALUES (9002, 'x', 1, now())", 'SET readonly = 0', 'SELECT 1 SETTINGS readonly = 0']) {
      expect(await send({ type: 'execute', config: readOnly, runId: `c-ro-${sql.length}`, sql, readWrite: false, window })).toMatchObject({ ok: false });
    }
    const allowed = await ok<Rows>({ type: 'execute', config: readOnly, runId: 'c-rw', sql: "INSERT INTO lingua_it_events VALUES (9001, 'x', 1, now())", readWrite: true, window });
    expect(allowed.affectedRows).toBe(1);
  });

  it('stops the server when a result is closed unread', async () => {
    await ok({ type: 'execute', config, runId: 'c-big', sql: 'SELECT number FROM numbers(1000000000)', readWrite: false, window });
    const started = Date.now();
    await ok({ type: 'close-run', runId: 'c-big' });
    expect(Date.now() - started).toBeLessThan(10_000);
    const stillRunning = async () =>
      Number((await run("SELECT count() AS n FROM system.processes WHERE query LIKE '%numbers(1000000000)%' AND query NOT LIKE '%system.processes%'")).rows[0]?.n);
    await vi.waitFor(async () => expect(await stillRunning()).toBe(0), { timeout: 5_000, interval: 200 });
  }, 30_000);

  it('cancels a long statement', async () => {
    const slow = send({ type: 'execute', config, runId: 'c-slow', sql: 'SELECT sleepEachRow(0.5) FROM numbers(60) SETTINGS max_block_size = 1', readWrite: false, window });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(await ok({ type: 'cancel', runId: 'c-slow' })).toEqual({ cancelled: true });
    await slow;
  }, 30_000);

  it('under prefer, falls back to plain HTTP only when the server answers in plain HTTP, never on a reset', async () => {
    const plain = await ok<{ encrypted?: boolean }>({ type: 'test', config: { ...config, connectionId: 'ch-prefer', ssl: { mode: 'prefer' } } });
    expect(plain.encrypted).toBe(false);
    // A man in the middle that resets every TLS hello and passes plain HTTP through to the server.
    const downgrading = net.createServer((socket) =>
      socket.once('data', (first) => {
        if (first[0] === 0x16) return socket.destroy();
        const upstream = net.connect(config.port!, config.address!, () => {
          upstream.write(first);
          socket.pipe(upstream).pipe(socket);
        });
        upstream.on('error', () => socket.destroy());
      })
    );
    await new Promise<void>((resolve) => downgrading.listen(0, '127.0.0.1', resolve));
    try {
      const port = (downgrading.address() as AddressInfo).port;
      const reset = await send({ type: 'test', config: { ...config, connectionId: 'ch-reset', port, ssl: { mode: 'prefer' } } });
      expect(reset).toMatchObject({ ok: false });
    } finally {
      downgrading.close();
    }
  });

  it('reads a statement that ends with its own FORMAT clause', async () => {
    expect((await run('SELECT 1 AS one FORMAT CSV')).rows).toEqual([{ one: 1 }]);
  });

  it('never edits rows on ClickHouse', async () => {
    const table: RowEditTable = { engine: 'clickhouse', name: 'lingua_it_events', columns: ['id', 'city'], key: { kind: 'pk', columns: ['id'] } };
    const statements = rowEditStatements(table, { updates: [{ key: { id: '1' }, values: { city: 'x' } }], deletes: [], inserts: [] }, false);
    expect(await send({ type: 'apply-edits', config, statements })).toMatchObject({ ok: false, error: { message: /not edited row by row/ } });
  });

  it('names the auth step on a wrong password and the database step on a missing database', async () => {
    const wrong = await send({ type: 'test', config: { ...config, connectionId: 'ch-wrong', password: 'nope' } });
    expect(wrong).toMatchObject({ ok: false, error: { step: 'auth', fix: 'auth' } });
    const missing = await send({ type: 'test', config: { ...config, connectionId: 'ch-missing', database: 'lingua_no_such_db' } });
    expect(missing).toMatchObject({ ok: false, error: { step: 'auth', fix: 'database' } });
  });
});

describe.skipIf(!mssql && !clickhouse)('through an SSH tunnel', () => {
  let bastion: Bastion;
  beforeAll(async () => {
    bastion = await startBastion();
  });
  afterAll(() => bastion?.close());

  for (const [engine, direct, sql] of [
    ['sqlserver', mssql, 'SELECT TOP (50) ROW_NUMBER() OVER (ORDER BY (SELECT NULL)) AS n FROM sys.all_objects'],
    ['clickhouse', clickhouse, 'SELECT number FROM numbers(50)'],
  ] as const) {
    it.runIf(Boolean(direct))(`${engine}: tests, runs and pages a result through the bastion`, async () => {
      bastion.forwarded.length = 0;
      const { address, ...rest } = direct!;
      const config: HostSessionConfig = { ...rest, connectionId: `${engine}-tunnel`, servername: 'db.behind.bastion', ssh: bastion.ssh({ host: address!, port: direct!.port! }) };
      const tested = await ok<{ sshMs: number; serverVersion: string }>({ type: 'test', config });
      expect(tested.sshMs).toBeGreaterThanOrEqual(0);
      const first = await ok<Rows>({ type: 'execute', config, runId: `${engine}-t1`, sql, readWrite: false, window: { maxRows: 20, maxBytes: 256 * 1024 } });
      expect(first.rows).toHaveLength(20);
      expect((await ok<{ rows: unknown[] }>({ type: 'fetch', runId: `${engine}-t1`, limit: 100, maxBytes: 1e9 })).rows).toHaveLength(30);
      await ok({ type: 'introspect', config, request: { level: 'schemas' } });
      expect(bastion.forwarded.length).toBeGreaterThan(0);
      expect(bastion.forwarded.every((target) => target === `${address}:${direct!.port}`)).toBe(true);
      await ok({ type: 'disconnect', connectionId: `${engine}-tunnel` });
    });
  }
});

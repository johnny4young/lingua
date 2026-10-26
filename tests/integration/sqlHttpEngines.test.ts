/**
 * The SQL host's HTTP engines against real servers: a libSQL server (sqld)
 * and Neon's HTTP proxy in front of Postgres. Runs when LINGUA_TEST_LIBSQL_URL
 * and LINGUA_TEST_NEON_HTTP_URL point at disposable ones; skipped otherwise.
 */

import { afterAll, describe, expect, it } from 'vitest';
import { createSqlHost } from '../../src/main/sqlHost/host';
import type { DriverFactory } from '../../src/main/sqlHost/driver';
import { openD1Host, openLibsqlHost, openNeonHost } from '../../src/main/sqlHost/httpEngines';
import type { HostRequest, HostSessionConfig } from '../../src/main/sqlHost/protocol';
import type { SqlDbIntrospectResult } from '../../src/shared/sqlDb';
import { openLibsql } from '../../src/shared/sqlHttp/libsql';
import { rowEditStatements, type RowEditTable } from '../../src/shared/sqlRowEdits';
import { fetchTransport } from '../../src/renderer/runtime/sqlWebDb';

const unused: DriverFactory = () => Promise.reject(new Error('not in this suite'));
const host = createSqlHost({ postgres: unused, mysql: unused, sqlite: unused, sqlserver: unused, clickhouse: unused, libsql: openLibsqlHost, neon: openNeonHost, d1: openD1Host });
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

const run = (config: HostSessionConfig, sql: string, readWrite = false) =>
  ok<Rows>({ type: 'execute', config, runId: `run-${++id}`, sql, readWrite, window });

/** A plain-HTTP server as main hands it over: the pinned address, the name, and TLS off. */
function configFrom(url: string | undefined, engine: 'libsql' | 'neon', connectionId: string, readOnly = false): HostSessionConfig | null {
  if (!url) return null;
  const parsed = new URL(url);
  return {
    connectionId,
    engine,
    address: parsed.hostname,
    servername: parsed.hostname,
    port: Number(parsed.port),
    ssl: { mode: 'disable' },
    // Neon's proxy opens the database the connection string names: the URL's path, or shop.
    ...(engine === 'neon' ? { host: 'db.localtest.me', user: 'postgres', password: 'lingua', database: parsed.pathname.slice(1) || 'shop' } : {}),
    readOnly,
  };
}

const libsql = configFrom(process.env.LINGUA_TEST_LIBSQL_URL, 'libsql', 'turso');
const libsqlReadOnly = configFrom(process.env.LINGUA_TEST_LIBSQL_URL, 'libsql', 'turso-ro', true);
const neon = configFrom(process.env.LINGUA_TEST_NEON_HTTP_URL, 'neon', 'neon');
const neonReadOnly = configFrom(process.env.LINGUA_TEST_NEON_HTTP_URL, 'neon', 'neon-ro', true);

describe.skipIf(!libsql)('libSQL over Hrana', () => {
  it('tests, runs, refuses writes when read-only and reads the catalog', async () => {
    const test = await ok<{ serverVersion: string; tcpMs?: number; encrypted?: boolean }>({ type: 'test', config: libsql! });
    expect(test.serverVersion).toMatch(/^libSQL \(SQLite 3\./);
    expect(test.encrypted).toBe(false);
    await run(libsql!, 'DROP TABLE IF EXISTS notes');
    await run(libsql!, 'CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL, score REAL, big INTEGER, raw BLOB)');
    const inserted = await run(libsql!, "INSERT INTO notes VALUES (1, 'hola', 1.5, 9007199254740993, x'cafe'), (2, 'adiós', NULL, 7, NULL)");
    expect(inserted.affectedRows).toBe(2);
    const read = await run(libsql!, 'SELECT * FROM notes ORDER BY id');
    expect(read.columns.map((column) => column.type)).toEqual(['INTEGER', 'TEXT', 'DOUBLE', 'INTEGER', 'BLOB']);
    expect(read.rows[0]).toEqual({ id: 1, body: 'hola', score: 1.5, big: '9007199254740993', raw: 'yv4=' });

    expect((await run(libsqlReadOnly!, 'SELECT count(*) AS n FROM notes')).rows).toEqual([{ n: 2 }]);
    const refused = await send({ type: 'execute', config: libsqlReadOnly!, runId: 'ro-write', sql: 'DELETE FROM notes', readWrite: false, window });
    expect(refused.ok ? null : refused.error.message).toMatch(/read-only/);
    expect((await run(libsql!, 'SELECT count(*) AS n FROM notes')).rows).toEqual([{ n: 2 }]);
    // Lifting read-only for one run writes.
    expect((await run(libsqlReadOnly!, "UPDATE notes SET body = 'hey' WHERE id = 2", true)).affectedRows).toBe(1);

    const objects = await ok<SqlDbIntrospectResult>({ type: 'introspect', config: libsql!, request: { level: 'objects', schema: 'main' } });
    expect(objects.objects).toContainEqual({ kind: 'table', name: 'notes' });
    const detail = await ok<SqlDbIntrospectResult>({ type: 'introspect', config: libsql!, request: { level: 'detail', schema: 'main', name: 'notes', kind: 'table' } });
    expect(detail.detail?.columns.find((column) => column.name === 'id')?.primaryKey).toBe(true);
  });

  it('applies staged edits in one stream, and rolls them all back on a conflict', async () => {
    const table: RowEditTable = { engine: 'libsql', schema: 'main', name: 'notes', columns: ['id', 'body'], key: { kind: 'pk', columns: ['id'] } };
    const good = rowEditStatements(table, { updates: [{ key: { id: '1' }, values: { body: 'edited' } }], deletes: [], inserts: [{ values: { id: '3', body: 'new' } }] }, false);
    await ok({ type: 'apply-edits', config: libsql!, statements: good });
    expect((await run(libsql!, 'SELECT id, body FROM notes ORDER BY id')).rows).toEqual([
      { id: 1, body: 'edited' },
      { id: 2, body: 'hey' },
      { id: 3, body: 'new' },
    ]);
    const conflict = rowEditStatements(table, { updates: [{ key: { id: '1' }, values: { body: 'lost' } }], deletes: [{ key: { id: '99' } }], inserts: [] }, false);
    const failed = await send({ type: 'apply-edits', config: libsql!, statements: conflict });
    expect(failed.ok ? null : failed.error.edit).toEqual({ kind: 'conflict', change: 2, touched: 0 });
    expect((await run(libsql!, 'SELECT body FROM notes WHERE id = 1')).rows).toEqual([{ body: 'edited' }]);
  });

  it('runs the same client over the browser transport', async () => {
    const session = await openLibsql({ origin: process.env.LINGUA_TEST_LIBSQL_URL!, readOnly: true }, fetchTransport);
    const rows = await session.run('SELECT count(*) AS n FROM notes', { readWrite: false });
    expect((await rows.next(10)).rows).toEqual([{ n: 3 }]);
    await session.close();
  });
});

describe.skipIf(!neon)('Neon over SQL over HTTP', () => {
  // About ten round trips to a proxy that shares Postgres with the other engine suites, like their 30 s tests.
  it('tests, runs, keeps a read-only connection read-only on the server and reads the catalog', async () => {
    const test = await ok<{ serverVersion: string }>({ type: 'test', config: neon! });
    expect(test.serverVersion).toMatch(/^PostgreSQL 16\.\d+ \(Neon\)$/);
    await run(neon!, 'DROP TABLE IF EXISTS orders');
    await run(neon!, 'CREATE TABLE orders (id int PRIMARY KEY, city text, paid boolean, total numeric(10,2), big bigint, raw bytea)');
    expect((await run(neon!, "INSERT INTO orders VALUES (1, 'Cali', true, 10.50, 9007199254740993, '\\xcafe'), (2, 'Lima', false, NULL, 2, NULL)")).affectedRows).toBe(2);
    const read = await run(neon!, 'SELECT * FROM orders ORDER BY id');
    expect(read.columns.map((column) => column.type)).toEqual(['INTEGER', 'TEXT', 'BOOLEAN', 'DECIMAL(10,2)', 'BIGINT', 'BLOB']);
    expect(read.rows[0]).toEqual({ id: 1, city: 'Cali', paid: true, total: '10.50', big: '9007199254740993', raw: 'yv4=' });

    const refused = await send({ type: 'execute', config: neonReadOnly!, runId: 'neon-ro', sql: 'DELETE FROM orders', readWrite: false, window });
    expect(refused.ok ? null : refused.error.message).toMatch(/read-only transaction/);
    expect((await run(neonReadOnly!, "UPDATE orders SET city = 'Quito' WHERE id = 2", true)).affectedRows).toBe(1);

    expect(await ok<number | null>({ type: 'estimate', config: neon!, sql: 'SELECT * FROM orders' })).toBeGreaterThan(0);
    const detail = await ok<SqlDbIntrospectResult>({ type: 'introspect', config: neon!, request: { level: 'detail', schema: 'public', name: 'orders', kind: 'table' } });
    expect(detail.detail?.columns.find((column) => column.name === 'id')).toMatchObject({ primaryKey: true, nullable: false });
  }, 30_000);

  it('applies staged edits as one batch, and rolls them all back on a conflict', async () => {
    const table: RowEditTable = { engine: 'neon', schema: 'public', name: 'orders', columns: ['id', 'city'], key: { kind: 'pk', columns: ['id'] } };
    await ok({ type: 'apply-edits', config: neon!, statements: rowEditStatements(table, { updates: [{ key: { id: '1' }, values: { city: 'Bogotá' } }], deletes: [], inserts: [{ values: { id: '3', city: 'Quito' } }] }, false) });
    expect((await run(neon!, 'SELECT id, city FROM orders ORDER BY id')).rows).toEqual([
      { id: 1, city: 'Bogotá' },
      { id: 2, city: 'Quito' },
      { id: 3, city: 'Quito' },
    ]);
    const failed = await send({
      type: 'apply-edits',
      config: neon!,
      statements: rowEditStatements(table, { updates: [{ key: { id: '1' }, values: { city: 'lost' } }], deletes: [{ key: { id: '99' } }], inserts: [] }, false),
    });
    expect(failed.ok ? null : failed.error.edit).toEqual({ kind: 'conflict', change: 2, touched: 0 });
    expect((await run(neon!, 'SELECT city FROM orders WHERE id = 1')).rows).toEqual([{ city: 'Bogotá' }]);
  });

  it('names a refused password as an auth failure', async () => {
    const wrong = await send({ type: 'test', config: { ...neon!, connectionId: 'neon-bad', password: 'nope' } });
    expect(wrong.ok ? null : wrong.error).toMatchObject({ step: 'auth', fix: 'auth' });
  });
});

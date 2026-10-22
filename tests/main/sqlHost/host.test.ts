import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DriverSession } from '../../../src/main/sqlHost/driver';
import { classifyConnectError, toJsonCell } from '../../../src/main/sqlHost/driver';
import { createSqlHost } from '../../../src/main/sqlHost/host';
import { TunnelError } from '../../../src/main/sqlHost/tunnel';
import type { HostRequest, HostSessionConfig } from '../../../src/main/sqlHost/protocol';
import type { SqlDbIntrospectResult } from '../../../src/shared/sqlDb';
import { openSqlite } from '../../../src/main/sqlHost/sqlite';

const window = { maxRows: 10_000, maxBytes: 256 * 1024 };

/** A fake engine whose statement yields `count` rows of `{ n }`. */
function fakeDriver(count: number, calls: string[] = []) {
  const session: DriverSession = {
    version: async () => 'Fake 1.0',
    async run(sql) {
      calls.push(sql);
      let sent = 0;
      return {
        columns: [{ name: 'n', type: 'BIGINT' }],
        async next(limit) {
          const rows = Array.from({ length: Math.min(limit, count - sent) }, (_, i) => ({ n: BigInt(sent + i) }));
          sent += rows.length;
          return { rows, done: sent >= count };
        },
        close: vi.fn(async () => undefined),
      };
    },
    cancel: vi.fn(async () => true),
    estimateRows: async () => 42,
    introspect: async () => ({ schemas: [] }),
    close: vi.fn(async () => undefined),
  };
  return { session, open: vi.fn(async () => session) };
}

const pgConfig = (overrides: Partial<HostSessionConfig> = {}): HostSessionConfig => ({
  connectionId: 'c1',
  engine: 'postgres',
  readOnly: false,
  ...overrides,
});

let id = 0;
type HostRequestBody = HostRequest extends infer R ? (R extends unknown ? Omit<R, 'id'> : never) : never;
const req = (body: HostRequestBody) => ({ id: ++id, ...body }) as HostRequest;

describe('SQL host', () => {
  it('reads a window, keeps the run open for more rows, and maps bigints to text', async () => {
    const { open } = fakeDriver(25_000);
    const host = createSqlHost({ postgres: open, mysql: open, sqlite: open });
    const first = await host.handle(req({ type: 'execute', config: pgConfig(), runId: 'r1', sql: 'SELECT n', readWrite: false, window }));
    expect(first).toMatchObject({ ok: true, result: { rowCount: 10_000, hasMore: true, rowCountIsLowerBound: true } });
    const rows = (first as { result: { rows: Array<{ n: string }> } }).result.rows;
    expect(rows[0]).toEqual({ n: '0' });
    const more = await host.handle(req({ type: 'fetch', runId: 'r1', limit: 15_000, maxBytes: Number.MAX_SAFE_INTEGER }));
    expect(more).toMatchObject({ ok: true, result: { done: true } });
    expect((more as { result: { rows: Array<{ n: string }> } }).result.rows.at(-1)).toEqual({ n: '24999' });
    // The finished run is gone, and reading it again is an error rather than an empty end.
    expect(await host.handle(req({ type: 'fetch', runId: 'r1', limit: 1, maxBytes: 1 }))).toMatchObject({ ok: false });
  });

  it('closes a fully read run too, so a read-only run ends its transaction', async () => {
    const closes: Array<ReturnType<typeof vi.fn>> = [];
    const { open, session } = fakeDriver(10);
    const run = session.run.bind(session);
    session.run = async (sql, options) => {
      const rows = await run(sql, options);
      closes.push(rows.close as ReturnType<typeof vi.fn>);
      return rows;
    };
    const host = createSqlHost({ postgres: open, mysql: open, sqlite: open });
    expect(await host.handle(req({ type: 'execute', config: pgConfig(), runId: 'r1', sql: 'SELECT n', readWrite: false, window }))).toMatchObject({
      result: { hasMore: false },
    });
    expect(closes[0]).toHaveBeenCalledOnce();
  });

  it('stops a page at the byte budget and keeps the rest', async () => {
    const { open } = fakeDriver(1_000);
    const host = createSqlHost({ postgres: open, mysql: open, sqlite: open });
    const first = await host.handle(req({ type: 'execute', config: pgConfig(), runId: 'r1', sql: 'SELECT n', readWrite: false, window: { maxRows: 1_000, maxBytes: 100 } }));
    const rows = (first as { result: { rows: unknown[]; hasMore: boolean } }).result;
    expect(rows.rows.length).toBeGreaterThan(0);
    expect(rows.rows.length).toBeLessThan(20);
    expect(rows.hasMore).toBe(true);
  });

  it('reuses one session per connection and closes the previous run when the next starts', async () => {
    const calls: string[] = [];
    const { open, session } = fakeDriver(20_000, calls);
    const host = createSqlHost({ postgres: open, mysql: open, sqlite: open });
    await host.handle(req({ type: 'execute', config: pgConfig(), runId: 'r1', sql: 'SELECT 1', readWrite: false, window }));
    await host.handle(req({ type: 'execute', config: pgConfig(), runId: 'r2', sql: 'SELECT 2', readWrite: false, window }));
    expect(open).toHaveBeenCalledOnce();
    expect(calls).toEqual(['SELECT 1', 'SELECT 2']);
    // r1 was replaced: its reader gets an error, so a cut-off result never passes for a whole one.
    expect(await host.handle(req({ type: 'fetch', runId: 'r1', limit: 5, maxBytes: 1e9 }))).toMatchObject({
      ok: false,
      error: { message: 'This result was closed by a newer run on the same connection.' },
    });
    // A changed config (a new password) opens a new session.
    await host.handle(req({ type: 'execute', config: pgConfig({ password: 'new' }), runId: 'r3', sql: 'SELECT 3', readWrite: false, window }));
    expect(open).toHaveBeenCalledTimes(2);
    expect(session.close).toHaveBeenCalled();
  });

  it('cancels from a side connection, or asks for a restart when the engine cannot', async () => {
    const { open, session } = fakeDriver(20_000);
    const host = createSqlHost({ postgres: open, mysql: open, sqlite: open });
    await host.handle(req({ type: 'execute', config: pgConfig(), runId: 'r1', sql: 'SELECT n', readWrite: false, window }));
    expect(await host.handle(req({ type: 'cancel', runId: 'r1' }))).toMatchObject({ result: { cancelled: true } });
    expect(session.cancel).toHaveBeenCalledOnce();
    vi.mocked(session.cancel).mockResolvedValueOnce(false);
    expect(await host.handle(req({ type: 'cancel', runId: 'r1' }))).toMatchObject({ result: { cancelled: false, restart: true } });
  });

  it('connects the driver to the tunnel end without the SSH settings, and lets the tunnel go with the session', async () => {
    const seen: HostSessionConfig[] = [];
    const { session } = fakeDriver(1);
    const release = vi.fn(async () => undefined);
    const pool = { acquire: vi.fn(async () => ({ port: 40123, release })), dispose: vi.fn() };
    const open = vi.fn(async (config: HostSessionConfig) => {
      seen.push(config);
      return session;
    });
    const host = createSqlHost({ postgres: open, mysql: open, sqlite: open }, pool);
    const ssh = { hops: [], auth: 'agent' as const, agent: '/tmp/agent.sock', target: { host: 'db.internal', port: 5432 } };
    await host.handle(req({ type: 'execute', config: pgConfig({ address: '10.0.0.9', port: 5432, ssh }), runId: 'r1', sql: 'SELECT n', readWrite: false, window }));
    expect(seen[0]).toMatchObject({ address: '127.0.0.1', port: 40123 });
    expect(seen[0]).not.toHaveProperty('ssh');
    await host.handle(req({ type: 'disconnect', connectionId: 'c1' }));
    expect(release).toHaveBeenCalledOnce();
    // A tunnel that fails keeps its step and fix.
    pool.acquire.mockRejectedValueOnce(new TunnelError({ step: 'ssh', fix: 'ssh-auth', message: 'refused' }));
    expect(await host.handle(req({ type: 'test', config: pgConfig({ connectionId: 'c2', ssh }) }))).toMatchObject({ ok: false, error: { step: 'ssh', fix: 'ssh-auth' } });
  });

  it('names the failed step of a connection test', async () => {
    const failing = vi.fn(async () => {
      throw Object.assign(new Error('password authentication failed for user "app"'), { code: '28P01' });
    });
    const host = createSqlHost({ postgres: failing, mysql: failing, sqlite: failing });
    const result = await host.handle(req({ type: 'test', config: pgConfig() }));
    expect(result).toMatchObject({ ok: false, error: { step: 'auth', fix: 'auth' } });
  });
});

describe('driver helpers', () => {
  it('maps cells the way the grid takes them', () => {
    expect(toJsonCell(12n)).toBe('12');
    expect(toJsonCell(new Uint8Array([0x89, 0x50]))).toBe('iVA=');
    expect(toJsonCell(new Date('2026-10-21T10:00:00Z'))).toBe('2026-10-21T10:00:00.000Z');
    expect(toJsonCell({ a: [1n, null] })).toEqual({ a: ['1', null] });
  });

  it('classifies TLS, auth, database and network failures', () => {
    expect(classifyConnectError({ code: 'SELF_SIGNED_CERT_IN_CHAIN', message: 'self-signed certificate in certificate chain' })).toMatchObject({ step: 'tls', fix: 'tls-untrusted' });
    expect(classifyConnectError({ code: 'ER_ACCESS_DENIED_ERROR', message: 'Access denied' })).toMatchObject({ step: 'auth', fix: 'auth' });
    expect(classifyConnectError({ code: '3D000', message: 'database "x" does not exist' })).toMatchObject({ fix: 'database' });
    expect(classifyConnectError({ code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })).toMatchObject({ step: 'tcp', fix: 'unreachable' });
    expect(classifyConnectError(new Error('The server does not support SSL connections'))).toMatchObject({ step: 'tls', fix: 'tls-unsupported' });
  });
});

describe('SQLite driver (node:sqlite)', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'lingua-sqlite-'));
    file = path.join(dir, 'app.db');
    const db = new DatabaseSync(file);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, big INTEGER, bytes BLOB, price NUMERIC); INSERT INTO t VALUES (1, 'a', 9007199254740993, x'8950', 1.5), (2, 'b', 2, NULL, NULL)");
    db.close();
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const sqliteConfig = (readOnly: boolean): HostSessionConfig => ({ connectionId: 's1', engine: 'sqlite', path: file, readOnly });
  const createSqlHostSupervisorless = () => createSqlHost({ postgres: openSqlite, mysql: openSqlite, sqlite: openSqlite });

  it('reads rows with types the grid knows and keeps large integers exact', async () => {
    const host = createSqlHost({ postgres: openSqlite, mysql: openSqlite, sqlite: openSqlite });
    const result = await host.handle(req({ type: 'execute', config: sqliteConfig(false), runId: 'r', sql: 'SELECT * FROM t ORDER BY id', readWrite: false, window }));
    expect(result).toMatchObject({
      ok: true,
      result: {
        columns: [
          { name: 'id', type: 'INTEGER' },
          { name: 'name', type: 'TEXT' },
          { name: 'big', type: 'INTEGER' },
          { name: 'bytes', type: 'BLOB' },
          { name: 'price', type: 'DECIMAL' },
        ],
        rows: [
          { id: '1', name: 'a', big: '9007199254740993', bytes: 'iVA=', price: 1.5 },
          { id: '2', name: 'b', big: '2', bytes: null, price: null },
        ],
        hasMore: false,
      },
    });
    await host.dispose();
  });

  it('refuses writes on a read-only file, and lifts read-only for one run', async () => {
    const host = createSqlHost({ postgres: openSqlite, mysql: openSqlite, sqlite: openSqlite });
    const refused = await host.handle(req({ type: 'execute', config: sqliteConfig(true), runId: 'w', sql: "UPDATE t SET name = 'z'", readWrite: false, window }));
    expect(refused).toMatchObject({ ok: false, error: { message: expect.stringMatching(/readonly/i) } });
    const lifted = await host.handle(req({ type: 'execute', config: sqliteConfig(true), runId: 'w2', sql: "UPDATE t SET name = 'z'", readWrite: true, window }));
    expect(lifted).toMatchObject({ ok: true, result: { affectedRows: 2, columns: [] } });
    await host.dispose();
  });

  it('refuses ATTACH and VACUUM INTO, which could reach other files', async () => {
    const host = createSqlHostSupervisorless();
    for (const sql of [`ATTACH '${path.join(dir, 'other.db')}' AS other`, `VACUUM INTO '${path.join(dir, 'copy.db')}'`]) {
      const result = await host.handle(req({ type: 'execute', config: sqliteConfig(false), runId: 'a', sql, readWrite: false, window }));
      expect(result).toMatchObject({ ok: false, error: { message: expect.stringMatching(/not authorized|authorization denied/) } });
    }
    await host.dispose();
  });

  it('lists the catalog of a file and details a table with keys, indexes and DDL', async () => {
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE customers (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER NOT NULL REFERENCES customers(id), status TEXT DEFAULT 'open');
      CREATE INDEX orders_by_customer ON orders(customer_id, status);
      CREATE VIEW open_orders AS SELECT * FROM orders WHERE status = 'open';`);
    db.close();
    const host = createSqlHostSupervisorless();
    const ask = async (request: Extract<HostRequestBody, { type: 'introspect' }>['request']) => {
      const response = await host.handle(req({ type: 'introspect', config: sqliteConfig(true), request }));
      if (!response.ok) throw new Error(response.error.message);
      return response.result as SqlDbIntrospectResult;
    };
    expect(await ask({ level: 'schemas' })).toEqual({ schemas: [{ name: 'main', objects: 4 }] });
    expect((await ask({ level: 'objects', schema: 'main' })).objects).toEqual([
      { kind: 'table', name: 'customers' },
      { kind: 'table', name: 'orders' },
      { kind: 'table', name: 't' },
      { kind: 'view', name: 'open_orders' },
    ]);
    expect((await ask({ level: 'columns', schema: 'main' })).columns).toContainEqual({ table: 'orders', name: 'customer_id', type: 'INTEGER' });
    const { detail } = await ask({ level: 'detail', schema: 'main', name: 'orders', kind: 'table' });
    expect(detail?.columns).toEqual([
      { name: 'id', type: 'INTEGER', nullable: true, primaryKey: true },
      { name: 'customer_id', type: 'INTEGER', nullable: false, references: { schema: 'main', table: 'customers', column: 'id' } },
      { name: 'status', type: 'TEXT', nullable: true, default: "'open'" },
    ]);
    expect(detail?.indexes).toEqual([{ name: 'orders_by_customer', columns: ['customer_id', 'status'], unique: false, primary: false }]);
    expect(detail?.ddl).toMatch(/^CREATE TABLE orders .*;$/s);
    await host.dispose();
  });

  it('tests the file: version on success, file-missing when it is gone', async () => {
    const host = createSqlHost({ postgres: openSqlite, mysql: openSqlite, sqlite: openSqlite });
    expect(await host.handle(req({ type: 'test', config: sqliteConfig(true) }))).toMatchObject({ ok: true, result: { serverVersion: expect.stringMatching(/^SQLite 3\./) } });
    expect(await host.handle(req({ type: 'test', config: { ...sqliteConfig(true), path: path.join(dir, 'nope.db') } }))).toMatchObject({
      ok: false,
      error: { step: 'file', fix: 'file-missing' },
    });
  });
});

import { describe, expect, it } from 'vitest';
import { createWebSqlDb } from '../../../src/renderer/runtime/sqlWebDb';
import type { SqlConnectionDraft } from '../../../src/shared/sqlConnections';
import type { HttpSqlRequest } from '../../../src/shared/sqlHttp/transport';

const connection: SqlConnectionDraft = {
  name: 'synthetic', engine: 'libsql', host: 'qa.invalid', port: 443,
  ssl: { mode: 'verify-full' }, readOnly: false, passwordMode: 'session',
};
const pipeline = (result: unknown) => ({ status: 200, body: JSON.stringify({
  baton: null, base_url: null,
  results: [{ type: 'ok', response: { type: 'execute', result } }, { type: 'ok', response: { type: 'close' } }],
}) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture() {
  const started = deferred<void>();
  const oldHandshake = deferred<{ status: number; body: string }>();
  const sent: Array<{ token: string | undefined; sql: string }> = [];
  let first = true;
  const db = createWebSqlDb(async (request: HttpSqlRequest) => {
    const sql = (JSON.parse(request.body) as { requests: Array<{ stmt?: { sql: string } }> }).requests[0]?.stmt?.sql ?? '';
    const token = request.headers.authorization;
    sent.push({ token, sql });
    if (first && token === 'Bearer old-token') {
      first = false;
      started.resolve();
      return oldHandshake.promise;
    }
    const name = sql.includes('sqlite_version') ? 'v' : sql.includes('database_list') ? 'name' : 'n';
    const value = name === 'v' ? '3.45.1' : name === 'name' ? 'main' : '42';
    return pipeline({ cols: [{ name }], rows: [[{ type: name === 'n' ? 'integer' : 'text', value }]], affected_row_count: 0 });
  });
  return { db, started, oldHandshake, sent };
}
async function open(db: ReturnType<typeof createWebSqlDb>) {
  const result = await db.openAdhoc(connection, 'old-token');
  if (!result.ok) throw new Error('Synthetic connection was refused');
  return result.connection.id;
}
const options = { timeoutMs: 1_000 };

// Synthetic Hrana transport: no server, no real token, no browser profile and no native vault.
describe('web SQL session ownership', () => {
  it('does not forget a working replacement token when the old catalog handshake returns 401', async () => {
    const { db, started, oldHandshake } = fixture();
    const id = await open(db);
    const oldCatalog = db.introspect(id, { level: 'schemas' });
    await started.promise;
    const rotating = db.sessionPassword(id, 'new-token');
    expect(await db.execute('new', id, 'SELECT 42 AS n', options)).toMatchObject({ status: 'success' });
    expect((await db.catalog()).adhoc[0]).toMatchObject({ hasPassword: true });
    oldHandshake.resolve({ status: 401, body: 'synthetic refusal' });
    await oldCatalog;
    await rotating;
    expect((await db.catalog()).adhoc[0]).toMatchObject({ hasPassword: true });
    expect(await db.execute('next', id, 'SELECT 42 AS n', options)).toMatchObject({ status: 'success', rows: [{ n: 42 }] });
  });

  it('accepts a new token at once while the old handshake is still pending', async () => {
    const { db, started } = fixture();
    const id = await open(db);
    void db.introspect(id, { level: 'schemas' });
    await started.promise;
    // The UI awaits the password change before it retries; a silent old handshake must not block it.
    await db.sessionPassword(id, 'new-token');
    expect(await db.execute('new', id, 'SELECT 42 AS n', options)).toMatchObject({ status: 'success', rows: [{ n: 42 }] });
  });

  it('detaches every old lane before awaiting a handshake so cleanup cannot drop a new catalog session', async () => {
    const { db, started, oldHandshake, sent } = fixture();
    const id = await open(db);
    const oldRun = db.execute('old', id, 'SELECT 42 AS n', options);
    await started.promise;
    const rotating = db.sessionPassword(id, 'new-token');
    expect(await db.introspect(id, { level: 'schemas' })).toMatchObject({ schemas: [{ name: 'main' }] });
    expect(await db.execute('new', id, 'SELECT 42 AS n', options)).toMatchObject({ status: 'success' });
    const count = () => sent.filter((r) => r.token === 'Bearer new-token' && r.sql.includes('sqlite_version')).length;
    expect(count()).toBe(2);
    oldHandshake.resolve({ status: 401, body: 'synthetic refusal' });
    await oldRun;
    await rotating;
    expect(await db.introspect(id, { level: 'schemas' })).toMatchObject({ schemas: [{ name: 'main' }] });
    expect(count()).toBe(2);
  });

  it('tracks replacement identity even when a token changes away and back to the same text', async () => {
    const { db, started, oldHandshake } = fixture();
    const id = await open(db);
    const oldCatalog = db.introspect(id, { level: 'schemas' });
    await started.promise;
    const firstRotation = db.sessionPassword(id, 'intermediate-token');
    await db.sessionPassword(id, 'old-token');
    expect(await db.execute('new', id, 'SELECT 42 AS n', options)).toMatchObject({ status: 'success' });
    oldHandshake.resolve({ status: 401, body: 'synthetic refusal' });
    await oldCatalog;
    await firstRotation;
    expect((await db.catalog()).adhoc[0]).toMatchObject({ hasPassword: true });
    expect(await db.execute('next', id, 'SELECT 42 AS n', options)).toMatchObject({ status: 'success' });
  });

  it('captures the credential when reserving a session, before its handshake microtask', async () => {
    const tokens: Array<string | undefined> = [];
    const db = createWebSqlDb(async (request) => {
      tokens.push(request.headers.authorization);
      return pipeline({ cols: [{ name: 'v' }], rows: [[{ type: 'text', value: '3.45.1' }]], affected_row_count: 0 });
    });
    const id = await open(db);
    const oldRun = db.execute('old', id, 'SELECT 1', options);
    const rotating = db.sessionPassword(id, 'new-token');
    await Promise.all([oldRun, rotating]);
    expect(tokens[0]).toBe('Bearer old-token');
  });

  it('still forgets the currently refused credential and asks again', async () => {
    const db = createWebSqlDb(async () => ({ status: 401, body: 'synthetic refusal' }));
    const id = await open(db);
    expect(await db.execute('refused', id, 'SELECT 42 AS n', options)).toMatchObject({ status: 'connection-failed', fix: 'password-needed' });
    expect((await db.catalog()).adhoc[0]).toMatchObject({ hasPassword: false });
  });
});

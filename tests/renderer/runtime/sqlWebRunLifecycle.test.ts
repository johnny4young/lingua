import { describe, expect, it } from 'vitest';
import { createWebSqlDb } from '../../../src/renderer/runtime/sqlWebDb';
import { executeRemoteScript } from '../../../src/renderer/runtime/sqlRemote';
import type { SqlConnectionDraft } from '../../../src/shared/sqlConnections';
import type { HttpSqlRequest } from '../../../src/shared/sqlHttp/transport';

const connection: SqlConnectionDraft = {
  name: 'synthetic', engine: 'libsql', host: 'qa.invalid', port: 443,
  ssl: { mode: 'verify-full' }, readOnly: false, passwordMode: 'session',
};
const version = { cols: [{ name: 'v' }], rows: [[{ type: 'text', value: '3.45.1' }]], affected_row_count: 0 };
const pipeline = (result: unknown) => ({ status: 200, body: JSON.stringify({
  baton: null, base_url: null,
  results: [{ type: 'ok', response: { type: 'execute', result } }, { type: 'ok', response: { type: 'close' } }],
}) });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
const statement = (request: HttpSqlRequest): string =>
  (JSON.parse(request.body) as { requests: Array<{ stmt?: { sql: string } }> }).requests[0]?.stmt?.sql ?? '';
async function open(db: ReturnType<typeof createWebSqlDb>) {
  const result = await db.openAdhoc(connection, 'synthetic-token');
  if (!result.ok) throw new Error('Synthetic connection was refused');
  return result.connection.id;
}

// No network: these responses exercise the real HTTP driver, bridge and remote cursor.
describe('web SQL run lifecycle', () => {
  it('does not dispatch the statement when cancelled during the initial handshake, and can run again', async () => {
    const started = deferred<void>();
    const handshake = deferred<ReturnType<typeof pipeline>>();
    const sent: string[] = [];
    let first = true;
    const db = createWebSqlDb(async (request) => {
      const sql = statement(request);
      sent.push(sql);
      if (first) {
        first = false;
        started.resolve();
        return handshake.promise;
      }
      return pipeline({ cols: [{ name: 'n' }], rows: [[{ type: 'integer', value: '2' }]], affected_row_count: 0 });
    });
    const id = await open(db);
    const controller = new AbortController();
    const running = executeRemoteScript(db, id, ['SELECT 1 AS n', 'SELECT 3 AS n'], {
      timeoutMs: 1_000, signal: controller.signal,
    });
    await started.promise;
    controller.abort();
    handshake.resolve(pipeline(version));
    expect((await running).map((result) => result.status)).toEqual(['cancelled']);
    expect(sent).toEqual(['SELECT sqlite_version() AS v']);
    expect(await db.execute('next-run', id, 'SELECT 2 AS n', { timeoutMs: 1_000 }))
      .toMatchObject({ status: 'success', rows: [{ n: 2 }] });
  });

  it('acknowledges cancellation before the driver is ready', async () => {
    const started = deferred<void>();
    const handshake = deferred<ReturnType<typeof pipeline>>();
    const db = createWebSqlDb(async () => {
      started.resolve();
      return handshake.promise;
    });
    const id = await open(db);
    const running = db.execute('pending', id, 'SELECT 1', { timeoutMs: 1_000 });
    await started.promise;
    const cancellation = await db.cancel('pending');
    handshake.resolve(pipeline(version));
    const result = await running;
    expect(cancellation).toEqual({ cancelled: true });
    expect(result.status).toBe('cancelled');
    expect(await db.cancel('unknown')).toEqual({ cancelled: false });
  });

  it('settles a cancelled run whose handshake never answers', async () => {
    const started = deferred<void>();
    const db = createWebSqlDb(async () => {
      started.resolve();
      return new Promise<never>(() => undefined);
    });
    const id = await open(db);
    const running = db.execute('stuck', id, 'SELECT 1', { timeoutMs: 1_000 });
    await started.promise;
    await db.cancel('stuck');
    expect((await running).status).toBe('cancelled');
  });

  it('keeps the result of a statement that answered before a late Cancel', async () => {
    const answered = deferred<ReturnType<typeof pipeline>>();
    const sent = deferred<void>();
    const db = createWebSqlDb(async (request) => {
      if (statement(request).includes('sqlite_version')) return pipeline(version);
      sent.resolve();
      return answered.promise;
    });
    const id = await open(db);
    const running = db.execute('late', id, 'INSERT INTO t VALUES (1)', { timeoutMs: 1_000, readWrite: { confirmName: 'synthetic' } });
    await sent.promise;
    answered.resolve(pipeline({ cols: [], rows: [], affected_row_count: 1 }));
    await db.cancel('late');
    expect(await running).toMatchObject({ status: 'success', affectedRows: 1 });
  });

  it('rejects an invalidated cursor instead of reporting a complete partial result', async () => {
    const db = createWebSqlDb(async (request) => pipeline(statement(request).includes('sqlite_version') ? version : {
      cols: [{ name: 'n' }],
      rows: Array.from({ length: statement(request).includes('large_result') ? 10_001 : 1 }, (_, n) => [{ type: 'integer', value: String(n) }]),
      affected_row_count: 0,
    }));
    const id = await open(db);
    const [result] = await executeRemoteScript(db, id, ['SELECT n FROM large_result'], { timeoutMs: 1_000, keepCursor: true });
    expect(result).toMatchObject({ rowCount: 10_000, rowCountIsLowerBound: true });
    expect(result?.cursor).toBeDefined();
    await db.execute('replacement', id, 'SELECT 0 AS n', { timeoutMs: 1_000 });
    await expect(result!.cursor!.next(10_000)).rejects.toThrow(/closed|no longer available/i);
  });

  it('still drains a current cursor to its real end', async () => {
    const db = createWebSqlDb(async (request) => pipeline(statement(request).includes('sqlite_version') ? version : {
      cols: [{ name: 'n' }],
      rows: Array.from({ length: 10_001 }, (_, n) => [{ type: 'integer', value: String(n) }]),
      affected_row_count: 0,
    }));
    const id = await open(db);
    const [result] = await executeRemoteScript(db, id, ['SELECT n FROM large_result'], { timeoutMs: 1_000, keepCursor: true });
    expect(await result!.cursor!.next(10_000)).toMatchObject({ rows: [{ n: 10_000 }], done: true });
    expect(await result!.cursor!.next(10_000)).toEqual({ rows: [], done: true, bytes: 0 });
  });
});

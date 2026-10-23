import { describe, expect, it } from 'vitest';
import { classifyConnectError, EditFailedError } from '../../src/shared/sqlDriver';
import { openD1 } from '../../src/shared/sqlHttp/d1';
import { openLibsql } from '../../src/shared/sqlHttp/libsql';
import { openNeon } from '../../src/shared/sqlHttp/neon';
import type { HttpSqlRequest, HttpSqlResponse } from '../../src/shared/sqlHttp/transport';

/** A transport that answers from `reply` and records what was sent. */
function fake(reply: (request: HttpSqlRequest, body: Record<string, unknown>) => HttpSqlResponse | Promise<HttpSqlResponse>) {
  const sent: Array<{ request: HttpSqlRequest; body: Record<string, unknown> }> = [];
  const transport = async (request: HttpSqlRequest) => {
    const body = JSON.parse(request.body) as Record<string, unknown>;
    sent.push({ request, body });
    return reply(request, body);
  };
  return { transport, sent };
}

const json = (value: unknown, status = 200): HttpSqlResponse => ({ status, body: JSON.stringify(value) });
const ok = (result: unknown) => ({ type: 'ok', response: { type: 'execute', result } });
const rows = (cols: string[], values: unknown[][]) => ({ cols: cols.map((name) => ({ name, decltype: null })), rows: values, affected_row_count: 0 });

describe('libSQL client', () => {
  const version = ok(rows(['v'], [[{ type: 'text', value: '3.45.1' }]]));

  it('signs in with the token, decodes values and keeps a read-only run to what SQLite calls readonly', async () => {
    const { transport, sent } = fake((_request, body) => {
      const requests = body.requests as Array<{ type: string; stmt?: { sql: string } }>;
      if (requests[0]?.type === 'describe') return json({ baton: null, base_url: null, results: [ok({ is_readonly: (requests[0] as { sql?: string }).sql?.startsWith('SELECT') }), ok(null)] });
      if (requests[0]?.stmt?.sql === 'BEGIN') {
        const cols = [{ name: 'id', decltype: 'INTEGER' }, { name: 'big', decltype: 'INTEGER' }, { name: 'raw', decltype: 'BLOB' }, { name: 'n', decltype: null }];
        const values = [[{ type: 'integer', value: '1' }, { type: 'integer', value: '9007199254740993' }, { type: 'blob', base64: 'yv4' }, { type: 'null' }]];
        return json({ baton: null, base_url: null, results: [ok(null), ok({ cols, rows: values, affected_row_count: 0 }), ok(null), ok(null)] });
      }
      return json({ baton: null, base_url: null, results: [version, ok(null)] });
    });
    const session = await openLibsql({ origin: 'https://db.turso.io/', token: 'secret', readOnly: true }, transport);
    expect(await session.version()).toBe('libSQL (SQLite 3.45.1)');
    expect(sent[0]!.request.url).toBe('https://db.turso.io/v2/pipeline');
    expect(sent[0]!.request.headers.authorization).toBe('Bearer secret');

    const result = await session.run('SELECT * FROM t', { readWrite: false });
    expect(result.columns).toEqual([
      { name: 'id', type: 'INTEGER' },
      { name: 'big', type: 'INTEGER' },
      { name: 'raw', type: 'BLOB' },
      { name: 'n', type: 'VALUE' },
    ]);
    expect((await result.next(10)).rows).toEqual([{ id: 1, big: '9007199254740993', raw: 'yv4=', n: null }]);
    expect((sent.at(-1)!.body.requests as Array<{ stmt?: { sql: string } }>).map((request) => request.stmt?.sql)).toEqual(['BEGIN', 'SELECT * FROM t', 'ROLLBACK', undefined]);

    const before = sent.length;
    await expect(session.run('DELETE FROM t', { readWrite: false })).rejects.toThrow(/read-only/);
    // Only the describe went out: the write never ran.
    expect(sent.length).toBe(before + 1);
  });

  it('rolls staged edits back on the same baton when a change misses its row', async () => {
    const { transport, sent } = fake((_request, body) => {
      const requests = body.requests as Array<{ type: string; stmt?: { sql: string } }>;
      if (requests[0]?.type === 'batch') {
        return json({ baton: 'b1', base_url: null, results: [{ type: 'ok', response: { type: 'batch', result: { step_results: [rows([], []), { ...rows([], []), affected_row_count: 1 }, { ...rows([], []), affected_row_count: 0 }], step_errors: [null, null, null] } } }] });
      }
      return json({ baton: null, base_url: null, results: [requests[0]?.stmt?.sql === 'SELECT sqlite_version() AS v' ? version : ok(null), ok(null)] });
    });
    const session = await openLibsql({ origin: 'https://db.turso.io', readOnly: false }, transport);
    const edits = [
      { sql: 'UPDATE "main"."t" SET "a" = ? WHERE "id" = ?', params: ['x', '1'] },
      { sql: 'DELETE FROM "main"."t" WHERE "id" = ?', params: ['9'] },
    ];
    await expect(session.applyEdits(edits)).rejects.toEqual(new EditFailedError({ kind: 'conflict', change: 2, touched: 0 }));
    const steps = ((sent[1]!.body.requests as Array<{ batch: { steps: Array<{ condition?: unknown; stmt: { sql: string; args: unknown[] } }> } }>)[0]!).batch.steps;
    expect(steps[0]!.stmt.sql).toBe('BEGIN IMMEDIATE');
    expect(steps[2]).toEqual({ condition: { type: 'ok', step: 1 }, stmt: { sql: edits[1]!.sql, args: [{ type: 'text', value: '9' }] } });
    expect(sent[2]!.body).toEqual({ baton: 'b1', requests: [{ type: 'execute', stmt: { sql: 'ROLLBACK' } }, { type: 'close' }] });
  });

  it('reads a refused token as a failed sign-in', async () => {
    const { transport } = fake(() => ({ status: 401, body: 'Unauthorized' }));
    const failure = await openLibsql({ origin: 'https://db.turso.io', token: 'bad', readOnly: false }, transport).catch((err: unknown) => err);
    expect(classifyConnectError(failure)).toMatchObject({ step: 'auth', fix: 'auth' });
  });
});

describe('Neon client', () => {
  const field = (name: string, dataTypeID: number) => ({ name, dataTypeID, dataTypeModifier: -1 });
  const target = { origin: 'https://api.us-east-2.aws.neon.tech', host: 'ep-1.us-east-2.aws.neon.tech', database: 'shop', user: 'app', password: 'p@ss:w/rd', readOnly: true };

  it('names the database in the connection string and sends every read-only run as a read-only batch', async () => {
    const { transport, sent } = fake((_request, body) => {
      if ('queries' in body) return json({ results: [{ fields: [field('ok', 16), field('n', 23), field('big', 20), field('raw', 17)], rows: [['t', '7', '9007199254740993', '\\xcafe']], rowCount: 1 }] });
      return json({ fields: [field('server_version', 25)], rows: [['16.4 (Ubuntu)']], rowCount: 1 });
    });
    const session = await openNeon({ ...target, readOnly: false }, transport);
    expect(await session.version()).toBe('PostgreSQL 16.4 (Neon)');
    expect(sent[0]!.request.url).toBe('https://api.us-east-2.aws.neon.tech/sql');
    expect(sent[0]!.request.headers['Neon-Connection-String']).toBe('postgresql://app:p%40ss%3Aw%2Frd@ep-1.us-east-2.aws.neon.tech/shop?sslmode=require');

    const readOnly = await openNeon(target, transport);
    const result = await readOnly.run('SELECT 1', { readWrite: false });
    expect(sent.at(-1)!.request.headers['Neon-Batch-Read-Only']).toBe('true');
    expect((await result.next(5)).rows).toEqual([{ ok: true, n: 7, big: '9007199254740993', raw: 'yv4=' }]);
  });

  it('turns the failing cast of a change that missed its row into a conflict', async () => {
    const { transport, sent } = fake((_request, body) =>
      'queries' in body
        ? json({ message: 'invalid input syntax for type integer: "lingua-edit-conflict-2-0"', code: '22P02' }, 400)
        : json({ fields: [field('server_version', 25)], rows: [['16.4']], rowCount: 1 })
    );
    const session = await openNeon({ ...target, readOnly: false }, transport);
    await expect(session.applyEdits([{ sql: 'UPDATE "public"."t" SET "a" = $1 WHERE "id" = $2', params: ['x', '1'] }, { sql: 'DELETE FROM "public"."t" WHERE "id" = $1', params: ['9'] }])).rejects.toEqual(
      new EditFailedError({ kind: 'conflict', change: 2, touched: 0 })
    );
    const queries = (sent.at(-1)!.body.queries as Array<{ query: string; params: unknown[] }>).map((query) => query.query);
    expect(queries[0]).toMatch(/^SET LOCAL lock_timeout/);
    expect(queries[3]).toBe(`WITH changed AS (DELETE FROM "public"."t" WHERE "id" = $1 RETURNING 1) SELECT CASE WHEN count(*) = 1 THEN 1 ELSE CAST('lingua-edit-conflict-2-' || count(*) AS integer) END FROM changed`);
    expect(queries.at(-1)).toMatch(/transaction_timestamp\(\).*lingua-edit-too-slow/);
    expect(sent.at(-1)!.request.headers['Neon-Batch-Read-Only']).toBe('false');
  });

  it('reads a refused password from its SQLSTATE', async () => {
    const { transport } = fake(() => json({ message: 'password authentication failed for user "app"', code: '28P01' }, 400));
    const failure = await openNeon(target, transport).catch((err: unknown) => err);
    expect(classifyConnectError(failure)).toMatchObject({ step: 'auth', fix: 'auth' });
  });
});

describe('D1 client', () => {
  const target = { origin: 'https://api.cloudflare.com', accountId: 'a'.repeat(32), databaseId: '0f0e0d0c-1111-2222-3333-444455556666', token: 'cf', readOnly: true };
  const answer = (columns: string[], values: unknown[][], changes = 0) => json({ success: true, errors: [], result: [{ results: { columns, rows: values }, meta: { changes } }] });

  it('posts to the database raw endpoint, names types from values and runs only proven reads when read-only', async () => {
    const { transport, sent } = fake((_request, body) => (body.sql === 'SELECT sqlite_version() AS v' ? answer(['v'], [['3.45.0']]) : answer(['id', 'name', 'score', 'raw'], [[1, null, 1.5, [202, 254]], [2, 'b', 2, null]])));
    const session = await openD1(target, transport);
    expect(await session.version()).toBe('D1 (SQLite 3.45.0)');
    expect(sent[0]!.request.url).toBe(`https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/d1/database/0f0e0d0c-1111-2222-3333-444455556666/raw`);
    expect(sent[0]!.request.headers.authorization).toBe('Bearer cf');
    const result = await session.run('SELECT * FROM t', { readWrite: false });
    expect(result.columns.map((column) => column.type)).toEqual(['BIGINT', 'TEXT', 'DOUBLE', 'BLOB']);
    expect((await result.next(1)).rows).toEqual([{ id: 1, name: null, score: 1.5, raw: 'yv4=' }]);
    const before = sent.length;
    await expect(session.run('SELECT 1; DELETE FROM t', { readWrite: false })).rejects.toThrow(/read-only/);
    expect(sent.length).toBe(before);
  });

  it("names a database the account does not hold, and hides Cloudflare's own tables from the catalog", async () => {
    const missing = fake(() => json({ success: false, errors: [{ code: 7404, message: 'The database 0f0e… could not be found' }], result: [] }, 404));
    const failure = await openD1(target, missing.transport).catch((err: unknown) => err);
    expect(classifyConnectError(failure)).toMatchObject({ step: 'auth', fix: 'database' });

    const { transport, sent } = fake((_request, body) => (body.sql === 'SELECT sqlite_version() AS v' ? answer(['v'], [['3.45.0']]) : answer(['kind', 'name'], [['table', 'users']])));
    const session = await openD1(target, transport);
    await session.introspect({ level: 'objects', schema: 'main' });
    expect(String(sent.at(-1)!.body.sql)).toContain("NOT LIKE '\\_cf\\_%' ESCAPE '\\'");
  });
});

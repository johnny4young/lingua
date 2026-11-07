import { existsSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqlLocalEngine, type SqlLocalEngine } from '../../../src/main/sqlLocal/engine';
import type { LocalPaths, LocalRequest } from '../../../src/main/sqlLocal/protocol';
import type { SqlLocalOpened, SqlLocalQueryResult, SqlLocalStreamOpened } from '../../../src/shared/sqlLocal';

type Body = LocalRequest extends infer R ? (R extends LocalRequest ? Omit<R, 'id'> : never) : never;

let root: string;
let outside: string;
let engine: SqlLocalEngine;
let id = 0;

const pathsFor = (owner: number): LocalPaths => ({
  database: path.join(root, 'lingua-sql.duckdb'),
  files: path.join(root, 'files', String(owner)),
  temp: path.join(root, 'tmp', String(owner)),
});

async function ok<T>(body: Body): Promise<T> {
  const response = await engine.handle({ id: ++id, ...body } as LocalRequest);
  if (!response.ok) throw Object.assign(new Error(response.error.message), { code: response.error.code });
  return response.result as T;
}

async function failure(body: Body): Promise<{ message: string; code?: string }> {
  const response = await engine.handle({ id: ++id, ...body } as LocalRequest);
  if (response.ok) throw new Error(`expected ${body.type} to fail`);
  return response.error;
}

async function openEngine(owner = 1, persist = false) {
  const opened = await ok<SqlLocalOpened>({ type: 'open', owner, persist, paths: pathsFor(owner) });
  const connectionId = await ok<string>({ type: 'connect', owner, engineId: opened.engineId });
  const query = (sql: string) => ok<SqlLocalQueryResult>({ type: 'query', owner, connectionId, sql });
  return { opened, connectionId, query };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lingua-sql-local-'));
  outside = await mkdtemp(path.join(tmpdir(), 'lingua-sql-outside-'));
  engine = createSqlLocalEngine(() => import('@duckdb/node-api'));
});

afterEach(async () => {
  await engine.dispose();
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('native Local SQL engine', () => {
  it('opens in memory with DuckDB 1.4.3 and the extensions WASM loads', async () => {
    const { opened, query } = await openEngine();
    expect(opened).toMatchObject({ storageMode: 'memory', version: 'v1.4.3', filesDir: pathsFor(1).files });
    const result = await query("SELECT now() - INTERVAL 1 DAY > TIMESTAMPTZ '2000-01-01' AS icu, '{\"a\":1}'::JSON->>'a' AS json, current_setting('TimeZone') AS tz");
    expect(result.rows).toEqual([{ icu: true, json: '1', tz: expect.any(String) }]);
    expect(result.rows[0]?.tz).not.toBe('');
    expect(result.columns).toEqual([
      { name: 'icu', type: 'Bool' },
      { name: 'json', type: 'Utf8' },
      { name: 'tz', type: 'Utf8' },
    ]);
  });

  it('refuses every path outside the files folder, network reads, INSTALL and LOAD', async () => {
    const secret = path.join(outside, 'secret.csv');
    await writeFile(secret, 'a\n1\n');
    const { query } = await openEngine();
    const refused = [
      `SELECT * FROM read_csv('${secret}')`,
      `COPY (SELECT 1) TO '${path.join(outside, 'out.csv')}'`,
      `ATTACH '${path.join(outside, 'x.duckdb')}' AS x`,
      `SELECT * FROM glob('${outside}/*')`,
      "SELECT * FROM read_csv('https://example.com/data.csv')",
      'INSTALL spatial',
      'LOAD spatial',
      "SELECT * FROM read_text('/etc/hosts')",
      `ATTACH '${pathsFor(1).database}' AS main_copy`,
    ];
    for (const sql of refused) await expect(query(sql), sql).rejects.toThrow(/disabled|Permission/i);
    expect(existsSync(path.join(outside, 'out.csv'))).toBe(false);
    expect(existsSync(path.join(outside, 'x.duckdb'))).toBe(false);
  });

  it('keeps the lock: the settings that open it cannot change while the database runs', async () => {
    const { query } = await openEngine();
    for (const sql of [
      'SET enable_external_access = true',
      "SET allowed_directories = ['/']",
      "SET allowed_paths = ['/etc/hosts']",
      'SET allow_unsigned_extensions = true',
      "SET temp_directory = '/tmp'",
      'SET lock_configuration = false',
      'RESET enable_external_access',
      `SET extension_directory = '${pathsFor(1).files}'`,
      `SET profiling_output = '${path.join(outside, 'profile.json')}'`,
    ]) {
      await expect(query(sql), sql).rejects.toThrow();
    }
    await expect(query(`SELECT * FROM read_text('/etc/hosts')`)).rejects.toThrow(/disabled/);
    expect(existsSync(path.join(outside, 'profile.json'))).toBe(false);
    // What SQL still owns: variables, the schema search path, catalog pragmas and EXPLAIN.
    expect((await query("SET VARIABLE v = 5; SELECT getvariable('v') AS v")).rows).toEqual([{ v: 5 }]);
    await query('CREATE SCHEMA s; USE s; CREATE TABLE t (a INTEGER); USE main');
    expect((await query("PRAGMA table_info('s.t')")).rowCount).toBe(1);
    expect((await query('EXPLAIN (FORMAT JSON) SELECT 1')).rowCount).toBe(1);
  });

  it('never reaches an extension repository, even one SQL names', async () => {
    const hits: string[] = [];
    const server = http.createServer((request, response) => {
      hits.push(request.url ?? '');
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const repository = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const { query } = await openEngine();
      for (const sql of ['INSTALL httpfs', `FORCE INSTALL httpfs FROM '${repository}'`, "SELECT * FROM read_csv('https://example.com/x.csv')", "SELECT * FROM read_json('s3://bucket/key.json')"]) {
        await expect(query(sql), sql).rejects.toThrow(/disabled|Permission/i);
      }
      expect(hits).toEqual([]);
    } finally {
      server.close();
    }
  });

  it('reads and writes registered files by absolute path and drops them', async () => {
    const owner = 1;
    const { opened, query } = await openEngine(owner);
    const name = 'lingua_import_0f1e2d3c.csv';
    await ok({ type: 'register-file', owner, engineId: opened.engineId, name, bytes: new TextEncoder().encode('a,b\n1,x\n2,y\n') });
    const file = path.join(opened.filesDir, name);
    expect((await query(`SELECT * FROM read_csv('${file}') ORDER BY a`)).rows).toEqual([
      { a: '1', b: 'x' },
      { a: '2', b: 'y' },
    ]);
    const out = 'lingua_export_5a6b7c.csv';
    await ok({ type: 'register-empty-file', owner, engineId: opened.engineId, name: out });
    await query(`COPY (SELECT 42 AS n) TO '${path.join(opened.filesDir, out)}' (FORMAT csv, HEADER true)`);
    const bytes = await ok<Uint8Array>({ type: 'read-file', owner, engineId: opened.engineId, name: out });
    expect(new TextDecoder().decode(bytes)).toBe('n\n42\n');
    await ok({ type: 'drop-file', owner, engineId: opened.engineId, name });
    expect(existsSync(file)).toBe(false);
    // A parse error names the file as WASM does, without the folder.
    await ok({ type: 'register-file', owner, engineId: opened.engineId, name, bytes: new Uint8Array([0xff, 0xfe, 0x00]) });
    const error = await query(`SELECT * FROM read_parquet('${file}')`).catch((err: Error) => err.message);
    expect(error).toContain(name);
    expect(error).not.toContain(opened.filesDir);
  });

  it('rejects a file name that climbs out of the folder', async () => {
    const owner = 1;
    const { opened } = await openEngine(owner);
    const error = await failure({ type: 'register-file', owner, engineId: opened.engineId, name: '../escape.csv', bytes: new Uint8Array([1]) });
    expect(error.message).toMatch(/Invalid file name/);
    expect(existsSync(path.join(root, 'files', 'escape.csv'))).toBe(false);
  });

  it('serves an id only to the owner it was opened for', async () => {
    const a = await openEngine(1);
    await openEngine(2);
    expect(await failure({ type: 'query', owner: 2, connectionId: a.connectionId, sql: 'SELECT 1' })).toMatchObject({ code: 'engine-gone' });
    expect(await failure({ type: 'connect', owner: 2, engineId: a.opened.engineId })).toMatchObject({ code: 'engine-gone' });
    expect(await failure({ type: 'read-file', owner: 2, engineId: a.opened.engineId, name: 'lingua_export_1.csv' })).toMatchObject({ code: 'engine-gone' });
  });

  it('streams one DuckDB chunk per batch and ends with null', async () => {
    const owner = 1;
    const { connectionId } = await openEngine(owner);
    const opened = await ok<SqlLocalStreamOpened>({ type: 'stream', owner, connectionId, sql: 'SELECT range AS n FROM range(5000)' });
    expect(opened.columns).toEqual([{ name: 'n', type: 'Int64' }]);
    const sizes: number[] = [];
    for (let batch = await ok<unknown[] | null>({ type: 'next', owner, streamId: opened.streamId }); batch; batch = await ok<unknown[] | null>({ type: 'next', owner, streamId: opened.streamId })) {
      sizes.push(batch.length);
    }
    expect(sizes).toEqual([2048, 2048, 904]);
    expect(await failure({ type: 'next', owner, streamId: opened.streamId })).toMatchObject({ code: 'engine-gone' });
  });

  it('stops a running query on cancel and keeps the connection usable', async () => {
    const owner = 1;
    const { connectionId, query } = await openEngine(owner);
    const running = query('SELECT count(*) FROM range(100000000000) a');
    await new Promise(resolve => setTimeout(resolve, 200));
    expect(await ok<boolean>({ type: 'cancel', owner, connectionId })).toBe(true);
    await expect(running).rejects.toThrow(/Interrupt/i);
    expect((await query('SELECT 7 AS n')).rows).toEqual([{ n: 7 }]);
  });

  it('caps a materialized result like the WASM preview and still counts every row', async () => {
    const { query } = await openEngine();
    const result = await query('CREATE TABLE t AS SELECT range AS n FROM range(25000); SELECT * FROM t');
    expect(result.rowCount).toBe(25000);
    expect(result.rows).toHaveLength(10_000);
    expect(result.tooLarge).toBe(true);
  });

  it('persists tables in the database file, gives the file to one engine and clears it', async () => {
    const first = await openEngine(1, true);
    expect(first.opened.storageMode).toBe('opfs');
    await first.query('CREATE TABLE kept AS SELECT 1 AS n; CHECKPOINT');
    // A second renderer cannot share the file and works in memory.
    const second = await openEngine(2, true);
    expect(second.opened.storageMode).toBe('memory');
    expect(await failure({ type: 'clear-database', database: pathsFor(1).database })).toMatchObject({ message: 'The SQL database is in use.' });
    expect(await ok<number>({ type: 'database-bytes', database: pathsFor(1).database })).toBeGreaterThan(0);
    await ok({ type: 'terminate', owner: 1, engineId: first.opened.engineId });
    expect(existsSync(pathsFor(1).files)).toBe(false);
    const reopened = await openEngine(1, true);
    expect(reopened.opened.storageMode).toBe('opfs');
    expect((await reopened.query('SELECT n FROM kept')).rows).toEqual([{ n: 1 }]);
    await ok({ type: 'release-owner', owner: 1 });
    await ok({ type: 'clear-database', database: pathsFor(1).database });
    expect(await ok<number>({ type: 'database-bytes', database: pathsFor(1).database })).toBe(0);
  });

  it('keeps the database file usable under the lock: writes, checkpoints and a reopen', async () => {
    const first = await openEngine(1, true);
    await first.query('CREATE TABLE big AS SELECT range AS n, repeat(\'x\', 100) AS pad FROM range(200000)');
    await first.query('CHECKPOINT');
    await ok({ type: 'release-owner', owner: 1 });
    const again = await openEngine(1, true);
    expect((await again.query('SELECT count(*)::INTEGER AS n FROM big')).rows).toEqual([{ n: 200000 }]);
    expect(await readFile(pathsFor(1).database).then(bytes => bytes.byteLength)).toBeGreaterThan(0);
  });
});

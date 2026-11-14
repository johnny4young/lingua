// @vitest-environment node
/**
 * The Local engine's client run twice over the same SQL: once on DuckDB-WASM
 * with its extension repository closed, as the renderer runs it, and once on
 * the native engine behind the desktop bridge. Every outcome the grid, imports,
 * exports and edits read must match; the few types WASM's Arrow mapping loses
 * are pinned separately. DuckDB-WASM's Node build cannot load the vendored JSON,
 * Parquet and ICU extensions, so those paths check the native results directly;
 * the browser e2e suite covers them on WASM.
 */

import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHost, inProcessTransport } from '@electron-stagewright/host-supervisor';
import { createSqlLocalEngine, type SqlLocalEngine } from '../../src/main/sqlLocal/engine';
import { SQL_LOCAL_OPERATIONS, SQL_LOCAL_STREAMS, type SqlLocalOps } from '../../src/main/sqlLocal/protocol';
import { createSqlLocalService, type SqlLocalService } from '../../src/main/sqlLocal/service';
import {
  __setDuckDbEngineFactoryForTests,
  executeQuery,
  executeSqlScript,
  importFileAsTable,
  mapArrowTable,
  previewImportFile,
  runEditTransaction,
  copyBatchesIntoTable,
  type ArrowTableLike,
  type DuckDbEngineHandle,
  type DuckDbExecuteOutcome,
} from '../../src/renderer/runtime/duckdbClient';
import { copyQueryToBytes, streamQueryRows } from '../../src/renderer/runtime/duckdbExport';
import { openNativeEngine } from '../../src/renderer/runtime/duckdbNativeEngine';
import type { SqlLocalBridge } from '../../src/shared/sqlLocal';

interface BlockingConnection {
  query(sql: string): ArrowTableLike;
  send(sql: string, stream: boolean): Promise<{ schema?: { fields: ArrowTableLike['schema']['fields'] }; next(): IteratorResult<ArrowTableLike> | Promise<IteratorResult<ArrowTableLike>> }>;
  cancelSent(): boolean;
  close(): void;
}
interface BlockingDb {
  instantiate(): Promise<void>;
  connect(): BlockingConnection;
  registerFileBuffer(name: string, data: Uint8Array): void;
  dropFile(name: string): void;
}
type Blocking = {
  createDuckDB: (bundles: unknown, logger: unknown, runtime: unknown) => Promise<BlockingDb>;
  VoidLogger: new () => unknown;
  NODE_RUNTIME: unknown;
};

let wasm: DuckDbEngineHandle;
let native: DuckDbEngineHandle;
let localEngine: SqlLocalEngine;
let localService: SqlLocalService;
let scratch: string;

/** DuckDB-WASM as `wasmEngineFactory` configures it. */
async function wasmHandle(): Promise<DuckDbEngineHandle> {
  const require = createRequire(import.meta.url);
  const entry = require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs');
  const dist = path.dirname(entry);
  const duck = require(entry) as Blocking;
  const db = await duck.createDuckDB(
    { mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: '' }, eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: '' } },
    new duck.VoidLogger(),
    duck.NODE_RUNTIME
  );
  await db.instantiate();
  const setup = db.connect();
  for (const sql of ["SET custom_extension_repository='data:'", 'SET autoload_known_extensions=false']) setup.query(sql);
  setup.close();
  return {
    connect: async () => {
      const connection = db.connect();
      return {
        query: async (sql: string) => mapArrowTable(connection.query(sql)),
        stream: async (sql: string) => {
          const reader = await connection.send(sql, true);
          // The blocking reader reads its schema with the first batch.
          let first: IteratorResult<ArrowTableLike> | null = await reader.next();
          const fields = () => (first && !first.done ? first.value.schema.fields : reader.schema?.fields ?? []);
          return {
            fields,
            next: async () => {
              const step = first ?? (await reader.next());
              first = null;
              return step.done ? null : step.value;
            },
          };
        },
        cancel: async () => connection.cancelSent(),
        close: async () => connection.close(),
      };
    },
    terminate: async () => undefined,
    registerFile: async (name, data) => db.registerFileBuffer(name, data.slice()),
    dropFile: async name => db.dropFile(name),
  };
}

/** The native engine as main serves it to one window, through the real supervisor but without Electron. */
async function nativeHandle(): Promise<DuckDbEngineHandle> {
  scratch = await mkdtemp(path.join(tmpdir(), 'lingua-parity-'));
  localEngine = createSqlLocalEngine(() => import('@duckdb/node-api'));
  localService = createSqlLocalService({
    root: scratch,
    available: () => true,
    createHost: () =>
      createHost<SqlLocalOps>({
        operations: SQL_LOCAL_OPERATIONS,
        streams: SQL_LOCAL_STREAMS,
        transport: inProcessTransport<SqlLocalOps>({ operations: SQL_LOCAL_OPERATIONS, streams: SQL_LOCAL_STREAMS, start: () => localEngine.handlers }),
      }),
  });
  const owner = 1;
  const bridge: SqlLocalBridge = {
    status: async () => localService.status(),
    open: persist => localService.open(owner, persist),
    connect: engineId => localService.connect(owner, engineId),
    query: (connectionId, sql) => localService.query(owner, connectionId, sql),
    stream: (connectionId, sql) => localService.stream(owner, connectionId, sql),
    next: streamId => localService.next(owner, streamId),
    cancel: connectionId => localService.cancel(owner, connectionId),
    closeConnection: connectionId => localService.closeConnection(owner, connectionId),
    registerFile: (engineId, name, bytes) => localService.registerFile(owner, engineId, name, bytes),
    registerEmptyFile: (engineId, name) => localService.registerEmptyFile(owner, engineId, name),
    dropFile: (engineId, name) => localService.dropFile(owner, engineId, name),
    readFile: (engineId, name) => localService.readFile(owner, engineId, name),
    terminate: engineId => localService.terminate(owner, engineId, false),
    clearDatabase: async () => ({ ok: true, value: null }),
    databaseBytes: async () => ({ ok: true, value: 0 }),
  };
  return (await openNativeEngine(bridge, false, () => undefined)).handle;
}

async function onEach<T>(run: () => Promise<T>): Promise<{ wasm: T; native: T }> {
  __setDuckDbEngineFactoryForTests(async () => wasm);
  const onWasm = await run();
  __setDuckDbEngineFactoryForTests(async () => native);
  const onNative = await run();
  return { wasm: onWasm, native: onNative };
}

/** What the grid reads from an outcome; the time it took differs by design. */
const seen = ({ durationMs: _durationMs, cursor, ...outcome }: DuckDbExecuteOutcome) => ({ ...outcome, hasCursor: cursor !== undefined });

async function same(sql: string) {
  const { wasm: onWasm, native: onNative } = await onEach(() => executeQuery(sql));
  expect(seen(onNative), sql).toEqual(seen(onWasm));
  return onNative;
}

beforeAll(async () => {
  [wasm, native] = await Promise.all([wasmHandle(), nativeHandle()]);
}, 60_000);

afterAll(async () => {
  __setDuckDbEngineFactoryForTests(null);
  await localService?.dispose();
  await localEngine?.dispose();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

describe('Local engine parity: DuckDB-WASM and native', () => {
  it('runs DuckDB 1.4.3 on both engines', async () => {
    const outcome = await same('SELECT version() AS v');
    expect(outcome.rows).toEqual([{ v: 'v1.4.3' }]);
  });


  it.each([
    ['integers', "SELECT 1::TINYINT a, 2::SMALLINT b, 3::INTEGER c, 4::BIGINT d, 5::UTINYINT e, 6::USMALLINT f, 7::UINTEGER g, 8::UBIGINT h, 170141183460469231731687303715884105727::HUGEINT i, -9223372036854775808::BIGINT j"],
    ['floats', "SELECT 1.5::FLOAT a, 1.1::FLOAT b, 2.25::DOUBLE c, 'nan'::DOUBLE d, 'inf'::DOUBLE e, '-inf'::DOUBLE f, 1e300::DOUBLE g"],
    ['decimals', 'SELECT 1.25::DECIMAL(4,2) a, -0.05::DECIMAL(18,2) b, 123456789012345678901234.5::DECIMAL(38,1) c, 7::DECIMAL(9,0) d, sum(x) e FROM range(5) t(x)'],
    ['text', "SELECT 'abc' a, '' b, 'ñandú 🦆' c, NULL::VARCHAR d, '5f1a6b2c-8c59-4b5f-9a6e-1b2c3d4e5f60'::UUID g"],
    ['blobs', "SELECT 'abc'::BLOB a, '\\xAA\\xBB'::BLOB b"],
    ['dates', "SELECT DATE '2024-01-02' a, DATE '1969-12-31' b, DATE '0001-01-01' c, DATE 'infinity' d"],
    ['timestamps', "SELECT TIMESTAMP '2024-01-02 03:04:05.123456' a, TIMESTAMPTZ '2024-01-02 03:04:05.123456+00' b, TIMESTAMP_S '2024-01-02 03:04:05' c, TIMESTAMP_MS '2024-01-02 03:04:05.123' d, TIMESTAMP_NS '2024-01-02 03:04:05.123456789' e, TIMESTAMP '1960-06-01 00:00:00.5' f"],
    ['time', "SELECT TIME '03:04:05.123456' a, TIME '23:59:59' b"],
    ['lists and structs', "SELECT [1,2,3] a, ['x', NULL] b, {'k': 1, 'v': 'x'} c, [[1],[2,3]] d, {'t': TIMESTAMP '2024-01-02 03:04:05', 'd': DATE '2024-01-02'} e, [1.5::DOUBLE, NULL] f, [1,2]::INTEGER[2] g, [{'a': 10::BIGINT}] h"],
    ['maps and unions', "SELECT MAP {'k': 1, 'z': 2} a, MAP {1: 'one'} b, union_value(num := 2) c"],
    ['booleans and nulls', 'SELECT true a, false b, NULL c, NULL::BOOLEAN d'],
    ['empty result keeps its columns', 'SELECT 1 AS a, \'x\' AS b WHERE false'],
    ['window and aggregate', 'SELECT g, count(*) n, sum(v)::BIGINT s, avg(v) a, list(v ORDER BY v) l, row_number() OVER (ORDER BY g) r FROM (SELECT range % 3 g, range v FROM range(10)) GROUP BY g ORDER BY g'],
  ])('%s', async (_name, sql) => {
    await same(sql);
  });

  it('pins the types WASM loses, where native keeps DuckDB values', async () => {
    const { wasm: onWasm, native: onNative } = await onEach(() =>
      executeQuery("SELECT INTERVAL '1 month 2 days 3 seconds' a, TIMETZ '03:04:05+02' b, '0101'::BIT c, 1::VARINT d, 1::UHUGEINT e, [1.5::DECIMAL(4,2)] f, [12::HUGEINT] g")
    );
    expect(onNative.columns).toEqual(onWasm.columns);
    expect(onNative.rows).toEqual([{ a: '1 month 2 days 00:00:03', b: '03:04:05+02', c: '0101', d: '1', e: '1', f: ['1.50'], g: ['12'] }]);
    for (const column of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) expect(onWasm.rows[0]?.[column], column).not.toEqual(onNative.rows[0]?.[column]);
    // A streamed ENUM reads as null on WASM's Node build; a repeated column name fails its row proxy.
    const enums = await onEach(() => executeQuery("SELECT 'a'::ENUM('a', 'b') AS e"));
    expect(enums.native.columns).toEqual(enums.wasm.columns);
    expect(enums.native.rows).toEqual([{ e: 'a' }]);
    const repeated = await onEach(() => executeQuery('SELECT 1 AS a, 2 AS a, 3 AS b'));
    expect(repeated.wasm.status).toBe('sql-error');
    expect(repeated.native).toMatchObject({ status: 'success', rows: [{ a: 2, b: 3 }] });
    // Infinite timestamps fail the whole WASM query; native shows them.
    const infinite = await onEach(() => executeQuery("SELECT TIMESTAMP 'infinity' AS t"));
    expect(infinite.wasm.status).toBe('sql-error');
    expect(infinite.native.status).toBe('success');
  });

  it('reports writes and DDL the same way', async () => {
    await same('CREATE OR REPLACE TABLE parity_w (id INTEGER PRIMARY KEY, name VARCHAR)');
    await same("INSERT INTO parity_w VALUES (1, 'a'), (2, 'b'), (3, 'c')");
    await same("UPDATE parity_w SET name = 'z' WHERE id > 1");
    await same('DELETE FROM parity_w WHERE id = 3');
    await same('SELECT * FROM parity_w ORDER BY id');
    await same('DROP TABLE parity_w');
  });

  it('runs a script on one connection and stops at the first failure', async () => {
    const statements = ['CREATE TEMP TABLE s (n INTEGER)', 'INSERT INTO s SELECT * FROM range(5)', 'SELECT sum(n) AS total FROM s', 'SELECT * FROM missing_table', 'SELECT 1'];
    const { wasm: onWasm, native: onNative } = await onEach(() => executeSqlScript(statements));
    expect(onNative.map(seen)).toEqual(onWasm.map(seen));
    expect(onNative.map(outcome => outcome.status)).toEqual(['success', 'success', 'success', 'sql-error']);
  });

  it('runs a multi-statement text as one query and keeps the last result', async () => {
    await same('CREATE TEMP TABLE m AS SELECT range AS n FROM range(4); INSERT INTO m VALUES (10); SELECT sum(n)::INTEGER AS s FROM m');
  });

  it('windows a large result at 10,000 rows with the same lower-bound count', async () => {
    const outcome = await same('SELECT range AS n FROM range(25000)');
    expect(outcome).toMatchObject({ status: 'too-large', rowCountIsLowerBound: true });
    expect(outcome.rows).toHaveLength(10_000);
  });

  it('windows wide rows at the byte cap', async () => {
    const outcome = await same("SELECT range AS n, repeat('x', 2000) AS pad FROM range(500)");
    expect(outcome.status).toBe('too-large');
    expect(outcome.rows.length).toBeLessThan(500);
  });

  it('reads the rest of a kept stream page by page', async () => {
    const { wasm: onWasm, native: onNative } = await onEach(() =>
      streamQueryRows('SELECT range AS n, md5(range::VARCHAR) AS h FROM range(23000) ORDER BY n', { cap: 21_000, batchSize: 5_000 })
    );
    expect(onNative).toEqual(onWasm);
    expect(onNative.rows).toHaveLength(21_000);
    expect(onNative.truncated).toBe(true);
  });

  it.each([
    ['syntax', 'SELEC 1'],
    ['catalog', 'SELECT * FROM no_such_table'],
    ['binder', 'SELECT no_such_column FROM range(1)'],
    ['conversion', "SELECT 'x'::INTEGER"],
    ['constraint', 'CREATE TEMP TABLE pk (id INTEGER PRIMARY KEY); INSERT INTO pk VALUES (1), (1)'],
    ['missing extension', 'SELECT ST_Point(1, 2)'],
  ])('fails a %s error with the same message', async (_name, sql) => {
    const outcome = await same(sql);
    expect(outcome.status).toBe('sql-error');
  });

  it('previews and imports a CSV file the same way', async () => {
    const bytes = new TextEncoder().encode('id,name,amount\n1,ana,10.5\n2,luis,\n3,"o\'neil",7\n');
    const preview = await onEach(() => previewImportFile({ fileName: 'x.csv', format: 'csv', bytes }));
    expect(preview.native).toEqual(preview.wasm);
    const imported = await onEach(async () => {
      const result = await importFileAsTable({ fileName: 'x.csv', tableName: 'parity_import', format: 'csv', bytes });
      const rows = await executeQuery('SELECT * FROM parity_import ORDER BY id');
      await executeQuery('DROP TABLE parity_import');
      return { result, rows: seen(rows) };
    });
    expect(imported.native).toEqual(imported.wasm);
  });


  describe('JSON and Parquet on the native engine', () => {
    const onNative = async <T>(run: () => Promise<T>) => {
      __setDuckDbEngineFactoryForTests(async () => native);
      return run();
    };

    it('reads JSON values and imports a JSON file', async () => {
      const value = await onNative(() => executeQuery(`SELECT '{"k":[1,2]}'::JSON AS j, '{"k":[1,2]}'::JSON->'k'->>0 AS first`));
      expect(value.columns).toEqual([
        { name: 'j', type: 'Utf8' },
        { name: 'first', type: 'Utf8' },
      ]);
      expect(value.rows).toEqual([{ j: '{"k":[1,2]}', first: '1' }]);
      const bytes = new TextEncoder().encode('[{"id":1,"tags":["a"],"at":"2024-01-02"},{"id":2,"tags":[],"at":null}]');
      const result = await onNative(async () => {
        const preview = await previewImportFile({ fileName: 'x.json', format: 'json', bytes });
        const imported = await importFileAsTable({ fileName: 'x.json', tableName: 'native_json', format: 'json', bytes });
        const rows = await executeQuery('SELECT * FROM native_json ORDER BY id');
        await executeQuery('DROP TABLE native_json');
        return { preview, imported, rows: rows.rows };
      });
      expect(result.preview).toMatchObject({ columns: ['id', 'tags', 'at'], rowCount: 2 });
      expect(result.imported).toEqual({ table: 'native_json', rowCount: 2 });
      expect(result.rows).toEqual([
        { id: '1', tags: ['a'], at: '2024-01-02' },
        { id: '2', tags: [], at: null },
      ]);
    });

    it('exports CSV through a registered file', async () => {
      const sql = "SELECT range AS n, CASE WHEN range % 2 = 0 THEN 'even' END AS label, range / 4 AS quarter FROM range(4) ORDER BY n";
      const csv = await onNative(() => copyQueryToBytes(sql, "FORMAT csv, HEADER true, DELIMITER ',', NULLSTR 'NULL'", 'csv'));
      expect(csv.rowCount).toBe(4);
      expect(new TextDecoder().decode(csv.bytes)).toBe('n,label,quarter\n0,even,0.0\n1,NULL,0.25\n2,even,0.5\n3,NULL,0.75\n');
    });

    it('exports JSON and round-trips Parquet', async () => {
      const json = await onNative(() => copyQueryToBytes('SELECT range AS n, range / 2 AS half FROM range(3) ORDER BY n', 'FORMAT json, ARRAY true', 'json'));
      expect(JSON.parse(new TextDecoder().decode(json.bytes))).toEqual([
        { n: 0, half: 0 },
        { n: 1, half: 0.5 },
        { n: 2, half: 1 },
      ]);
      const sql = "SELECT range AS id, 'row ' || range AS label, DATE '2024-01-01' + range::INTEGER AS day FROM range(50)";
      const parquet = await onNative(() => copyQueryToBytes(sql, 'FORMAT parquet', 'parquet'));
      expect(parquet.rowCount).toBe(50);
      const back = await onNative(async () => {
        const imported = await importFileAsTable({ fileName: 'x.parquet', tableName: 'native_pq', format: 'parquet', bytes: parquet.bytes });
        const rows = await executeQuery('SELECT * FROM native_pq ORDER BY id LIMIT 2');
        await executeQuery('DROP TABLE native_pq');
        return { imported, rows: rows.rows };
      });
      expect(back.imported.rowCount).toBe(50);
      expect(back.rows).toEqual([
        { id: '0', label: 'row 0', day: '2024-01-01' },
        { id: '1', label: 'row 1', day: '2024-01-02' },
      ]);
    });

    it('copies batches into a table with its origin', async () => {
      async function* batches() {
        yield [{ id: 1, created_at: '2026-10-01T00:00:00.000Z', amount: '10.50', raw: 'eA==' }];
        yield [{ id: 2, created_at: '2026-10-02T12:30:00.000Z', amount: null, raw: null }];
      }
      const result = await onNative(async () => {
        const copied = await copyBatchesIntoTable({
          table: 'native_copy',
          columns: [
            { name: 'id', type: 'BIGINT' },
            { name: 'created_at', type: 'TIMESTAMPTZ' },
            { name: 'amount', type: 'DECIMAL(12,2)' },
            { name: 'raw', type: 'BLOB' },
          ],
          sourceNames: ['id', 'created_at', 'amount', 'raw'],
          batches: batches(),
          origin: { connection: 'orders-dev', at: '2026-10-23T10:00:00.000Z' },
        });
        const rows = await executeQuery('SELECT id, created_at, amount, hex(raw) AS raw FROM native_copy ORDER BY id');
        await executeQuery('DROP TABLE native_copy');
        return { copied, rows: rows.rows, error: rows.errorMessage };
      });
      expect(result.copied).toEqual({ rowCount: 2 });
      expect(result.error).toBeUndefined();
      expect(result.rows).toEqual([
        { id: '1', created_at: '2026-10-01T00:00:00.000Z', amount: '10.50', raw: '78' },
        { id: '2', created_at: '2026-10-02T12:30:00.000Z', amount: null, raw: null },
      ]);
    });
  });

  it('applies staged edits in one transaction and rolls back a conflict', async () => {
    const result = await onEach(async () => {
      await executeQuery('CREATE OR REPLACE TABLE parity_e (id INTEGER PRIMARY KEY, v VARCHAR); INSERT INTO parity_e VALUES (1, \'a\'), (2, \'b\')');
      const applied = await runEditTransaction(["UPDATE parity_e SET v = 'x' WHERE id = 1", "UPDATE parity_e SET v = 'y' WHERE id = 2"]);
      const conflict = await runEditTransaction(["UPDATE parity_e SET v = 'q' WHERE id = 1", "UPDATE parity_e SET v = 'q' WHERE id = 99"]);
      const rows = await executeQuery('SELECT * FROM parity_e ORDER BY id');
      await executeQuery('DROP TABLE parity_e');
      return { applied, conflict, rows: seen(rows) };
    });
    expect(result.native).toEqual(result.wasm);
    expect(result.native.conflict).toEqual({ edit: { kind: 'conflict', change: 2, touched: 0 } });
  });
});

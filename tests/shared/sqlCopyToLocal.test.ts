import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  localColumnType,
  localCopyCheck,
  localCopyCheckFailure,
  localCopyColumns,
  localCopyComment,
  localCopyCreate,
  localCopyInsert,
  localCopyLines,
  LocalCopyValueError,
  parseLocalCopyOrigin,
} from '../../src/shared/sqlCopyToLocal';

const require = createRequire(import.meta.url);
const dist = path.dirname(require.resolve('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs'));

type Blocking = {
  createDuckDB: (bundles: unknown, logger: unknown, runtime: unknown) => Promise<{ instantiate(): Promise<void>; connect(): { query(sql: string): { toArray(): Array<{ toJSON(): Record<string, unknown> }> }; close(): void }; registerFileText(name: string, text: string): void }>;
  ConsoleLogger: new (level: number) => unknown;
  LogLevel: { ERROR: number };
  NODE_RUNTIME: unknown;
};

let conn: ReturnType<Awaited<ReturnType<Blocking['createDuckDB']>>['connect']>;
let db: Awaited<ReturnType<Blocking['createDuckDB']>>;

beforeAll(async () => {
  const duck = require('@duckdb/duckdb-wasm/dist/duckdb-node-blocking.cjs') as Blocking;
  db = await duck.createDuckDB(
    { mvp: { mainModule: path.join(dist, 'duckdb-mvp.wasm'), mainWorker: '' }, eh: { mainModule: path.join(dist, 'duckdb-eh.wasm'), mainWorker: '' } },
    new duck.ConsoleLogger(duck.LogLevel.ERROR),
    duck.NODE_RUNTIME
  );
  await db.instantiate();
  conn = db.connect();
});
afterAll(() => conn?.close());

const rows = (sql: string) =>
  conn.query(sql).toArray().map((row) => JSON.parse(JSON.stringify(row.toJSON(), (_key, value) => (typeof value === 'bigint' ? value.toString() : value))) as Record<string, unknown>);

describe('Copy to Local planner', () => {
  it('maps the grid types to DuckDB types and keeps everything else as text', () => {
    expect(['BIGINT', 'DECIMAL(10,2)', 'TIMESTAMP WITH TIME ZONE', 'REAL', 'UUID', 'BLOB', 'DATE', 'DATETIME'].map(localColumnType)).toEqual([
      'BIGINT',
      'DECIMAL(10,2)',
      'TIMESTAMPTZ',
      'FLOAT',
      'UUID',
      'BLOB',
      'DATE',
      'TIMESTAMP',
    ]);
    // SQLite's INTEGER is 64-bit and MySQL's unsigned integers pass the signed range, so narrow ones widen.
    expect(['TINYINT', 'SMALLINT', 'INTEGER', 'INT'].map(localColumnType)).toEqual(['BIGINT', 'BIGINT', 'BIGINT', 'BIGINT']);
    for (const text of ['TEXT', 'JSONB', 'MONEY', 'INTERVAL', 'DECIMAL', 'DECIMAL(40,2)', 'OID 1234', 'VARCHAR[]', 'VALUE', 'INT); DROP TABLE x; --']) expect(localColumnType(text), text).toBe('VARCHAR');
  });

  it('creates the table and casts each batch from text, with names and values as they came', () => {
    const columns = localCopyColumns([
      { name: 'id', type: 'BIGINT' },
      { name: 'ID', type: 'INTEGER' },
      { name: 'total', type: 'DECIMAL(10,2)' },
      { name: 'at', type: 'TIMESTAMP WITH TIME ZONE' },
      { name: 'day', type: 'DATE' },
      { name: 'paid', type: 'BOOLEAN' },
      { name: 'raw', type: 'BLOB' },
      { name: 'tags', type: 'VARCHAR[]' },
      { name: 'say "hi"; --', type: 'TEXT' },
    ]);
    expect(columns.map((column) => column.name)).toEqual(['id', 'ID_2', 'total', 'at', 'day', 'paid', 'raw', 'tags', 'say "hi"; --']);
    const source = ['id', 'ID', 'total', 'at', 'day', 'paid', 'raw', 'tags', 'say "hi"; --'];
    const batch = [
      { id: '9007199254740993', ID: 7, total: '10.50', at: '2026-10-23 10:00:00+00', day: '2026-10-23', paid: true, raw: 'yv4=', tags: ['a', 'b'], 'say "hi"; --': "it's" },
      { id: null, ID: null, total: null, at: null, day: null, paid: false, raw: null, tags: null, 'say "hi"; --': null },
    ];
    conn.query(localCopyCreate('copied', columns));
    db.registerFileText('batch_1.json', localCopyLines(batch, source, columns));
    expect(localCopyCheckFailure(columns, rows(localCopyCheck(columns, 'batch_1.json')!)[0])).toBeNull();
    conn.query(localCopyInsert('copied', columns, 'batch_1.json'));
    conn.query(localCopyComment('copied', { connection: "orders-dev's", at: '2026-10-23T10:00:00.000Z' }));
    expect(rows('SELECT id::VARCHAR AS id, "ID_2", total::VARCHAR AS total, epoch("at") AS "at", "day"::VARCHAR AS "day", paid, hex(raw) AS raw, tags, "say ""hi""; --" AS said FROM copied ORDER BY id NULLS LAST')).toEqual([
      { id: '9007199254740993', ID_2: '7', total: '10.50', at: 1792749600, day: '2026-10-23', paid: true, raw: 'CAFE', tags: '["a","b"]', said: "it's" },
      { id: null, ID_2: null, total: null, at: null, day: null, paid: false, raw: null, tags: null, said: null },
    ]);
    expect(rows("SELECT data_type FROM information_schema.columns WHERE table_name = 'copied' ORDER BY ordinal_position").map((row) => row.data_type)).toEqual([
      'BIGINT',
      'BIGINT',
      'DECIMAL(10,2)',
      'TIMESTAMP WITH TIME ZONE',
      'DATE',
      'BOOLEAN',
      'BLOB',
      'VARCHAR',
      'VARCHAR',
    ]);
    const [table] = rows("SELECT comment FROM duckdb_tables() WHERE table_name = 'copied'");
    expect(parseLocalCopyOrigin(table?.comment)).toEqual({ connection: "orders-dev's", at: '2026-10-23T10:00:00.000Z' });
  });

  it('names the column whose value its type cannot hold, without a cast that throws', () => {
    const columns = localCopyColumns([{ name: 'id', type: 'BIGINT' }, { name: 'day', type: 'DATE' }]);
    db.registerFileText('batch_2.json', localCopyLines([{ id: '1', day: '2026-10-23' }, { id: '2', day: 'not a date' }], ['id', 'day'], columns));
    expect(localCopyCheckFailure(columns, rows(localCopyCheck(columns, 'batch_2.json')!)[0])).toEqual(new LocalCopyValueError('day', 'DATE'));
    expect(() => localCopyLines([{ raw: '{"0":120}' }], ['raw'], localCopyColumns([{ name: 'raw', type: 'BLOB' }]))).toThrow(new LocalCopyValueError('raw', 'BLOB'));
    expect(localCopyCheck(localCopyColumns([{ name: 'body', type: 'TEXT' }]), 'x.json')).toBeNull();
  });

  it('reads only its own origin comments', () => {
    expect(parseLocalCopyOrigin('a note someone wrote')).toBeNull();
    expect(parseLocalCopyOrigin('{"kind":"other"}')).toBeNull();
    expect(parseLocalCopyOrigin(null)).toBeNull();
  });
});

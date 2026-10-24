import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SqlDbBridge, SqlDbRunResult } from '../../../src/shared/sqlDb';
import { __setDuckDbEngineFactoryForTests, type DuckDbEngineHandle } from '../../../src/renderer/runtime/duckdbClient';
import { copyConnectionResultToLocal, CopyToLocalError, COPY_BATCH_ROWS } from '../../../src/renderer/runtime/sqlCopyToLocal';

/** An engine that records each statement and the size of each registered batch. */
function fakeEngine(failOn?: RegExp, badColumn?: number) {
  const sql: string[] = [];
  const files: number[] = [];
  const engine: DuckDbEngineHandle = {
    connect: async () => ({
      query: async (statement: string) => {
        sql.push(statement);
        if (failOn?.test(statement)) throw new Error('Conversion Error: could not convert');
        const rows = statement.startsWith('SELECT count(*) FILTER') && badColumn !== undefined ? [{ [String(badColumn)]: '1' }] : [];
        return { columns: [], rows, rowCount: rows.length, tooLarge: false };
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
    registerFile: async (_name, data) => {
      files.push(new TextDecoder().decode(data).trimEnd().split('\n').length);
    },
    dropFile: async () => undefined,
  };
  __setDuckDbEngineFactoryForTests(async () => engine);
  return { sql, files };
}

/** A bridge whose run returns `total` rows of `width` columns: a first window, then pages. */
function fakeBridge(total: number, width = 2, window = 10_000) {
  const columns = Array.from({ length: width }, (_, index) => ({ name: `c${index}`, type: index === 0 ? 'BIGINT' : 'TEXT' }));
  const row = (index: number) => Object.fromEntries(columns.map((column, at) => [column.name, at === 0 ? String(index) : 'x']));
  let served = Math.min(total, window);
  const closeRun = vi.fn(async () => ({ ok: true as const }));
  const db = {
    execute: vi.fn(async (): Promise<SqlDbRunResult> => ({
      status: total > window ? 'too-large' : 'success',
      engine: 'postgres',
      columns,
      rows: Array.from({ length: served }, (_, index) => row(index)),
      rowCount: served,
      tooLarge: total > window,
      rowCountIsLowerBound: total > window,
      hasMore: total > window,
      durationMs: 1,
    })),
    fetch: vi.fn(async (_runId: string, limit: number) => {
      const count = Math.min(limit, total - served);
      const rows = Array.from({ length: count }, (_, index) => row(served + index));
      served += count;
      return { rows, done: served >= total, bytes: count * 20 };
    }),
    closeRun,
    cancel: vi.fn(async () => ({ cancelled: true })),
  } as unknown as SqlDbBridge;
  return { db, closeRun };
}

afterEach(() => __setDuckDbEngineFactoryForTests(null));

const base = { connectionId: 'c_1', connectionName: 'orders-dev', sql: 'SELECT * FROM orders', table: 'orders_copy', timeoutMs: 1_000, now: () => new Date('2026-10-23T10:00:00Z') };

describe('copyConnectionResultToLocal', () => {
  it('creates the table, fills it in batches inside one transaction and records its origin', async () => {
    const { sql, files } = fakeEngine();
    const { db } = fakeBridge(120_000);
    const progress: number[] = [];
    const result = await copyConnectionResultToLocal({ ...base, db, onProgress: (rows) => progress.push(rows) });
    expect(result).toEqual({ rowCount: 120_000, truncated: false });
    expect(files).toEqual([COPY_BATCH_ROWS, COPY_BATCH_ROWS, 20_000]);
    expect(sql[0]).toBe('BEGIN TRANSACTION');
    expect(sql[1]).toBe('CREATE TABLE "orders_copy" ("c0" BIGINT, "c1" VARCHAR)');
    expect(sql.filter((statement) => statement.startsWith('INSERT INTO "orders_copy"'))).toHaveLength(3);
    expect(sql.at(-2)).toBe(`COMMENT ON TABLE "orders_copy" IS '{"kind":"lingua.copy","connection":"orders-dev","at":"2026-10-23T10:00:00.000Z"}'`);
    expect(sql.at(-1)).toBe('COMMIT');
    expect(progress.at(-1)).toBe(120_000);
  });

  it('closes a batch at its byte budget too, so wide rows never pile up', async () => {
    const { files } = fakeEngine();
    // Each fetched page reports 20 bytes a row; a 2-million-byte page means huge rows.
    const { db } = fakeBridge(60_000);
    const wide = db.fetch as ReturnType<typeof vi.fn>;
    const inner = wide.getMockImplementation()!;
    wide.mockImplementation(async (...args: unknown[]) => ({ ...(await inner(...args)), bytes: 20 * 1024 * 1024 }));
    await copyConnectionResultToLocal({ ...base, db });
    expect(files).toEqual([30_000, 20_000, 10_000]);
  });

  it('closes the open run the moment Cancel is pressed', async () => {
    fakeEngine();
    const { db, closeRun } = fakeBridge(30_000);
    const controller = new AbortController();
    (db.fetch as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      controller.abort();
      return new Promise(() => undefined);
    });
    void copyConnectionResultToLocal({ ...base, db, signal: controller.signal }).catch(() => undefined);
    await vi.waitFor(() => expect(closeRun).toHaveBeenCalled());
  });

  it('stops at the export cell cap and says the table holds the first rows', async () => {
    fakeEngine();
    // 100 columns: five million cells is fifty thousand rows.
    const { db } = fakeBridge(60_000, 100);
    expect(await copyConnectionResultToLocal({ ...base, db })).toEqual({ rowCount: 50_000, truncated: true });
  });

  it('rolls back and creates nothing when cancelled mid-copy', async () => {
    const { sql } = fakeEngine();
    const { db, closeRun } = fakeBridge(120_000);
    const controller = new AbortController();
    const copy = copyConnectionResultToLocal({ ...base, db, signal: controller.signal, onProgress: (rows) => rows >= 60_000 && controller.abort() });
    await expect(copy).rejects.toMatchObject({ cancelled: true });
    expect(sql).toContain('ROLLBACK');
    expect(sql).not.toContain('COMMIT');
    expect(closeRun).toHaveBeenCalled();
  });

  it('rolls back when a batch fails to cast, and passes the reason on', async () => {
    const { sql } = fakeEngine(/^INSERT INTO/);
    const { db } = fakeBridge(10);
    await expect(copyConnectionResultToLocal({ ...base, db })).rejects.toEqual(new CopyToLocalError('Conversion Error: could not convert'));
    expect(sql.at(-1)).toBe('ROLLBACK');
  });

  it('names the column whose value does not fit, and creates nothing', async () => {
    const { sql } = fakeEngine(undefined, 0);
    const { db } = fakeBridge(10);
    await expect(copyConnectionResultToLocal({ ...base, db })).rejects.toMatchObject({ value: { column: 'c0', type: 'BIGINT' }, cancelled: false });
    expect(sql.some((statement) => statement.startsWith('INSERT INTO'))).toBe(false);
    expect(sql.at(-1)).toBe('ROLLBACK');
  });

  it('refuses a result with two columns of one name, which rows cannot hold apart', async () => {
    const { sql } = fakeEngine();
    const { db, closeRun } = fakeBridge(10);
    (db.execute as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ status: 'success', engine: 'postgres', columns: [{ name: 'id', type: 'BIGINT' }, { name: 'id', type: 'BIGINT' }], rows: [{ id: '2' }], rowCount: 1, tooLarge: false, rowCountIsLowerBound: false, hasMore: true, durationMs: 1 });
    await expect(copyConnectionResultToLocal({ ...base, db })).rejects.toMatchObject({ repeated: 'id' });
    expect(sql).toEqual([]);
    expect(closeRun).toHaveBeenCalled();
  });

  it('copies nothing when the connection refuses the statement', async () => {
    const { sql } = fakeEngine();
    const db = { execute: vi.fn(async () => ({ status: 'sql-error', engine: 'postgres', columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false, durationMs: 1, errorMessage: 'permission denied for table orders' })) } as unknown as SqlDbBridge;
    await expect(copyConnectionResultToLocal({ ...base, db })).rejects.toEqual(new CopyToLocalError('permission denied for table orders'));
    expect(sql).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setDuckDbEngineFactoryForTests,
  mapArrowTable,
  type ArrowTableLike,
  type DuckDbEngineHandle,
} from '../../../src/renderer/runtime/duckdbClient';
import { SqlExportError, copyQueryToBytes, streamQueryRows } from '../../../src/renderer/runtime/duckdbExport';

const fields = [{ name: 'n', type: { toString: () => 'Int32' } }];
const batch = (from: number, size: number): ArrowTableLike => ({
  numRows: size,
  schema: { fields },
  toArray: () => Array.from({ length: size }, (_, i) => ({ n: from + i })),
});
const countTable = (count: bigint): ArrowTableLike => ({
  numRows: 1,
  schema: { fields: [{ name: 'Count', type: { toString: () => 'Int64' } }] },
  toArray: () => [{ Count: count }],
});

/** Files COPY writes into, the queries run and the files dropped. */
function copyEngine(fail = false) {
  const files = new Map<string, Uint8Array>();
  const queries: string[] = [];
  const dropped: string[] = [];
  const engine: DuckDbEngineHandle = {
    connect: async () => ({
      query: async (sql: string) => {
        queries.push(sql);
        if (fail) throw new Error('Binder Error: column "nope" not found');
        const name = /TO '([^']+)'/.exec(sql)?.[1];
        if (name) files.set(name, new TextEncoder().encode('n\n1\n2\n'));
        return mapArrowTable(countTable(2n));
      },
      stream: async (sql: string) => {
        queries.push(sql);
        if (fail) throw new Error('Binder Error: column "nope" not found');
        const name = /TO '([^']+)'/.exec(sql)?.[1];
        if (name) files.set(name, new TextEncoder().encode('n\n1\n2\n'));
        let sent = false;
        return {
          fields: () => countTable(2n).schema.fields,
          next: async () => {
            if (sent) return null;
            sent = true;
            return countTable(2n);
          },
        };
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
    registerEmptyFile: async (name) => {
      files.set(name, new Uint8Array());
    },
    readFile: async (name) => files.get(name) ?? new Uint8Array(),
    dropFile: async (name) => {
      dropped.push(name);
    },
  };
  __setDuckDbEngineFactoryForTests(() => Promise.resolve(engine));
  return { queries, dropped };
}

afterEach(() => {
  __setDuckDbEngineFactoryForTests(null);
});

describe('copyQueryToBytes', () => {
  it('copies the statement into a virtual file, returns its bytes and the row count, and drops the file', async () => {
    const { queries, dropped } = copyEngine();
    const out = await copyQueryToBytes('SELECT * FROM t -- note\n; -- trailing', 'FORMAT csv', 'csv');
    expect(new TextDecoder().decode(out.bytes)).toBe('n\n1\n2\n');
    expect(out.rowCount).toBe(2);
    expect(queries[0]).toMatch(/^COPY \(\nSELECT \* FROM t -- note\n\) TO 'lingua_export_[\w-]+\.csv' \(FORMAT csv\)$/);
    expect(dropped).toHaveLength(1);
    expect(queries[0]).toContain(dropped[0]);
  });

  it('throws what DuckDB reported and still drops the file', async () => {
    const { dropped } = copyEngine(true);
    const error = await copyQueryToBytes('SELECT nope', 'FORMAT parquet', 'parquet').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(SqlExportError);
    expect((error as SqlExportError).status).toBe('sql-error');
    expect((error as Error).message).toContain('column "nope" not found');
    expect(dropped).toHaveLength(1);
  });

  it('refuses an engine that cannot write files', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({ query: async () => mapArrowTable(countTable(0n)), close: async () => undefined }),
        terminate: async () => undefined,
      })
    );
    await expect(copyQueryToBytes('SELECT 1', 'FORMAT csv', 'csv')).rejects.toMatchObject({ status: 'unsupported' });
  });
});

describe('streamQueryRows', () => {
  function streamEngine(batches: number, size: number) {
    const state = { pulled: 0, cancelled: 0 };
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async () => mapArrowTable(batch(0, 0)),
          stream: async () => {
            let index = 0;
            return {
              fields: () => fields,
              next: async () => {
                if (index >= batches) return null;
                state.pulled += 1;
                index += 1;
                return batch((index - 1) * size, size);
              },
            };
          },
          cancel: async () => {
            state.cancelled += 1;
            return true;
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    return state;
  }

  it('reads past the row window to the end of the result, reporting progress', async () => {
    streamEngine(12, 2_048);
    const progress = vi.fn();
    const out = await streamQueryRows('SELECT n FROM r', { cap: 1_000_000, onProgress: progress });
    expect(out.rows).toHaveLength(12 * 2_048);
    expect(out.rows[24_575]).toEqual({ n: 24_575 });
    expect(out.truncated).toBe(false);
    expect(progress).toHaveBeenLastCalledWith(24_576);
  });

  it('stops at the cap, says so and releases the stream', async () => {
    const state = streamEngine(40, 2_048);
    const out = await streamQueryRows('SELECT n FROM r', { cap: 15_000 });
    expect(out.rows).toHaveLength(15_000);
    expect(out.truncated).toBe(true);
    expect(state.pulled).toBeLessThan(40);
    expect(state.cancelled).toBe(1);
  });

  it('stops when the export is cancelled', async () => {
    streamEngine(40, 2_048);
    const controller = new AbortController();
    const error = await streamQueryRows('SELECT n FROM r', {
      cap: 1_000_000,
      signal: controller.signal,
      onProgress: (rows) => {
        if (rows > 0) controller.abort();
      },
    }).catch((err: unknown) => err);
    expect(error).toMatchObject({ status: 'cancelled' });
  });
});

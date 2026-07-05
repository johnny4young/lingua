/**
 * RL-097 Slice 2 — duckdbClient tests with an injected mock engine.
 *
 * Exercises: happy path, sql-error classification, soft timeout via
 * Promise.race, too-large flag, engine-load-failed, multi-statement
 * counting, sanitiseRowForJson for BigInt + Date + nested values.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setDuckDbEngineFactoryForTests,
  __setResolvedSqlStorageModeForTests,
  applyDuckDbPersistence,
  clearPersistedSqlDatabase,
  configureDuckDbPersistence,
  countSqlStatements,
  estimateOriginStorageBytes,
  executeQuery,
  fetchRuntimeAssetWithRetry,
  getResolvedSqlStorageMode,
  getResolvedSqlStorageRequestMode,
  importFileAsTable,
  isOpfsStorageAvailable,
  mapArrowTable,
  previewImportFile,
  type ArrowTableLike,
  type DuckDbConnection,
  type DuckDbEngineHandle,
} from '../../../src/renderer/runtime/duckdbClient';
import {
  MAX_RESULT_PREVIEW_BYTES,
  MAX_RESULT_ROWS,
  OPFS_SQL_DB_PATH,
} from '../../../src/shared/sqlWorkspace';

function arrowTableFrom(
  columns: ReadonlyArray<{ name: string; type: string }>,
  rows: ReadonlyArray<Record<string, unknown>>
): ArrowTableLike {
  return {
    numRows: rows.length,
    schema: { fields: columns.map((c) => ({ name: c.name, type: { toString: () => c.type } })) },
    toArray: () => [...rows],
  };
}

function mockEngine(impl: (sql: string) => Promise<ArrowTableLike>): DuckDbEngineHandle {
  return {
    connect: async (): Promise<DuckDbConnection> => ({
      query: async (sql) => {
        const table = await impl(sql);
        return mapArrowTable(table);
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
}

afterEach(() => {
  __setDuckDbEngineFactoryForTests(null);
});

describe('fetchRuntimeAssetWithRetry — R2 runtime WASM fetch resilience', () => {
  const originalFetch = globalThis.fetch;
  const noSleep = (): Promise<void> => Promise.resolve();
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('retries a transient 5xx and returns the eventual 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(new Response(null, { status: 503, statusText: 'Service Unavailable' }))
      .mockResolvedValueOnce(new Response('wasm', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchRuntimeAssetWithRetry('https://mirror/duckdb.wasm', 3, 1, noSleep);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry a deterministic 4xx (Bot-Fight-Mode 403)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchRuntimeAssetWithRetry('https://mirror/duckdb.wasm', 3, 1, noSleep);
    expect(res.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a thrown network error, then succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response('wasm', { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchRuntimeAssetWithRetry('https://mirror/duckdb.wasm', 3, 1, noSleep);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns the last 5xx after exhausting retries (caller maps it to a load error)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503, statusText: 'Service Unavailable' }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const res = await fetchRuntimeAssetWithRetry('https://mirror/duckdb.wasm', 2, 1, noSleep);
    expect(res.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('throws the network error when every attempt rejects', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('offline'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      fetchRuntimeAssetWithRetry('https://mirror/duckdb.wasm', 2, 1, noSleep)
    ).rejects.toThrow(/offline/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('countSqlStatements', () => {
  it('counts single statements', () => {
    expect(countSqlStatements('SELECT 1')).toBe(1);
    expect(countSqlStatements('SELECT 1;')).toBe(1);
  });
  it('counts multi-statement input', () => {
    expect(countSqlStatements('SELECT 1; SELECT 2;')).toBe(2);
  });
  it('ignores semicolons inside string literals', () => {
    expect(countSqlStatements("SELECT ';' AS sep;")).toBe(1);
  });
  it('handles empty input', () => {
    expect(countSqlStatements('')).toBe(0);
  });
});

describe('mapArrowTable', () => {
  it('maps a small Arrow table to rows + columns', () => {
    const table = arrowTableFrom(
      [
        { name: 'id', type: 'INTEGER' },
        { name: 'name', type: 'VARCHAR' },
      ],
      [
        { id: 1, name: 'one' },
        { id: 2, name: 'two' },
      ]
    );
    const out = mapArrowTable(table);
    expect(out.rows).toHaveLength(2);
    expect(out.columns.map((c) => c.name)).toEqual(['id', 'name']);
    expect(out.rowCount).toBe(2);
    expect(out.tooLarge).toBe(false);
  });

  it('flags tooLarge when row count exceeds MAX_RESULT_ROWS', () => {
    const oversized = Array.from({ length: MAX_RESULT_ROWS + 1 }, (_, i) => ({ i }));
    const table = arrowTableFrom([{ name: 'i', type: 'INTEGER' }], oversized);
    const out = mapArrowTable(table);
    expect(out.rows.length).toBe(MAX_RESULT_ROWS);
    expect(out.rowCount).toBe(MAX_RESULT_ROWS + 1);
    expect(out.tooLarge).toBe(true);
  });

  it('serialises BigInt as string', () => {
    const table = arrowTableFrom(
      [{ name: 'big', type: 'BIGINT' }],
      [{ big: 9007199254740993n }]
    );
    const out = mapArrowTable(table);
    expect(out.rows[0]?.big).toBe('9007199254740993');
  });

  it('serialises Date as ISO string', () => {
    const date = new Date('2026-05-26T00:00:00.000Z');
    const table = arrowTableFrom([{ name: 'd', type: 'DATE' }], [{ d: date }]);
    const out = mapArrowTable(table);
    expect(out.rows[0]?.d).toBe('2026-05-26T00:00:00.000Z');
  });

  it('enforces the preview cap with UTF-8 bytes, not UTF-16 code units', () => {
    const row = { label: '界'.repeat(1024) };
    const rowUtf16Units = JSON.stringify(row).length;
    const rowUtf8Bytes = new TextEncoder().encode(JSON.stringify(row)).byteLength;
    const rowsThatFitByUtf16 = Math.floor(MAX_RESULT_PREVIEW_BYTES / rowUtf16Units);
    const rows = Array.from({ length: rowsThatFitByUtf16 }, () => row);

    expect(rowUtf8Bytes).toBeGreaterThan(rowUtf16Units);

    const out = mapArrowTable(
      arrowTableFrom([{ name: 'label', type: 'VARCHAR' }], rows)
    );

    expect(out.tooLarge).toBe(true);
    expect(out.rows.length).toBeLessThan(rowsThatFitByUtf16);
  });
});

describe('executeQuery', () => {
  it('returns success for a happy-path query', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        mockEngine(async () =>
          arrowTableFrom(
            [{ name: 'a', type: 'INTEGER' }],
            [{ a: 1 }, { a: 2 }]
          )
        )
      )
    );
    const outcome = await executeQuery('SELECT a FROM gen');
    expect(outcome.status).toBe('success');
    expect(outcome.rows).toHaveLength(2);
    expect(outcome.rowCount).toBe(2);
  });

  it('returns sql-error when the connection rejects', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async () => {
            throw new Error('syntax error');
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    const outcome = await executeQuery('NOT VALID SQL');
    expect(outcome.status).toBe('sql-error');
    expect(outcome.errorMessage).toContain('syntax error');
  });

  it('normalizes DuckDB-WASM internal rejection messages', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async () => {
            throw new ReferenceError('_setThrew is not defined');
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    const outcome = await executeQuery('SELEC 1;');
    expect(outcome.status).toBe('sql-error');
    expect(outcome.errorMessage).toBe(
      'DuckDB could not return the detailed SQL error. Check the query syntax, table names, and column names.'
    );
  });

  it('returns timeout when the query exceeds the soft timeout', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: () =>
            new Promise(() => {
              /* never resolves */
            }),
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    const outcome = await executeQuery('SELECT pg_sleep(60)', { timeoutMs: 50 });
    expect(outcome.status).toBe('timeout');
  });

  it('returns engine-load-failed when the engine factory rejects', async () => {
    __setDuckDbEngineFactoryForTests(() => Promise.reject(new Error('wasm 404')));
    const outcome = await executeQuery('SELECT 1');
    expect(outcome.status).toBe('engine-load-failed');
    expect(outcome.errorMessage).toContain('wasm 404');
  });

  it('returns too-large when the result exceeds MAX_RESULT_ROWS', async () => {
    const oversized = Array.from({ length: MAX_RESULT_ROWS + 5 }, (_, i) => ({ i }));
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        mockEngine(async () =>
          arrowTableFrom([{ name: 'i', type: 'INTEGER' }], oversized)
        )
      )
    );
    const outcome = await executeQuery('SELECT i FROM range(10005)');
    expect(outcome.status).toBe('too-large');
    expect(outcome.tooLarge).toBe(true);
    expect(outcome.rows.length).toBe(MAX_RESULT_ROWS);
  });

  it('returns empty success for whitespace-only input', async () => {
    const outcome = await executeQuery('   \n  ');
    expect(outcome.status).toBe('success');
    expect(outcome.rows).toEqual([]);
    expect(outcome.statementCount).toBe(0);
  });

  it('counts statementCount for multi-statement queries', async () => {
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        mockEngine(async () =>
          arrowTableFrom([{ name: 'a', type: 'INTEGER' }], [{ a: 1 }])
        )
      )
    );
    const outcome = await executeQuery('SELECT 1; SELECT 2; SELECT 3;');
    expect(outcome.statementCount).toBe(3);
  });
});

describe('OPFS persistence (RL-097 Slice 3)', () => {
  it('stays in-memory when persistence is off (no open call)', async () => {
    const open = vi.fn(async () => undefined);
    const mode = await applyDuckDbPersistence({ open }, false, true);
    expect(mode).toBe('memory');
    expect(open).not.toHaveBeenCalled();
  });

  it('stays in-memory when OPFS is unavailable (no open call)', async () => {
    const open = vi.fn(async () => undefined);
    const mode = await applyDuckDbPersistence({ open }, true, false);
    expect(mode).toBe('memory');
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the opfs database when persistence is on and OPFS available', async () => {
    const open = vi.fn(async () => undefined);
    const mode = await applyDuckDbPersistence({ open }, true, true);
    expect(mode).toBe('opfs');
    expect(open).toHaveBeenCalledTimes(1);
    const cfg = open.mock.calls[0]![0] as {
      path?: string;
      accessMode?: number;
      opfs?: { fileHandling?: string };
    };
    expect(cfg.path).toBe(OPFS_SQL_DB_PATH);
    expect(cfg.accessMode).toBe(3); // DuckDBAccessMode.READ_WRITE
    expect(cfg.opfs).toEqual({ fileHandling: 'auto' });
  });

  it('falls back to in-memory when the opfs open throws (cross-tab lock)', async () => {
    const open = vi
      .fn()
      .mockRejectedValueOnce(new Error('locked by another tab'))
      .mockResolvedValueOnce(undefined);
    const mode = await applyDuckDbPersistence({ open }, true, true);
    expect(mode).toBe('memory');
    // First call = opfs attempt; second = the defensive ':memory:' reopen.
    expect(open).toHaveBeenCalledTimes(2);
    const reopen = open.mock.calls[1]![0] as { path?: string };
    expect(reopen.path).toBe(':memory:');
  });

  it('isOpfsStorageAvailable is false in jsdom (no navigator.storage.getDirectory)', () => {
    expect(isOpfsStorageAvailable()).toBe(false);
  });

  it('estimateOriginStorageBytes returns null when the API is absent', async () => {
    expect(await estimateOriginStorageBytes()).toBeNull();
  });

  it('configureDuckDbPersistence does not flip the resolved mode by itself', () => {
    configureDuckDbPersistence(true);
    // Preference captured for the NEXT instantiate; nothing resolved yet.
    expect(getResolvedSqlStorageMode()).toBe('memory');
    expect(getResolvedSqlStorageRequestMode()).toBe('memory');
    configureDuckDbPersistence(false);
  });

  it('tracks the request that produced the resolved storage mode', () => {
    __setResolvedSqlStorageModeForTests('memory', 'opfs');
    expect(getResolvedSqlStorageMode()).toBe('memory');
    expect(getResolvedSqlStorageRequestMode()).toBe('opfs');
  });

  it('issues CHECKPOINT after a successful query when persistent (fold A)', async () => {
    const queries: string[] = [];
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async (sql: string) => {
            queries.push(sql);
            return { columns: [], rows: [], rowCount: 0, tooLarge: false };
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    // Force the resolved mode AFTER the factory set (which resets it).
    __setResolvedSqlStorageModeForTests('opfs');
    await executeQuery('CREATE TABLE t AS SELECT 1');
    expect(queries).toContain('CHECKPOINT');
  });

  it('does NOT issue CHECKPOINT when in-memory', async () => {
    const queries: string[] = [];
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => ({
          query: async (sql: string) => {
            queries.push(sql);
            return { columns: [], rows: [], rowCount: 0, tooLarge: false };
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    __setResolvedSqlStorageModeForTests('memory');
    await executeQuery('SELECT 1');
    expect(queries).not.toContain('CHECKPOINT');
  });

  it('clearPersistedSqlDatabase resolves without throwing when OPFS unavailable', async () => {
    await expect(clearPersistedSqlDatabase()).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// RL-097 (SQL import) — previewImportFile + importFileAsTable.
// ---------------------------------------------------------------------------

interface ImportEngineLog {
  registered: Array<{ name: string; bytes: Uint8Array }>;
  dropped: string[];
  queries: string[];
}

/**
 * A registerFile-capable mock engine. `respond` maps each SQL string to
 * an Arrow table; defaults to an empty result. Records register / drop /
 * query calls so the import tests can assert the file lifecycle.
 */
function importEngine(
  respond: (sql: string) => ArrowTableLike,
  log: ImportEngineLog
): DuckDbEngineHandle {
  return {
    registerFile: async (name, bytes) => {
      log.registered.push({ name, bytes });
    },
    dropFile: async (name) => {
      log.dropped.push(name);
    },
    connect: async (): Promise<DuckDbConnection> => ({
      query: async (sql) => {
        log.queries.push(sql);
        return mapArrowTable(respond(sql));
      },
      close: async () => undefined,
    }),
    terminate: async () => undefined,
  };
}

function emptyLog(): ImportEngineLog {
  return { registered: [], dropped: [], queries: [] };
}

describe('previewImportFile', () => {
  it('registers the file, reads a sample + count, then drops the file', async () => {
    const log = emptyLog();
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        importEngine((sql) => {
          if (/count\(\*\)/i.test(sql)) {
            return arrowTableFrom([{ name: 'n', type: 'BIGINT' }], [{ n: 42n }]);
          }
          return arrowTableFrom(
            [
              { name: 'id', type: 'INTEGER' },
              { name: 'name', type: 'VARCHAR' },
            ],
            [
              { id: 1, name: 'a' },
              { id: 2, name: 'b' },
            ]
          );
        }, log)
      )
    );
    const preview = await previewImportFile({
      fileName: 'data.csv',
      format: 'csv',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(preview.columns).toEqual(['id', 'name']);
    expect(preview.sampleRows).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
    // BIGINT count comes back stringified by mapArrowTable → parsed to 42.
    expect(preview.rowCount).toBe(42);
    expect(log.registered).toHaveLength(1);
    // The reader call uses read_csv_auto against the registered name.
    expect(log.queries.some((q) => q.includes('read_csv_auto'))).toBe(true);
    // The virtual file is dropped on settle — no leak after a preview.
    expect(log.dropped).toEqual([log.registered[0]!.name]);
  });

  it('uses read_json_auto / read_parquet for the matching format', async () => {
    for (const [format, reader] of [
      ['json', 'read_json_auto'],
      ['parquet', 'read_parquet'],
    ] as const) {
      const log = emptyLog();
      __setDuckDbEngineFactoryForTests(() =>
        Promise.resolve(
          importEngine((sql) => {
            if (/count\(\*\)/i.test(sql)) {
              return arrowTableFrom([{ name: 'n', type: 'BIGINT' }], [{ n: 1n }]);
            }
            return arrowTableFrom([{ name: 'a', type: 'INTEGER' }], [{ a: 1 }]);
          }, log)
        )
      );
      await previewImportFile({
        fileName: `x.${format}`,
        format,
        bytes: new Uint8Array([1]),
      });
      expect(log.queries.some((q) => q.includes(reader))).toBe(true);
    }
  });

  it('drops the file even when the read throws (malformed source)', async () => {
    const log = emptyLog();
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        registerFile: async (name: string, bytes: Uint8Array) => {
          log.registered.push({ name, bytes });
        },
        dropFile: async (name: string) => {
          log.dropped.push(name);
        },
        connect: async () => ({
          query: async () => {
            throw new Error('Invalid Input Error: malformed CSV');
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    await expect(
      previewImportFile({
        fileName: 'bad.csv',
        format: 'csv',
        bytes: new Uint8Array([1]),
      })
    ).rejects.toThrow(/malformed/);
    expect(log.registered).toHaveLength(1);
    expect(log.dropped).toEqual([log.registered[0]!.name]);
  });
});

describe('importFileAsTable', () => {
  it('CREATE TABLE with the (escaped) edited name, then counts + drops', async () => {
    const log = emptyLog();
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        importEngine((sql) => {
          if (/count\(\*\)/i.test(sql)) {
            return arrowTableFrom([{ name: 'n', type: 'BIGINT' }], [{ n: 7n }]);
          }
          // CREATE TABLE returns an empty result set.
          return arrowTableFrom([], []);
        }, log)
      )
    );
    const result = await importFileAsTable({
      fileName: 'Sales.csv',
      tableName: 'my_sales',
      format: 'csv',
      bytes: new Uint8Array([1, 2]),
    });
    expect(result).toEqual({ table: 'my_sales', rowCount: 7 });
    const createStmt = log.queries.find((q) => /CREATE TABLE/i.test(q));
    expect(createStmt).toContain('"my_sales"');
    expect(createStmt).toContain('read_csv_auto');
    expect(log.dropped).toEqual([log.registered[0]!.name]);
  });

  it('throws and creates no table when the DDL fails (file still dropped)', async () => {
    const log = emptyLog();
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        registerFile: async (name: string, bytes: Uint8Array) => {
          log.registered.push({ name, bytes });
        },
        dropFile: async (name: string) => {
          log.dropped.push(name);
        },
        connect: async () => ({
          query: async (sql: string) => {
            log.queries.push(sql);
            throw new Error('Conversion Error: malformed JSON');
          },
          close: async () => undefined,
        }),
        terminate: async () => undefined,
      })
    );
    await expect(
      importFileAsTable({
        fileName: 'bad.json',
        tableName: 'bad',
        format: 'json',
        bytes: new Uint8Array([1]),
      })
    ).rejects.toThrow(/malformed JSON/);
    // No count query ran — the CREATE failed first.
    expect(log.queries.filter((q) => /count\(\*\)/i.test(q))).toHaveLength(0);
    expect(log.dropped).toEqual([log.registered[0]!.name]);
  });

  it('issues a CHECKPOINT after a persistent import (fold A durability)', async () => {
    const log = emptyLog();
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve(
        importEngine((sql) => {
          if (/count\(\*\)/i.test(sql)) {
            return arrowTableFrom([{ name: 'n', type: 'BIGINT' }], [{ n: 1n }]);
          }
          return arrowTableFrom([], []);
        }, log)
      )
    );
    __setResolvedSqlStorageModeForTests('opfs');
    await importFileAsTable({
      fileName: 'x.csv',
      tableName: 't',
      format: 'csv',
      bytes: new Uint8Array([1]),
    });
    expect(log.queries).toContain('CHECKPOINT');
  });
});

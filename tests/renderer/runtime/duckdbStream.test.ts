import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CANCEL_SETTLE_MS,
  __setDuckDbEngineFactoryForTests,
  executeQuery,
  executeSqlScript,
  restartDuckDbEngine,
  getDuckDbEngine,
  readResultStream,
  type ArrowTableLike,
  type DuckDbConnection,
  type DuckDbResultStream,
} from '../../../src/renderer/runtime/duckdbClient';
import { MAX_RESULT_ROWS } from '../../../src/shared/sqlWorkspace';

const fields = [{ name: 'n', type: { toString: () => 'Int32' } }];

function batch(from: number, size: number): ArrowTableLike {
  return {
    numRows: size,
    schema: { fields },
    toArray: () => Array.from({ length: size }, (_, i) => ({ n: from + i })),
  };
}

/** A stream of `batches` batches of `size` rows; `pulled` counts the batches read. */
function stream(batches: number, size: number) {
  let index = 0;
  const state = { pulled: 0 };
  const result: DuckDbResultStream = {
    fields: () => fields,
    next: async () => {
      if (index >= batches) return null;
      state.pulled += 1;
      index += 1;
      return batch((index - 1) * size, size);
    },
  };
  return { result, state };
}

function engineWith(connection: Partial<DuckDbConnection>) {
  __setDuckDbEngineFactoryForTests(() =>
    Promise.resolve({
      connect: async () => ({
        query: async () => ({ columns: [], rows: [], rowCount: 0, tooLarge: false }),
        close: async () => undefined,
        ...connection,
      }),
      terminate: async () => undefined,
    })
  );
}

afterEach(() => {
  vi.useRealTimers();
  __setDuckDbEngineFactoryForTests(null);
});

describe('readResultStream', () => {
  it('reads every batch of a result that fits the window', async () => {
    const { result } = stream(3, 100);
    const cancel = vi.fn(async () => true);
    const out = await readResultStream(result, cancel);
    expect(out.rows).toHaveLength(300);
    expect(out).toMatchObject({ rowCount: 300, tooLarge: false, rowCountIsLowerBound: false });
    expect(cancel).not.toHaveBeenCalled();
  });

  it('stops at the row window, cancels the rest and reports a lower bound', async () => {
    const { result, state } = stream(1_000, 2_048);
    const cancel = vi.fn(async () => true);
    const out = await readResultStream(result, cancel);
    expect(out.rows).toHaveLength(MAX_RESULT_ROWS);
    expect(out.rowCountIsLowerBound).toBe(true);
    expect(out.rowCount).toBeGreaterThanOrEqual(MAX_RESULT_ROWS);
    expect(state.pulled).toBeLessThan(10);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('keeps a full window when the peek past it fails', async () => {
    let calls = 0;
    const failing: DuckDbResultStream = {
      fields: () => fields,
      next: async () => {
        calls += 1;
        // Five batches fill the window exactly, so only the peek can tell there is more.
        if (calls > 5) throw new Error('interrupted');
        return batch((calls - 1) * 2_000, 2_000);
      },
    };
    const out = await readResultStream(failing);
    expect(out.rows).toHaveLength(MAX_RESULT_ROWS);
    expect(out.rowCountIsLowerBound).toBe(true);
  });

  it('keeps the columns of an empty result', async () => {
    const out = await readResultStream(stream(0, 0).result);
    expect(out.columns).toEqual([{ name: 'n', type: 'Int32' }]);
    expect(out.rows).toEqual([]);
  });
});

describe('executeQuery streaming and cancel', () => {
  it('streams a single statement and marks a windowed total', async () => {
    const query = vi.fn();
    engineWith({ query, stream: async () => stream(1_000, 2_048).result, cancel: async () => true });
    const outcome = await executeQuery('SELECT * FROM range(100000000)');
    expect(outcome.status).toBe('too-large');
    expect(outcome.rowCountIsLowerBound).toBe(true);
    expect(query).not.toHaveBeenCalled();
  });

  it('keeps several statements on the query path', async () => {
    const stream = vi.fn();
    const query = vi.fn(async () => ({ columns: [], rows: [], rowCount: 0, tooLarge: false }));
    engineWith({ query, stream });
    await executeQuery('SELECT 1; SELECT 2;');
    expect(query).toHaveBeenCalledOnce();
    expect(stream).not.toHaveBeenCalled();
  });

  it('cancels a running query on abort and resolves cancelled', async () => {
    let release!: () => void;
    const cancel = vi.fn(async () => {
      release();
      return true;
    });
    engineWith({
      stream: async () => ({
        fields: () => fields,
        next: () => new Promise<null>((resolve) => (release = () => resolve(null))),
      }),
      cancel,
    });
    const controller = new AbortController();
    const pending = executeQuery('SELECT * FROM big', { signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const outcome = await pending;
    expect(outcome.status).toBe('cancelled');
    expect(outcome.stillRunning).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('reports a cancelled query that has not stopped after the settle window', async () => {
    vi.useFakeTimers();
    engineWith({
      stream: async () => ({ fields: () => fields, next: () => new Promise(() => {}) }),
      cancel: async () => true,
    });
    const controller = new AbortController();
    const pending = executeQuery('SELECT * FROM stuck', { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(CANCEL_SETTLE_MS);
    const outcome = await pending;
    expect(outcome).toMatchObject({ status: 'cancelled', stillRunning: true });
  });

  it('times out like a cancel: stops the statement and settles when DuckDB obeys', async () => {
    let release: () => void = () => {};
    const cancel = vi.fn(async () => {
      release();
      return true;
    });
    engineWith({
      stream: async () => ({
        fields: () => fields,
        next: () => new Promise<null>((resolve) => (release = () => resolve(null))),
      }),
      cancel,
    });
    const outcome = await executeQuery('SELECT * FROM big', { timeoutMs: 20 });
    expect(outcome.status).toBe('timeout');
    expect(outcome.stillRunning).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('does not wait on the close of a query DuckDB is still running', async () => {
    vi.useFakeTimers();
    engineWith({
      stream: async () => ({ fields: () => fields, next: () => new Promise(() => {}) }),
      cancel: async () => true,
      // A busy worker answers close only after the query ends.
      close: () => new Promise<void>(() => {}),
    });
    const controller = new AbortController();
    const pending = executeQuery('SELECT * FROM stuck', { signal: controller.signal });
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await vi.advanceTimersByTimeAsync(CANCEL_SETTLE_MS);
    await expect(pending).resolves.toMatchObject({ status: 'cancelled', stillRunning: true });
  });
});

describe('executeSqlScript', () => {
  it('runs every statement on one connection and stops at the first error', async () => {
    const connect = vi.fn();
    const ran: string[] = [];
    __setDuckDbEngineFactoryForTests(() =>
      Promise.resolve({
        connect: async () => {
          connect();
          return {
            query: async (sql: string) => {
              ran.push(sql);
              if (sql.startsWith('BAD')) throw new Error('Parser Error: syntax error');
              return { columns: [], rows: [], rowCount: 0, tooLarge: false };
            },
            close: async () => undefined,
          };
        },
        terminate: async () => undefined,
      })
    );
    const seen: number[] = [];
    const outcomes = await executeSqlScript(['CREATE TEMP TABLE t(a INT)', 'BAD', 'SELECT 1'], {
      onStatement: (index) => seen.push(index),
    });
    expect(connect).toHaveBeenCalledOnce();
    expect(ran).toEqual(['CREATE TEMP TABLE t(a INT)', 'BAD']);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['success', 'sql-error']);
    expect(seen).toEqual([0, 1]);
  });

  it('returns nothing for an empty script', async () => {
    expect(await executeSqlScript(['  ', ''])).toEqual([]);
  });
});

describe('restartDuckDbEngine', () => {
  it('terminates the engine so the next run boots a fresh one', async () => {
    const terminate = vi.fn(async () => undefined);
    const factory = vi.fn(() =>
      Promise.resolve({
        connect: async () => ({
          query: async () => ({ columns: [], rows: [], rowCount: 0, tooLarge: false }),
          close: async () => undefined,
        }),
        terminate,
      })
    );
    __setDuckDbEngineFactoryForTests(factory);
    await getDuckDbEngine();
    await restartDuckDbEngine();
    expect(terminate).toHaveBeenCalledOnce();
    await getDuckDbEngine();
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

describe('result cursor (Load more)', () => {
  it('keeps the stream open past the window and continues from the next row', async () => {
    const { result } = stream(10, 2_048);
    const cancel = vi.fn(async () => true);
    const release = vi.fn(async () => undefined);
    const out = await readResultStream(result, cancel, { keepOpen: release });
    expect(out.rows).toHaveLength(MAX_RESULT_ROWS);
    expect(out.cursor).toBeDefined();
    expect(cancel).not.toHaveBeenCalled();
    const more = await out.cursor!.next(1_000);
    expect(more.rows.map((row) => row.n)).toEqual(Array.from({ length: 1_000 }, (_, i) => MAX_RESULT_ROWS + i));
    expect(more.done).toBe(false);
  });

  it('reports done at the end and releases the connection once', async () => {
    const { result } = stream(5, 2_100);
    const cancel = vi.fn(async () => true);
    const release = vi.fn(async () => undefined);
    const out = await readResultStream(result, cancel, { keepOpen: release });
    const rest = await out.cursor!.next(5_000);
    expect(rest).toMatchObject({ done: true });
    expect(rest.rows).toHaveLength(5 * 2_100 - MAX_RESULT_ROWS);
    await out.cursor!.close();
    expect(release).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('holds the connection until the cursor closes, and only the last statement keeps one', async () => {
    const close = vi.fn(async () => undefined);
    engineWith({ stream: async () => stream(10, 2_048).result, cancel: async () => true, close });
    const outcome = await executeQuery('SELECT * FROM range(100000)', { keepCursor: true });
    expect(outcome.cursor).toBeDefined();
    expect(close).not.toHaveBeenCalled();
    await outcome.cursor!.close();
    expect(close).toHaveBeenCalledOnce();

    const scriptClose = vi.fn(async () => undefined);
    engineWith({ stream: async () => stream(10, 2_048).result, cancel: async () => true, close: scriptClose });
    const outcomes = await executeSqlScript(['SELECT * FROM a', 'SELECT * FROM b'], { keepCursor: true });
    expect(outcomes[0]?.cursor).toBeUndefined();
    expect(outcomes[1]?.cursor).toBeDefined();
    await outcomes[1]!.cursor!.close();
    expect(scriptClose).toHaveBeenCalledOnce();
  });

  it('closes a window that arrives after the run was cancelled', async () => {
    let releaseWindow: () => void = () => {};
    const close = vi.fn(async () => undefined);
    engineWith({
      stream: () =>
        new Promise<DuckDbResultStream>((resolve) => {
          releaseWindow = () => resolve(stream(10, 2_048).result);
        }),
      cancel: async () => {
        releaseWindow();
        return true;
      },
      close,
    });
    const controller = new AbortController();
    const pending = executeQuery('SELECT * FROM big', { keepCursor: true, signal: controller.signal });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    expect(await pending).toMatchObject({ status: 'cancelled' });
    await vi.waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  });
});

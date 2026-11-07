import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeRemoteScript, sqlDbBridge } from '../../../src/renderer/runtime/sqlRemote';
import i18next from 'i18next';
import { closedSqlResult, type SqlDbBridge, type SqlDbRunResult } from '../../../src/shared/sqlDb';

const base: SqlDbRunResult = {
  status: 'success',
  engine: 'postgres',
  columns: [{ name: 'n', type: 'INTEGER' }],
  rows: [{ n: 1 }],
  rowCount: 1,
  tooLarge: false,
  rowCountIsLowerBound: false,
  hasMore: false,
  durationMs: 3,
};

function bridge(results: SqlDbRunResult[], pages: Array<{ rows: Array<Record<string, unknown>>; done: boolean; bytes: number; errorMessage?: string; closed?: true }> = []) {
  const queue = [...results];
  const fetchQueue = [...pages];
  return {
    execute: vi.fn(async () => queue.shift() ?? base),
    fetch: vi.fn(async () => fetchQueue.shift() ?? { rows: [], done: true, bytes: 0 }),
    cancel: vi.fn(async () => ({ cancelled: true })),
    closeRun: vi.fn(async () => ({ ok: true })),
  } as unknown as SqlDbBridge & Record<'execute' | 'fetch' | 'cancel' | 'closeRun', ReturnType<typeof vi.fn>>;
}

afterEach(() => {
  delete (window as { lingua?: unknown }).lingua;
});

describe('sqlDbBridge', () => {
  it('is the desktop bridge, whose platform is the OS name, and the browser\'s own session-only bridge on web', async () => {
    const db = {} as SqlDbBridge;
    (window as { lingua?: unknown }).lingua = { platform: 'darwin', db };
    expect(sqlDbBridge()).toBe(db);
    (window as { lingua?: unknown }).lingua = { platform: 'win32', db };
    expect(sqlDbBridge()).toBe(db);
    (window as { lingua?: unknown }).lingua = { platform: 'web' };
    const web = sqlDbBridge();
    expect(web).not.toBe(db);
    expect(sqlDbBridge()).toBe(web);
    expect(await web!.catalog()).toMatchObject({ connections: [], adhoc: [], sessionOnly: true });
  });
});

describe('executeRemoteScript', () => {
  it('answers a write with one Count row, as Local does', async () => {
    const db = bridge([{ ...base, columns: [], rows: [], rowCount: 0, affectedRows: 10 }]);
    const [outcome] = await executeRemoteScript(db, 'c_1', ['UPDATE t SET a = 1'], { timeoutMs: 1_000 });
    expect(outcome).toMatchObject({ columns: [{ name: 'Count', type: 'BIGINT' }], rows: [{ Count: '10' }], rowCount: 1 });
  });

  it('stops at the first statement that fails and passes the typed name on every run', async () => {
    const db = bridge([base, { ...base, status: 'sql-error', columns: [], rows: [], errorMessage: 'boom' }, base]);
    const outcomes = await executeRemoteScript(db, 'c_1', ['SELECT 1', 'SELECT x', 'SELECT 3'], { timeoutMs: 1_000, confirmName: 'orders-prod' });
    expect(outcomes.map((o) => o.status)).toEqual(['success', 'sql-error']);
    expect(db.execute).toHaveBeenCalledTimes(2);
    expect(db.execute.mock.calls[0]?.[3]).toEqual({ timeoutMs: 1_000, readWrite: { confirmName: 'orders-prod' } });
  });

  it('keeps a cursor on the last statement and closes the others', async () => {
    const db = bridge([{ ...base, hasMore: true }, { ...base, hasMore: true }], [
      { rows: [{ n: 2 }], done: false, bytes: 8 },
      { rows: [], done: true, bytes: 0, errorMessage: 'connection lost' },
    ]);
    const outcomes = await executeRemoteScript(db, 'c_1', ['SELECT 1', 'SELECT 2'], { timeoutMs: 1_000, keepCursor: true });
    expect(db.closeRun).toHaveBeenCalledTimes(1);
    const cursor = outcomes[1]?.cursor;
    expect(await cursor?.next(100)).toMatchObject({ rows: [{ n: 2 }], done: false });
    // A failed read throws, and so does every read after it, so a partial result never passes for a whole one.
    await expect(cursor?.next(100)).rejects.toThrow('connection lost');
    await expect(cursor?.next(100)).rejects.toThrow('This result is closed or no longer available.');
  });

  it('reads past the end as empty, but a read after close throws', async () => {
    const open = async (pages: Parameters<typeof bridge>[1]) =>
      (await executeRemoteScript(bridge([{ ...base, hasMore: true }], pages), 'c_1', ['SELECT 1'], { timeoutMs: 1_000, keepCursor: true }))[0]!.cursor!;
    const finished = await open([{ rows: [{ n: 2 }], done: true, bytes: 8 }]);
    expect(await finished.next(100)).toMatchObject({ rows: [{ n: 2 }], done: true });
    expect(await finished.next(100)).toEqual({ rows: [], done: true, bytes: 0 });
    const stopped = await open([{ rows: [{ n: 2 }], done: false, bytes: 8 }]);
    await stopped.close();
    await expect(stopped.next(100)).rejects.toThrow('This result is closed or no longer available.');
  });

  it('shows a run the host already closed in the app language', async () => {
    await i18next.changeLanguage('es');
    try {
      const db = bridge([{ ...base, hasMore: true }], [closedSqlResult()]);
      const [outcome] = await executeRemoteScript(db, 'c_1', ['SELECT 1'], { timeoutMs: 1_000, keepCursor: true });
      await expect(outcome!.cursor!.next(100)).rejects.toThrow('Este resultado está cerrado o ya no está disponible.');
    } finally {
      await i18next.changeLanguage('en');
    }
  });

  it('cancels the running statement on abort and reports it as cancelled', async () => {
    const controller = new AbortController();
    const db = bridge([]);
    db.execute.mockImplementation(async () => {
      controller.abort();
      return { ...base, status: 'sql-error', columns: [], rows: [], errorMessage: 'canceling statement' };
    });
    const outcomes = await executeRemoteScript(db, 'c_1', ['SELECT pg_sleep(5)', 'SELECT 1'], { timeoutMs: 1_000, signal: controller.signal });
    expect(db.cancel).toHaveBeenCalledTimes(1);
    expect(outcomes.map((o) => o.status)).toEqual(['cancelled']);
  });
});

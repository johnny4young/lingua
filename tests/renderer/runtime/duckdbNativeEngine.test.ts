import { afterEach, describe, expect, it, vi } from 'vitest';
import { __setDuckDbEngineFactoryForTests, executeQuery, getDuckDbEngine, type DuckDbEngineHandle } from '../../../src/renderer/runtime/duckdbClient';
import { DuckDbEngineLifecycle } from '../../../src/renderer/runtime/duckdbEngineLifecycle';
import { openNativeEngine } from '../../../src/renderer/runtime/duckdbNativeEngine';
import type { SqlLocalBridge, SqlLocalReply } from '../../../src/shared/sqlLocal';

const ok = <T>(value: T): Promise<SqlLocalReply<T>> => Promise.resolve({ ok: true, value });

function bridge(overrides: Partial<SqlLocalBridge> = {}): SqlLocalBridge {
  return {
    status: async () => ({ available: true }),
    open: () => ok({ engineId: 'e1', storageMode: 'memory', version: 'v1.4.3', filesDir: '/data/files/1' }),
    connect: () => ok('c1'),
    query: () => ok({ columns: [{ name: 'n', type: 'Int32' }], rows: [{ n: 1 }], rowCount: 1, tooLarge: false }),
    stream: () => ok({ streamId: 's1', columns: [{ name: 'n', type: 'Int32' }] }),
    next: vi.fn().mockResolvedValueOnce({ ok: true, value: [{ n: 1 }, { n: 2 }] }).mockResolvedValue({ ok: true, value: null }),
    cancel: () => ok(true),
    closeConnection: () => ok(null),
    registerFile: () => ok(null),
    registerEmptyFile: () => ok(null),
    dropFile: () => ok(null),
    readFile: () => ok(new Uint8Array([1])),
    terminate: vi.fn(() => ok(null)),
    clearDatabase: () => ok(null),
    databaseBytes: () => ok(0),
    ...overrides,
  };
}

afterEach(() => __setDuckDbEngineFactoryForTests(null));

describe('native Local engine handle', () => {
  it('runs a streamed query through executeQuery and names files by absolute path', async () => {
    const native = await openNativeEngine(bridge(), false, () => undefined);
    expect(native.handle.filePath?.('lingua_import_1.csv')).toBe('/data/files/1/lingua_import_1.csv');
    __setDuckDbEngineFactoryForTests(async () => native.handle);
    const outcome = await executeQuery('SELECT n FROM t');
    expect(outcome).toMatchObject({ status: 'success', rows: [{ n: 1 }, { n: 2 }], rowCount: 2, columns: [{ name: 'n', type: 'Int32' }] });
  });

  it('surfaces DuckDB’s message as is and reports an engine that stopped', async () => {
    const gone = vi.fn();
    const native = await openNativeEngine(
      bridge({ stream: () => Promise.resolve({ ok: false, error: { message: 'The SQL engine stopped. Run the query again to start a new one.', code: 'engine-gone' } }) }),
      false,
      gone
    );
    __setDuckDbEngineFactoryForTests(async () => native.handle);
    const outcome = await executeQuery('SELECT 1');
    expect(outcome).toMatchObject({ status: 'sql-error', errorMessage: 'The SQL engine stopped. Run the query again to start a new one.' });
    expect(gone).toHaveBeenCalledWith(native.handle);
  });

  it('asks main to restart the process only for a forced stop', async () => {
    const terminate = vi.fn(() => ok(null));
    const native = await openNativeEngine(bridge({ terminate }), false, () => undefined);
    await native.handle.terminate();
    await native.handle.terminate({ force: true });
    expect(terminate.mock.calls).toEqual([
      ['e1', false],
      ['e1', true],
    ]);
  });
});

describe('engine lifecycle after a lost engine', () => {
  it('drops the lost generation so the next use starts a new one, and never a newer one', async () => {
    let made = 0;
    const lifecycle = new DuckDbEngineLifecycle<DuckDbEngineHandle>(async () => ({ id: ++made, connect: vi.fn(), terminate: vi.fn(async () => undefined) }) as unknown as DuckDbEngineHandle);
    const first = await lifecycle.get();
    await lifecycle.releaseIfCurrent(first);
    const second = await lifecycle.get();
    expect(second).not.toBe(first);
    await lifecycle.releaseIfCurrent(first);
    expect(await lifecycle.get()).toBe(second);
  });

  it('keeps executeQuery usable once a test factory swaps engines', async () => {
    __setDuckDbEngineFactoryForTests(async () => (await openNativeEngine(bridge(), false, () => undefined)).handle);
    expect(await getDuckDbEngine()).toBeDefined();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { openOwnedDuckDb } from '../../../src/renderer/runtime/duckdbPersistence';
import { DuckDbEngineLifecycle } from '../../../src/renderer/runtime/duckdbEngineLifecycle';

const missing = () => new DOMException('missing', 'NotFoundError');
function file(name: string, size: number): FileSystemFileHandle {
  return { kind: 'file', name, getFile: async () => new File([new Uint8Array(size)], name) } as FileSystemFileHandle;
}
function storage(files: Record<string, FileSystemFileHandle>) {
  const getFileHandle = vi.fn(async (name: string, options?: FileSystemGetFileOptions) => {
    if (files[name]) return files[name];
    if (!options?.create) throw missing();
    return (files[name] = file(name, 0));
  });
  const getDirectory = vi.fn(async () => ({ getFileHandle }) as unknown as FileSystemDirectoryHandle);
  return { getDirectory, getFileHandle };
}
function instance() {
  return {
    db: {
      open: vi.fn(async (_config: { path?: string }): Promise<void> => undefined),
      registerFileHandle: vi.fn(async (_name: string, _handle: FileSystemFileHandle, _protocol: number, _directIO: boolean): Promise<void> => undefined),
    },
    terminateWorker: vi.fn(),
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const options = { persist: true, protocol: 3, accessMode: 3 };

describe('owned persistent DuckDB startup', () => {
  it.each([false, true])('does no OPFS IO when persistence is %s and storage is unavailable', async persist => {
    const first = instance();
    const create = vi.fn(async () => first);

    const opened = await openOwnedDuckDb(create, { ...options, persist, storage: undefined });

    expect(opened.mode).toBe('memory');
    expect(opened.instance).toBe(first);
    expect(first.db.open).not.toHaveBeenCalled();
    expect(first.db.registerFileHandle).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('does not touch storage when persistence is off', async () => {
    const first = instance();
    const directory = storage({});

    const opened = await openOwnedDuckDb(async () => first, { ...options, persist: false, storage: directory });

    expect(opened.mode).toBe('memory');
    expect(directory.getDirectory).not.toHaveBeenCalled();
  });

  it.each([
    ['new database', {}],
    ['empty database', { 'lingua-sql.db': file('lingua-sql.db', 0) }],
    ['nonempty WAL', { 'lingua-sql.db': file('lingua-sql.db', 64), 'lingua-sql.db.wal': file('lingua-sql.db.wal', 32) }],
  ] as const)('leaves automatic handling unchanged for %s', async (_name, files) => {
    const first = instance();
    const directory = storage({ ...files });

    const opened = await openOwnedDuckDb(async () => first, { ...options, storage: directory });

    expect(opened.mode).toBe('opfs');
    expect(first.db.registerFileHandle).not.toHaveBeenCalled();
    expect(first.db.open).toHaveBeenCalledExactlyOnceWith({ path: 'opfs://lingua-sql.db', accessMode: 3, opfs: { fileHandling: 'auto' } });
    expect(directory.getFileHandle).not.toHaveBeenCalledWith('lingua-sql.db.wal', { create: true });
  });

  it.each([false, true])('registers the active DB and its %s empty WAL without touching staging', async existing => {
    const db = file('lingua-sql.db', 64);
    const wal = file('lingua-sql.db.wal', 0);
    const first = instance();
    const directory = storage({ 'lingua-sql.db': db, ...(existing ? { 'lingua-sql.db.wal': wal } : {}), 'lingua-sql.db.lingua-migrating': file('staging', 8) });

    const opened = await openOwnedDuckDb(async () => first, { ...options, storage: directory });

    expect(opened.mode).toBe('opfs');
    expect(first.db.registerFileHandle).toHaveBeenCalledTimes(2);
    expect(first.db.registerFileHandle).toHaveBeenNthCalledWith(1, 'opfs://lingua-sql.db', db, 3, true);
    expect(first.db.registerFileHandle.mock.calls[1]?.[0]).toBe('opfs://lingua-sql.db.wal');
    expect(directory.getFileHandle.mock.calls.map(([name]) => name)).not.toContain('lingua-sql.db.lingua-migrating');
    expect(first.terminateWorker).not.toHaveBeenCalled();
  });

  it.each(['NotAllowedError', 'QuotaExceededError', 'SecurityError'])('does not treat %s as absence or create files after it', async name => {
    const first = instance();
    const next = instance();
    const directory = storage({});
    directory.getFileHandle.mockRejectedValue(new DOMException('denied', name));
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const opened = await openOwnedDuckDb(create, { ...options, storage: directory });

    expect(opened.mode).toBe('memory');
    expect(opened.instance).toBe(next);
    // The reason stays diagnosable by name; the message, which can carry paths, does not leave.
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining('OPFS'), name);
    warn.mockRestore();
    expect(directory.getFileHandle).toHaveBeenCalledExactlyOnceWith('lingua-sql.db');
    expect(first.terminateWorker).toHaveBeenCalledTimes(1);
    expect(first.db.open).not.toHaveBeenCalled();
    expect(next.db.open).not.toHaveBeenCalled();
  });

  it.each([1, 2])('discards a worker when registration %i fails before falling back cleanly', async failure => {
    const first = instance();
    first.db.registerFileHandle.mockImplementation(async name => {
      if (name === (failure === 1 ? 'opfs://lingua-sql.db' : 'opfs://lingua-sql.db.wal')) throw new Error('registration failed');
    });
    const next = instance();
    const directory = storage({ 'lingua-sql.db': file('lingua-sql.db', 64) });
    const create = vi.fn().mockResolvedValueOnce(first).mockImplementationOnce(async () => {
      expect(first.terminateWorker).toHaveBeenCalledTimes(1);
      return next;
    });

    const opened = await openOwnedDuckDb(create, { ...options, storage: directory });

    expect(opened.mode).toBe('memory');
    expect(opened.instance).toBe(next);
    expect(first.db.open).not.toHaveBeenCalled();
    expect(next.db.open).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('discards registered handles when open fails, without reopening memory on that worker', async () => {
    const first = instance();
    first.db.open.mockRejectedValue(new Error('cross-tab lock'));
    const next = instance();
    const directory = storage({ 'lingua-sql.db': file('lingua-sql.db', 64) });
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);

    const opened = await openOwnedDuckDb(create, { ...options, storage: directory });

    expect(opened.mode).toBe('memory');
    expect(opened.instance).toBe(next);
    expect(first.db.open).toHaveBeenCalledTimes(1);
    expect(first.terminateWorker).toHaveBeenCalledTimes(1);
    expect(next.db.open).not.toHaveBeenCalled();
  });

  it('propagates a failed clean fallback without another persistence attempt', async () => {
    const first = instance();
    first.db.open.mockRejectedValue(new Error('locked'));
    const create = vi.fn().mockResolvedValueOnce(first).mockRejectedValueOnce(new Error('fallback instantiate'));

    await expect(openOwnedDuckDb(create, { ...options, storage: storage({}) })).rejects.toThrow('fallback instantiate');

    expect(first.terminateWorker).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('serializes release and the next generation while OPFS preparation is pending', async () => {
    const first = instance();
    const next = instance();
    const registration = deferred<void>();
    first.db.registerFileHandle.mockImplementationOnce(() => registration.promise);
    const directory = storage({ 'lingua-sql.db': file('lingua-sql.db', 64) });
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);
    const factory = async () => {
      const opened = await openOwnedDuckDb(create, { ...options, storage: directory });
      return { ...opened, terminate: async () => opened.instance.terminateWorker() };
    };
    const lifecycle = new DuckDbEngineLifecycle(factory);
    const loading = lifecycle.get();
    await vi.waitFor(() => expect(first.db.registerFileHandle).toHaveBeenCalledTimes(1));

    const releasing = lifecycle.release();
    const later = lifecycle.get();
    expect(create).toHaveBeenCalledTimes(1);
    registration.resolve();
    await loading;
    await releasing;
    const opened = await later;

    expect(first.terminateWorker).toHaveBeenCalledTimes(1);
    expect(opened.instance).toBe(next);
    await lifecycle.release();
    expect(next.terminateWorker).toHaveBeenCalledTimes(1);
  });

  it('preserves a WAL that gains content while the database handle is acquired', async () => {
    const files = { 'lingua-sql.db': file('lingua-sql.db', 64), 'lingua-sql.db.wal': file('lingua-sql.db.wal', 0) };
    const first = instance();
    first.db.registerFileHandle.mockImplementationOnce(async () => { files['lingua-sql.db.wal'] = file('lingua-sql.db.wal', 32); });
    const directory = storage(files);

    const opened = await openOwnedDuckDb(async () => first, { ...options, storage: directory });

    expect(opened.mode).toBe('opfs');
    expect(first.db.registerFileHandle).toHaveBeenCalledTimes(1);
    expect(directory.getFileHandle).not.toHaveBeenCalledWith('lingua-sql.db.wal', { create: true });
    expect((await files['lingua-sql.db.wal'].getFile()).size).toBe(32);
  });

  it('discards the attempted worker when inspecting the database bytes fails', async () => {
    const first = instance();
    const next = instance();
    const database = file('lingua-sql.db', 64);
    database.getFile = vi.fn().mockRejectedValue(new DOMException('unreadable', 'NotAllowedError'));
    const directory = storage({ 'lingua-sql.db': database });
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);

    const opened = await openOwnedDuckDb(create, { ...options, storage: directory });

    expect(opened.mode).toBe('memory');
    expect(opened.instance).toBe(next);
    expect(first.terminateWorker).toHaveBeenCalledTimes(1);
    expect(first.db.registerFileHandle).not.toHaveBeenCalled();
    expect(directory.getFileHandle).not.toHaveBeenCalledWith('lingua-sql.db.wal', { create: true });
  });

  it('propagates the initial instantiate failure without attempting a second instance', async () => {
    const create = vi.fn().mockRejectedValue(new Error('instantiate failed'));
    const directory = storage({});

    await expect(openOwnedDuckDb(create, { ...options, storage: directory })).rejects.toThrow('instantiate failed');

    expect(create).toHaveBeenCalledTimes(1);
    expect(directory.getDirectory).not.toHaveBeenCalled();
  });

  it('does not start fallback when terminating the failed worker itself fails', async () => {
    const first = instance();
    first.db.open.mockRejectedValue(new Error('open failed'));
    first.terminateWorker.mockImplementation(() => { throw new Error('termination failed'); });
    const create = vi.fn(async () => first);

    await expect(openOwnedDuckDb(create, { ...options, storage: storage({}) })).rejects.toThrow('termination failed');

    expect(create).toHaveBeenCalledTimes(1);
  });

});

describe('partial OPFS preparation failures', () => {
  it('discards a registered DB handle when the second WAL inspection fails', async () => {
    const first = instance();
    const next = instance();
    const directory = storage({ 'lingua-sql.db': file('lingua-sql.db', 64) });
    first.db.registerFileHandle.mockImplementationOnce(async () => {
      directory.getFileHandle.mockRejectedValue(new DOMException('locked after acquisition', 'NotAllowedError'));
    });
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);

    const opened = await openOwnedDuckDb(create, { ...options, storage: directory });

    expect(opened.mode).toBe('memory');
    expect(opened.instance).toBe(next);
    expect(first.db.registerFileHandle).toHaveBeenCalledTimes(1);
    expect(first.terminateWorker).toHaveBeenCalledTimes(1);
    expect(first.db.open).not.toHaveBeenCalled();
  });

  it('discards a registered DB handle when creating its WAL fails', async () => {
    const first = instance();
    const next = instance();
    const directory = storage({ 'lingua-sql.db': file('lingua-sql.db', 64) });
    const lookup = directory.getFileHandle.getMockImplementation()!;
    directory.getFileHandle.mockImplementation(async (name, config) => {
      if (config?.create) throw new DOMException('full', 'QuotaExceededError');
      return lookup(name, config);
    });
    const create = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(next);

    const opened = await openOwnedDuckDb(create, { ...options, storage: directory });

    expect(opened.mode).toBe('memory');
    expect(opened.instance).toBe(next);
    expect(first.db.registerFileHandle).toHaveBeenCalledTimes(1);
    expect(first.terminateWorker).toHaveBeenCalledTimes(1);
    expect(first.db.open).not.toHaveBeenCalled();
  });
});

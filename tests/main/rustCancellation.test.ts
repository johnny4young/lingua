import { EventEmitter } from 'node:events';
import { rmSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), spawn: vi.fn(), write: vi.fn(), rm: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../../src/main/runners/spawnNativeRun', () => ({ spawnNativeRun: mocks.spawn }));
vi.mock('node:fs/promises', () => { const fs = { writeFile: mocks.write, rm: mocks.rm }; return { ...fs, default: fs }; });
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFile = Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: vi.fn().mockResolvedValue({ stdout: 'rustc fixture', stderr: '' }) });
  return { ...actual, default: { ...actual, execFile }, execFile };
});

const ok = { stdout: '', stderr: '', exitCode: 0, executionTime: 1, timedOut: false, killed: false };
function owner() { return Object.assign(new EventEmitter(), { isDestroyed: () => false }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
// Exercise the actual IPC boundary; malformed payloads are deliberately unknown.
function handler(channel: string) { return mocks.handle.mock.calls.find(c => c[0] === channel)?.[1]; }

afterEach(() => {
  for (const [dir] of mocks.rm.mock.calls) rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.spawn.mockReset().mockResolvedValue(ok);
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.rm.mockReset().mockResolvedValue(undefined);
  const { registerRustHandlers } = await import('../../src/main/rust-compiler');
  registerRustHandlers();
});

describe('Rust cancellation owns every preparation phase', () => {
  it.each([0, 1, 2])('stops phase %i and never starts the next subprocess', async phase => {
    const held = deferred<typeof ok>();
    for (let i = 0; i < phase; i++) mocks.spawn.mockResolvedValueOnce(ok);
    mocks.spawn.mockImplementationOnce(() => held.promise);
    const sender = owner();
    const run = handler('rust:run')({ sender }, 'fn main() {}', {}, undefined, 'a');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(phase + 1));
    const signal = mocks.spawn.mock.calls[phase]![0].signal as AbortSignal;
    expect(await handler('rust:stop')({ sender }, 'a')).toEqual({ stopped: true });
    expect(signal.aborted).toBe(true);
    held.resolve(ok); // Even a late success cannot escape cancellation.
    expect(await run).toMatchObject({ success: false, kind: 'stopped' });
    expect(mocks.spawn).toHaveBeenCalledTimes(phase + 1);
    if (phase) expect(mocks.rm).toHaveBeenCalledWith(expect.stringMatching(/lingua-rust-[^/\\]+$/), { recursive: true, force: true });
  });

  it('rejects duplicate IDs and a foreign sender cannot stop the owner', async () => {
    const held = deferred<typeof ok>();
    mocks.spawn.mockReturnValueOnce(held.promise);
    const sender = owner();
    const run = handler('rust:run')({ sender }, 'fn main() {}', {}, undefined, 'same');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    expect(await handler('rust:run')({ sender }, 'fn main() {}', {}, undefined, 'same')).toMatchObject({ success: false, kind: 'error' });
    expect(await handler('rust:stop')({ sender: owner() }, 'same')).toEqual({ stopped: false });
    expect(mocks.spawn.mock.calls[0]![0].signal.aborted).toBe(false);
    sender.emit('destroyed');
    held.resolve(ok);
    expect(await run).toMatchObject({ kind: 'stopped' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
  });

  it('stops while staging source and removes its private directory', async () => {
    const held = deferred<void>();
    mocks.write.mockReturnValueOnce(held.promise);
    const sender = owner();
    const run = handler('rust:run')({ sender }, 'fn main() {}', {}, undefined, 'a');
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    await handler('rust:stop')({ sender }, 'a');
    held.resolve();
    expect(await run).toMatchObject({ kind: 'stopped' });
    expect(mocks.spawn).toHaveBeenCalledOnce();
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it('stops before staging when toolchain detection resolves late', async () => {
    const held = deferred<typeof ok>();
    mocks.spawn.mockReturnValueOnce(held.promise);
    const sender = owner();
    const run = handler('rust:run')({ sender }, 'fn main() {}', {}, undefined, 'a');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    await handler('rust:stop')({ sender }, 'a');
    held.resolve(ok);
    expect(await run).toMatchObject({ kind: 'stopped' });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.rm).not.toHaveBeenCalled();
  });

  it.each([
    [{ SECRET: 42 }, undefined, 'run'],
    [[], undefined, 'run'],
    [{}, { stdoutTruncated: false }, 'run'],
    [{}, undefined, ''],
    [{}, undefined, {}],
  ])('rejects malformed options before effects: %j', async (env, messages, runId) => {
    expect(await handler('rust:run')({ sender: owner() }, 'fn main() {}', env, messages, runId))
      .toMatchObject({ kind: 'error' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('owner loss aborts a standalone settings detector as well', async () => {
    const held = deferred<typeof ok>();
    mocks.spawn.mockReturnValueOnce(held.promise);
    const sender = owner();
    const probe = handler('rust:detect')({ sender }, {});
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    sender.emit('destroyed');
    expect(mocks.spawn.mock.calls[0]![0].signal.aborted).toBe(true);
    held.resolve(ok);
    expect(await probe).toMatchObject({ installed: false });
  });

  it.each([null, {}, 123])('rejects malformed source %j before effects', async source => {
    expect(await handler('rust:run')({ sender: owner() }, source)).toMatchObject({ success: false, kind: 'error' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])('reports timeout in phase %i instead of ordinary exit failure', async phase => {
    for (let i = 0; i < phase; i++) mocks.spawn.mockResolvedValueOnce(ok);
    mocks.spawn.mockResolvedValueOnce({ ...ok, timedOut: true, exitCode: -1 });
    const result = await handler('rust:run')({ sender: owner() }, 'fn main() {}', {});
    expect(result).toMatchObject({ kind: 'timeout', success: false, timeoutMs: [5000, 60000, 30000][phase] });
    expect(mocks.spawn).toHaveBeenCalledTimes(phase + 1);
  });
});

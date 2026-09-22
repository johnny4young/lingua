import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handle: vi.fn(), spawn: vi.fn(), write: vi.fn(), mkdir: vi.fn(), rm: vi.fn(), stat: vi.fn(), read: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: mocks.handle } }));
vi.mock('../../src/main/runners/spawnNativeRun', () => ({ spawnNativeRun: mocks.spawn }));
vi.mock('node:fs/promises', () => { const fs = { writeFile: mocks.write, mkdtemp: mocks.mkdir, rm: mocks.rm, stat: mocks.stat, readFile: mocks.read }; return { ...fs, default: fs }; });
vi.mock('node:child_process', async importOriginal => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const execFile = Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: vi.fn().mockResolvedValue({ stdout: 'goc fixture', stderr: '' }) });
  return { ...actual, default: { ...actual, execFile }, execFile };
});

const ok = { stdout: '/fixture/go', stderr: '', exitCode: 0, executionTime: 1, timedOut: false, killed: false };
function owner() { return Object.assign(new EventEmitter(), { isDestroyed: () => false }); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
// Exercise the actual IPC boundary; malformed payloads are deliberately unknown.
function handler(channel: string) { return mocks.handle.mock.calls.find(c => c[0] === channel)?.[1]; }

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.spawn.mockReset().mockResolvedValue(ok);
  mocks.write.mockReset().mockResolvedValue(undefined);
  mocks.mkdir.mockReset().mockResolvedValue('/tmp/lingua-go-fixture');
  mocks.rm.mockReset().mockResolvedValue(undefined);
  mocks.stat.mockReset().mockResolvedValue({ size: 8 });
  mocks.read.mockReset().mockImplementation(async (_path, encoding) => encoding ? 'wasm runtime' : Buffer.from([0, 97, 115, 109]));
  const { registerGoHandlers } = await import('../../src/main/go-compiler');
  registerGoHandlers();
});

describe('Go cancellation owns every preparation phase', () => {
  it.each([0, 1, 2])('stops phase %i and never starts the next subprocess', async phase => {
    const held = deferred<typeof ok>();
    for (let i = 0; i < phase; i++) mocks.spawn.mockResolvedValueOnce(ok);
    mocks.spawn.mockImplementationOnce(() => held.promise);
    const sender = owner();
    const run = handler('go:compile')({ sender }, 'package main\nfunc main() {}', {}, undefined, 'a');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(phase + 1));
    const signal = mocks.spawn.mock.calls[phase]![0].signal as AbortSignal;
    expect(await handler('go:stop')({ sender }, 'a')).toEqual({ stopped: true });
    expect(signal.aborted).toBe(true);
    held.resolve(ok); // Even a late success cannot escape cancellation.
    expect(await run).toMatchObject({ success: false, kind: 'stopped' });
    expect(mocks.spawn).toHaveBeenCalledTimes(phase + 1);
    if (phase === 2) expect(mocks.rm).toHaveBeenCalledWith('/tmp/lingua-go-fixture', { recursive: true, force: true });
  });

  it('rejects duplicate IDs and a foreign sender cannot stop the owner', async () => {
    const held = deferred<typeof ok>();
    mocks.spawn.mockReturnValueOnce(held.promise);
    const sender = owner();
    const run = handler('go:compile')({ sender }, 'package main\nfunc main() {}', {}, undefined, 'same');
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    expect(await handler('go:compile')({ sender }, 'package main\nfunc main() {}', {}, undefined, 'same')).toMatchObject({ success: false, kind: 'error' });
    expect(await handler('go:stop')({ sender: owner() }, 'same')).toEqual({ stopped: false });
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
    const run = handler('go:compile')({ sender }, 'package main\nfunc main() {}', {}, undefined, 'a');
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalledOnce());
    await handler('go:stop')({ sender }, 'a');
    held.resolve();
    expect(await run).toMatchObject({ kind: 'stopped' });
    expect(mocks.spawn).toHaveBeenCalledTimes(2);
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it('stops while allocating the directory without writing cancelled source', async () => {
    const held = deferred<string>();
    mocks.mkdir.mockReturnValueOnce(held.promise);
    const sender = owner();
    const run = handler('go:compile')({ sender }, 'package main\nfunc main() {}', {}, undefined, 'a');
    await vi.waitFor(() => expect(mocks.mkdir).toHaveBeenCalledOnce());
    await handler('go:stop')({ sender }, 'a');
    held.resolve('/tmp/lingua-go-fixture');
    expect(await run).toMatchObject({ kind: 'stopped' });
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it.each([
    [{ SECRET: 42 }, undefined, 'run'],
    [[], undefined, 'run'],
    [{}, { stdoutTruncated: false }, 'run'],
    [{}, undefined, ''],
    [{}, undefined, {}],
  ])('rejects malformed options before effects: %j', async (env, messages, runId) => {
    expect(await handler('go:compile')({ sender: owner() }, 'package main\nfunc main() {}', env, messages, runId))
      .toMatchObject({ kind: 'error' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
  });

  it('owner loss aborts a standalone settings detector as well', async () => {
    const held = deferred<typeof ok>();
    mocks.spawn.mockReturnValueOnce(held.promise);
    const sender = owner();
    const probe = handler('go:detect')({ sender }, {});
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    sender.emit('destroyed');
    expect(mocks.spawn.mock.calls[0]![0].signal.aborted).toBe(true);
    held.resolve(ok);
    expect(await probe).toMatchObject({ installed: false });
  });

  it.each(['stat', 'wasm', 'runtime'] as const)('does not return an executable artifact after Stop during %s read', async phase => {
    const held = deferred<unknown>();
    if (phase === 'stat') mocks.stat.mockReturnValueOnce(held.promise);
    else {
      if (phase === 'runtime') mocks.read.mockResolvedValueOnce(Buffer.from([0, 97, 115, 109]));
      mocks.read.mockReturnValueOnce(held.promise);
    }
    const sender = owner();
    const run = handler('go:compile')({ sender }, 'package main', {}, undefined, 'a');
    if (phase === 'stat') await vi.waitFor(() => expect(mocks.stat).toHaveBeenCalledOnce());
    else await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(phase === 'runtime' ? 2 : 1));
    await handler('go:stop')({ sender }, 'a');
    held.resolve(phase === 'stat' ? { size: 8 } : phase === 'runtime' ? 'runtime' : Buffer.from([0]));
    const result = await run;
    expect(result).toMatchObject({ kind: 'stopped' });
    expect(result.wasmBytes).toBeUndefined();
    expect(mocks.read).toHaveBeenCalledTimes(phase === 'stat' ? 0 : phase === 'runtime' ? 2 : 1);
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it('retains a typed WASM payload and runner-owned build target on success', async () => {
    const result = await handler('go:compile')({ sender: owner() }, 'package main', { GOOS: 'linux', GOARCH: 'amd64' });
    expect(result).toMatchObject({ success: true, kind: 'success', wasmExecJs: 'wasm runtime' });
    expect(result.wasmBytes).toBeInstanceOf(Uint8Array);
    expect([...result.wasmBytes]).toEqual([0, 97, 115, 109]);
    expect(mocks.spawn.mock.calls[2]![0]).toMatchObject({ command: 'go', args: ['build', '-o', '/tmp/lingua-go-fixture/main.wasm', '.'], env: { GOOS: 'js', GOARCH: 'wasm' } });
  });

  it('rejects oversized WASM before reading its bytes', async () => {
    mocks.stat.mockResolvedValueOnce({ size: 10 * 1024 * 1024 + 1 });
    expect(await handler('go:compile')({ sender: owner() }, 'package main', {})).toMatchObject({ kind: 'error' });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.rm).toHaveBeenCalledOnce();
  });

  it.each([null, {}, 123])('rejects malformed source %j before effects', async source => {
    expect(await handler('go:compile')({ sender: owner() }, source)).toMatchObject({ success: false, kind: 'error' });
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(mocks.mkdir).not.toHaveBeenCalled();
  });

  it.each([0, 1, 2])('reports timeout in phase %i instead of ordinary exit failure', async phase => {
    for (let i = 0; i < phase; i++) mocks.spawn.mockResolvedValueOnce(ok);
    mocks.spawn.mockResolvedValueOnce({ ...ok, timedOut: true, exitCode: -1 });
    const result = await handler('go:compile')({ sender: owner() }, 'package main\nfunc main() {}', {});
    expect(result).toMatchObject({ kind: 'timeout', success: false, timeoutMs: [5000, 5000, 30000][phase] });
    expect(mocks.spawn).toHaveBeenCalledTimes(phase + 1);
  });
});

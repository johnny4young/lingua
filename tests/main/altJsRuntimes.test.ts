import { EventEmitter } from 'node:events';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, unknown>();
  const execFileAsync = vi.fn();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsync,
  });
  return {
    handlers,
    execFile,
    execFileAsync,
    spawn: vi.fn(),
    writeFile: vi.fn(),
    probeSignals: [] as AbortSignal[],
  };
});

vi.mock('../../src/main/runners/spawnNativeRun', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/main/runners/spawnNativeRun')>();
  const { mockNativeVersionProbe } = await import('../utils/mockNativeVersionProbe');
  return {
    ...actual,
    spawnNativeRun: mockNativeVersionProbe(
      actual.spawnNativeRun,
      (command, args, options) => mocks.execFileAsync(command, args, options),
      signal => {
        if (signal) mocks.probeSignals.push(signal);
      }
    ),
  };
});

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mocked = { ...actual, writeFile: (...args: Parameters<typeof actual.writeFile>) => mocks.writeFile(...args) };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('node:child_process', () => ({
  default: { execFile: mocks.execFile, spawn: mocks.spawn },
  execFile: mocks.execFile,
  spawn: mocks.spawn,
}));

function createChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { on: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
    kill: ReturnType<typeof vi.fn>;
    pid?: number;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = { on: vi.fn(), end: vi.fn(), write: vi.fn() };
  child.kill = vi.fn(() => true);
  return child;
}

type RunHandler = (event: unknown, source: unknown, options?: unknown) => Promise<{ kind: string; stdout: string }>;
type DetectHandler = (event: unknown, userEnv?: unknown, force?: unknown) => Promise<{ installed: boolean; version?: string }>;

function handlerFor<T>(channel: string): T {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler ${channel}`);
  return handler as T;
}

describe('implementation: Deno & Bun runtimes', () => {
  beforeEach(async () => {
    vi.resetModules();
    mocks.handlers.clear();
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mocks.writeFile.mockReset().mockImplementation(actualFs.writeFile);
    mocks.execFile.mockReset();
    mocks.execFileAsync.mockReset();
    mocks.probeSignals.length = 0;
    mocks.spawn.mockReset();
  });

  afterEach(async () => {
    const mod = await import('../../src/main/altJsRuntimes');
    mod._resetAltRuntimesForTests();
  });

  it.each(['deno', 'bun'])('%s owns Stop during detection and never spawns cancelled source', async id => {
    let complete!: (value: { stdout: string; stderr: string }) => void;
    mocks.execFileAsync.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    mocks.spawn.mockImplementation(() => { throw new Error('Unexpected child spawn'); });
    const { registerAltJsRuntimeHandlers, stopAltRun } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const pending = handlerFor<RunHandler>(`${id}:run`)({}, 'console.log("cancelled")', { runId: 'preparing' });
    await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
    const stopped = stopAltRun('preparing');
    expect(mocks.probeSignals).toHaveLength(1);
    expect(mocks.probeSignals[0]?.aborted).toBe(true);
    complete({ stdout: '1.0.0', stderr: '' });
    const result = await pending;
    expect(stopped).toEqual({ stopped: true });
    expect(result.kind).toBe('stopped');
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(stopAltRun('preparing')).toEqual({ stopped: false });
  });

  it.each(['deno', 'bun'])('%s rejects a duplicate live identity without losing its Stop owner', async id => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '1.0.0', stderr: '' });
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerAltJsRuntimeHandlers, stopAltRun } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const run = handlerFor<RunHandler>(`${id}:run`);
    const first = run({}, 'setInterval(() => {}, 1000)', { runId: 'owned' });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
    const duplicate = await run({}, 'console.log("duplicate")', { runId: 'owned' });
    const stopped = stopAltRun('owned');
    child.emit('close', null);
    const result = await first;
    expect(duplicate.kind).toBe('error');
    expect(stopped).toEqual({ stopped: true });
    expect(result.kind).toBe('stopped');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['deno', false], ['deno', true], ['bun', false], ['bun', true],
  ] as const)('%s cleans cancelled staging (write fails: %s) without losing the next owner', async (id, fails) => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '1.0.0', stderr: '' });
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const { writeFile: realWrite } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let stagedPath: string | undefined;
    mocks.writeFile.mockImplementationOnce(async (...args: Parameters<typeof realWrite>) => {
      stagedPath = String(args[0]);
      await held;
      if (fails) throw new Error('staging failed');
      await realWrite(...args);
    });
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerAltJsRuntimeHandlers, stopAltRun } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const run = handlerFor<RunHandler>(`${id}:run`);
    const old = run({}, 'console.log("cancelled")', { runId: 'staging' });
    try {
      await vi.waitFor(() => expect(stagedPath).toBeTypeOf('string'));
      expect(stopAltRun('staging')).toEqual({ stopped: true });
      const current = run({}, 'setInterval(() => {}, 1000)', { runId: 'current' });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      release();
      await expect(old).resolves.toMatchObject({ kind: 'stopped' });
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      await expect(fsPromises.access(path.dirname(stagedPath!))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(stopAltRun('current')).toEqual({ stopped: true });
      child.emit('close', null);
      await expect(current).resolves.toMatchObject({ kind: 'stopped' });
    } finally {
      release();
      child.emit('close', null);
      mocks.writeFile.mockImplementation(realWrite);
    }
  });

  it('registers detect/run/stop handlers for both runtimes', async () => {
    const { registerAltJsRuntimeHandlers } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    for (const id of ['deno', 'bun']) {
      expect(mocks.handlers.get(`${id}:detect`)).toBeTypeOf('function');
      expect(mocks.handlers.get(`${id}:run`)).toBeTypeOf('function');
      expect(mocks.handlers.get(`${id}:stop`)).toBeTypeOf('function');
    }
  });

  it('detects a runtime version', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'deno 2.1.4 (release)\n', stderr: '' });
    const { registerAltJsRuntimeHandlers } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const detect = handlerFor<DetectHandler>('deno:detect');
    await expect(detect({}, undefined, true)).resolves.toMatchObject({ installed: true, version: 'deno 2.1.4 (release)' });
  });

  it('reports missing-binary when detection throws', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('spawn deno ENOENT'));
    const { registerAltJsRuntimeHandlers } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const run = handlerFor<RunHandler>('bun:run');
    await expect(run({}, 'console.log(1)', { timeoutMs: 5_000 })).resolves.toMatchObject({
      kind: 'missing-binary',
    });
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('sandboxes Deno to the temp dir and runs TypeScript directly', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'deno 2.1.4\n', stderr: '' });
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerAltJsRuntimeHandlers } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const run = handlerFor<RunHandler>('deno:run');
    const promise = run({}, 'const x: number = 2; console.log(x)', {
      runId: 'd1',
      language: 'typescript',
      timeoutMs: 5_000,
    });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    const [binary, args] = mocks.spawn.mock.calls[0]!;
    expect(binary).toBe('deno');
    expect(args[0]).toBe('run');
    expect(args.some((a: string) => a.startsWith('--allow-read='))).toBe(true);
    expect(args[args.length - 1]).toMatch(/entry\.ts$/);
    child.stdout.emit('data', Buffer.from('2\n'));
    child.emit('close', 0);
    await expect(promise).resolves.toMatchObject({ kind: 'success', stdout: '2\n' });
  });

  it('runs Bun with run <file> and surfaces non-zero exits as errors', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '1.1.30\n', stderr: '' });
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerAltJsRuntimeHandlers } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const run = handlerFor<RunHandler>('bun:run');
    const promise = run({}, 'throw new Error("boom")', { runId: 'b1', timeoutMs: 5_000 });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    const [binary, args] = mocks.spawn.mock.calls[0]!;
    expect(binary).toBe('bun');
    expect(args[0]).toBe('run');
    child.stderr.emit('data', Buffer.from('boom\n'));
    child.emit('close', 1);
    await expect(promise).resolves.toMatchObject({ kind: 'error', exitCode: 1 });
  });

  it('maps synchronous spawn throws to an error result instead of rejecting IPC', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'deno 2\n', stderr: '' });
    mocks.spawn.mockImplementation(() => {
      throw new TypeError('bad spawn options');
    });
    const { registerAltJsRuntimeHandlers } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const run = handlerFor<RunHandler>('deno:run');
    await expect(run({}, 'console.log(1)', { timeoutMs: 5_000 })).resolves.toMatchObject({
      kind: 'error',
      stderr: 'bad spawn options',
      error: 'bad spawn options',
    });
  });

  it.each(['deno', 'bun'])('%s kills remaining descendants when a stopped parent closes early', async id => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '1.0.0', stderr: '' });
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerAltJsRuntimeHandlers, stopAltRun } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const pending = handlerFor<RunHandler>(`${id}:run`)({}, 'source', { runId: 'early-close' });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    expect(stopAltRun('early-close')).toEqual({ stopped: true });
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    const signalsBeforeClose = child.kill.mock.calls.length;
    child.emit('close', null);
    expect(child.kill).toHaveBeenCalledTimes(signalsBeforeClose + 1);
    await expect(pending).resolves.toMatchObject({ kind: 'stopped' });
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
    expect(stopAltRun('early-close')).toEqual({ stopped: false });
  });

  it.each(['deno', 'bun'])('%s kills remaining descendants when a timed-out parent closes early', async id => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '1.0.0', stderr: '' });
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerAltJsRuntimeHandlers } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const pending = handlerFor<RunHandler>(`${id}:run`)({}, 'source', { runId: 'early-timeout', timeoutMs: 1000 });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(child.kill).toHaveBeenCalledWith('SIGTERM'), { timeout: 2000, interval: 5 });
    const signalsBeforeClose = child.kill.mock.calls.length;
    child.emit('close', null);
    expect(child.kill).toHaveBeenCalledTimes(signalsBeforeClose + 1);
    await expect(pending).resolves.toMatchObject({ kind: 'timeout' });
    expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');
  });

  it('stop terminates an active run by runId', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'deno 2\n', stderr: '' });
    const child = createChild();
    mocks.spawn.mockReturnValue(child);
    const { registerAltJsRuntimeHandlers, stopAltRun } = await import('../../src/main/altJsRuntimes');
    registerAltJsRuntimeHandlers();
    const run = handlerFor<RunHandler>('deno:run');
    const promise = run({}, 'while(true){}', { runId: 'stop-me', timeoutMs: 60_000 });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    expect(stopAltRun('stop-me')).toEqual({ stopped: true });
    expect(child.kill).toHaveBeenCalled();
    child.emit('close', null);
    await expect(promise).resolves.toMatchObject({ kind: 'stopped' });
    expect(stopAltRun('stop-me')).toEqual({ stopped: false });
  });
});

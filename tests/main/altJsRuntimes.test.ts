import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, unknown>();
  const execFileAsync = vi.fn();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsync,
  });
  return { handlers, execFile, execFileAsync, spawn: vi.fn() };
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
  beforeEach(() => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.execFile.mockReset();
    mocks.execFileAsync.mockReset();
    mocks.spawn.mockReset();
  });

  afterEach(async () => {
    const mod = await import('../../src/main/altJsRuntimes');
    mod._resetAltRuntimesForTests();
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

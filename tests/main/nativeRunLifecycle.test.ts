import { ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const exec = vi.fn();
  return {
    handlers: new Map<string, (...args: unknown[]) => Promise<{ kind: string }>>(),
    exec,
    execFile: Object.assign(vi.fn(), { [Symbol.for('nodejs.util.promisify.custom')]: exec }),
    spawn: vi.fn(),
    probeChildren: [] as Array<{ kill: ReturnType<typeof vi.fn> }>,
  };
});
vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  ipcMain: { handle: (name: string, handler: (...args: unknown[]) => Promise<{ kind: string }>) => mocks.handlers.set(name, handler) },
}));
vi.mock('node:child_process', async importOriginal => {
  const { ChildProcess } = await importOriginal<typeof import('node:child_process')>();
  const { EventEmitter } = await import('node:events');
  const spawn = (command: string, args: string[], options: unknown) => {
    if (args.length !== 1 || args[0] !== '--version') {
      return mocks.spawn(command, args, options);
    }
    const process = Object.assign(new EventEmitter(), {
      stdout: Object.assign(new EventEmitter(), { resume: vi.fn() }),
      stderr: Object.assign(new EventEmitter(), { resume: vi.fn() }),
      stdin: { on: vi.fn(), write: vi.fn(), end: vi.fn() },
      kill: vi.fn((_signal?: string) => {
        queueMicrotask(() => process.emit('close', null));
        return true;
      }),
    });
    mocks.probeChildren.push(process);
    Promise.resolve()
      .then(() => mocks.exec(command, args, options))
      .then(
        result => {
          process.stdout.emit('data', Buffer.from(String(result.stdout ?? '')));
          process.stderr.emit('data', Buffer.from(String(result.stderr ?? '')));
          process.emit('close', 0);
        },
        error => process.emit('error', error)
      );
    return process;
  };
  return {
    ChildProcess, execFile: mocks.execFile, spawn,
    default: { ChildProcess, execFile: mocks.execFile, spawn },
  };
});
function owner() {
  const emitter = new EventEmitter();
  let destroyed = false;
  return Object.assign(emitter, {
    isDestroyed: () => destroyed,
    send: vi.fn(),
    destroy: () => { destroyed = true; emitter.emit('destroyed'); },
  });
}
function child() {
  return Object.assign(new EventEmitter(), {
    stdout: Object.assign(new EventEmitter(), { resume: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { resume: vi.fn() }),
    stdin: { on: vi.fn(), write: vi.fn(), end: vi.fn() },
    kill: vi.fn((_signal?: string) => true),
  });
}
async function runHandler(runtime: string) {
  if (runtime === 'node') (await import('../../src/main/node-runner')).registerNodeJSHandlers();
  else if (runtime === 'ruby') (await import('../../src/main/ruby-runner')).registerRubyHandlers();
  else (await import('../../src/main/altJsRuntimes')).registerAltJsRuntimeHandlers();
  const handler = mocks.handlers.get(`${runtime}:run`);
  if (!handler) throw new Error(`Missing ${runtime} handler`);
  return handler;
}
beforeEach(() => {
  vi.resetModules();
  mocks.handlers.clear();
  mocks.execFile.mockClear();
  mocks.exec.mockReset().mockResolvedValue({ stdout: 'v24.0.0', stderr: '' });
  mocks.probeChildren.length = 0;
  mocks.spawn.mockReset();
});

describe.each(['node', 'ruby', 'deno', 'bun'])('%s native owner lifecycle', runtime => {
  it('does not execute after its window closes during detection', async () => {
    let detect!: (result: { stdout: string; stderr: string }) => void;
    mocks.exec.mockImplementationOnce(() => new Promise(resolve => { detect = resolve; }));
    mocks.spawn.mockImplementation(() => {
      const process = child();
      queueMicrotask(() => process.emit('close', 0));
      return process;
    });
    const sender = owner();
    const run = await runHandler(runtime);
    const pending = run({ sender }, 'cancelled source', { runId: 'preparing' });
    await vi.waitFor(() => expect(detect).toBeTypeOf('function'));
    sender.destroy();
    expect(mocks.probeChildren).toHaveLength(1);
    expect(mocks.probeChildren[0]?.kill).toHaveBeenCalledWith('SIGKILL');
    detect({ stdout: 'v24.0.0', stderr: '' });
    const result = await pending;
    expect(mocks.spawn).not.toHaveBeenCalled();
    expect(result.kind).toBe('stopped');
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('never detects or executes for an already-closed window', async () => {
    const sender = owner();
    sender.destroy();
    const run = await runHandler(runtime);
    expect((await run({ sender }, 'cancelled source', {})).kind).toBe('stopped');
    expect(mocks.exec).not.toHaveBeenCalled();
    expect(mocks.spawn).not.toHaveBeenCalled();
  });

  it('cancels preparing work at shutdown without preventing a later independent run', async () => {
    let detect!: (result: { stdout: string; stderr: string }) => void;
    mocks.exec.mockImplementationOnce(() => new Promise(resolve => { detect = resolve; }));
    const sender = owner();
    const run = await runHandler(runtime);
    const pending = run({ sender }, 'cancelled source', { runId: 'old' });
    await vi.waitFor(() => expect(detect).toBeTypeOf('function'));
    const { disposeNativeRuns } = await import('../../src/main/runners/nativeRunLifecycle');
    disposeNativeRuns();
    expect(mocks.probeChildren).toHaveLength(1);
    expect(mocks.probeChildren[0]?.kill).toHaveBeenCalledWith('SIGKILL');
    detect({ stdout: 'v24.0.0', stderr: '' });
    expect((await pending).kind).toBe('stopped');
    expect(mocks.spawn).not.toHaveBeenCalled();
    const process = child();
    mocks.spawn.mockImplementationOnce(() => {
      queueMicrotask(() => process.emit('close', 0));
      return process;
    });
    expect((await run({ sender }, 'recovery', { runId: 'new' })).kind).toBe('success');
    disposeNativeRuns();
    expect(process.kill).not.toHaveBeenCalled();
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('upgrades a pending graceful Stop when the window subsequently disappears', async () => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const sender = owner();
    const run = await runHandler(runtime);
    const pending = run({ sender }, 'ignores graceful stop', { runId: 'stopping' });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    await mocks.handlers.get(`${runtime}:stop`)!({ sender }, 'stopping');
    expect(process.kill).toHaveBeenCalledWith('SIGTERM');
    sender.destroy();
    const forceKilled = process.kill.mock.calls.some(args => args[0] === 'SIGKILL');
    process.emit('close', null);
    await pending;
    expect(forceKilled).toBe(true);
  });

  it('force-terminates every remaining child synchronously on app shutdown', async () => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const sender = owner();
    const run = await runHandler(runtime);
    const pending = run({ sender }, 'long running source', {});
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    const { disposeNativeRuns } = await import('../../src/main/runners/nativeRunLifecycle');
    disposeNativeRuns();
    const forceKilled = process.kill.mock.calls.some(args => args[0] === 'SIGKILL');
    process.emit('close', null);
    expect((await pending).kind).toBe('stopped');
    expect(forceKilled).toBe(true);
    process.kill.mockClear();
    disposeNativeRuns();
    expect(process.kill).not.toHaveBeenCalled();
    expect(sender.listenerCount('destroyed')).toBe(0);
  });

  it('terminates its child when the window closes and releases the listener', async () => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const sender = owner();
    const run = await runHandler(runtime);
    // Unlabelled native runs still belong to the window and app lifecycle.
    const pending = run({ sender }, 'long running source', {});
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledOnce());
    sender.destroy();
    process.emit('close', null);
    const result = await pending;
    expect(process.kill).toHaveBeenCalledWith('SIGKILL');
    expect(result.kind).toBe('stopped');
    expect(sender.listenerCount('destroyed')).toBe(0);
  });
});

 it('shares one owner listener and never cancels another window or a released run', async () => {
  const { createNativeRunLifecycle, disposeNativeRuns } = await import('../../src/main/runners/nativeRunLifecycle');
  const first = owner();
  const second = owner();
  const runs = Array.from({ length: 20 }, () => createNativeRunLifecycle(first));
  const independent = createNativeRunLifecycle(second);
  const completed = createNativeRunLifecycle(first);
  completed.release();
  expect(first.listenerCount('destroyed')).toBe(1);
  first.destroy();
  expect(runs.every(run => run.controller.signal.aborted)).toBe(true);
  expect(independent.controller.signal.aborted).toBe(false);
  expect(completed.controller.signal.aborted).toBe(false);
  for (const run of runs) run.release();
  independent.release();
  disposeNativeRuns();
  expect(independent.controller.signal.aborted).toBe(false);
  expect(first.listenerCount('destroyed')).toBe(0);
  expect(second.listenerCount('destroyed')).toBe(0);
});

it.runIf(process.platform === 'win32')('uses taskkill tree termination during shutdown on Windows', async () => {
  const { trackNativeRunProcess, disposeNativeRuns } = await import('../../src/main/runners/nativeRunLifecycle');
  const process = Object.assign(new ChildProcess(), { pid: 98765 });
  vi.spyOn(process, 'kill').mockReturnValue(true);
  const release = trackNativeRunProcess(process);
  disposeNativeRuns();
  release();
  expect(mocks.execFile).toHaveBeenCalledWith('taskkill', ['/pid', '98765', '/T', '/F'], expect.any(Function));
});

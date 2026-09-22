import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => Promise<unknown>>(),
  resolve: vi.fn(),
  run: vi.fn(),
  stop: vi.fn(),
}));
vi.mock('../../src/main/ipc/typedHandle', () => ({
  typedHandle: (channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler);
  },
}));
vi.mock('../../src/main/ipc/projectCapabilities', () => ({ resolveCapabilityPath: mocks.resolve }));
vi.mock('../../src/main/projectTests', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/main/projectTests')>(),
  runProjectTests: mocks.run,
  stopProjectTests: mocks.stop,
}));
vi.mock('electron', () => ({ app: {} }));

function sender() {
  const events = new EventEmitter();
  let destroyed = false;
  return Object.assign(events, {
    isDestroyed: () => destroyed,
    send: vi.fn(),
    destroy: () => { destroyed = true; events.emit('destroyed'); },
  });
}
function call(channel: string, ...args: unknown[]) {
  const handler = mocks.handlers.get(`project-tests:${channel}`);
  if (!handler) throw new Error(`Missing ${channel} handler`);
  return handler(...args);
}

beforeEach(async () => {
  vi.resetModules();
  mocks.handlers.clear();
  mocks.resolve.mockReset().mockResolvedValue({ ok: true, absolutePath: '/approved/project' });
  mocks.run.mockReset().mockResolvedValue({ kind: 'success' });
  mocks.stop.mockReset().mockReturnValue(false);
  const { registerProjectTestHandlers } = await import('../../src/main/ipc/projectTests');
  registerProjectTestHandlers();
});

describe('project test IPC preparation ownership', () => {
  it('honors Stop while root authorization is pending, without entering the runner', async () => {
    let authorize!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
    const owner = sender();
    const pending = call('run', { sender: owner }, 'root', 'vitest', 'run');
    const stopped = await call('stop', { sender: owner }, 'root', 'run');
    authorize({ ok: true, absolutePath: '/approved/project' });
    const result = await pending;
    expect(stopped).toEqual({ stopped: true });
    expect(result).toMatchObject({ kind: 'stopped' });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(owner.listenerCount('destroyed')).toBe(0);
  });

  it('does not execute after the sender disappears during authorization', async () => {
    let authorize!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
    const owner = sender();
    const pending = call('run', { sender: owner }, 'root', 'vitest', 'run');
    owner.destroy();
    authorize({ ok: true, absolutePath: '/approved/project' });
    await expect(pending).resolves.toMatchObject({ kind: 'stopped' });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(owner.listenerCount('destroyed')).toBe(0);
  });

  it('binds Stop to its sender and root, and suppresses output immediately and after completion', async () => {
    type Options = NonNullable<Parameters<typeof import('../../src/main/projectTests').runProjectTests>[3]>;
    let options!: Options;
    let finish!: () => void;
    mocks.run.mockImplementationOnce((_root, _framework, _runId, value: Options) => new Promise(resolve => {
      options = value;
      finish = () => resolve({ kind: 'stopped' });
    }));
    const owner = sender();
    const pending = call('run', { sender: owner }, 'root', 'vitest', 'run');
    await vi.waitFor(() => expect(options).toBeDefined());
    options.onOutput?.('stdout', 'before');
    await expect(call('stop', { sender: sender() }, 'root', 'run')).resolves.toEqual({ stopped: false });
    await expect(call('stop', { sender: owner }, 'another-root', 'run')).resolves.toEqual({ stopped: false });
    expect(options.signal?.aborted).toBe(false);
    let authorizeStop!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { authorizeStop = resolve; }));
    const stopped = call('stop', { sender: owner }, 'root', 'run');
    expect(options.signal?.aborted).toBe(true);
    options.onOutput?.('stderr', 'late');
    authorizeStop({ ok: true, absolutePath: '/approved/project' });
    await expect(stopped).resolves.toEqual({ stopped: true });
    finish();
    await pending;
    options.onOutput?.('stdout', 'after completion');
    expect(owner.send).toHaveBeenCalledTimes(1);
    expect(owner.send).toHaveBeenCalledWith('project-tests:output', { runId: 'run', stream: 'stdout', chunk: 'before' });
    expect(owner.listenerCount('destroyed')).toBe(0);
  });

  it('rejects a duplicate pending identity without replacing its owner', async () => {
    let authorize!: (value: unknown) => void;
    mocks.resolve.mockImplementationOnce(() => new Promise(resolve => { authorize = resolve; }));
    const owner = sender();
    const pending = call('run', { sender: owner }, 'root', 'vitest', 'run');
    await expect(call('run', { sender: owner }, 'root', 'vitest', 'run')).resolves.toMatchObject({ kind: 'invalid-request' });
    await call('stop', { sender: owner }, 'root', 'run');
    authorize({ ok: true, absolutePath: '/approved/project' });
    await expect(pending).resolves.toMatchObject({ kind: 'stopped' });
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each([['vitest', ''], ['vitest', '../bad'], ['vitest', 'x'.repeat(129)], ['arbitrary', 'run']])(
    'rejects malformed framework/identity before authorization (%s)', async (framework, runId) => {
      await expect(call('run', { sender: sender() }, 'root', framework, runId)).resolves.toMatchObject({ kind: 'invalid-request' });
      expect(mocks.resolve).not.toHaveBeenCalled();
      expect(mocks.run).not.toHaveBeenCalled();
    }
  );

  it('does not enter the runner for an already-destroyed sender', async () => {
    const owner = sender();
    owner.destroy();
    await expect(call('run', { sender: owner }, 'root', 'vitest', 'run')).resolves.toMatchObject({ kind: 'stopped' });
    expect(mocks.run).not.toHaveBeenCalled();
    expect(owner.listenerCount('destroyed')).toBe(0);
  });

  it('cancels a run when its output transport disappears', async () => {
    type Options = NonNullable<Parameters<typeof import('../../src/main/projectTests').runProjectTests>[3]>;
    const owner = sender();
    owner.send.mockImplementation(() => { throw new Error('Frame disposed'); });
    mocks.run.mockImplementationOnce((_root, _framework, _runId, options: Options) => {
      options.onOutput?.('stdout', 'chunk');
      return Promise.resolve({ kind: options.signal?.aborted ? 'stopped' : 'success' });
    });
    await expect(call('run', { sender: owner }, 'root', 'vitest', 'run')).resolves.toMatchObject({ kind: 'stopped' });
    expect(owner.listenerCount('destroyed')).toBe(0);
  });

  it('invalidates output callbacks after normal completion', async () => {
    type Options = NonNullable<Parameters<typeof import('../../src/main/projectTests').runProjectTests>[3]>;
    let output!: Options['onOutput'];
    mocks.run.mockImplementationOnce((_root, _framework, _runId, options: Options) => {
      output = options.onOutput;
      output?.('stdout', 'before');
      return Promise.resolve({ kind: 'success' });
    });
    const owner = sender();
    await call('run', { sender: owner }, 'root', 'vitest', 'run');
    output?.('stdout', 'late');
    expect(owner.send).toHaveBeenCalledTimes(1);
    expect(owner.listenerCount('destroyed')).toBe(0);
  });

  it('rejects revoked capabilities before execution and releases preparation ownership', async () => {
    const owner = sender();
    mocks.resolve.mockResolvedValueOnce({ ok: false, error: 'revoked' });
    await expect(call('run', { sender: owner }, 'root', 'vitest', 'run')).rejects.toThrow('revoked');
    expect(mocks.run).not.toHaveBeenCalled();
    expect(owner.listenerCount('destroyed')).toBe(0);
    await expect(call('run', { sender: owner }, 'root', 'vitest', 'run')).resolves.toMatchObject({ kind: 'success' });
  });
});

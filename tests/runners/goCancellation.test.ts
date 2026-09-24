import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GoRunner } from '@/runners/go';

const compile = vi.fn();
const stop = vi.fn().mockResolvedValue({ stopped: true });
const workers: FixtureWorker[] = [];
class FixtureWorker {
  listeners = new Map<string, (event: unknown) => void>();
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() { workers.push(this); }
  addEventListener(type: string, listener: (event: unknown) => void) { this.listeners.set(type, listener); }
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const compiled = () => ({ success: true, wasmBytes: new Uint8Array([0]), wasmExecJs: 'runtime' });

beforeEach(() => {
  compile.mockReset(); stop.mockClear(); workers.length = 0;
  vi.stubGlobal('Worker', FixtureWorker);
  vi.stubGlobal('window', { ...window, lingua: { ...window.lingua, go: {
    detect: vi.fn().mockResolvedValue({ installed: true }), compile, stop,
  } } });
});
afterEach(() => vi.unstubAllGlobals());

describe('Go compiler-to-worker ownership', () => {
  it.each(['resolve', 'reject'] as const)('ignores late compile %s after A Stop B without stealing B', async outcome => {
    const held = deferred<ReturnType<typeof compiled>>();
    compile.mockReturnValueOnce(held.promise).mockResolvedValueOnce(compiled());
    const runner = new GoRunner(); await runner.init();
    const old = runner.execute('old');
    const oldId = compile.mock.calls[0]![3];
    runner.stop();
    expect(stop).toHaveBeenCalledWith(expect.any(String));
    expect(oldId).toEqual(expect.any(String));
    await expect(old).resolves.toMatchObject({ kind: 'stopped', cancelled: true });
    const current = runner.execute('current');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const worker = workers[0]!;
    if (outcome === 'resolve') held.resolve(compiled()); else held.reject(new Error('late compile error'));
    await Promise.resolve(); await Promise.resolve();
    expect(workers).toHaveLength(1);
    expect(worker.terminate).not.toHaveBeenCalled();
    runner.stop();
    expect(stop).toHaveBeenLastCalledWith(compile.mock.calls[1]![3]);
    expect(compile.mock.calls[1]![3]).not.toBe(oldId);
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(current).resolves.toMatchObject({ kind: 'stopped' });
  });

  it('does not create a worker on compiler timeout and identifies its own budget', async () => {
    compile.mockResolvedValue({ success: false, kind: 'timeout', timeoutMs: 30000 });
    const runner = new GoRunner(); await runner.init();
    expect(await runner.execute('code')).toMatchObject({ kind: 'timeout', timeoutMs: 30000, timeoutPreset: 'override' });
    expect(workers).toHaveLength(0);
  });

  it('does not create a worker when main cancels compilation', async () => {
    compile.mockResolvedValue({ success: false, kind: 'stopped' });
    const runner = new GoRunner(); await runner.init();
    expect(await runner.execute('code')).toMatchObject({ kind: 'stopped', cancelled: true });
    expect(workers).toHaveLength(0);
  });
  it('reaps its worker when the initial transfer throws', async () => {
    vi.stubGlobal('Worker', class extends FixtureWorker {
      constructor() { super(); this.postMessage.mockImplementation(() => { throw new Error('transfer failed'); }); }
    });
    compile.mockResolvedValue(compiled());
    const runner = new GoRunner(); await runner.init();
    expect(await runner.execute('code')).toMatchObject({ kind: 'error', error: { message: 'transfer failed' } });
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    runner.stop();
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  });

  it('ignores old worker errors and foreign messages while preserving current output order', async () => {
    compile.mockImplementation(async () => compiled());
    const runner = new GoRunner(); await runner.init();
    const old = runner.execute('old');
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    const oldWorker = workers[0]!;
    runner.stop(); await old;
    const current = runner.execute('current');
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    const worker = workers[1]!;
    const runId = worker.postMessage.mock.calls[0]![0].runId;
    oldWorker.listeners.get('error')!({ message: 'late error' });
    worker.listeners.get('message')!({ data: { runId: 'foreign', type: 'done', executionTime: 0 } });
    expect(worker.terminate).not.toHaveBeenCalled();
    for (const method of ['log', 'error', 'log']) worker.listeners.get('message')!({ data: { runId, type: 'console', method, args: [method] } });
    worker.listeners.get('message')!({ data: { runId, type: 'done', executionTime: 1 } });
    const result = await current;
    expect(result.kind).toBe('success');
    expect(result.stdout.map(row => row.captureOrder)).toEqual([0, 2]);
    expect(result.stderr.map(row => row.captureOrder)).toEqual([1]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

});

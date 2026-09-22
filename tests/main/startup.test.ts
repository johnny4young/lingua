// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createStartupGuard,
  loadStartupRenderer,
  RENDERER_STARTUP_TIMEOUT_MS,
  startupFailureMessage,
} from '../../src/main/startup';

afterEach(() => vi.useRealTimers());

describe('terminal startup boundary', () => {
  it('reports a synchronous failure once and forbids every later operation', async () => {
    const report = vi.fn();
    const exit = vi.fn();
    const later = vi.fn();
    const startup = createStartupGuard(report, exit);
    await startup.run('initialization', () => {
      throw Object.assign(new Error('private path/token'), { code: 'EACCES' });
    });
    await startup.run('renderer-load', later);
    expect(report).toHaveBeenCalledExactlyOnceWith({ stage: 'initialization', code: 'EACCES' });
    expect(exit).toHaveBeenCalledOnce();
    expect(startup.signal.aborted).toBe(true);
    expect(later).not.toHaveBeenCalled();
  });
  it('observes async failures and exits even if reporting fails', async () => {
    const exit = vi.fn();
    const startup = createStartupGuard(() => {
      throw new Error('dialog unavailable');
    }, exit);
    await expect(
      startup.run('initialization', async () => {
        throw new Error('secret');
      })
    ).resolves.toBeUndefined();
    expect(exit).toHaveBeenCalledOnce();
  });
  it('does not turn an intentional quit into a fatal error or resume a pending task', async () => {
    const report = vi.fn();
    const exit = vi.fn();
    const startup = createStartupGuard(report, exit);
    let reject!: (error: Error) => void;
    const pending = startup.run(
      'renderer-load',
      () =>
        new Promise((_resolve, rejectPromise) => {
          reject = rejectPromise;
        })
    );
    startup.stop();
    reject(new Error('late rejection'));
    await pending;
    expect(report).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
  it('terminates once when concurrent startup operations both fail', async () => {
    const report = vi.fn();
    const exit = vi.fn();
    const startup = createStartupGuard(report, exit);
    await Promise.all([
      startup.run('initialization', async () => {
        throw new Error('first');
      }),
      startup.run('renderer-load', async () => {
        throw new Error('second');
      }),
    ]);
    expect(report).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });
  it('never starts an operation after an intentional stop', async () => {
    const operation = vi.fn();
    const startup = createStartupGuard(vi.fn(), vi.fn());
    startup.stop();
    await startup.run('initialization', operation);
    expect(operation).not.toHaveBeenCalled();
  });
  it('reads an error code once before allowlisting it', async () => {
    const report = vi.fn();
    let reads = 0;
    const error = {
      get code() {
        return ++reads === 1 ? 'EACCES' : 'PRIVATE_TOKEN';
      },
    };
    await createStartupGuard(report, vi.fn()).run('initialization', () => {
      throw error;
    });
    expect(reads).toBe(1);
    expect(report).toHaveBeenCalledExactlyOnceWith({ stage: 'initialization', code: 'EACCES' });
  });
  it('never formats unknown thrown payloads, paths or hostile code getters', async () => {
    const report = vi.fn();
    const error = {
      get code() {
        throw new Error('private');
      },
      toString() {
        throw new Error('do not format');
      },
    };
    await createStartupGuard(report, vi.fn()).run('initialization', () => {
      throw error;
    });
    expect(report).toHaveBeenCalledExactlyOnceWith({ stage: 'initialization', code: 'UNKNOWN' });
  });
  it.each([
    ['es-CO', 'no pudo iniciar'],
    ['en-US', 'could not start'],
    ['fr-FR', 'could not start'],
  ])('uses supported system language %s without loading renderer stores', (language, text) => {
    const message = startupFailureMessage({ stage: 'renderer-load', code: 'ERR_FILE_NOT_FOUND' }, [
      language,
    ]);
    expect(message.title).toContain(text);
    expect(message.content).toContain('renderer-load/ERR_FILE_NOT_FOUND');
  });
});

describe('renderer startup loading', () => {
  it('does not retry a missing packaged document', async () => {
    const failure = new Error('missing');
    const load = vi.fn().mockRejectedValue(failure);
    await expect(loadStartupRenderer(load, new AbortController().signal, false)).rejects.toBe(
      failure
    );
    expect(load).toHaveBeenCalledOnce();
  });
  it('retries a dev connection and cleans its deadline after recovery', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValueOnce(new Error('refused')).mockResolvedValue(undefined);
    const promise = loadStartupRenderer(load, new AbortController().signal, true);
    await vi.advanceTimersByTimeAsync(1000);
    await promise;
    expect(load).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([true, false])(
    'bounds a hanging load, retry=%s, and observes a late rejection',
    async retry => {
      vi.useFakeTimers();
      let reject!: (reason: Error) => void;
      const load = vi.fn(
        () =>
          new Promise((_resolve, rejectPromise) => {
            reject = rejectPromise;
          })
      );
      const promise = loadStartupRenderer(load, new AbortController().signal, retry);
      const assertion = expect(promise).rejects.toMatchObject({ code: 'ETIMEDOUT' });
      await vi.advanceTimersByTimeAsync(RENDERER_STARTUP_TIMEOUT_MS);
      await assertion;
      reject(new Error('late'));
      await Promise.resolve();
      expect(load).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    }
  );
  it('rejects cancellation even if the pending document later loads successfully', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    let resolve!: () => void;
    const load = vi.fn(
      () =>
        new Promise<void>(done => {
          resolve = done;
        })
    );
    const promise = loadStartupRenderer(load, controller.signal, true);
    const assertion = expect(promise).rejects.toBeDefined();
    controller.abort();
    await assertion;
    resolve();
    await vi.advanceTimersByTimeAsync(RENDERER_STARTUP_TIMEOUT_MS);
    expect(load).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a retry delay before another load can start', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const load = vi.fn().mockRejectedValue(new Error('refused'));
    const promise = loadStartupRenderer(load, controller.signal, true);
    const assertion = expect(promise).rejects.toBeDefined();
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await assertion;
    await vi.advanceTimersByTimeAsync(RENDERER_STARTUP_TIMEOUT_MS);
    expect(load).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds repeated connection failures without continuing afterward', async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValue(new Error('refused'));
    const assertion = expect(
      loadStartupRenderer(load, new AbortController().signal, true)
    ).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    await vi.advanceTimersByTimeAsync(RENDERER_STARTUP_TIMEOUT_MS);
    await assertion;
    expect(load.mock.calls.length).toBeGreaterThan(1);
    expect(load.mock.calls.length).toBeLessThanOrEqual(31);
    const count = load.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RENDERER_STARTUP_TIMEOUT_MS);
    expect(load).toHaveBeenCalledTimes(count);
    expect(vi.getTimerCount()).toBe(0);
  });
});

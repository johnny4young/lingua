/**
 * RL-078 — parent-owned execution timeout, runId guard, and console
 * cap behavior for the JavaScript / TypeScript runners.
 *
 * The existing MockWorker fixture only emitted `console` + `done` on
 * `addEventListener('message', …)`; for these cases we need a worker
 * that actually replays whatever the runner posts (so we can echo or
 * NOT echo `runId`) and that we can leave silent to drive the parent
 * kill timer. We register the mock per `describe` block rather than
 * globally so other suites are unaffected.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isDebugWorkerActive,
  postDebuggerMessage,
  setActiveDebugWorker,
} from '@/runtime/debuggerWorkerBridge';
import { useDebuggerStore } from '@/stores/debuggerStore';

interface PostedRequest {
  type: string;
  runId?: string;
  code?: string;
  stdin?: string;
  timeout?: number;
  resultTruncationMarker?: string;
}

let lastPosted: PostedRequest | null = null;
let messageListeners: Array<(e: MessageEvent) => void> = [];
let terminateCount = 0;
let respond: 'silent' | 'echo' | 'no-runid' = 'echo';
let extraEcho: Array<{
  type: string;
  method?: string;
  args?: string[];
  count?: number;
  total?: number;
}> = [];

class ProgrammableWorker {
  postMessage(msg: PostedRequest) {
    lastPosted = msg;
    if (respond === 'silent') return;
    const runId = respond === 'no-runid' ? undefined : msg.runId;
    queueMicrotask(() => {
      for (const extra of extraEcho) {
        const data: Record<string, unknown> = { ...extra };
        if (runId) data.runId = runId;
        for (const cb of messageListeners) {
          cb(new MessageEvent('message', { data }));
        }
      }
      const doneData: Record<string, unknown> = {
        type: 'done',
        executionTime: 5,
      };
      if (runId) doneData.runId = runId;
      for (const cb of messageListeners) {
        cb(new MessageEvent('message', { data: doneData }));
      }
    });
  }

  addEventListener(event: string, cb: (e: MessageEvent) => void) {
    if (event === 'message') messageListeners.push(cb);
  }

  removeEventListener() {}

  terminate() {
    terminateCount += 1;
  }
}

beforeEach(() => {
  lastPosted = null;
  messageListeners = [];
  terminateCount = 0;
  respond = 'echo';
  extraEcho = [];
  setActiveDebugWorker(null);
  useDebuggerStore.setState(
    {
      breakpoints: {},
      breakpointOrder: [],
      watches: [],
      session: null,
      pausedFrame: null,
    },
    false
  );
  vi.stubGlobal('Worker', ProgrammableWorker);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('JavaScriptRunner — RL-078 parent-owned timeout', () => {
  it('mints a runId per execute() and posts it to the worker', async () => {
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();
    const result = await runner.execute('void 0', { timeout: 1_000 });
    expect(result.error).toBeUndefined();
    expect(typeof lastPosted?.runId).toBe('string');
    expect(lastPosted?.runId).not.toHaveLength(0);
  });

  it('drops worker messages that omit the active runId', async () => {
    respond = 'no-runid';
    extraEcho = [{ type: 'console', method: 'log', args: ['leaked'] }];
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();
    vi.useFakeTimers();
    const promise = runner.execute('void 0', { timeout: 50 });
    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;
    vi.useRealTimers();
    expect(result.stdout).toHaveLength(0);
    expect(result.error?.message).toMatch(/timed out|excedi[oó]/i);
  });

  it('passes the localized result truncation marker into the worker', async () => {
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();
    await runner.execute('void 0', { timeout: 1_000 });
    expect(lastPosted?.resultTruncationMarker).toBe('[result truncated]');
  });

  it('threads stdin into the JS worker and relays the consumption summary', async () => {
    extraEcho = [{ type: 'stdin-consumed', count: 2, total: 3 }];
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();

    const result = await runner.execute('prompt()', {
      timeout: 1_000,
      stdin: 'Ada\nGrace\nLinus',
    });

    expect(lastPosted?.stdin).toBe('Ada\nGrace\nLinus');
    expect(result.stdinConsumed).toEqual({ count: 2, total: 3 });
  });

  it('rejects worker replies whose runId does not match the active run', async () => {
    // Custom mock: replays with a stale runId.
    class StaleWorker {
      postMessage(msg: PostedRequest) {
        lastPosted = msg;
        queueMicrotask(() => {
          for (const cb of messageListeners) {
            cb(
              new MessageEvent('message', {
                data: {
                  type: 'console',
                  method: 'log',
                  args: ['leaked'],
                  runId: 'stale-run-id',
                },
              })
            );
            cb(
              new MessageEvent('message', {
                data: {
                  type: 'done',
                  executionTime: 5,
                  runId: msg.runId,
                },
              })
            );
          }
        });
      }
      addEventListener(event: string, cb: (e: MessageEvent) => void) {
        if (event === 'message') messageListeners.push(cb);
      }
      removeEventListener() {}
      terminate() {
        terminateCount += 1;
      }
    }
    vi.stubGlobal('Worker', StaleWorker);
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();
    const result = await runner.execute('void 0', { timeout: 1_000 });
    // The stale `console` message is dropped; only the matching
    // `done` resolves the promise.
    expect(result.stdout).toHaveLength(0);
  });

  it('parent kill timer terminates the worker and resolves with a timeout error', async () => {
    respond = 'silent';
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();

    vi.useFakeTimers();
    const promise = runner.execute('while(true){}', { timeout: 50 });
    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;
    vi.useRealTimers();

    expect(result.error?.message).toMatch(/timed out|excedi[oó]/i);
    expect(result.executionTime).toBe(50);
    expect(terminateCount).toBeGreaterThan(0);
  });

  it('caps console entries at MAX_CONSOLE_ENTRIES with a single truncation notice', async () => {
    const flood: Array<{ type: string; method: string; args: string[] }> = [];
    for (let i = 0; i < 1100; i += 1) {
      flood.push({ type: 'console', method: 'log', args: [`line-${i}`] });
    }
    extraEcho = flood;
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();
    const result = await runner.execute('void 0', { timeout: 1_000 });
    // Exactly MAX_CONSOLE_ENTRIES (1000), with the final slot as notice.
    expect(result.stdout).toHaveLength(1000);
    expect(result.stdout[999]?.type).toBe('warn');
  });

  it('keeps stderr byte truncation sticky after the first oversized chunk', async () => {
    extraEcho = [
      { type: 'console', method: 'error', args: ['x'.repeat(256 * 1024 + 1)] },
      { type: 'console', method: 'error', args: ['should-not-leak'] },
    ];
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();
    const result = await runner.execute('void 0', { timeout: 1_000 });
    expect(result.stderr).toEqual([
      { type: 'error', args: ['[stderr truncated]'] },
    ]);
  });

  it('stop() resolves an in-flight execute() instead of leaving it pending', async () => {
    respond = 'silent';
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();
    const promise = runner.execute('while(true){}', { timeout: 60_000 });
    runner.stop();
    const result = await promise;
    expect(result.cancelled).toBe(true);
    expect(result.error?.message).toBe('Execution stopped by user.');
    expect(result.stdout).toHaveLength(0);
  });

  it('stop() clears an attached debugger session and worker bridge', async () => {
    respond = 'silent';
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 1);
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();

    const promise = runner.execute('const value = 1;', {
      timeout: 60_000,
      tabId: 'tab-1',
      debug: true,
    });
    expect(useDebuggerStore.getState().session).toMatchObject({
      runtime: 'js',
      tabId: 'tab-1',
    });
    expect(isDebugWorkerActive()).toBe(true);

    runner.stop();
    const result = await promise;

    expect(result.cancelled).toBe(true);
    expect(useDebuggerStore.getState().session).toBeNull();
    expect(useDebuggerStore.getState().pausedFrame).toBeNull();
    expect(isDebugWorkerActive()).toBe(false);
  });

  it('suspends the parent timeout while a debug run is paused', async () => {
    const streamed: string[] = [];
    class PausingWorker {
      private runId: string | undefined;

      postMessage(msg: PostedRequest) {
        if (msg.type === 'execute') {
          lastPosted = msg;
          this.runId = msg.runId;
          queueMicrotask(() => {
            for (const cb of messageListeners) {
              cb(
                new MessageEvent('message', {
                  data: {
                    type: 'console',
                    method: 'log',
                    args: ['before-pause'],
                    line: 1,
                    runId: this.runId,
                  },
                })
              );
              cb(
                new MessageEvent('message', {
                  data: {
                    type: 'paused',
                    line: 1,
                    reason: 'user-breakpoint',
                    locals: { value: '1' },
                    callStack: [],
                    watchResults: {},
                    runId: this.runId,
                  },
                })
              );
            }
          });
          return;
        }

        if (msg.type === 'resume') {
          queueMicrotask(() => {
            for (const cb of messageListeners) {
              cb(new MessageEvent('message', { data: { type: 'resumed', runId: this.runId } }));
              cb(
                new MessageEvent('message', {
                  data: {
                    type: 'console',
                    method: 'log',
                    args: ['after-resume'],
                    line: 2,
                    runId: this.runId,
                  },
                })
              );
              cb(new MessageEvent('message', { data: { type: 'done', executionTime: 5, runId: this.runId } }));
            }
          });
        }
      }

      addEventListener(event: string, cb: (e: MessageEvent) => void) {
        if (event === 'message') messageListeners.push(cb);
      }

      removeEventListener() {}

      terminate() {
        terminateCount += 1;
      }
    }

    vi.stubGlobal('Worker', PausingWorker);
    useDebuggerStore.getState().toggleBreakpoint('tab-1', 1);
    const { JavaScriptRunner } = await import('@/runners/javascript');
    const runner = new JavaScriptRunner();
    await runner.init();

    vi.useFakeTimers();
    let settled = false;
    const promise = runner
      .execute('console.log("before-pause");\nconsole.log("after-resume");', {
        timeout: 50,
        tabId: 'tab-1',
        debug: true,
        onConsole: (output) => streamed.push(output.args.join(' ')),
      })
      .then((result) => {
        settled = true;
        return result;
      });

    await Promise.resolve();
    expect(useDebuggerStore.getState().pausedFrame).toMatchObject({ line: 1 });
    expect(streamed).toEqual(['before-pause']);

    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    expect(terminateCount).toBe(0);

    expect(postDebuggerMessage({ type: 'resume' })).toBe(true);
    await Promise.resolve();
    const result = await promise;
    vi.useRealTimers();

    expect(result.error).toBeUndefined();
    expect(result.stdout.map((output) => output.args.join(' '))).toEqual([
      'before-pause',
      'after-resume',
    ]);
    expect(streamed).toEqual(['before-pause', 'after-resume']);
  });
});

describe('TypeScriptRunner — RL-078 parent-owned timeout', () => {
  // Stub esbuild-wasm so init() doesn't try to fetch the wasm bundle.
  beforeEach(() => {
    vi.doMock('esbuild-wasm', () => ({
      initialize: vi.fn().mockResolvedValue(undefined),
      transform: vi.fn().mockImplementation(async (code: string) => ({
        code,
        warnings: [],
      })),
    }));
  });

  afterEach(() => {
    vi.doUnmock('esbuild-wasm');
    vi.resetModules();
  });

  it('parent kill timer terminates the worker after transpile', async () => {
    respond = 'silent';
    const { TypeScriptRunner } = await import('@/runners/typescript');
    const runner = new TypeScriptRunner();
    await runner.init();

    vi.useFakeTimers();
    const promise = runner.execute('while(true){}', { timeout: 40 });
    await vi.advanceTimersByTimeAsync(60);
    const result = await promise;
    vi.useRealTimers();

    expect(result.error?.message).toMatch(/timed out|excedi[oó]/i);
    expect(terminateCount).toBeGreaterThan(0);
  });

  it('threads stdin through the TS transpile path into the shared JS worker', async () => {
    extraEcho = [{ type: 'stdin-consumed', count: 1, total: 1 }];
    const { TypeScriptRunner } = await import('@/runners/typescript');
    const runner = new TypeScriptRunner();
    await runner.init();

    const result = await runner.execute('const value: string | null = prompt();', {
      timeout: 1_000,
      stdin: 'typed input',
    });

    expect(lastPosted?.stdin).toBe('typed input');
    expect(result.stdinConsumed).toEqual({ count: 1, total: 1 });
  });
});

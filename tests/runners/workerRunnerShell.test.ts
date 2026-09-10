/**
 * The worker-runner shell shared by the JavaScript and TypeScript runners.
 *
 * `javascript.test.ts` and `typescript.test.ts` exercise this through their
 * runners and stayed untouched when the shell was extracted, which is what
 * proves the move was faithful. These cases go at the lifecycle directly,
 * because the edges that used to be duplicated are exactly the ones a
 * per-runner test does not reach: a stale reply arriving after a stop, a crash
 * with no `done`, and the two console caps having to stay independent.
 *
 * The worker here is fully controllable rather than auto-responding, so a test
 * can hold a run open and drive the pump message by message.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkerRunnerShell, type WorkerRunSpec } from '@/runners/workerRunnerShell';
import { useDebuggerStore } from '@/stores/debuggerStore';

class ControllableWorker {
  static latest: ControllableWorker | null = null;
  static created = 0;

  private messageHandlers: Array<(event: { data: unknown }) => void> = [];
  private errorHandlers: Array<(event: { message: string }) => void> = [];
  posted: Array<Record<string, unknown>> = [];
  terminated = false;
  /** Counted, so a test can prove a cleared deadline never fires a second one. */
  terminateCount = 0;

  constructor(_url: URL | string, _options?: WorkerOptions) {
    ControllableWorker.latest = this;
    ControllableWorker.created += 1;
  }

  addEventListener(type: string, handler: (event: never) => void): void {
    if (type === 'message') this.messageHandlers.push(handler as never);
    if (type === 'error') this.errorHandlers.push(handler as never);
  }

  postMessage(message: Record<string, unknown>): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
    this.terminateCount += 1;
  }

  /** The runId the shell minted for this run. */
  get runId(): string {
    return this.posted[0]?.['runId'] as string;
  }

  emit(data: Record<string, unknown>): void {
    for (const handler of this.messageHandlers) handler({ data } as never);
  }

  /** Emit carrying the live runId, which is what the shell's guard expects. */
  emitForRun(data: Record<string, unknown>): void {
    this.emit({ ...data, runId: this.runId });
  }

  emitError(message: string): void {
    for (const handler of this.errorHandlers) handler({ message } as never);
  }
}

const originalWorker = globalThis.Worker;

/**
 * Every shell a test starts, so teardown can stop it.
 *
 * A run that is never finished leaves its real kill timer armed. That timer
 * outlives the test, and when it fires it touches the shared debugger store
 * and keeps the Vitest worker alive — so a case that only asserts on the
 * execute payload would quietly interfere with later ones.
 */
const startedShells: WorkerRunnerShell[] = [];

function spec(overrides: Partial<WorkerRunSpec> = {}): WorkerRunSpec {
  return {
    code: 'noop',
    language: 'javascript',
    timeout: 5_000,
    timeoutPreset: 'normal',
    debug: false,
    breakpoints: [],
    watches: [],
    sourceLineMap: undefined,
    sourceMappingEnabled: true,
    magicKindByLine: {},
    magicDirectiveByLine: {},
    captureStructuredResult: false,
    context: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  ControllableWorker.latest = null;
  ControllableWorker.created = 0;
  (globalThis as { Worker: unknown }).Worker = ControllableWorker;
});

afterEach(() => {
  // Stop before restoring timers: a shell stopped under fake timers clears its
  // deadline through the same fake clock it armed on.
  for (const shell of startedShells.splice(0)) shell.stop();
  (globalThis as { Worker: unknown }).Worker = originalWorker;
  vi.useRealTimers();
});

function startRun(overrides: Partial<WorkerRunSpec> = {}) {
  const shell = new WorkerRunnerShell();
  startedShells.push(shell);
  const promise = shell.run(spec(overrides));
  const worker = ControllableWorker.latest;
  if (!worker) throw new Error('the shell did not boot a worker');
  return { shell, promise, worker };
}

describe('the execution request', () => {
  it('carries the code and the language-stamped scope', () => {
    const { worker } = startRun({ code: 'const x = 1;', language: 'typescript' });

    expect(worker.posted[0]).toMatchObject({
      type: 'execute',
      code: 'const x = 1;',
      scopeLanguage: 'typescript',
    });
    expect(worker.runId).toBeTruthy();
  });

  it('is posted once per run', () => {
    const { worker } = startRun();

    expect(worker.posted).toHaveLength(1);
    expect(ControllableWorker.created).toBe(1);
  });
});

describe('the message pump', () => {
  it('assembles console, result and timings onto the finished run', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'console', method: 'log', args: ['hi'], line: 1 });
    worker.emitForRun({ type: 'result', value: 42 });
    worker.emitForRun({ type: 'line-timing', entries: [{ line: 1, durationMs: 3 }] });
    worker.emitForRun({ type: 'done', executionTime: 7 });

    const result = await promise;
    expect(result.stdout).toHaveLength(1);
    expect(result.result).toBe(42);
    expect(result.lineTimings).toEqual([{ line: 1, durationMs: 3 }]);
    expect(result.executionTime).toBe(7);
    expect(result.kind).toBe('success');
  });

  it('routes an error message and marks the run as failed', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'error', error: { message: 'boom' } });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    const result = await promise;
    expect(result.error).toEqual({ message: 'boom' });
    expect(result.kind).toBe('error');
  });

  it('keeps stdout and stderr on separate accumulators', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'console', method: 'log', args: ['out'], line: 1 });
    worker.emitForRun({ type: 'console', method: 'error', args: ['err'], line: 2 });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    const result = await promise;
    expect(result.stdout).toHaveLength(1);
    expect(result.stderr).toHaveLength(1);
    expect(result.stdout[0]?.args).toEqual(['out']);
    expect(result.stderr[0]?.args).toEqual(['err']);
  });

  it('coerces a malformed stdin summary to bounded integers', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'stdin-consumed', count: -4, total: 'nope' });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).stdinConsumed).toEqual({ count: 0, total: 0 });
  });

  it('rejects a scope snapshot whose shape is wrong', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'scope-snapshot', snapshot: { language: 7, variables: 'no' } });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).scopeSnapshot).toBeNull();
  });

  it('accepts a well-formed scope snapshot', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({
      type: 'scope-snapshot',
      snapshot: { language: 'javascript', variables: [] },
    });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).scopeSnapshot).toEqual({ language: 'javascript', variables: [] });
  });

  it('stitches the magic-comment kind back in from the side table', async () => {
    const { promise, worker } = startRun({ magicKindByLine: { 3: 'watch' } });

    worker.emitForRun({ type: 'magic-comment', line: 3, value: '5' });
    worker.emitForRun({ type: 'magic-comment', line: 9, value: '6' });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    const result = await promise;
    expect(result.magicResults?.[0]).toMatchObject({ line: 3, value: '5', kind: 'watch' });
    // A line with no entry falls back to `arrow` rather than dropping the row.
    expect(result.magicResults?.[1]).toMatchObject({ line: 9, kind: 'arrow' });
  });

  it('upgrades a table directive into a typed payload', async () => {
    const { promise, worker } = startRun({ magicDirectiveByLine: { 1: 'table' } });

    worker.emitForRun({ type: 'magic-comment', line: 1, value: '[{"a":1}]' });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    const entry = (await promise).magicResults?.[0];
    expect(entry?.payload).toBeDefined();
    // The stringified value survives as the canonical text fallback.
    expect(entry?.value).toBe('[{"a":1}]');
  });

  it('leaves a table directive alone when the value is not JSON', async () => {
    const { promise, worker } = startRun({ magicDirectiveByLine: { 1: 'table' } });

    worker.emitForRun({ type: 'magic-comment', line: 1, value: 'undefined' });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).magicResults?.[0]?.value).toBe('undefined');
  });

  it('omits magicResults entirely when the run produced none', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).magicResults).toBeUndefined();
  });

  it('forwards a structured result only when one arrives', async () => {
    const { promise, worker } = startRun({ captureStructuredResult: true });

    worker.emitForRun({ type: 'result', value: 'display', structured: { real: true } });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    const result = await promise;
    expect(result.result).toBe('display');
    expect(result.structuredResult).toEqual({ real: true });
  });

  it('leaves structuredResult undefined for a normal run', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'result', value: 1 });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).structuredResult).toBeUndefined();
  });

  it('terminates the worker once the run is done', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'done', executionTime: 1 });
    await promise;

    expect(worker.terminated).toBe(true);
  });
});

describe('the runId guard', () => {
  it('drops a reply carrying a different runId', async () => {
    const { promise, worker } = startRun();

    worker.emit({
      type: 'console',
      runId: 'someone-elses-run',
      method: 'log',
      args: ['x'],
      line: 1,
    });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).stdout).toHaveLength(0);
  });

  it('drops a reply with no runId at all', async () => {
    const { promise, worker } = startRun();

    worker.emit({ type: 'console', method: 'log', args: ['x'], line: 1 });
    worker.emitForRun({ type: 'done', executionTime: 1 });

    expect((await promise).stdout).toHaveLength(0);
  });

  it('ignores a late reply that arrives after the run finished', async () => {
    const { promise, worker } = startRun();

    worker.emitForRun({ type: 'done', executionTime: 1 });
    const result = await promise;
    // A terminated worker can still flush a queued message.
    worker.emitForRun({ type: 'console', method: 'log', args: ['ghost'], line: 1 });

    expect(result.stdout).toHaveLength(0);
  });
});

describe('stop', () => {
  it('resolves an in-flight run instead of leaving it hanging', async () => {
    const { shell, promise, worker } = startRun();

    worker.emitForRun({ type: 'console', method: 'log', args: ['before stop'], line: 1 });
    shell.stop();

    const result = await promise;
    // Output produced before the stop survives, so the user keeps what ran.
    expect(result.stdout).toHaveLength(1);
    expect(worker.terminated).toBe(true);
  });

  it('clears the deadline, so an abandoned run cannot fire one later', async () => {
    // This is the mechanism the suite teardown relies on: every shell a test
    // starts gets stopped, and a stopped shell must not leave a timer armed
    // that would fire into a later case.
    vi.useFakeTimers();
    const { shell, promise, worker } = startRun({ timeout: 1_000 });

    shell.stop();
    await promise;
    const afterStop = worker.terminateCount;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(worker.terminateCount).toBe(afterStop);
  });

  it('is safe with no run in flight', () => {
    const shell = new WorkerRunnerShell();

    expect(() => shell.stop()).not.toThrow();
    expect(() => shell.stop()).not.toThrow();
  });

  it('does not re-resolve a run that already finished', async () => {
    const { shell, promise, worker } = startRun();

    worker.emitForRun({ type: 'done', executionTime: 4 });
    const result = await promise;
    shell.stop();

    expect(result.executionTime).toBe(4);
    expect(result.kind).toBe('success');
  });

  it('terminates the previous worker when a new run starts', async () => {
    const shell = new WorkerRunnerShell();
    startedShells.push(shell);
    const first = shell.run(spec());
    const firstWorker = ControllableWorker.latest!;

    const second = shell.run(spec());

    expect(firstWorker.terminated).toBe(true);
    expect(ControllableWorker.created).toBe(2);
    await first;
    ControllableWorker.latest!.emitForRun({ type: 'done', executionTime: 1 });
    await second;
  });
});

describe('a stale worker error', () => {
  it('does not detach the debugger session of the run that replaced it', async () => {
    const shell = new WorkerRunnerShell();
    startedShells.push(shell);
    const debugSpec = spec({ debug: true, context: { tabId: 'tab-1' } });

    const first = shell.run(debugSpec);
    const firstWorker = ControllableWorker.latest!;
    const second = shell.run(debugSpec);
    const secondWorker = ControllableWorker.latest!;
    await first;

    // The second run owns the debugger session now.
    expect(useDebuggerStore.getState().session).not.toBeNull();

    // A worker that was terminated when the second run began can still flush a
    // queued error. Its own finish() is already a no-op, but the debugger
    // cleanup that follows is shell-wide.
    firstWorker.emitError('late crash from a replaced worker');

    expect(useDebuggerStore.getState().session).not.toBeNull();

    secondWorker.emitForRun({ type: 'done', executionTime: 1 });
    await second;
  });

  it('still cleans up when the crash belongs to the live run', async () => {
    const shell = new WorkerRunnerShell();
    startedShells.push(shell);
    const promise = shell.run(spec({ debug: true, context: { tabId: 'tab-1' } }));
    const worker = ControllableWorker.latest!;

    expect(useDebuggerStore.getState().session).not.toBeNull();
    worker.emitError('real crash');

    const result = await promise;
    expect(result.kind).toBe('error');
    expect(useDebuggerStore.getState().session).toBeNull();
  });
});

describe('failure paths', () => {
  it('resolves on a worker crash that never sends done', async () => {
    const { promise, worker } = startRun();

    worker.emitError('worker exploded');

    const result = await promise;
    expect(result.kind).toBe('error');
    expect(result.error?.message).toBe('worker exploded');
    expect(worker.terminated).toBe(true);
  });

  it('falls back to a generic message when the crash carries none', async () => {
    const { promise, worker } = startRun();

    worker.emitError('');

    expect((await promise).error?.message).toBe('Worker error');
  });

  it('kills a run that never yields, once the deadline passes', async () => {
    vi.useFakeTimers();
    const { promise, worker } = startRun({ timeout: 1_000 });

    await vi.advanceTimersByTimeAsync(1_000);

    const result = await promise;
    expect(worker.terminated).toBe(true);
    expect(result.timeoutMs).toBe(1_000);
    expect(result.timeoutPreset).toBe('normal');
  });

  it('does not fire the deadline for a run that finished in time', async () => {
    vi.useFakeTimers();
    const { promise, worker } = startRun({ timeout: 1_000 });

    worker.emitForRun({ type: 'done', executionTime: 5 });
    const result = await promise;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(result.kind).toBe('success');
    expect(result.executionTime).toBe(5);
  });
});

describe('debugger stepping', () => {
  it('suspends the deadline while paused and re-arms it on resume', async () => {
    vi.useFakeTimers();
    const { promise, worker } = startRun({ timeout: 1_000, context: { tabId: 'tab-1' } });

    worker.emitForRun({
      type: 'paused',
      line: 2,
      reason: 'user-breakpoint',
      locals: {},
      callStack: [],
      watchResults: {},
    });
    // A paused debugger waits on the user, so time passing must not kill it.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(worker.terminated).toBe(false);

    worker.emitForRun({ type: 'resumed' });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(worker.terminated).toBe(true);
    expect((await promise).timeoutMs).toBe(1_000);
  });
});

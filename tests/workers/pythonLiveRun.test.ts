// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LIVE_RUN_THROTTLE_MS, mapLiveRunLines, sanitizeLiveRun, type LiveRunSnapshot } from '@/../shared/liveRun';
import { injectPythonLoopProtectionWithLineMap } from '@/utils/loopProtection';
import type { PythonWorkerOutboundMessage } from '@/workers/python-worker-protocol';
import type { PyodideRuntime } from '@/workers/python-worker-runtime';

const require = createRequire(import.meta.url);
const { loadPyodide } = require('pyodide') as typeof import('pyodide');
const posted: Array<{ message: PythonWorkerOutboundMessage; at: number }> = [];
let py: Awaited<ReturnType<typeof loadPyodide>>;
let handle: ReturnType<typeof import('@/workers/python-worker-execution').createPythonExecutionHandler>;

beforeAll(async () => {
  const port = { postMessage: (message: PythonWorkerOutboundMessage) => posted.push({ message, at: performance.now() }) };
  vi.stubGlobal('self', port);
  py = await loadPyodide({ indexURL: path.dirname(require.resolve('pyodide')) });
  const { createPythonExecutionHandler } = await import('@/workers/python-worker-execution');
  handle = createPythonExecutionHandler(port, {
    loadPyodide: async () => py as unknown as PyodideRuntime,
    ensureMicropip: async () => ({}),
    setActiveRunId: vi.fn(),
    resetStdin: () => py.setStdin(),
  });
}, 30_000);
afterAll(() => vi.unstubAllGlobals());

/** Runs `source` the way the runner does: loop-protected, then mapped back to the user's lines. */
async function execute(source: string, extra: { live?: boolean; autoLog?: boolean; autoLogMode?: 'assignments' } = { live: true }) {
  posted.length = 0;
  const { code, sourceLineMap } = injectPythonLoopProtectionWithLineMap(source, 100_000_000);
  const toSource = (line: number | undefined) => (line === undefined ? undefined : (sourceLineMap[line] ?? line));
  const startedAt = performance.now();
  await handle({ type: 'execute', runId: 'py-live', code, ...extra });
  const of = <T extends PythonWorkerOutboundMessage['type']>(type: T) =>
    posted.filter(entry => entry.message.type === type) as Array<{ message: Extract<PythonWorkerOutboundMessage, { type: T }>; at: number }>;
  const lives = of('live-line').map(entry => ({ at: entry.at, live: mapLiveRunLines(entry.message.live, toSource)! }));
  const done = of('done')[0]!;
  return { lives, startedAt, done, console: of('console'), magic: of('magic-comment'), error: of('error')[0] };
}

describe('Python live line', () => {
  it('samples the running line and each loop pass through a long loop, throttled', async () => {
    const source = [
      'import time',
      'names = ["api", "worker", "db"]',
      'spins = 0',
      'for name in names:',
      '    until = time.perf_counter() + 0.15',
      '    while time.perf_counter() < until:',
      '        spins += 1',
    ].join('\n');
    const run = await execute(source);
    expect(run.error).toBeUndefined();
    expect(run.lives.length).toBeGreaterThanOrEqual(5);
    expect(run.lives.length).toBeLessThanOrEqual(Math.ceil((run.done.at - run.startedAt) / LIVE_RUN_THROTTLE_MS) + 1);
    for (const { live } of run.lives) {
      expect(sanitizeLiveRun(live)).toEqual(live);
      expect([6, 7]).toContain(live.line);
      expect(live.loops[0]).toMatchObject({ line: 4, total: 3 });
      expect(live.loops[1]?.line).toBe(6);
      expect(live.loops[1]).not.toHaveProperty('total');
    }
    const outer = run.lives.map(({ live }) => live.loops[0]!.pass);
    expect(outer).toEqual([...outer].sort());
    expect(outer.at(-1)).toBe(3);
    expect(run.lives.at(-1)!.live.loops[1]!.pass).toBeGreaterThan(100);
  });

  it('reports a blocking sleep on its line with its length before it blocks', async () => {
    const run = await execute(['from time import sleep', 'for n in range(2):', '    sleep(0.2)', 'print("done")'].join('\n'));
    const waits = run.lives.filter(({ live }) => live.waitMs !== undefined);
    expect(waits.map(({ live }) => live.line)).toEqual([3, 3]);
    expect(waits.map(({ live }) => live.waitMs)).toEqual([200, 200]);
    expect(waits.map(({ live }) => live.loops)).toEqual([
      [{ line: 2, end: 3, pass: 1, total: 2, binding: { name: 'n', value: '0' } }],
      [{ line: 2, end: 3, pass: 2, total: 2, binding: { name: 'n', value: '1' } }],
    ]);
    // Posted as the sleep began, not when it ended.
    expect(waits[1]!.at - waits[0]!.at).toBeGreaterThanOrEqual(180);
    expect(run.done.at - waits[1]!.at).toBeGreaterThanOrEqual(180);
  });

  it('sends the loop variable as a repr of builtin values only', async () => {
    const run = await execute(
      [
        'from time import sleep',
        'class Box:',
        '    def __repr__(self):',
        '        raise RuntimeError("never read")',
        'for name in ["api", "db"]:',
        '    sleep(0.06)',
        'for box in [Box()]:',
        '    sleep(0.06)',
        'for row in [list(range(60))]:',
        '    sleep(0.06)',
        'for pair in [(1, "a")]:',
        '    sleep(0.06)',
        'for a, b in [(1, 2)]:',
        '    sleep(0.06)',
        'for big in [10 ** 5000]:',
        '    sleep(0.06)',
      ].join('\n')
    );
    expect(run.error).toBeUndefined();
    const bindingAt = (line: number) => run.lives.find(({ live }) => live.waitMs !== undefined && live.line === line)?.live.loops[0]?.binding;
    expect(run.lives.filter(({ live }) => live.waitMs !== undefined && live.line === 6).map(({ live }) => live.loops[0]?.binding?.value)).toEqual(["'api'", "'db'"]);
    expect(bindingAt(8)).toBeUndefined();
    expect(bindingAt(10)).toBeUndefined();
    expect(bindingAt(12)).toEqual({ name: 'pair', value: "(1, 'a')" });
    expect(bindingAt(14)).toBeUndefined();
    // Past the int digit limit repr raises; the sample still goes out.
    expect(run.lives.some(({ live }) => live.waitMs !== undefined && live.line === 16)).toBe(true);
    expect(bindingAt(16)).toBeUndefined();
  });

  it('measures time on the current line in the runtime', async () => {
    const run = await execute(['import time', 'x = 0', 'end = time.perf_counter() + 0.25', 'while time.perf_counter() < end: x += 1'].join('\n'));
    const onLoop = run.lives.filter(({ live }) => live.line === 4).map(({ live }) => live);
    expect(onLoop.length).toBeGreaterThanOrEqual(3);
    const last = onLoop.at(-1) as LiveRunSnapshot;
    expect(last.lineMs).toBeGreaterThanOrEqual(150);
    expect(last.lineMs).toBeLessThanOrEqual(last.elapsedMs);
  });

  it('tags prints and answers with their pass; two calls on one line share it', async () => {
    const run = await execute(
      ['def show(x):', '    print(x)', 'show(1); show(2)', 'for v in [3, 4]:', '    show(v); show(v * 10)', 'for i in range(2):', '    for j in range(2):', '        print(i, j)'].join('\n')
    );
    const passes = run.console.map(entry => entry.message.pass);
    expect(passes.slice(0, 2)).toEqual([0, 0]);
    const [a, b, c, d] = passes.slice(2, 6) as number[];
    expect(a).toBe(b);
    expect(c).toBe(d);
    expect(c).not.toBe(a);
    expect(new Set(passes.slice(6)).size).toBe(4);
  });

  it('numbers the passes of a loop entered again apart from its first run', async () => {
    const run = await execute(['def f():', '    for i in range(2):', '        print(i)', 'f()', 'f()'].join('\n'));
    expect(new Set(run.console.map(entry => entry.message.pass)).size).toBe(4);
  });

  it('runs and numbers a loop inside a class method', async () => {
    const run = await execute(['class A:', '    def run(self):', '        for i in range(3):', '            print(i)', 'A().run()'].join('\n'));
    expect(run.error).toBeUndefined();
    expect(run.console.map(entry => entry.message.args)).toEqual([['0'], ['1'], ['2']]);
    expect(new Set(run.console.map(entry => entry.message.pass)).size).toBe(3);
  });

  it('tags auto-log answers too, and leaves results untagged when the signal is off', async () => {
    const live = await execute(['total = 0', 'for n in range(2):', '    total += n', 'total'].join('\n'), { live: true, autoLog: true, autoLogMode: 'assignments' });
    expect(live.magic.map(entry => entry.message.pass)).toEqual([0, 0]);
    const off = await execute(['for n in range(2):', '    print(n)'].join('\n'), {});
    expect(off.console.map(entry => entry.message.pass)).toEqual([undefined, undefined]);
    expect(off.lives).toEqual([]);
  });

  it('keeps the result of the last expression and puts the signal handler back', async () => {
    posted.length = 0;
    await handle({ type: 'execute', runId: 'py-live', code: '1 + 1', live: true });
    expect(posted.find(entry => entry.message.type === 'result')?.message).toMatchObject({ value: '2' });
    expect(py.runPython('import signal\nsignal.getsignal(signal.SIGUSR1) in (signal.SIG_DFL, None)')).toBe(true);
  });

  it('does not read the auto-log wrapper as a user frame', async () => {
    // The module frame, then the auto-log pass, then the wrapper that called it.
    const run = await execute(['import sys', 'caller = sys._getframe(2).f_code.co_filename', 'print(caller)'].join('\n'), { live: true, autoLog: true, autoLogMode: 'assignments' });
    expect(run.console.map(entry => entry.message.args[0])).toEqual(['<lingua-auto-log>']);
  });

  it('turns the signal off again when sampling cannot start', async () => {
    const runtime = py as unknown as { setInterruptBuffer: (buffer: unknown) => void };
    const original = runtime.setInterruptBuffer.bind(py);
    runtime.setInterruptBuffer = () => {
      throw new Error('no buffer');
    };
    try {
      const failed = await execute('for n in range(2):\n    print(n)');
      expect(failed.console.map(entry => entry.message.pass)).toEqual([undefined, undefined]);
    } finally {
      runtime.setInterruptBuffer = original;
    }
    expect(py.runPython('__lingua_live_state is None')).toBe(true);
  });
});

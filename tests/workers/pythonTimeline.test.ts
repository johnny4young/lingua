// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  TIMELINE_MAX_STEPS,
  TIMELINE_PROGRESS_MS,
  mapTimelineLines,
  sanitizeTimeline,
  type ExecutionTimeline,
} from '@/../shared/timeline';
import { injectPythonLoopProtectionWithLineMap } from '@/utils/loopProtection';
import { detectLoops, slowestLine } from '@/utils/runTraceModel';
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
async function record(source: string, extra: { record?: boolean; live?: boolean; autoLog?: boolean; autoLogMode?: 'assignments' } = { record: true }) {
  posted.length = 0;
  const { code, sourceLineMap } = injectPythonLoopProtectionWithLineMap(source, 100_000_000);
  const toSource = (line: number) => sourceLineMap[line] ?? line;
  const startedAt = performance.now();
  await handle({ type: 'execute', runId: 'py-record', code, ...extra });
  const of = <T extends PythonWorkerOutboundMessage['type']>(type: T) =>
    posted.filter(entry => entry.message.type === type) as Array<{ message: Extract<PythonWorkerOutboundMessage, { type: T }>; at: number }>;
  const final = of('timeline')[0]?.message.timeline;
  const timeline = final ? mapTimelineLines(sanitizeTimeline(final)!, toSource) : undefined;
  const progress = of('timeline-steps').map(entry => ({
    at: entry.at,
    ms: entry.message.ms,
    steps: mapTimelineLines(sanitizeTimeline({ steps: entry.message.steps })!, toSource).steps,
  }));
  const done = of('done')[0]!;
  return { timeline, progress, done, startedAt, error: of('error')[0], lives: of('live-line') };
}

const LATENCIES = [
  'from statistics import mean',
  'from time import sleep',
  '',
  'api = [38, 41, 35]',
  'db = [92, 88, 131]',
  'latencies = {"api": api, "db": db}',
  'for name in latencies:',
  '    live = [x * 2 for x in latencies[name]]',
  '    sleep(0.2)',
  '    print(f"{name} {mean(live):.1f} ms")',
  'print("done")',
].join('\n');

describe('Python Record run', () => {
  it('keeps one step per line in the JS shape, with loop passes, ms and the line that slept', async () => {
    const run = await record(LATENCIES);
    expect(run.error).toBeUndefined();
    const timeline = run.timeline as ExecutionTimeline;
    expect(timeline.truncated).toBe(false);
    expect(timeline.steps.map(step => step.line)).toEqual([1, 2, 4, 5, 6, 7, 8, 9, 10, 8, 9, 10, 11]);
    for (const step of timeline.steps) {
      expect(step.frames).toEqual([{ name: '<module>', line: step.line }]);
      expect(step.depth).toBe(0);
      expect(step.call).toBe(0);
    }
    // Times climb, and each sleep shows on its own line.
    const times = timeline.steps.map(step => step.ms!);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(timeline.ms).toBeGreaterThanOrEqual(times.at(-1)!);
    const slowest = slowestLine(timeline.steps, timeline.ms)!;
    expect(slowest.line).toBe(9);
    expect(slowest.ms).toBeGreaterThanOrEqual(380);
    expect(slowest.share).toBeGreaterThan(0.8);
    // Two passes of the loop headed by line 7.
    expect(detectLoops(timeline.steps).map(loop => ({ head: loop.head, passes: loop.passes.length }))).toEqual([{ head: 8, passes: 2 }]);
    // Prints mark the step that wrote them.
    expect(timeline.steps.filter(step => step.log).map(step => step.line)).toEqual([10, 10, 11]);
  });

  it('shows a module name only after the line that binds it ran, without callables or modules', async () => {
    await record('x = 99\ny = 1');
    const run = await record(LATENCIES);
    const varsAt = (index: number) => Object.fromEntries(run.timeline!.steps[index]!.vars);
    expect(varsAt(0)).toEqual({});
    expect(varsAt(3)).toEqual({ api: '[38, 41, 35]' });
    expect(varsAt(5)).toEqual({ api: '[38, 41, 35]', db: '[92, 88, 131]', latencies: "{'api': [38, 41, 35], 'db': [92, 88, 131]}" });
    expect(varsAt(6)).toMatchObject({ name: "'api'" });
    expect(varsAt(6)).not.toHaveProperty('live');
    expect(varsAt(7)).toMatchObject({ name: "'api'", live: '[76, 82, 70]' });
    expect(varsAt(9)).toMatchObject({ name: "'db'", live: '[76, 82, 70]' });
    expect(Object.keys(varsAt(12))).not.toContain('mean');
    expect(Object.keys(varsAt(12))).not.toContain('sleep');
  });

  it('shows a global bound outside its own lines, such as an import or a global set in a function', async () => {
    await record('pi = 0\ncount = 5');
    const run = await record(['from math import pi', 'def bump():', '    global count', '    count = 1', 'bump()', 'x = 2'].join('\n'));
    const last = Object.fromEntries(run.timeline!.steps.at(-1)!.vars);
    expect(last).toMatchObject({ pi: '3.141592653589793', count: '1' });
    expect(Object.fromEntries(run.timeline!.steps[0]!.vars)).toEqual({});
  });

  it('frames calls, numbers each one, and reads locals without user code', async () => {
    const run = await record(
      [
        'class Box:',
        '    def __repr__(self):',
        '        raise RuntimeError("never read")',
        'def area(w, h):',
        '    box = Box()',
        '    big = 10 ** 5000',
        '    return w * h',
        'a = area(2, 3)',
        'b = area(4, 5)',
      ].join('\n')
    );
    expect(run.error).toBeUndefined();
    const steps = run.timeline!.steps;
    // The class body runs its def, so it is a frame of its own.
    expect(steps.map(step => step.line)).toEqual([1, 2, 4, 8, 5, 6, 7, 9, 5, 6, 7]);
    expect(steps[1]!.frames.map(frame => frame.name)).toEqual(['<module>', 'Box']);
    const inside = steps.filter(step => step.frames.at(-1)!.name === 'area');
    expect(inside.every(step => step.frames.map(frame => frame.name).join('>') === '<module>>area')).toBe(true);
    expect(inside[0]!.frames[0]!.line).toBe(8);
    expect(inside[3]!.frames[0]!.line).toBe(9);
    expect(new Set(inside.slice(0, 3).map(step => step.call)).size).toBe(1);
    expect(inside[0]!.call).not.toBe(inside[3]!.call);
    expect(Object.fromEntries(inside[2]!.vars)).toEqual({ w: '2', h: '3', box: '<Box>', big: '<int>' });
  });

  it('records a statement that spans lines once, on its first line', async () => {
    const run = await record(['names = ["api", "db"]', 'report = [', '    {"name": n}', '    for n in names', ']', 'total = sum(', '    len(n) for n in names', ')'].join('\n'));
    expect(run.timeline!.steps.map(step => step.line)).toEqual([1, 2, 6]);
  });

  it('keeps a first line that spans the columns of the final-expression rewrite in Pyodide', async () => {
    const run = await record(['from statistics import mean, quantiles', 'print(mean([1, 2]))'].join('\n'));
    expect(run.timeline!.steps.map(step => step.line)).toEqual([1, 2]);
  });

  it('marks the step that raised and still posts the timeline', async () => {
    const run = await record(['x = 1', 'y = x / 0', 'z = 2'].join('\n'));
    expect(run.error).toBeDefined();
    expect(run.timeline!.steps.map(step => [step.line, step.error ?? false])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it('posts the steps while the run goes, before a sleep blocks', async () => {
    const run = await record(LATENCIES);
    expect(run.progress.length).toBeGreaterThanOrEqual(2);
    const streamed = run.progress.flatMap(entry => entry.steps.map(step => step.line));
    expect(streamed).toEqual(run.timeline!.steps.slice(0, streamed.length).map(step => step.line));
    // The first sleep's step reaches the renderer while it sleeps, not after.
    const first = run.progress.find(entry => entry.steps.some(step => step.line === 9))!;
    expect(run.done.at - first.at).toBeGreaterThanOrEqual(300);
    for (const entry of run.progress) expect(entry.ms).toBeGreaterThanOrEqual(entry.steps.at(-1)!.ms!);
  });

  it('throttles posts in a busy loop and stops at the step cap', async () => {
    const run = await record(['total = 0', 'for i in range(20000):', '    total += i'].join('\n'));
    expect(run.timeline!.truncated).toBe(true);
    expect(run.timeline!.steps).toHaveLength(TIMELINE_MAX_STEPS);
    expect(run.progress.length).toBeLessThanOrEqual(Math.ceil((run.done.at - run.startedAt) / TIMELINE_PROGRESS_MS) + 2);
  });

  it('leaves no tracing behind: a normal run after a recording posts no steps', async () => {
    await record(LATENCIES);
    const run = await record(LATENCIES, {});
    expect(run.timeline).toBeUndefined();
    expect(run.progress).toEqual([]);
    expect(py.runPython('import sys; sys.monitoring.get_tool(4) or sys.monitoring.get_tool(3)')).toBeUndefined();
  });

  it('records a Scratchpad auto-log run and never beside the live signal', async () => {
    const run = await record('a = 1\nb = a + 1', { record: true, autoLog: true, autoLogMode: 'assignments' });
    expect(run.timeline!.steps.map(step => step.line)).toEqual([1, 2]);
    const both = await record('a = 1', { record: true, live: true });
    expect(both.timeline!.steps.map(step => step.line)).toEqual([1]);
    expect(both.lives).toEqual([]);
  });
});

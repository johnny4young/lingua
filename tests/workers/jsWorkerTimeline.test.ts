// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

// The worker modules read `self` on import; here it is the test's globalThis.
vi.hoisted(() => {
  (globalThis as { self?: unknown }).self = globalThis;
});

import type { ExecutionTimeline } from '@/../shared/timeline';
import { TIMELINE_MAX_FRAMES, TIMELINE_MAX_STEPS, TIMELINE_MAX_VARS } from '@/../shared/timeline';
import { instrumentForTimeline } from '@/runtime/timelineInstrument';
import { createJsWorkerTimeline, previewTimelineValue } from '@/workers/js-worker-timeline';
import { sanitizeTimeline } from '@/../shared/timeline';

type Message = { type: string; [key: string]: unknown };

/** Runs recorded code through the real JS worker handler. */
async function record(source: string, recordRun = true) {
  vi.resetModules();
  const messages: Message[] = [];
  vi.stubGlobal('postMessage', (message: Message) => messages.push(message));
  vi.stubGlobal('self', globalThis);
  const { createJsWorkerMessageHandler } = await import('@/workers/js-worker-execution');
  const handler = createJsWorkerMessageHandler(globalThis as unknown as Worker);
  const code = recordRun ? instrumentForTimeline(source).code : source;
  await handler({ data: { type: 'execute', runId: 'rec', code, record: recordRun } } as MessageEvent);
  const timeline = (messages.find(message => message.type === 'timeline') as { timeline?: ExecutionTimeline } | undefined)?.timeline;
  return { messages, timeline };
}

afterEach(() => vi.unstubAllGlobals());

describe('JS worker timeline', () => {
  it('records every step with values, frames and the console line, before done', async () => {
    const { messages, timeline } = await record(
      ['function double(n) {', '  const twice = n * 2;', '  return twice;', '}', 'const values = [1, 2];', 'for (const v of values) {', '  console.log(double(v));', '}'].join('\n')
    );
    expect(timeline?.truncated).toBe(false);
    expect(timeline?.steps.map(step => step.line)).toEqual([5, 6, 7, 2, 3, 7, 2, 3]);
    expect(timeline?.steps[3]).toMatchObject({
      line: 2,
      frames: [{ name: '<module>', line: 7 }, { name: 'double', line: 2 }],
      vars: [['n', '1']],
    });
    expect(timeline?.steps[4]?.vars).toEqual([['n', '1'], ['twice', '2']]);
    expect(timeline?.steps[4]?.log).toBe('log');
    expect(messages.findIndex(message => message.type === 'timeline')).toBeLessThan(messages.findIndex(message => message.type === 'done'));
  });

  it('marks console.table output on the step that wrote it', async () => {
    const { timeline } = await record('const rows = [{ a: 1 }];\nconsole.table(rows);');
    expect(timeline?.steps.at(-1)).toMatchObject({ line: 2, log: 'log' });
  });

  it('marks the step where the run threw', async () => {
    const { timeline } = await record('const a = 1;\nnull.boom;');
    expect(timeline?.steps.at(-1)).toMatchObject({ line: 2, error: true });
  });

  it('posts no timeline for a normal run', async () => {
    const { timeline, messages } = await record('const a = 1;', false);
    expect(timeline).toBeUndefined();
    expect(messages.some(message => message.type === 'done')).toBe(true);
  });
});

describe('timeline step buffer', () => {
  it('stops at the step cap and keeps only the current line afterwards', () => {
    const timeline = createJsWorkerTimeline();
    const getLocals = vi.fn(() => ({ i: 1 }));
    for (let i = 0; i < TIMELINE_MAX_STEPS + 10; i += 1) timeline.rec(1, getLocals);
    expect(timeline.snapshot().steps).toHaveLength(TIMELINE_MAX_STEPS);
    expect(timeline.snapshot().truncated).toBe(true);
    expect(getLocals).toHaveBeenCalledTimes(TIMELINE_MAX_STEPS);
  });

  it('caps variables per step, skips functions, keeps the strongest console method and survives a throwing getter', () => {
    const timeline = createJsWorkerTimeline();
    const many = Object.fromEntries(Array.from({ length: TIMELINE_MAX_VARS + 5 }, (_, i) => [`v${i}`, i]));
    timeline.rec(1, () => ({ fn: () => 1, ...many }));
    expect(timeline.snapshot().steps[0]!.vars).toHaveLength(TIMELINE_MAX_VARS);
    expect(timeline.snapshot().steps[0]!.vars[0]).toEqual(['v0', '0']);
    timeline.noteConsole('warn');
    timeline.noteConsole('log');
    expect(timeline.snapshot().steps[0]!.log).toBe('warn');
    timeline.rec(2, () => {
      throw new Error('getter');
    });
    expect(timeline.snapshot().steps[1]).toMatchObject({ line: 2, vars: [] });
    timeline.exit();
    expect(timeline.snapshot().steps[1]!.frames).toEqual([{ name: '<module>', line: 2 }]);
  });

  it('records the true depth and a distinct id for each call', () => {
    const timeline = createJsWorkerTimeline();
    for (let depth = 0; depth < TIMELINE_MAX_FRAMES + 2; depth += 1) timeline.enter('f', 1);
    timeline.rec(2, () => ({}));
    timeline.exit();
    timeline.enter('g', 3);
    timeline.rec(4, () => ({}));
    const [deepStep, sibling] = timeline.snapshot().steps;
    expect(deepStep).toMatchObject({ depth: TIMELINE_MAX_FRAMES + 2, call: TIMELINE_MAX_FRAMES + 2 });
    expect(deepStep!.frames).toHaveLength(TIMELINE_MAX_FRAMES);
    expect(sibling).toMatchObject({ depth: TIMELINE_MAX_FRAMES + 2, call: TIMELINE_MAX_FRAMES + 3 });
    expect(sanitizeTimeline({ steps: [{ line: 1, frames: [], vars: [], depth: -1, call: 2.5 }] })!.steps[0]).toEqual({ line: 1, frames: [], vars: [] });
  });

  it('cuts long values to their preview length', () => {
    const timeline = createJsWorkerTimeline();
    timeline.rec(1, () => ({ text: 'x'.repeat(500) }));
    expect(timeline.snapshot().steps[0]!.vars[0]![1]).toHaveLength(120);
  });
});

describe('timeline value preview', () => {
  it('never runs getters, toJSON or user code while previewing', () => {
    const getter = vi.fn(() => 1);
    const toJSON = vi.fn(() => 'x');
    const value = { a: 1, toJSON, get b() { return getter(); } };
    expect(previewTimelineValue(value)).toBe('{ a: 1, toJSON: [Function], b: [Getter] }');
    expect(getter).not.toHaveBeenCalled();
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('stays short for huge or deep values and survives values that refuse to convert', () => {
    const big = Array.from({ length: 200_000 }, (_, i) => i);
    const started = performance.now();
    const shown = previewTimelineValue(big);
    expect(performance.now() - started).toBeLessThan(50);
    expect(shown.length).toBeLessThanOrEqual(120);
    const sparse: unknown[] = [];
    sparse.length = 20_000_000;
    const sparseStarted = performance.now();
    expect(previewTimelineValue(sparse).startsWith('[ undefined, undefined')).toBe(true);
    expect(performance.now() - sparseStarted).toBeLessThan(50);
    expect(previewTimelineValue({ a: { b: { c: 1 } } })).toBe('{ a: { b: {…} } }');
    const looped = Object.create(null) as Record<string, unknown>;
    looped.self = looped;
    expect(previewTimelineValue(looped)).toBe('{ self: { self: {…} } }');
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(previewTimelineValue(proxy)).toBe('[unreadable]');
    expect(previewTimelineValue([3, 1])).toBe('[ 3, 1 ]');
    expect(previewTimelineValue('hi')).toBe('"hi"');
  });

  it('never throws into user code, whatever the recorder is called with', () => {
    const timeline = createJsWorkerTimeline();
    expect(() => timeline.rec(() => 1, 'not a function')).not.toThrow();
    expect(() => timeline.enter({ toString: null }, Symbol('line'))).not.toThrow();
    timeline.rec(2, () => ({ x: 1 }));
    const steps = timeline.snapshot().steps;
    expect(steps[0]).toMatchObject({ line: 0, vars: [] });
    expect(steps[1]).toMatchObject({ line: 2, frames: [{ name: '<module>', line: 0 }, { name: '<anonymous>', line: 2 }] });
    const guarded = createJsWorkerTimeline();
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => guarded.rec(1, () => proxy)).not.toThrow();
    expect(guarded.snapshot().truncated).toBe(true);
  });

  it('re-applies the caps and types to a timeline from the worker', () => {
    const forged = {
      steps: [
        { line: 'x', frames: [{ name: { evil: true }, line: 3 }], vars: [['n', 1], 'bad'], log: 'shout', error: 'yes' },
        null,
        { line: 4, frames: [], vars: [['k', 'v'.repeat(500)]], log: 'warn', error: true },
      ],
      truncated: 'no',
    };
    expect(sanitizeTimeline(forged)).toEqual({
      steps: [
        { line: 0, frames: [{ name: '<anonymous>', line: 3 }], vars: [['n', ''], ['', '']] },
        { line: 4, frames: [], vars: [['k', 'v'.repeat(120)]], log: 'warn', error: true },
      ],
      truncated: false,
    });
    expect(sanitizeTimeline({ steps: 'no' })).toBeUndefined();
  });
});


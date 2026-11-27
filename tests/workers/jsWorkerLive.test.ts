// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { self?: unknown }).self = globalThis;
});

import { LIVE_RUN_THROTTLE_MS, sanitizeLiveRun, type LiveRunSnapshot } from '@/../shared/liveRun';
import { instrumentForLive } from '@/runtime/liveInstrument';
import { createJsWorkerLive } from '@/workers/js-worker-live';

type Message = { type: string; [key: string]: unknown };

async function run(source: string) {
  vi.resetModules();
  const messages: Array<Message & { at: number }> = [];
  vi.stubGlobal('postMessage', (message: Message) => messages.push({ ...message, at: performance.now() }));
  vi.stubGlobal('self', globalThis);
  const { createJsWorkerMessageHandler } = await import('@/workers/js-worker-execution');
  const handler = createJsWorkerMessageHandler(globalThis as unknown as Worker);
  const { code, loops } = instrumentForLive(source, { maxLine: source.split('\n').length });
  const startedAt = performance.now();
  await handler({ data: { type: 'execute', runId: 'live', code, live: { loops } } } as MessageEvent);
  const lives = messages.filter(message => message.type === 'live-line') as Array<Message & { at: number; live: LiveRunSnapshot; v: number }>;
  return { messages, lives, startedAt };
}

afterEach(() => vi.unstubAllGlobals());

describe('JS worker live line', () => {
  it('reports the line and the pass of each loop through a long loop, throttled', async () => {
    const source = [
      'const names = ["api", "worker", "db"];',
      'let spins = 0;',
      'for (const name of names) {',
      '  const until = Date.now() + 120;',
      '  while (Date.now() < until) {',
      '    spins += 1;',
      '  }',
      '}',
    ].join('\n');
    const { lives, messages, startedAt } = await run(source);
    const done = messages.find(message => message.type === 'done')!;
    expect(lives.length).toBeGreaterThanOrEqual(4);
    // Never more than one snapshot per throttle window, even with millions of probes.
    expect(lives.length).toBeLessThanOrEqual(Math.ceil((done.at - startedAt) / LIVE_RUN_THROTTLE_MS) + 1);
    for (const [index, entry] of lives.entries()) {
      expect(entry.v).toBe(1);
      expect(sanitizeLiveRun(entry.live)).toEqual(entry.live);
      expect([5, 6]).toContain(entry.live.line);
      expect(entry.live.loops[0]).toMatchObject({ line: 3, total: 3 });
      expect(entry.live.loops[1]?.line).toBe(5);
      if (index > 0) expect(entry.at - lives[index - 1]!.at).toBeGreaterThanOrEqual(LIVE_RUN_THROTTLE_MS - 5);
    }
    expect(lives.map(entry => entry.live.loops[0]!.pass)).toEqual([...lives.map(entry => entry.live.loops[0]!.pass)].sort());
    expect(lives.at(-1)!.live.loops[0]!.pass).toBe(3);
    expect(lives.at(-1)!.live.loops[1]!.pass).toBeGreaterThan(1000);
  });

  it('keeps measuring a blocking sleep on its own line while the run waits', async () => {
    const source = ['let a = 1;', 'await new Promise(resolve => setTimeout(resolve, 300));', 'a += 1;'].join('\n');
    const { lives } = await run(source);
    const waiting = lives.filter(entry => entry.live.line === 2);
    expect(waiting.length).toBeGreaterThanOrEqual(3);
    expect(waiting.at(-1)!.live.lineMs).toBeGreaterThanOrEqual(200);
    expect(waiting.at(-1)!.live.lineMs).toBeLessThanOrEqual(waiting.at(-1)!.live.elapsedMs);
    expect(waiting.map(entry => entry.live.lineMs)).toEqual([...waiting.map(entry => entry.live.lineMs)].sort((a, b) => a - b));
  });

  it('posts nothing for a run shorter than one throttle window', async () => {
    const { lives, messages } = await run('let total = 0;\nfor (let i = 0; i < 1000; i++) total += i;');
    expect(lives).toEqual([]);
    expect(messages.some(message => message.type === 'done')).toBe(true);
  });

  it('tags each output with the pass it came from, so two calls on one line share a pass', async () => {
    const source = [
      'function show(x) { console.log(x); }',
      'show(1); show(2);',
      'for (const v of [3, 4]) {',
      '  show(v); show(v * 10);',
      '}',
      'for (let i = 0; i < 2; i++) {',
      '  for (let j = 0; j < 2; j++) console.log(i, j);',
      '}',
    ].join('\n');
    const { messages } = await run(source);
    const passes = messages.filter(message => message.type === 'console').map(message => message.pass);
    const [first, second, a, b, c, d, ...nested] = passes as number[];
    expect([first, second]).toEqual([0, 0]);
    expect(a).toBe(b);
    expect(c).toBe(d);
    expect(c).not.toBe(a);
    expect(a).toBeGreaterThan(0);
    // Every pass of the inner loop is its own pass, across passes of the outer one.
    expect(new Set(nested).size).toBe(4);
  });

  it('answers magic comments with their pass', async () => {
    const { messages } = await run('let n = 0;\nwhile (n < 2) {\n  n += 1;\n  __mc(4, n);\n}');
    const magic = messages.filter(message => message.type === 'magic-comment');
    expect(magic.map(message => message.value)).toEqual(['1', '2']);
    expect(magic[0]!.pass).not.toBe(magic[1]!.pass);
  });
});

describe('live tracker', () => {
  it('adapts how often it reads the clock to how fast probes come', () => {
    let clock = 0;
    const reads = vi.fn(() => clock);
    const posted: LiveRunSnapshot[] = [];
    const tracker = createJsWorkerLive(live => posted.push(live), [1], reads);
    // Slow lines read the clock at every probe and time each line exactly.
    clock = 10;
    tracker.line(2);
    clock = 30;
    tracker.line(3);
    clock = 80;
    tracker.line(3);
    expect(posted.at(-1)).toMatchObject({ line: 3, lineMs: 50, elapsedMs: 80 });
    // A hot stretch reads it once per growing countdown.
    reads.mockClear();
    for (let i = 0; i < 10_000; i += 1) tracker.line(4 + (i % 2));
    expect(reads.mock.calls.length).toBeLessThan(100);
    tracker.stop();
  });

  it('reports loop passes and totals, outermost first, and pops loops that end', () => {
    let clock = 0;
    let outer = 0;
    let inner = 0;
    const posted: LiveRunSnapshot[] = [];
    const tracker = createJsWorkerLive(live => posted.push(live), [2, 4], () => clock);
    clock = 10;
    tracker.loop(0, () => outer);
    tracker.of(0, new Set(['a', 'b']));
    outer = 1;
    tracker.loop(1, () => inner);
    tracker.of(1, (function* () {})());
    inner = 2;
    const first = tracker.passOrdinal();
    clock = 60;
    tracker.line(5);
    expect(posted.at(-1)!.loops).toEqual([{ line: 2, pass: 1, total: 2 }, { line: 4, pass: 2 }]);
    expect(tracker.passOrdinal()).toBe(first);
    inner = 3;
    expect(tracker.passOrdinal()).not.toBe(first);
    tracker.end(1);
    expect(tracker.passOrdinal()).toBeGreaterThan(0);
    tracker.end(0);
    expect(tracker.passOrdinal()).toBe(0);
    tracker.stop();
  });
});

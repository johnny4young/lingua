// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

// The worker modules read `self` on import; here it is the test's globalThis.
vi.hoisted(() => {
  (globalThis as { self?: unknown }).self = globalThis;
});

import { instrumentForDebugger } from '@/runtime/debuggerInstrument';
import type { WorkerResponse } from '@/types/execution';

type Paused = Extract<WorkerResponse, { type: 'paused' }>;

const SORT = [
  'function quickSort(arr) {',
  '  if (arr.length <= 1) return arr;',
  '  const pivot = arr[Math.floor(arr.length / 2)];',
  '  const left = arr.filter((x) => x < pivot);',
  '  const mid = arr.filter((x) => x === pivot);',
  '  const right = arr.filter((x) => x > pivot);',
  '  return [...quickSort(left), ...mid, ...quickSort(right)];',
  '}',
  '',
  'function mergeSort(arr) {',
  '  return arr;',
  '}',
  '',
  'const nums = [3, 6, 8, 10, 1, 2, 1];',
  'const total = nums.reduce(',
  '  (sum, n) => sum + n,',
  '  0',
  ');',
  'console.log(quickSort(nums), total);',
].join('\n');

/** Debugs through the real JS worker handler, resuming each pause after `stopAfter` pauses are collected. */
async function debugRun(source: string, breakpoints: number[], stopAfter: number) {
  vi.resetModules();
  const pauses: Paused[] = [];
  const { createJsWorkerMessageHandler } = await import('@/workers/js-worker-execution');
  let handler: (event: MessageEvent) => Promise<void> = async () => {};
  vi.stubGlobal('postMessage', (message: { type: string }) => {
    if (message.type !== 'paused') return;
    pauses.push(message as Paused);
    setTimeout(() => void handler({ data: { type: 'resume', runId: 'dbg' } } as MessageEvent));
  });
  handler = createJsWorkerMessageHandler(globalThis as unknown as Worker);
  const { code } = instrumentForDebugger(source);
  await handler({
    data: { type: 'execute', runId: 'dbg', code, debug: true, breakpoints: breakpoints.map(line => ({ line })) },
  } as MessageEvent);
  return pauses.slice(0, stopAfter);
}

afterEach(() => vi.unstubAllGlobals());

describe('JS worker pause frames', () => {
  it('reports the line each recursive frame is running, down to the top level', async () => {
    const [first, second] = await debugRun(SORT, [4], 2);
    expect(first!.line).toBe(4);
    expect(first!.callStack).toEqual([
      { functionName: 'quickSort', line: 4, declarationLine: 1, callIndex: 1 },
      { functionName: '<module>', line: 19 },
    ]);
    // The second visit is one call deeper, entered from the caller's return on line 7.
    expect(second!.callStack).toEqual([
      { functionName: 'quickSort', line: 4, declarationLine: 1, callIndex: 1 },
      { functionName: 'quickSort', line: 7, declarationLine: 1, callIndex: 1 },
      { functionName: '<module>', line: 19 },
    ]);
  });

  it('sends every line the session ran, whole multi-line statements included, and never an uncalled function', async () => {
    const [first, second] = await debugRun(SORT, [4], 2);
    // The paused statement has not run on its first visit.
    expect(first!.reachedLines).toEqual([2, 3, 14, 15, 16, 17, 18, 19]);
    expect(second!.reachedLines).toEqual([2, 3, 4, 5, 6, 7, 14, 15, 16, 17, 18, 19]);
    expect(second!.reachedLines).not.toContain(11);
  });

  it('reads nested blocks: the call line inside a loop, the branch taken, a class method that ran', async () => {
    const source = [
      'class Box {',
      '  size(items) {',
      '    return items.length;',
      '  }',
      '}',
      'function visit(n) {',
      '  return n;',
      '}',
      'for (const n of [1]) {',
      '  if (n > 5) {',
      '    console.log(n);',
      '  } else {',
      '    new Box().size([n]);',
      '    visit(n);',
      '  }',
      '}',
    ].join('\n');
    const [pause] = await debugRun(source, [7], 1);
    expect(pause!.callStack).toEqual([
      { functionName: 'visit', line: 7, declarationLine: 6, callIndex: 1 },
      { functionName: '<module>', line: 14 },
    ]);
    expect(pause!.reachedLines).toEqual([3, 9, 10, 13, 14]);
  });

  it('numbers the calls a statement starts per function, so a caller knows which one it waits on', async () => {
    const source = ['function f(n) {', '  return n;', '}', 'const pair = [f(1), f(2)];', 'const next = f(3);'].join('\n');
    const pauses = await debugRun(source, [2], 3);
    expect(pauses.map(pause => pause.callStack[0]!.callIndex)).toEqual([1, 2, 1]);
    expect(pauses.map(pause => pause.callStack[1]!.line)).toEqual([4, 4, 5]);
  });

  it('lists the bindings the paused frame has not assigned yet, with their declaration line', async () => {
    const [first] = await debugRun(SORT, [4], 1);
    expect(first!.unassigned).toEqual([
      { name: 'left', kind: 'const', line: 4 },
      { name: 'mid', kind: 'const', line: 5 },
      { name: 'right', kind: 'const', line: 6 },
    ]);
    expect(Object.keys(first!.locals)).toEqual(['arr', 'pivot']);
  });

  it('sends the lines the paused invocation itself started, not those of another call', async () => {
    const [first, second] = await debugRun(SORT, [4], 2);
    expect(first!.frameLines).toEqual([2, 3]);
    expect(second!.frameLines).toEqual([2, 3]);
    const [atTop] = await debugRun(SORT, [19], 1);
    expect(atTop!.frameLines).toEqual([14, 15]);
  });
});

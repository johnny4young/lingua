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
      { functionName: 'quickSort', line: 4, declarationLine: 1 },
      { functionName: '<module>', line: 19 },
    ]);
    // The second visit is one call deeper, entered from the caller's return on line 7.
    expect(second!.callStack).toEqual([
      { functionName: 'quickSort', line: 4, declarationLine: 1 },
      { functionName: 'quickSort', line: 7, declarationLine: 1 },
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
});

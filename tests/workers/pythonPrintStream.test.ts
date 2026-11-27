// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

async function execute(code: string, extra: { richConsoleEnabled?: boolean } = {}) {
  posted.length = 0;
  const startedAt = performance.now();
  await handle({ type: 'execute', runId: 'py-stream', code, ...extra });
  const done = posted.find(entry => entry.message.type === 'done')!;
  const console = posted.filter(entry => entry.message.type === 'console') as Array<{
    message: Extract<PythonWorkerOutboundMessage, { type: 'console' }>;
    at: number;
  }>;
  return { startedAt, done, console };
}

describe('Python print batches', () => {
  it('posts prints separated by sleep() while the run goes, in order', async () => {
    const run = await execute('from time import sleep\nprint("api")\nsleep(0.3)\nprint("worker")\nsleep(0.3)\nprint("db")');
    expect(run.console.map(entry => entry.message.args[0])).toEqual(['api', 'worker', 'db']);
    expect(run.console.map(entry => entry.message.captureOrder)).toEqual([0, 1, 2]);
    expect(run.console.map(entry => entry.message.line)).toEqual([2, 4, 6]);
    // Two batches reached the console before the run ended, each about when it printed.
    const [api, worker] = run.console;
    expect(api!.at - run.startedAt).toBeLessThan(250);
    expect(worker!.at - api!.at).toBeGreaterThanOrEqual(250);
    expect(run.done.at - worker!.at).toBeGreaterThanOrEqual(250);
  });

  it('sends a quick burst in one batch at the end and keeps the cap across batches', async () => {
    const burst = await execute('for i in range(3):\n    print(i)');
    expect(burst.console.map(entry => entry.message.args[0])).toEqual(['0', '1', '2']);

    const capped = await execute('import time\nfor i in range(5003):\n    print(i)\n    if i % 1000 == 0:\n        time.sleep(0.06)');
    expect(capped.console).toHaveLength(5000);
    expect(new Set(capped.console.map(entry => entry.message.captureOrder)).size).toBe(5000);
  });

  it('keeps plain buffered output at the end when the rich console is off', async () => {
    const run = await execute('import time\nprint("one")\ntime.sleep(0.1)\nprint("two")', { richConsoleEnabled: false });
    expect(run.console.map(entry => entry.message.args[0])).toEqual(['one', 'two']);
  });

  it('gives time.sleep back after the run', async () => {
    await execute('import time\ntime.sleep(0)');
    expect(py.runPython('import time\ntime.sleep is time._lingua_sleep')).toBe(true);
  });
});

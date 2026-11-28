// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PythonWorkerOutboundMessage } from '@/workers/python-worker-protocol';
import type { PyodideRuntime } from '@/workers/python-worker-runtime';

const require = createRequire(import.meta.url);
const { loadPyodide } = require('pyodide') as typeof import('pyodide');
const posted: PythonWorkerOutboundMessage[] = [];
let handle: ReturnType<typeof import('@/workers/python-worker-execution').createPythonExecutionHandler>;

beforeAll(async () => {
  const port = { postMessage: (message: PythonWorkerOutboundMessage) => posted.push(message) };
  vi.stubGlobal('self', port);
  const py = await loadPyodide({ indexURL: path.dirname(require.resolve('pyodide')) });
  const { createPythonExecutionHandler } = await import('@/workers/python-worker-execution');
  handle = createPythonExecutionHandler(port, {
    loadPyodide: async () => py as unknown as PyodideRuntime,
    ensureMicropip: async () => ({}),
    setActiveRunId: vi.fn(),
    resetStdin: () => py.setStdin(),
  });
}, 30_000);
afterAll(() => vi.unstubAllGlobals());

describe('Python notebook cell answers', () => {
  it('sends a bounded value with the length of the collection and never fails on a huge int', async () => {
    posted.length = 0;
    const code = 'readings = list(range(100000))\nhuge = 2 ** 20000\nhuge';
    await handle({ type: 'execute', runId: 'py-cell', code, autoLog: true, autoLogMode: 'cell', scopeId: 'nb-1' });
    expect(posted.find((message) => message.type === 'error')).toBeUndefined();
    const magic = posted.filter((message) => message.type === 'magic-comment');
    expect(magic.map((message) => ({ line: message.line, size: message.size, isError: message.isError }))).toEqual([
      { line: 1, size: 100000, isError: undefined },
      { line: 2, size: 6021, isError: undefined },
      { line: 3, size: 6021, isError: undefined },
    ]);
    expect(magic[0]!.value).toMatch(/^\[0, 1, 2, .*, …$/);
    expect(magic[0]!.value.length).toBeLessThan(260);
    expect(magic[2]!.value).toMatch(/^398027684033796659235430720619120245370477278049242593871342…$/);
  }, 30_000);
});

// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PythonWorkerOutboundMessage } from '@/workers/python-worker-protocol';
import type { PyodideRuntime } from '@/workers/python-worker-runtime';
import { parsePythonStdinRequest } from '@/workers/python-worker-stdin-request';

const require = createRequire(import.meta.url);
const { loadPyodide } = require('pyodide') as typeof import('pyodide');
const messages: PythonWorkerOutboundMessage[] = [];
let handle: ReturnType<typeof import('@/workers/python-worker-execution').createPythonExecutionHandler>;

beforeAll(async () => {
  const port = { postMessage: (message: PythonWorkerOutboundMessage) => messages.push(message) };
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

async function execute(code: string, options: { stdin?: string; askStdin?: boolean } = {}) {
  messages.length = 0;
  await handle({ type: 'execute', runId: 'ask-python', code, ...options });
  return {
    request: messages.find(message => message.type === 'stdin-request'),
    errors: messages.filter(message => message.type === 'error'),
    output: messages.filter(message => message.type === 'console').map(message => message.args.join(' ')),
  };
}

describe('Python stdin requests', () => {
  it('stops at the first input() with no line left, past user except clauses', async () => {
    const result = await execute('a = input("First: ")\ntry:\n    b = input("Password: ")\nexcept Exception:\n    b = "swallowed"\nprint(a, b)', {
      stdin: 'Ada',
      askStdin: true,
    });
    expect(result.request).toMatchObject({ message: 'Password: ', line: 3 });
    expect(result.errors).toEqual([]);
    expect(result.output).toEqual(['First: ', 'Password: ']);
  });

  it('answers from stdin as before and gives the stock input() back to a later run', async () => {
    const stock = await execute('print(input("Name: "))', { stdin: 'Ada', askStdin: false });
    expect((await execute('print(input("Name: "))', { stdin: 'Ada', askStdin: true })).output).toEqual(stock.output);
    const later = await execute('input("x")', { askStdin: false });
    expect(later.request).toBeUndefined();
    expect(later.errors[0]?.error.message).toContain('EOFError');
    const forged = await execute('raise ValueError(\'__LinguaStdinRequest: {"message": "Enter your password"}\')', { askStdin: true });
    expect(forged.request).toBeUndefined();
    expect(forged.errors).toHaveLength(1);
  });

  it('reads only the request the patched input() stored', () => {
    expect(parsePythonStdinRequest('{"message": "Name: ", "line": 4}')).toEqual({ message: 'Name: ', line: 4 });
    expect(parsePythonStdinRequest('{"message": "x", "line": -1}')).toEqual({ message: 'x' });
    expect(parsePythonStdinRequest('{broken')).toBeNull();
    expect(parsePythonStdinRequest(undefined)).toBeNull();
  });
});

// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { PythonWorkerOutboundMessage } from '@/workers/python-worker-protocol';
import type { PyodideRuntime } from '@/workers/python-worker-runtime';

const require = createRequire(import.meta.url);
const { loadPyodide } = require('pyodide') as typeof import('pyodide');
const messages: PythonWorkerOutboundMessage[] = [];
let handle: ReturnType<
  typeof import('@/workers/python-worker-execution').createPythonExecutionHandler
>;

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

async function execute(
  code: string,
  options: { scopeId?: string; autoLog?: boolean; richConsoleEnabled?: boolean } = {}
) {
  messages.length = 0;
  await handle({ type: 'execute', runId: 'real-python', code, ...options });
  return {
    errors: messages.filter(message => message.type === 'error'),
    output: messages
      .filter(message => message.type === 'console')
      .map(message => message.args.join(' ')),
    results: messages.filter(message => message.type === 'result'),
  };
}

describe('actual Pyodide execution error boundary', () => {
  it('reports thrown errors once while retaining independent, identical user stderr', async () => {
    const result = await execute(
      'import sys\nprint("ValueError: actual failure", file=sys.stderr)\nprint("middle")\nraise ValueError("actual failure")'
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error).toMatchObject({
      message: 'ValueError: actual failure',
      line: 4,
    });
    expect(result.output).toEqual(['ValueError: actual failure', 'middle']);
    const wrappers = result.errors[0]?.error.frames?.filter(frame =>
      /<lingua-(bootstrap|execution)>/.test(frame.text)
    );
    expect(wrappers?.length).toBeGreaterThan(0);
    expect(wrappers?.every(frame => frame.file === undefined)).toBe(true);
  });

  it('reports the innermost user coordinate, not the caller or execution wrapper', async () => {
    const result = await execute('def fail():\n    raise ValueError("nested")\nfail()');
    expect(result.errors[0]?.error).toMatchObject({ message: 'ValueError: nested', line: 2 });
  });

  it('preserves syntax error coordinates and does not echo its traceback', async () => {
    const result = await execute('answer = 42\nif :');
    expect(result.errors[0]?.error).toMatchObject({ line: 2 });
    expect(result.errors[0]?.error.message).toContain('SyntaxError');
    expect(result.output).toEqual([]);
  });

  it('supports plain buffered output when rich console is disabled', async () => {
    const result = await execute(
      'import sys\nprint("warning", file=sys.stderr)\nraise ValueError("plain")',
      { richConsoleEnabled: false }
    );
    expect(result.output).toEqual(['warning']);
    expect(result.errors[0]?.error.message).toBe('ValueError: plain');
  });

  it('retains failure when a user exception hook suppresses its message', async () => {
    const result = await execute(
      'import sys\nsaved_hook = sys.excepthook\nsys.excepthook = lambda *args: None\nraise ValueError("quiet")'
    );
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.error.message).not.toBe('');
    await execute('sys.excepthook = saved_hook');
  });

  it('does not let ordinary user bindings break stream restoration', async () => {
    const result = await execute('sys = 42\nraise ValueError("shadow")');
    expect(result.errors[0]?.error.message).toBe('ValueError: shadow');
  });

  it('preserves automatic expression capture and Unicode source', async () => {
    const result = await execute('value = "🧪"\nvalue\nint("not a number")', { autoLog: true });
    expect(result.errors).toEqual([]);
    expect(messages.filter(message => message.type === 'magic-comment')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ line: 2, value: "'🧪'", kind: 'autoLog' }),
        expect.objectContaining({ line: 3, isError: true, kind: 'autoLog' }),
      ])
    );
  });

  it('does not classify a printed traceback or an old exception as failure', async () => {
    const result = await execute('print("Traceback (most recent call last):")\n21 * 2');
    expect(result.errors).toEqual([]);
    expect(result.output).toEqual(['Traceback (most recent call last):']);
    expect(result.results[0]?.value).toBe('42');
  });

  it('preserves top-level await and notebook namespaces through failure and recovery', async () => {
    await execute('value = 41\nraise ValueError("notebook")', { scopeId: 'notebook-a' });
    const recovered = await execute('import asyncio\nawait asyncio.sleep(0)\nvalue + 1', {
      scopeId: 'notebook-a',
    });
    expect(recovered.errors).toEqual([]);
    expect(recovered.results[0]?.value).toBe('42');
    expect((await execute('value', { scopeId: 'notebook-b' })).errors[0]?.error.message).toContain(
      'NameError'
    );
    await handle({ type: 'reset-scope', scopeId: 'notebook-a' });
    await handle({ type: 'reset-scope', scopeId: 'notebook-b' });
  });
});

// @vitest-environment node
import { createRequire } from 'node:module';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PythonWorkerOutboundMessage } from '@/workers/python-worker-protocol';
import type { PyodideRuntime } from '@/workers/python-worker-runtime';

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

async function execute(code: string, richDisplay = true, scopeId?: string) {
  messages.length = 0;
  await handle({ type: 'execute', runId: 'py-display', code, richDisplay, ...(scopeId ? { scopeId } : {}) });
  return {
    console: messages.filter(message => message.type === 'console') as Array<Extract<PythonWorkerOutboundMessage, { type: 'console' }>>,
    errors: messages.filter(message => message.type === 'error'),
  };
}

describe('Python display', () => {
  it('displays values in order with print, with their line, through display and lingua.display', async () => {
    const result = await execute('print("before")\ndisplay([{"city": "Envigado", "orders": 42}])\nlingua.display({"a": 1})\ndisplay("plain text")\nprint("after")');
    expect(result.errors).toEqual([]);
    expect(result.console.map(message => message.args[0])).toEqual(['before', expect.any(String), expect.any(String), 'plain text', 'after']);
    expect(result.console[1]).toMatchObject({ line: 2, payload: [{ kind: 'table' }] });
    expect(result.console[2]).toMatchObject({ line: 3, payload: [{ kind: 'object' }] });
    expect(result.console[3]).toMatchObject({ line: 4, payload: [{ kind: 'rawText', text: 'plain text' }] });
    expect((await execute('display([1, 2], as_="table")')).console[0]).toMatchObject({ payload: [{ kind: 'table', columns: ['value'] }] });
    expect((await execute('display([{"a": 1}], as_="json")')).console[0]).toMatchObject({ payload: [{ kind: 'array' }] });
  });

  it('keeps one entry per progress bar with its last value', async () => {
    const result = await execute('bar = display.progress("import")\nfor i in range(1, 101):\n    bar.update(i / 100, f"{i} / 100")\ndef update():\n    print("user update")\nupdate()');
    expect(result.console).toHaveLength(2);
    expect(result.console[0]).toMatchObject({
      line: 1,
      args: ['import 100% · 100 / 100'],
      payload: [{ kind: 'progress', id: 'py-display:progress-1', value: 1, text: '100 / 100' }],
    });
    expect(result.console[1]).toMatchObject({ args: ['user update'], line: 5 });
  });

  it('drops display and lingua when a later run has the flag off', async () => {
    await execute('display(1)');
    const off = await execute('print("display" in globals(), "lingua" in globals())', false);
    expect(off.console.map(message => message.args[0])).toEqual(['False False']);
    await execute('display(1)', true, 'nb-1');
    const scoped = await execute('print("display" in globals(), "lingua" in globals())', false, 'nb-1');
    expect(scoped.console.map(message => message.args[0])).toEqual(['False False']);
  });

  it('shows a multi-line string on one row, and never copies a user display or lingua into a notebook', async () => {
    expect((await execute('display("a\\nb")')).console).toHaveLength(1);
    await execute('display = 5\nlingua = "es"', false);
    const scoped = await execute('print("display" in globals(), "lingua" in globals())', false, 'nb-2');
    expect(scoped.console.map(message => message.args[0])).toEqual(['False False']);
    const helpers = await execute('print("__lingua_display" in globals())', false);
    expect(helpers.console.map(message => message.args[0])).toEqual(['False']);
  });

  it('reads the mime of a data URL', async () => {
    const result = await execute('display("data:image/jpeg;base64,/9j/4AAQ")');
    expect(result.console[0]).toMatchObject({ payload: [{ kind: 'image', mime: 'image/jpeg' }] });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PythonWorkerOutboundMessage } from '@/workers/python-worker-protocol';

async function execute(streams: object, failure?: string) {
  vi.resetModules();
  const messages: PythonWorkerOutboundMessage[] = [];
  const port = { postMessage: (message: PythonWorkerOutboundMessage) => messages.push(message) };
  vi.stubGlobal('self', port);
  const { PYTHON_STREAM_STATE_SOURCE } = await import('@/workers/python-worker-sources');
  const { createPythonExecutionHandler } = await import('@/workers/python-worker-execution');
  const py = {
    globals: { set: vi.fn() },
    runPythonAsync: async (source: string) => {
      if (source === PYTHON_STREAM_STATE_SOURCE) return JSON.stringify(streams);
      if (source.startsWith('await __lingua_execute(') && failure !== undefined)
        throw new Error(failure);
      return undefined;
    },
  };
  const handle = createPythonExecutionHandler(port, {
    loadPyodide: async () => py,
    ensureMicropip: async () => ({}),
    setActiveRunId: vi.fn(),
    resetStdin: vi.fn(),
  });
  await handle({ type: 'execute', runId: 'output-order', code: 'user source' });
  return messages;
}

afterEach(() => vi.unstubAllGlobals());

describe('Python ordered capture delivery', () => {
  it('does not replay buffered stderr already present in the ordered entry stream', async () => {
    const messages = await execute({
      stdout: 'middle',
      stderr: 'first\nlast',
      print_entries: [
        { text: 'first', method: 'error', payloads: [] },
        { text: 'middle', method: 'log', payloads: [] },
        { text: 'last', method: 'error', payloads: [] },
      ],
    });
    expect(
      messages.filter(message => message.type === 'console').map(message => message.args.join(' '))
    ).toEqual(['first', 'middle', 'last']);
    expect(
      messages.filter(message => message.type === 'console').map(message => message.captureOrder)
    ).toEqual([0, 1, 2]);
  });

  it('keeps an empty rejection classified as a failure', async () => {
    const messages = await execute({ stdout: '', stderr: '', print_entries: [] }, '');
    expect(messages.find(message => message.type === 'error')?.error.message).toBe('Error');
  });

  it('uses the thrown traceback rather than unrelated user stderr for the fatal error', async () => {
    const messages = await execute(
      { stdout: '', stderr: 'user warning', print_entries: [] },
      'Traceback (most recent call last):\n  File "<exec>", line 3, in <module>\nValueError: real failure'
    );
    expect(messages.find(message => message.type === 'error')?.error).toMatchObject({
      message: 'ValueError: real failure',
      line: 3,
    });
    expect(
      messages.filter(message => message.type === 'console').map(message => message.args.join(' '))
    ).toEqual(['user warning']);
  });
});

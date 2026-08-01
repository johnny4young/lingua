import { describe, expect, it, vi } from 'vitest';
import {
  applyJsWorkerExecutePayload,
  createJsWorkerDebuggerSession,
} from '../../src/renderer/workers/js-worker-debugger';
import {
  safeJsWorkerStructuredResult,
  serializeJsWorkerValues,
} from '../../src/renderer/workers/js-worker-serialization';
import { createJsWorkerStdinReader } from '../../src/renderer/workers/js-worker-stdin';
import { createPythonExecutionHandler } from '../../src/renderer/workers/python-worker-execution';
import type {
  PythonWorkerOutboundMessage,
  PythonWorkerPort,
} from '../../src/renderer/workers/python-worker-protocol';
import type {
  PyodideRuntime,
  PythonRuntimeAdapter,
} from '../../src/renderer/workers/python-worker-runtime';
import { PYTHON_STREAM_STATE_SOURCE } from '../../src/renderer/workers/python-worker-sources';

function createPythonExecutionHarness(overrides: Partial<PythonRuntimeAdapter> = {}) {
  const messages: PythonWorkerOutboundMessage[] = [];
  const port: PythonWorkerPort = {
    postMessage: message => messages.push(message),
  };
  const runtimeValue: PyodideRuntime = {
    runPythonAsync: vi.fn(async () => null),
    globals: { set: vi.fn() },
  };
  const runtime: PythonRuntimeAdapter = {
    loadPyodide: vi.fn(async () => runtimeValue),
    ensureMicropip: vi.fn(async () => ({ install: vi.fn(async () => undefined) })),
    setActiveRunId: vi.fn(),
    resetStdin: vi.fn(),
    ...overrides,
  };
  return {
    messages,
    port,
    runtime,
    runtimeValue,
  };
}

describe('JavaScript worker responsibility modules', () => {
  it('keeps stdin consumption local to one execution', () => {
    const reader = createJsWorkerStdinReader('alpha\n\nbeta\n');

    expect(reader.getTotal()).toBe(3);
    expect(reader.consume()).toBe('alpha');
    expect(reader.consume()).toBe('');
    expect(reader.consume()).toBe('beta');
    expect(reader.consume()).toBeNull();
    expect(reader.getCount()).toBe(3);
  });

  it('normalizes debugger payloads into fresh session state', () => {
    const session = createJsWorkerDebuggerSession('run-1');
    session.stepMode = 'into';
    session.frames.push({ functionName: 'stale', line: 9 });

    applyJsWorkerExecutePayload(session, {
      type: 'execute',
      runId: 'run-1',
      code: '',
      debug: true,
      breakpoints: [{ line: 3, condition: 'ready' }, { line: 0 }],
      watches: ['value'],
    });

    expect(session).toMatchObject({
      enabled: true,
      watches: ['value'],
      stepMode: 'none',
      stepDepth: 0,
      frames: [],
    });
    expect([...session.breakpoints]).toEqual([[3, { condition: 'ready' }]]);
  });

  it('keeps text and structured serialization behavior intact', () => {
    const circular: Record<string, unknown> = { keep: 1 };
    circular.self = circular;

    expect(serializeJsWorkerValues([undefined, null, { answer: 42 }], '[cut]')).toEqual([
      'undefined',
      'null',
      '{\n  "answer": 42\n}',
    ]);
    const structured = safeJsWorkerStructuredResult({ keep: [1, 2], circular }) as {
      keep: number[];
      circular: Record<string, unknown>;
    };
    expect(structured.keep).toEqual([1, 2]);
    expect(structured.circular).not.toBe(circular);
    expect(structured.circular.self).toBe(structured.circular);
  });
});

describe('Python execution worker adapter', () => {
  it('preserves lifecycle and result ordering through the extracted handler', async () => {
    const harness = createPythonExecutionHarness();
    const runPythonAsync = vi.fn(async (source: string) => {
      if (source === '40 + 2') return 42;
      if (source === PYTHON_STREAM_STATE_SOURCE) {
        return JSON.stringify({ stdout: '', stderr: '', magic: [], print_entries: [] });
      }
      return null;
    });
    harness.runtimeValue.runPythonAsync = runPythonAsync;
    const handle = createPythonExecutionHandler(harness.port, harness.runtime);

    await handle({ type: 'init' });
    expect(harness.messages).toEqual([
      { type: 'loading', stage: 'Loading Python runtime...' },
      { type: 'ready' },
    ]);

    harness.messages.length = 0;
    await handle({
      type: 'execute',
      runId: 'python-run-1',
      code: '40 + 2',
    });

    expect(harness.messages[0]).toEqual({
      type: 'result',
      runId: 'python-run-1',
      value: '42',
    });
    expect(harness.messages[1]).toMatchObject({
      type: 'done',
      runId: 'python-run-1',
      executionTime: expect.any(Number),
    });
    expect(harness.runtime.setActiveRunId).toHaveBeenNthCalledWith(1, 'python-run-1');
    expect(harness.runtime.setActiveRunId).toHaveBeenLastCalledWith(null);
    expect(harness.runtime.resetStdin).toHaveBeenCalledOnce();
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createPythonDependencyHandler } from '../../src/renderer/workers/python-worker-dependencies';
import type {
  PythonWorkerOutboundMessage,
  PythonWorkerPort,
} from '../../src/renderer/workers/python-worker-protocol';
import type {
  PyodideRuntime,
  PythonRuntimeAdapter,
} from '../../src/renderer/workers/python-worker-runtime';

function harness(overrides: Partial<PythonRuntimeAdapter> = {}) {
  const messages: PythonWorkerOutboundMessage[] = [];
  const pyodide = {
    loadedPackages: { numpy: {}, pandas: {} },
    globals: { set: vi.fn() },
  } as unknown as PyodideRuntime;
  const runtime: PythonRuntimeAdapter = {
    loadPyodide: vi.fn().mockResolvedValue(pyodide),
    ensureMicropip: vi.fn().mockResolvedValue({ install: vi.fn() }),
    setActiveRunId: vi.fn(),
    resetStdin: vi.fn(),
    ...overrides,
  };
  const port: PythonWorkerPort = {
    postMessage: message => messages.push(message),
  };
  return {
    messages,
    pyodide,
    runtime,
    handle: createPythonDependencyHandler(port, runtime),
  };
}

describe('python worker dependency adapter', () => {
  it('reports the packages loaded by the shared runtime', async () => {
    const { handle, messages } = harness();

    await handle({ type: 'dependencies:list-loaded', requestId: 'loaded-1' });

    expect(messages).toEqual([
      {
        type: 'dependencies:list-loaded:reply',
        requestId: 'loaded-1',
        packages: ['numpy', 'pandas'],
      },
    ]);
  });

  it('rejects every invalid specifier without loading micropip', async () => {
    const { handle, messages, runtime } = harness();

    await handle({
      type: 'dependencies:install',
      runId: 'install-invalid',
      specifiers: ['bad package', '../escape'],
    });

    expect(runtime.ensureMicropip).not.toHaveBeenCalled();
    expect(messages).toEqual([
      {
        type: 'dependencies:install:done',
        runId: 'install-invalid',
        statuses: { 'bad package': 'failed', '../escape': 'failed' },
        outcome: 'failed',
        failureReason: 'invalid-specifier',
      },
    ]);
  });

  it('keeps mixed installs partial and destroys the converted Python list', async () => {
    const destroy = vi.fn();
    const install = vi.fn().mockResolvedValue(undefined);
    const pythonList = { destroy };
    const pyodide = {
      toPy: vi.fn().mockReturnValue(pythonList),
      globals: { set: vi.fn() },
    } as unknown as PyodideRuntime;
    const { handle, messages } = harness({
      loadPyodide: vi.fn().mockResolvedValue(pyodide),
      ensureMicropip: vi.fn().mockResolvedValue({ install }),
    });

    await handle({
      type: 'dependencies:install',
      runId: 'install-mixed',
      specifiers: ['requests', 'bad package', 'requests'],
    });

    expect(pyodide.toPy).toHaveBeenCalledWith(['requests']);
    expect(install).toHaveBeenCalledWith(pythonList);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(messages.at(-1)).toEqual({
      type: 'dependencies:install:done',
      runId: 'install-mixed',
      statuses: { requests: 'installed', 'bad package': 'failed' },
      outcome: 'partial',
      failureReason: 'invalid-specifier',
    });
  });

  it('classifies unsupported wheels and settles every accepted name', async () => {
    const { handle, messages } = harness({
      ensureMicropip: vi.fn().mockResolvedValue({
        install: vi.fn().mockRejectedValue(new Error("can't find a pure Python 3 wheel")),
      }),
    });

    await handle({
      type: 'dependencies:install',
      runId: 'install-wheel',
      specifiers: ['native-package'],
    });

    expect(messages.at(-1)).toEqual({
      type: 'dependencies:install:done',
      runId: 'install-wheel',
      statuses: { 'native-package': 'failed' },
      outcome: 'failed',
      failureReason: 'unsupported-wheel',
    });
  });
});

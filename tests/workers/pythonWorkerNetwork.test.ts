// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NetworkRunPolicy } from '@/../shared/networkPolicy';

/** One execute through the real Python handler, where the "user code" calls fetch. */
async function execute(network?: NetworkRunPolicy) {
  vi.resetModules();
  const posted: Array<Record<string, unknown>> = [];
  const upstream = vi.fn(async (_input: RequestInfo | URL) => new Response('ok'));
  vi.stubGlobal('fetch', upstream);
  vi.stubGlobal('postMessage', (message: Record<string, unknown>) => posted.push(message));
  vi.stubGlobal('self', globalThis);
  const { ensurePythonNetworkGuard } = await import('@/workers/python-worker-network');
  ensurePythonNetworkGuard('https://cdn.example/pyodide/');
  const { createPythonExecutionHandler } = await import('@/workers/python-worker-execution');
  const outcomes: string[] = [];
  const py = {
    globals: { set: vi.fn() },
    runPythonAsync: async (source: string) => {
      if (!source.startsWith('await __lingua_execute(')) return undefined;
      // Stands in for `await pyodide.http.pyfetch(...)` inside user code.
      try {
        await fetch('https://api.example/data');
        outcomes.push('fetched');
      } catch (error) {
        outcomes.push(String((error as Error).message));
      }
      return undefined;
    },
  };
  const handle = createPythonExecutionHandler(
    { postMessage: (m: Record<string, unknown>) => posted.push(m) } as never,
    {
      // The runtime's own asset load happens before the policy starts.
      loadPyodide: async () => {
        await fetch('https://cdn.example/pyodide/pyodide.asm.wasm');
        return py;
      },
      ensureMicropip: async () => ({}),
      setActiveRunId: vi.fn(),
      resetStdin: vi.fn(),
    } as never
  );
  await handle({ type: 'execute', runId: 'py-net', code: 'user', network } as never);
  // A package install Lingua starts may reach the package index, and nothing else.
  const { withPackageIndexAccess } = await import('@/workers/python-worker-network');
  await withPackageIndexAccess(() => fetch('https://files.pythonhosted.org/wheel.whl'));
  // Anything else the code left behind still meets the run's policy.
  const late = await fetch('https://api.example/late').then(
    () => 'fetched',
    (error: Error) => error.message
  );
  return { outcomes, upstream, posted, late };
}

afterEach(() => vi.unstubAllGlobals());

describe('Pyodide worker network policy', () => {
  it('blocks user requests under Block, after the run too, but never the runtime’s own loading', async () => {
    const { outcomes, upstream, late } = await execute({
      policy: 'block',
      allowedHosts: [],
      blockedHosts: [],
    });
    expect(outcomes[0]).toMatch(/blocked a network request to api\.example/);
    expect(upstream.mock.calls.map(([url]) => String(url))).toEqual([
      'https://cdn.example/pyodide/pyodide.asm.wasm',
      'https://files.pythonhosted.org/wheel.whl',
    ]);
    expect(late).toMatch(/blocked a network request to api\.example/);
  });

  it('lets user requests through without a policy', async () => {
    const { outcomes } = await execute();
    expect(outcomes).toEqual(['fetched']);
  });
});

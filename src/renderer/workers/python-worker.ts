/**
 * Python execution Web Worker using Pyodide (CPython compiled to WASM).
 *
 * Loads Pyodide on first use, caches in memory for subsequent runs,
 * captures stdout/stderr, and sends results to the main thread.
 *
 * implementation — desktop/dev resolve `pyodide.mjs` against the
 * renderer build output (file:// in packaged Electron, the dev server
 * origin in `pnpm run dev:desktop`). The build pipeline copies
 * `node_modules/pyodide/*` to `<outDir>/pyodide/` via
 * `build/copyRuntimeAssetsPlugin.mts`. The web build explicitly
 * overrides the index URL to the CDN until implementation picks the
 * first-party hosting path.
 *
 * internal: this worker no longer schedules its own deadline. The
 * parent renderer thread owns a kill timer and calls
 * `worker.terminate()` if user code does not yield in time. Each
 * `execute` request carries a `runId` that the worker echoes on
 * every reply so the parent can drop messages from a previous
 * (terminated) run.
 */

import { createPythonDependencyHandler } from './python-worker-dependencies';
import { createPythonExecutionHandler } from './python-worker-execution';
import type { PythonWorkerInboundMessage, PythonWorkerPort } from './python-worker-protocol';
import { createPythonRuntimeAdapter } from './python-worker-runtime';

const ctx = self as unknown as Worker;
const port = ctx as unknown as PythonWorkerPort;
const runtime = createPythonRuntimeAdapter(port);
const handleExecution = createPythonExecutionHandler(port, runtime);
const handleDependencies = createPythonDependencyHandler(port, runtime);

ctx.addEventListener('message', async (event: MessageEvent<unknown>) => {
  const message = event.data as PythonWorkerInboundMessage;

  if (message.type === 'init' || message.type === 'reset-scope' || message.type === 'execute') {
    await handleExecution(message);
    return;
  }

  if (message.type === 'dependencies:list-loaded' || message.type === 'dependencies:install') {
    await handleDependencies(message);
    return;
  }

  const unhandled: never = message;
  void unhandled;
});

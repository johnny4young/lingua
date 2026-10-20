import type { NetworkRunPolicy } from '../../shared/networkPolicy';
import { createNetworkAsker, installNetworkGuard, type NetworkGuard } from './networkGuard';

/**
 * The Pyodide worker's network guard. It must be installed before Pyodide
 * loads, because `pyodide.http` captures the global `fetch` when first
 * imported; the worker entry calls `ensurePythonNetworkGuard` at startup.
 */

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);
let activeRunId = '';
let guard: NetworkGuard | null = null;

export const pythonNetworkAsker = createNetworkAsker(post, () => activeRunId);

/** `indexUrl` is Pyodide's index: its own wasm, stdlib and packages load from there and always pass. */
export function ensurePythonNetworkGuard(indexUrl?: string): NetworkGuard {
  guard ??= installNetworkGuard(globalThis, {
    isRuntimeAsset: url => indexUrl !== undefined && url.startsWith(indexUrl),
    ask: pythonNetworkAsker.ask,
    report: (host, verdict) => post({ type: 'network-event', runId: activeRunId, host, verdict }),
  });
  return guard;
}

export function beginPythonNetwork(runId: string, policy: NetworkRunPolicy | undefined): void {
  if (!policy || policy.policy === 'allow') return;
  activeRunId = runId;
  ensurePythonNetworkGuard().begin(policy);
}

export function endPythonNetwork(): void {
  guard?.end();
  pythonNetworkAsker.cancelAll();
}

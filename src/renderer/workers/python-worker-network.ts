import type { NetworkRunPolicy } from '../../shared/networkPolicy';
import { createNetworkAsker, installNetworkGuard, type NetworkGuard } from './networkGuard';

/**
 * The Pyodide worker's network guard. It must be installed before Pyodide
 * loads, because `pyodide.http` captures the global `fetch` when first
 * imported; the worker entry calls `ensurePythonNetworkGuard` at startup.
 */

const post = (message: unknown) => (self as unknown as Worker).postMessage(message);
const ALLOW_ALL: NetworkRunPolicy = { policy: 'allow', allowedHosts: [], blockedHosts: [] };
let activeRunId = '';
let guard: NetworkGuard | null = null;

export const pythonNetworkAsker = createNetworkAsker(post, () => activeRunId);

/** `indexUrl` is Pyodide's index: its own wasm, stdlib and packages load from there and always pass. */
export function ensurePythonNetworkGuard(indexUrl?: string): NetworkGuard {
  guard ??= installNetworkGuard(globalThis, {
    runtimeAssetPrefix: indexUrl,
    ask: pythonNetworkAsker.ask,
    report: (host, verdict) => post({ type: 'network-event', runId: activeRunId, host, verdict }),
  });
  return guard;
}

/** Puts the run's policy in force; it stays until the next run, so tasks the code leaves behind are checked too. */
export function beginPythonNetwork(runId: string, policy: NetworkRunPolicy | undefined): void {
  activeRunId = runId;
  ensurePythonNetworkGuard().begin(policy ?? ALLOW_ALL);
}

/** Questions still open when a run ends are answered with Block. */
export function endPythonNetwork(): void {
  pythonNetworkAsker.cancelAll();
}

/** micropip resolves on PyPI and downloads wheels from its file host. */
const PACKAGE_INDEX_HOSTS = ['pypi.org', 'files.pythonhosted.org'];

/** Package installs Lingua starts may reach the package index; every other host keeps the policy. */
export function withPackageIndexAccess<T>(task: () => Promise<T>): Promise<T> {
  return ensurePythonNetworkGuard().exempt(PACKAGE_INDEX_HOSTS, task);
}

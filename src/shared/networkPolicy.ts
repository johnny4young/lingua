/**
 * Network policy for code running in the sandboxed runtimes (JS/TS worker,
 * Pyodide, ruby.wasm). Shared by the renderer, which owns the setting and the
 * per-tab answers, and the workers, which enforce it around user code.
 */

export const NETWORK_POLICIES = ['allow', 'ask', 'block'] as const;
export type NetworkPolicy = (typeof NETWORK_POLICIES)[number];

export const DEFAULT_NETWORK_POLICY: NetworkPolicy = 'allow';

export function isNetworkPolicy(value: unknown): value is NetworkPolicy {
  return typeof value === 'string' && (NETWORK_POLICIES as readonly string[]).includes(value);
}

export function sanitizeNetworkPolicy(value: unknown): NetworkPolicy {
  return isNetworkPolicy(value) ? value : DEFAULT_NETWORK_POLICY;
}

/** What a worker receives with each run: the policy plus the hosts this tab already answered. */
export interface NetworkRunPolicy {
  policy: NetworkPolicy;
  allowedHosts: string[];
  blockedHosts: string[];
}

export type NetworkRuntime = 'worker' | 'pyodide' | 'ruby';

/** Worker to renderer: a request to ask about a host, and a record of a decided request. */
export type NetworkWorkerMessage =
  | { type: 'network-request'; runId: string; requestId: string; host: string }
  | { type: 'network-event'; runId: string; host: string; verdict: 'allowed' | 'blocked' };

/** Renderer to worker: the answer to a `network-request`. */
export interface NetworkDecisionMessage {
  type: 'network-decision';
  requestId: string;
  allow: boolean;
}

export type NetworkVerdict = 'allow' | 'block' | 'ask';

/** Block refuses every host; under Ask, a host the tab already answered wins. */
export function decideNetworkHost(run: NetworkRunPolicy, host: string): NetworkVerdict {
  if (run.policy !== 'ask') return run.policy;
  // Plain loops: the worker guard calls this next to user code that may replace Array methods.
  for (let index = 0; index < run.blockedHosts.length; index += 1)
    if (run.blockedHosts[index] === host) return 'block';
  for (let index = 0; index < run.allowedHosts.length; index += 1)
    if (run.allowedHosts[index] === host) return 'allow';
  return 'ask';
}

const NETWORK_HOST = /^[a-z0-9._~%:[\]-]{1,262}$/i;

/** A `host[:port]` as `networkHostOf` produces it; anything else from a worker is refused. */
export function isNetworkHost(value: unknown): value is string {
  return typeof value === 'string' && NETWORK_HOST.test(value);
}

export function networkBlockedMessage(host: string): string {
  return `Lingua blocked a network request to ${host} (Settings › Privacy › Network from running code).`;
}

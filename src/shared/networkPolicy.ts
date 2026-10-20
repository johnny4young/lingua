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

const NETWORK_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);

/**
 * `host[:port]` of a network URL, resolved against `base` for relative ones.
 * Null for anything that never leaves the process (data:, blob:) or does not parse.
 */
export function networkHostOf(url: string, base?: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return null;
  }
  return NETWORK_PROTOCOLS.has(parsed.protocol) ? parsed.host.toLowerCase() : null;
}

export type NetworkVerdict = 'allow' | 'block' | 'ask';

/** A host the tab already answered wins; otherwise the policy decides. */
export function decideNetworkHost(run: NetworkRunPolicy, host: string): NetworkVerdict {
  if (run.policy === 'allow') return 'allow';
  if (run.blockedHosts.includes(host)) return 'block';
  if (run.allowedHosts.includes(host)) return 'allow';
  return run.policy;
}

export function networkBlockedMessage(host: string): string {
  return `Lingua blocked a network request to ${host} (Settings › Privacy › Network from running code).`;
}

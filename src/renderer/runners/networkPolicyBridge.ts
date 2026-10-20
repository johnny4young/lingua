import {
  isNetworkHost,
  type NetworkRunPolicy,
  type NetworkRuntime,
  type NetworkWorkerMessage,
} from '../../shared/networkPolicy';
import {
  askNetworkHost,
  cancelNetworkQuestions,
  networkRunPolicyFor,
} from '../stores/networkAskStore';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';
import type { ExecutionContext } from '../types/execution';

/** A tab remembers its answers; a run without a tab or notebook scope keeps them to itself. */
export function networkTabKey(context: Pick<ExecutionContext, 'tabId' | 'scopeId'>): string {
  return context.tabId ?? context.scopeId ?? `run-${crypto.randomUUID()}`;
}

interface NetworkMessageHooks {
  tabKey: string;
  /** The policy the run carries; without one, network messages are dropped. */
  network: NetworkRunPolicy | undefined;
  runtime: NetworkRuntime;
  post: (message: unknown) => void;
  /** The run timeout stops while any question is open and restarts when the last is answered. */
  pauseDeadline: () => void;
  resumeDeadline: () => void;
}

/** Questions one run may keep open; later ones are answered with Block. */
const MAX_OPEN_QUESTIONS = 8;
/** Distinct activity entries one run may add, so a loop cannot flush the trust log. */
const MAX_RUN_EVENTS = 20;

/**
 * One per run: handles the worker's network messages and returns false for any
 * other. Code in the worker can post these too, so each one is checked against
 * the run's policy and shape before it reaches the dialog or the trust log.
 */
export function createNetworkMessageRouter(hooks: NetworkMessageHooks) {
  let open = 0;
  const recorded = new Set<string>();
  const canAsk = hooks.network?.policy === 'ask' && hooks.runtime !== 'ruby';
  return (message: { type?: unknown }): boolean => {
    const msg = message as Partial<NetworkWorkerMessage> & { type?: unknown };
    if (msg.type === 'network-request') {
      const { requestId, host } = msg as { requestId?: unknown; host?: unknown };
      if (typeof requestId !== 'string' || requestId.length > 64) return true;
      const decide = (allow: boolean) => hooks.post({ type: 'network-decision', requestId, allow });
      if (!canAsk || !isNetworkHost(host) || open >= MAX_OPEN_QUESTIONS) {
        decide(false);
        return true;
      }
      open += 1;
      if (open === 1) hooks.pauseDeadline();
      void askNetworkHost(hooks.tabKey, host, hooks.runtime).then(allow => {
        decide(allow);
        open -= 1;
        if (open === 0) hooks.resumeDeadline();
      });
      return true;
    }
    if (msg.type === 'network-event') {
      const { host, verdict } = msg as { host?: unknown; verdict?: unknown };
      if (!hooks.network || hooks.network.policy === 'allow') return true;
      if (!isNetworkHost(host) || (verdict !== 'allowed' && verdict !== 'blocked')) return true;
      const key = `${verdict} ${host}`;
      if (recorded.has(key) || recorded.size >= MAX_RUN_EVENTS) return true;
      recorded.add(key);
      recordTrustEventBestEffort({
        feature: 'network',
        action: verdict,
        sensitivity: verdict === 'blocked' ? 'low' : 'medium',
        summary: `${hooks.runtime}: ${host}`,
      });
      return true;
    }
    return false;
  };
}

export { cancelNetworkQuestions, networkRunPolicyFor };

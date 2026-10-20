import type { NetworkRuntime, NetworkWorkerMessage } from '../../shared/networkPolicy';
import {
  askNetworkHost,
  cancelNetworkQuestions,
  networkRunPolicyFor,
} from '../stores/networkAskStore';
import { recordTrustEventBestEffort } from '../stores/trustEventStore';
import type { ExecutionContext } from '../types/execution';

/** Runs without a tab (notebook cells, recipes) share one answer set per scope. */
export function networkTabKey(context: Pick<ExecutionContext, 'tabId' | 'scopeId'>): string {
  return context.tabId ?? context.scopeId ?? 'session';
}

export function networkPolicyForRun(context: Pick<ExecutionContext, 'tabId' | 'scopeId'>) {
  return networkRunPolicyFor(networkTabKey(context));
}

interface NetworkMessageHooks {
  tabKey: string;
  runtime: NetworkRuntime;
  post: (message: unknown) => void;
  /** The run timeout stops while the user decides and restarts after. */
  pauseDeadline: () => void;
  resumeDeadline: () => void;
}

/** Handles the network messages of a runtime worker; false for any other message. */
export function handleNetworkWorkerMessage(
  message: { type?: unknown },
  hooks: NetworkMessageHooks
): boolean {
  const msg = message as NetworkWorkerMessage;
  if (msg.type === 'network-request') {
    hooks.pauseDeadline();
    void askNetworkHost(hooks.tabKey, msg.host, hooks.runtime).then(allow => {
      hooks.post({ type: 'network-decision', requestId: msg.requestId, allow });
      hooks.resumeDeadline();
    });
    return true;
  }
  if (msg.type === 'network-event') {
    recordTrustEventBestEffort({
      feature: 'network',
      action: msg.verdict,
      sensitivity: msg.verdict === 'blocked' ? 'low' : 'medium',
      summary: `${hooks.runtime}: ${msg.host}`,
    });
    return true;
  }
  return false;
}

export { cancelNetworkQuestions };

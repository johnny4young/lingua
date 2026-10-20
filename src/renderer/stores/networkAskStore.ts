import { create } from 'zustand';
import type { NetworkRunPolicy, NetworkRuntime } from '../../shared/networkPolicy';
import { useSettingsStore } from './settingsStore';

/**
 * Session-only answers to "may this code reach <host>?", per tab, plus the
 * questions waiting for the user. Nothing here is persisted: a reload asks again.
 */

type Answer = 'allow' | 'block';

interface NetworkQuestion {
  id: string;
  tabKey: string;
  host: string;
  runtime: NetworkRuntime;
}

interface NetworkAskState {
  answers: Record<string, Record<string, Answer>>;
  queue: NetworkQuestion[];
}

export const useNetworkAskStore = create<NetworkAskState>(() => ({ answers: {}, queue: [] }));

const waiting = new Map<string, Array<(allow: boolean) => void>>();
let nextId = 0;

/** The policy a run should carry, or undefined when running code is unrestricted. */
export function networkRunPolicyFor(tabKey: string): NetworkRunPolicy | undefined {
  const settings = useSettingsStore.getState();
  if (settings.featureFlags.networkPolicy !== true) return undefined;
  const policy = settings.networkFromRunningCode;
  if (policy === 'allow') return undefined;
  const answers = Object.entries(useNetworkAskStore.getState().answers[tabKey] ?? {});
  return {
    policy,
    allowedHosts: answers.filter(([, answer]) => answer === 'allow').map(([host]) => host),
    blockedHosts: answers.filter(([, answer]) => answer === 'block').map(([host]) => host),
  };
}

/** Resolves with the tab's answer for `host`, asking the user once when there is none. */
export function askNetworkHost(
  tabKey: string,
  host: string,
  runtime: NetworkRuntime
): Promise<boolean> {
  const known = useNetworkAskStore.getState().answers[tabKey]?.[host];
  if (known) return Promise.resolve(known === 'allow');
  return new Promise(resolve => {
    const queued = useNetworkAskStore
      .getState()
      .queue.find(question => question.tabKey === tabKey && question.host === host);
    if (queued) {
      waiting.get(queued.id)?.push(resolve);
      return;
    }
    const question: NetworkQuestion = { id: `network-${(nextId += 1)}`, tabKey, host, runtime };
    waiting.set(question.id, [resolve]);
    useNetworkAskStore.setState(state => ({ queue: [...state.queue, question] }));
  });
}

/** Stores the answer for the rest of the tab's session and releases everyone waiting on it. */
export function answerNetworkQuestion(id: string, allow: boolean): void {
  const question = useNetworkAskStore.getState().queue.find(entry => entry.id === id);
  if (!question) return;
  useNetworkAskStore.setState(state => ({
    queue: state.queue.filter(entry => entry.id !== id),
    answers: {
      ...state.answers,
      [question.tabKey]: {
        ...state.answers[question.tabKey],
        [question.host]: allow ? 'allow' : 'block',
      },
    },
  }));
  for (const resolve of waiting.get(id) ?? []) resolve(allow);
  waiting.delete(id);
}

/** Drops a tab's open questions without remembering an answer, when its run ends first. */
export function cancelNetworkQuestions(tabKey: string): void {
  const dropped = useNetworkAskStore.getState().queue.filter(entry => entry.tabKey === tabKey);
  if (dropped.length === 0) return;
  useNetworkAskStore.setState(state => ({
    queue: state.queue.filter(entry => entry.tabKey !== tabKey),
  }));
  for (const question of dropped) {
    for (const resolve of waiting.get(question.id) ?? []) resolve(false);
    waiting.delete(question.id);
  }
}

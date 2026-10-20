import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerNetworkQuestion,
  askNetworkHost,
  cancelNetworkQuestions,
  networkRunPolicyFor,
  useNetworkAskStore,
} from '@/stores/networkAskStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { handleNetworkWorkerMessage } from '@/runners/networkPolicyBridge';
import { useTrustEventStore } from '@/stores/trustEventStore';

const initialSettings = useSettingsStore.getState();

beforeEach(() => {
  useSettingsStore.setState(initialSettings, true);
  useNetworkAskStore.setState({ answers: {}, queue: [] });
  useTrustEventStore.getState().clear();
});
afterEach(() => cancelNetworkQuestions('tab-1'));

describe('network ask store', () => {
  it('carries no policy until the flag is on and the policy limits the network', () => {
    useSettingsStore.setState({ networkFromRunningCode: 'block' });
    expect(networkRunPolicyFor('tab-1')).toBeUndefined();
    useSettingsStore.setState({
      featureFlags: { networkPolicy: true },
      networkFromRunningCode: 'allow',
    });
    expect(networkRunPolicyFor('tab-1')).toBeUndefined();
    useSettingsStore.setState({ networkFromRunningCode: 'ask' });
    expect(networkRunPolicyFor('tab-1')).toEqual({
      policy: 'ask',
      allowedHosts: [],
      blockedHosts: [],
    });
  });

  it('asks once per host per tab, shares the wait, and remembers the answer', async () => {
    useSettingsStore.setState({
      featureFlags: { networkPolicy: true },
      networkFromRunningCode: 'ask',
    });
    const first = askNetworkHost('tab-1', 'api.example', 'worker');
    const second = askNetworkHost('tab-1', 'api.example', 'worker');
    expect(useNetworkAskStore.getState().queue).toHaveLength(1);

    answerNetworkQuestion(useNetworkAskStore.getState().queue[0]!.id, true);
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await expect(askNetworkHost('tab-1', 'api.example', 'worker')).resolves.toBe(true);
    expect(networkRunPolicyFor('tab-1')?.allowedHosts).toEqual(['api.example']);
    // Another tab has its own answers.
    void askNetworkHost('tab-2', 'api.example', 'worker');
    expect(useNetworkAskStore.getState().queue).toHaveLength(1);
    cancelNetworkQuestions('tab-2');
  });

  it('drops a tab’s questions with Block, without remembering it, when the run ends', async () => {
    const pending = askNetworkHost('tab-1', 'api.example', 'pyodide');
    cancelNetworkQuestions('tab-1');
    await expect(pending).resolves.toBe(false);
    expect(useNetworkAskStore.getState().answers['tab-1']).toBeUndefined();
  });
});

describe('runner bridge', () => {
  it('pauses the deadline while asking and posts the answer back', async () => {
    const hooks = {
      tabKey: 'tab-1',
      runtime: 'worker' as const,
      post: vi.fn(),
      pauseDeadline: vi.fn(),
      resumeDeadline: vi.fn(),
    };
    expect(
      handleNetworkWorkerMessage(
        { type: 'network-request', runId: 'r', requestId: 'net-1', host: 'api.example' } as never,
        hooks
      )
    ).toBe(true);
    expect(hooks.pauseDeadline).toHaveBeenCalledTimes(1);
    answerNetworkQuestion(useNetworkAskStore.getState().queue[0]!.id, false);
    await vi.waitFor(() =>
      expect(hooks.post).toHaveBeenCalledWith({
        type: 'network-decision',
        requestId: 'net-1',
        allow: false,
      })
    );
    expect(hooks.resumeDeadline).toHaveBeenCalledTimes(1);
  });

  it('logs decided requests to the trust feed with the host only', () => {
    const hooks = {
      tabKey: 'tab-1',
      runtime: 'ruby' as const,
      post: vi.fn(),
      pauseDeadline: vi.fn(),
      resumeDeadline: vi.fn(),
    };
    handleNetworkWorkerMessage(
      { type: 'network-event', runId: 'r', host: 'api.example', verdict: 'blocked' } as never,
      hooks
    );
    expect(useTrustEventStore.getState().events.at(-1)).toMatchObject({
      feature: 'network',
      action: 'blocked',
      summary: 'ruby: api.example',
    });
    expect(handleNetworkWorkerMessage({ type: 'console' }, hooks)).toBe(false);
  });
});

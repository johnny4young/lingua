import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  answerNetworkQuestion,
  askNetworkHost,
  cancelNetworkQuestions,
  networkRunPolicyFor,
  useNetworkAskStore,
} from '@/stores/networkAskStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { createNetworkMessageRouter, networkTabKey } from '@/runners/networkPolicyBridge';
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

const ASK = { policy: 'ask' as const, allowedHosts: [], blockedHosts: [] };

describe('runner bridge', () => {
  it('pauses the deadline while asking and posts the answer back', async () => {
    const hooks = {
      tabKey: 'tab-1',
      network: ASK,
      runtime: 'worker' as const,
      post: vi.fn(),
      pauseDeadline: vi.fn(),
      resumeDeadline: vi.fn(),
    };
    const route = createNetworkMessageRouter(hooks);
    expect(
      route({
        type: 'network-request',
        runId: 'r',
        requestId: 'net-1',
        host: 'api.example',
      } as never)
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
      network: { ...ASK, policy: 'block' as const },
      runtime: 'ruby' as const,
      post: vi.fn(),
      pauseDeadline: vi.fn(),
      resumeDeadline: vi.fn(),
    };
    const route = createNetworkMessageRouter(hooks);
    route({ type: 'network-event', runId: 'r', host: 'api.example', verdict: 'blocked' } as never);
    expect(useTrustEventStore.getState().events.at(-1)).toMatchObject({
      feature: 'network',
      action: 'blocked',
      summary: 'ruby: api.example',
    });
    expect(route({ type: 'console' })).toBe(false);
  });

  it('keeps the deadline paused until every open question is answered', async () => {
    const hooks = {
      tabKey: 'tab-1',
      network: ASK,
      runtime: 'worker' as const,
      post: vi.fn(),
      pauseDeadline: vi.fn(),
      resumeDeadline: vi.fn(),
    };
    const route = createNetworkMessageRouter(hooks);
    route({ type: 'network-request', runId: 'r', requestId: 'a', host: 'a.example' } as never);
    route({ type: 'network-request', runId: 'r', requestId: 'b', host: 'b.example' } as never);
    expect(hooks.pauseDeadline).toHaveBeenCalledTimes(1);

    answerNetworkQuestion(useNetworkAskStore.getState().queue[0]!.id, true);
    await vi.waitFor(() => expect(hooks.post).toHaveBeenCalledTimes(1));
    expect(hooks.resumeDeadline).not.toHaveBeenCalled();

    answerNetworkQuestion(useNetworkAskStore.getState().queue[0]!.id, false);
    await vi.waitFor(() => expect(hooks.resumeDeadline).toHaveBeenCalledTimes(1));
  });

  it('gives a run without a tab or notebook scope answers of its own', () => {
    expect(networkTabKey({ tabId: 'tab-1' })).toBe('tab-1');
    expect(networkTabKey({ scopeId: 'nb-1' })).toBe('nb-1');
    expect(networkTabKey({})).not.toBe(networkTabKey({}));
  });

  it('answers Block without asking when the run cannot ask or the request is malformed', () => {
    const post = vi.fn();
    const base = { tabKey: 'tab-1', post, pauseDeadline: vi.fn(), resumeDeadline: vi.fn() };
    const request = (host: unknown) =>
      ({ type: 'network-request', runId: 'r', requestId: 'x', host }) as never;
    createNetworkMessageRouter({ ...base, network: undefined, runtime: 'worker' })(
      request('a.example')
    );
    createNetworkMessageRouter({ ...base, network: ASK, runtime: 'ruby' })(request('a.example'));
    createNetworkMessageRouter({ ...base, network: ASK, runtime: 'worker' })(request({}));
    createNetworkMessageRouter({ ...base, network: ASK, runtime: 'worker' })(
      request('a.example/<img>')
    );
    expect(post).toHaveBeenCalledTimes(4);
    expect(post.mock.calls.every(([message]) => message.allow === false)).toBe(true);
    expect(useNetworkAskStore.getState().queue).toEqual([]);
    expect(base.pauseDeadline).not.toHaveBeenCalled();
  });

  it('caps the questions one run can keep open', () => {
    const post = vi.fn();
    const route = createNetworkMessageRouter({
      tabKey: 'tab-1',
      network: ASK,
      runtime: 'worker',
      post,
      pauseDeadline: vi.fn(),
      resumeDeadline: vi.fn(),
    });
    for (let index = 0; index < 12; index += 1)
      route({
        type: 'network-request',
        runId: 'r',
        requestId: `q${index}`,
        host: `h${index}.example`,
      } as never);
    expect(useNetworkAskStore.getState().queue).toHaveLength(8);
    expect(post).toHaveBeenCalledTimes(4);
  });

  it('ignores activity a run without a policy reports, and records each host once', () => {
    const before = useTrustEventStore.getState().events.length;
    const event = (host: unknown, verdict: unknown) =>
      ({ type: 'network-event', runId: 'r', host, verdict }) as never;
    const hooks = {
      tabKey: 'tab-1',
      runtime: 'worker' as const,
      post: vi.fn(),
      pauseDeadline: vi.fn(),
      resumeDeadline: vi.fn(),
    };
    createNetworkMessageRouter({ ...hooks, network: undefined })(event('a.example', 'blocked'));
    const route = createNetworkMessageRouter({ ...hooks, network: ASK });
    route(event('a.example', 'blocked'));
    route(event('a.example', 'blocked'));
    route(event('a.example', 'enabled'));
    route(event({}, 'blocked'));
    expect(useTrustEventStore.getState().events.length).toBe(before + 1);
  });
});

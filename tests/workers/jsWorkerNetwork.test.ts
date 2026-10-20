// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerResponse } from '@/types/execution';
import type { NetworkRunPolicy } from '@/../shared/networkPolicy';

type Message = WorkerResponse | { type: string; [key: string]: unknown };

/** Runs user code through the real JS worker handler with a stubbed network. */
async function run(code: string, network?: NetworkRunPolicy, answer?: boolean) {
  vi.resetModules();
  const messages: Message[] = [];
  const upstream = vi.fn(async () => new Response('{"ok":true}'));
  vi.stubGlobal('fetch', upstream);
  let handler: ((event: MessageEvent) => Promise<void>) | null = null;
  // The worker's global scope is `self`; here it is the test's globalThis.
  vi.stubGlobal('postMessage', (message: Message) => {
    messages.push(message);
    if (message.type === 'network-request' && answer !== undefined) {
      void handler?.({
        data: { type: 'network-decision', requestId: message.requestId, allow: answer },
      } as MessageEvent);
    }
  });
  vi.stubGlobal('self', globalThis);
  const { createJsWorkerMessageHandler } = await import('@/workers/js-worker-execution');
  handler = createJsWorkerMessageHandler(globalThis as unknown as Worker);
  await handler({ data: { type: 'execute', runId: 'net', code, network } } as MessageEvent);
  return { messages, upstream };
}

afterEach(() => vi.unstubAllGlobals());

const fetchCode = `
  try {
    const response = await fetch('https://api.example/data');
    console.log('status', response.status);
  } catch (error) {
    console.log('failed', error.message);
  }
`;

const logged = (messages: Message[]) =>
  messages.flatMap(message =>
    message.type === 'console' ? [(message as { args: string[] }).args.join(' ')] : []
  );

describe('JS worker network policy', () => {
  it('leaves fetch alone when the run carries no policy', async () => {
    const { messages, upstream } = await run(fetchCode);
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(logged(messages)).toContain('status 200');
  });

  it('blocks user fetch under Block and reports the host', async () => {
    const { messages, upstream } = await run(fetchCode, {
      policy: 'block',
      allowedHosts: [],
      blockedHosts: [],
    });
    expect(upstream).not.toHaveBeenCalled();
    expect(logged(messages).join('\n')).toMatch(
      /failed Lingua blocked a network request to api\.example/
    );
    expect(messages).toContainEqual({
      type: 'network-event',
      runId: 'net',
      host: 'api.example',
      verdict: 'blocked',
    });
  });

  it('asks the renderer under Ask and proceeds when allowed', async () => {
    const { messages, upstream } = await run(
      fetchCode,
      { policy: 'ask', allowedHosts: [], blockedHosts: [] },
      true
    );
    expect(messages.find(message => message.type === 'network-request')).toMatchObject({
      host: 'api.example',
    });
    expect(upstream).toHaveBeenCalledTimes(1);
    expect(logged(messages)).toContain('status 200');
  });

  it('skips the question for a host the tab already allowed', async () => {
    const { messages, upstream } = await run(fetchCode, {
      policy: 'ask',
      allowedHosts: ['api.example'],
      blockedHosts: [],
    });
    expect(messages.some(message => message.type === 'network-request')).toBe(false);
    expect(upstream).toHaveBeenCalledTimes(1);
  });
});

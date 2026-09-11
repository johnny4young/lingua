/**
 * The production hop dispatcher keeps undici on HTTP/1.1.
 *
 * undici 8 turned `allowH2` on by default, which would let the HTTP workspace
 * silently negotiate HTTP/2 with any TLS server that offers it. The pinned-
 * lookup `Agent` is also the SSRF guard's socket layer, so its options are
 * load-bearing twice over.
 *
 * Every other proxy test injects `fetchImpl`, which skips this branch
 * entirely, and a live HTTPS server would need a committed private key. So
 * this records what the production branch hands to the `Agent` constructor.
 */
import { describe, expect, it, vi } from 'vitest';
import type { LookupImpl } from '../../src/main/httpProxy';
import { createBlankHttpRequest } from '../../src/shared/httpWorkspace';

const recorded = vi.hoisted(() => ({ agentOptions: [] as unknown[], fetchCalls: 0 }));

vi.mock('undici', async importOriginal => {
  const actual = await importOriginal<typeof import('undici')>();
  class RecordingAgent {
    constructor(options: unknown) {
      recorded.agentOptions.push(options);
    }
    close(): Promise<void> {
      return Promise.resolve();
    }
    destroy(): Promise<void> {
      return Promise.resolve();
    }
  }
  return {
    ...actual,
    Agent: RecordingAgent,
    fetch: async () => {
      recorded.fetchCalls += 1;
      return new Response('{"ok":true}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  };
});

const { executeHttpProxyRequest } = await import('../../src/main/httpProxy');

const publicLookup: LookupImpl = async () => [{ address: '93.184.216.34', family: 4 }];

describe('executeHttpProxyRequest — production hop dispatcher', () => {
  it('builds the pinned-lookup Agent with HTTP/2 disabled', async () => {
    const response = await executeHttpProxyRequest(
      {
        ...createBlankHttpRequest({ id: 'r1', now: '2026-09-11T00:00:00.000Z' }),
        url: 'https://api.example.com/users',
        method: 'GET',
      },
      { lookupImpl: publicLookup }
    );

    // The branch really ran: no fetchImpl was injected, so the recorded
    // undici fetch is what produced this envelope.
    expect(recorded.fetchCalls).toBe(1);
    expect(response.kind).toBe('success');

    expect(recorded.agentOptions).toHaveLength(1);
    expect(recorded.agentOptions[0]).toMatchObject({
      allowH2: false,
      connect: { lookup: expect.any(Function) },
    });
  });
});

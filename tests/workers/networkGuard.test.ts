// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createNetworkAsker, installNetworkGuard } from '@/workers/networkGuard';
import type { NetworkRunPolicy } from '@/../shared/networkPolicy';

/** A stand-in global scope whose fetch lives on its prototype, like a worker's. */
function fakeScope() {
  // Fresh classes per scope: the guard wraps their prototypes in place.
  class FakeXhr {
    opened: unknown[] = [];
    open(...args: unknown[]) {
      this.opened = args;
    }
  }
  class FakeSocket {
    static OPEN = 1;
    constructor(public url: string) {}
  }
  class FakeWorker {
    constructor(public url: string) {}
  }
  const fetch = vi.fn(async () => new Response('ok'));
  const proto = { fetch };
  const scope = Object.create(proto) as Record<string, unknown>;
  Object.assign(scope, {
    location: { href: 'https://app.example/worker.js' },
    XMLHttpRequest: FakeXhr,
    WebSocket: FakeSocket,
    EventSource: FakeSocket,
    Worker: FakeWorker,
  });
  return { scope: scope as unknown as typeof globalThis, fetch, proto };
}

const policy = (
  value: NetworkRunPolicy['policy'],
  allowed: string[] = [],
  blocked: string[] = []
) => ({
  policy: value,
  allowedHosts: allowed,
  blockedHosts: blocked,
});

describe('network guard', () => {
  it('passes everything through outside a run and under Allow', async () => {
    const { scope, fetch } = fakeScope();
    const guard = installNetworkGuard(scope);
    await scope.fetch('https://api.example/a');
    guard.begin(policy('allow'));
    await scope.fetch('https://api.example/b');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('blocks fetch, XHR, WebSocket, EventSource and nested workers under Block', async () => {
    const { scope, fetch } = fakeScope();
    const report = vi.fn();
    const guard = installNetworkGuard(scope, { report });
    guard.begin(policy('block'));

    await expect(scope.fetch('https://api.example/data')).rejects.toThrow(
      /blocked a network request to api\.example/
    );
    expect(fetch).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledWith('api.example', 'blocked');
    expect(() => new scope.XMLHttpRequest().open('GET', 'https://api.example/x')).toThrow(
      /api\.example/
    );
    expect(() => new scope.WebSocket('wss://socket.example')).toThrow(/socket\.example/);
    expect(() => new scope.EventSource('https://events.example')).toThrow(/events\.example/);
    expect(() => new scope.Worker('blob:worker')).toThrow(/blocks Worker/);
    // Static constants survive the wrapper.
    expect((scope.WebSocket as unknown as { OPEN: number }).OPEN).toBe(1);
  });

  it('throws an error whose stack points at the user, not at the guard', async () => {
    const { scope } = fakeScope();
    installNetworkGuard(scope).begin(policy('block'));
    const error = await scope.fetch('https://api.example/').catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).stack).not.toMatch(/networkGuard/);
  });

  it('keeps the guard when user code deletes the own fetch property', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope).begin(policy('block'));
    delete (scope as unknown as Record<string, unknown>).fetch;
    await expect(scope.fetch('https://api.example/')).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets runtime assets, data: and blob: URLs through and resolves relative URLs', async () => {
    const { scope, fetch } = fakeScope();
    const guard = installNetworkGuard(scope, {
      isRuntimeAsset: url => url.startsWith('https://cdn.example/pyodide/'),
    });
    guard.begin(policy('block'));
    await scope.fetch('https://cdn.example/pyodide/pyodide.asm.wasm');
    await scope.fetch('data:text/plain,hi');
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(scope.fetch('/api/same-origin')).rejects.toThrow(/app\.example/);
  });

  it('asks once per host under Ask and remembers the answer for the run', async () => {
    const { scope, fetch } = fakeScope();
    const ask = vi.fn(async (host: string) => host === 'ok.example');
    const guard = installNetworkGuard(scope, { ask });
    guard.begin(policy('ask'));

    await scope.fetch('https://ok.example/1');
    await scope.fetch('https://ok.example/2');
    await expect(scope.fetch('https://no.example/')).rejects.toThrow(/no\.example/);
    expect(ask).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(2);
    // A host allowed by fetch also opens for the synchronous APIs.
    expect(() => new scope.WebSocket('wss://ok.example/live')).not.toThrow();
  });

  it('blocks synchronous APIs for hosts nobody answered, and honors earlier answers', () => {
    const { scope } = fakeScope();
    installNetworkGuard(scope).begin(policy('ask', ['known.example']));
    expect(() => new scope.XMLHttpRequest().open('GET', 'https://known.example/x')).not.toThrow();
    expect(() => new scope.XMLHttpRequest().open('GET', 'https://other.example/x')).toThrow(
      TypeError
    );
  });

  it('blocks under Ask when the runtime cannot wait for an answer', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope).begin(policy('ask'));
    await expect(scope.fetch('https://api.example/')).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('stops enforcing after end', async () => {
    const { scope, fetch } = fakeScope();
    const guard = installNetworkGuard(scope);
    guard.begin(policy('block'));
    guard.end();
    await scope.fetch('https://api.example/');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('network asker', () => {
  it('posts a request and resolves with the renderer answer', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const asker = createNetworkAsker(
      message => posted.push(message as Record<string, unknown>),
      () => 'run-1'
    );
    const answer = asker.ask('api.example');
    expect(posted[0]).toMatchObject({
      type: 'network-request',
      runId: 'run-1',
      host: 'api.example',
    });
    expect(
      asker.receive({ type: 'network-decision', requestId: posted[0]!.requestId, allow: true })
    ).toBe(true);
    await expect(answer).resolves.toBe(true);
    expect(asker.receive({ type: 'network-decision', requestId: 'unknown', allow: true })).toBe(
      false
    );
  });

  it('answers open questions with Block when the run ends', async () => {
    const asker = createNetworkAsker(
      () => undefined,
      () => 'run-1'
    );
    const answer = asker.ask('api.example');
    asker.cancelAll();
    await expect(answer).resolves.toBe(false);
  });
});

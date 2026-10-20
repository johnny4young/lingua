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
  class FakeEvents {
    constructor(public url: string) {}
  }
  class FakeWorker {
    constructor(public url: string) {}
  }
  const fetch = vi.fn(async (_input?: unknown, _init?: unknown) => new Response('ok'));
  const proto = { fetch };
  const scope = Object.create(proto) as Record<string, unknown>;
  Object.assign(scope, {
    location: { href: 'https://app.example/worker.js' },
    XMLHttpRequest: FakeXhr,
    WebSocket: FakeSocket,
    EventSource: FakeEvents,
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
      runtimeAssetPrefix: 'https://cdn.example/pyodide/',
    });
    guard.begin(policy('block'));
    await scope.fetch('https://cdn.example/pyodide/pyodide.asm.wasm');
    await scope.fetch('data:text/plain,hi');
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(scope.fetch('/api/same-origin')).rejects.toThrow(/app\.example/);
  });

  it('asks once per host under Ask and remembers the answer for the run', async () => {
    const { scope, fetch } = fakeScope();
    const ask = vi.fn(async (host: string, ticket: { allow: boolean }) => {
      ticket.allow = host === 'ok.example';
    });
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

  it('keeps the policy until the next begin', async () => {
    const { scope, fetch } = fakeScope();
    const guard = installNetworkGuard(scope);
    guard.begin(policy('block'));
    // Work the code left behind still meets the policy after the run.
    await expect(scope.fetch('https://api.example/late')).rejects.toThrow(TypeError);
    guard.begin(policy('allow'));
    await scope.fetch('https://api.example/open');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('opens only the exempted hosts around runtime work, and only while it runs', async () => {
    const { scope, fetch } = fakeScope();
    const guard = installNetworkGuard(scope);
    guard.begin(policy('block'));
    await guard.exempt(['pypi.example'], async () => {
      await scope.fetch('https://pypi.example/simple');
      // Code left running during the install still meets the policy.
      await expect(scope.fetch('https://api.example/')).rejects.toThrow(TypeError);
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(scope.fetch('https://pypi.example/again')).rejects.toThrow(TypeError);
  });

  it('ends overlapping exemptions in any order without leaving a host open', async () => {
    const { scope } = fakeScope();
    const guard = installNetworkGuard(scope);
    guard.begin(policy('block'));
    let releaseFirst!: () => void;
    const first = guard.exempt(['pypi.example'], () => new Promise<void>(r => (releaseFirst = r)));
    const second = guard.exempt(['pypi.example'], async () => {
      releaseFirst();
      await first;
    });
    await Promise.all([first, second]);
    await expect(scope.fetch('https://pypi.example/')).rejects.toThrow(TypeError);
  });

  it('checks the URL the platform will use, even from objects that stringify', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope).begin(policy('block'));
    await expect(scope.fetch({ toString: () => 'https://evil.example/' } as never)).rejects.toThrow(
      /evil\.example/
    );
    // A toString that changes between calls is read once, and that string is what goes out.
    const fresh = fakeScope();
    installNetworkGuard(fresh.scope).begin(policy('ask', ['ok.example']));
    let calls = 0;
    const shifty = {
      toString: () => (calls++ === 0 ? 'https://ok.example/' : 'https://evil.example/'),
    };
    await fresh.scope.fetch(shifty as never);
    expect(String(fresh.fetch.mock.calls.at(-1)?.[0])).toBe('https://ok.example/');
    expect(fetch).not.toHaveBeenCalled();
    expect(() =>
      new scope.XMLHttpRequest().open('GET', { toString: () => 'https://evil.example/' } as never)
    ).toThrow(/evil\.example/);
  });

  it('leaves no path back to an original constructor', () => {
    const { scope } = fakeScope();
    const Original = (scope as unknown as Record<string, unknown>).WebSocket;
    installNetworkGuard(scope).begin(policy('block'));
    const Wrapped = scope.WebSocket as unknown as { prototype: { constructor: unknown } };
    expect(Object.getPrototypeOf(Wrapped)).not.toBe(Original);
    expect(Wrapped.prototype.constructor).toBe(Wrapped);
    expect(
      () => new (Wrapped.prototype.constructor as new (u: string) => object)('wss://x.example')
    ).toThrow(TypeError);
  });

  it('wraps WebTransport and WebSocketStream when the runtime has them', () => {
    const { scope } = fakeScope();
    const globals = scope as unknown as Record<string, unknown>;
    globals.WebTransport = class {
      constructor(public url: string) {}
    };
    globals.WebSocketStream = class {
      constructor(public url: string) {}
    };
    installNetworkGuard(scope).begin(policy('block'));
    expect(
      () => new (globals.WebTransport as new (u: string) => object)('https://t.example:4433')
    ).toThrow(/t\.example/);
    expect(
      () => new (globals.WebSocketStream as new (u: string) => object)('wss://s.example')
    ).toThrow(/s\.example/);
  });

  it('matches runtime assets after resolving the URL', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope, {
      runtimeAssetPrefix: 'https://cdn.example/pyodide/',
    }).begin(policy('block'));
    await expect(scope.fetch('https://cdn.example/pyodide/../other/payload')).rejects.toThrow(
      /cdn\.example/
    );
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('network guard against code that patches the realm', () => {
  it('refuses a target that does not parse instead of reading it as local', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope).begin(policy('block'));
    await expect(scope.fetch('http://[broken')).rejects.toThrow(TypeError);
    await expect(scope.fetch('ftp://files.example/x')).rejects.toThrow(/ftp:/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the built-ins it captured when code replaces them later', async () => {
    const { scope, fetch } = fakeScope();
    (scope as unknown as Record<string, unknown>).URL = URL;
    installNetworkGuard(scope, { runtimeAssetPrefix: 'https://cdn.example/pyodide/' }).begin(
      policy('block')
    );
    // A replacement that reads every target as an in-process URL.
    (scope as unknown as Record<string, unknown>).URL = class extends URL {
      constructor() {
        super('data:,');
      }
    };
    const startsWith = String.prototype.startsWith;
    String.prototype.startsWith = () => true;
    try {
      await expect(scope.fetch('https://evil.example/')).rejects.toThrow(/evil\.example/);
    } finally {
      String.prototype.startsWith = startsWith;
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it('reads a Request’s real URL, not an overridden url property', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope).begin(policy('block'));
    const request = new Request('https://evil.example/');
    Object.defineProperty(request, 'url', { value: 'data:,' });
    await expect(scope.fetch(request)).rejects.toThrow(/evil\.example/);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('decides from the ticket, so an early resolution cannot answer Allow', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope, { ask: async () => true }).begin(policy('ask'));
    await expect(scope.fetch('https://api.example/')).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('blocks under Block even for a host the tab allowed under Ask', async () => {
    const { scope, fetch } = fakeScope();
    installNetworkGuard(scope).begin(policy('block', ['api.example']));
    await expect(scope.fetch('https://api.example/')).rejects.toThrow(TypeError);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('lets the app’s own files through on desktop', async () => {
    const { scope, fetch } = fakeScope();
    (scope as unknown as { location: unknown }).location = {
      href: 'file:///app/index.html',
      protocol: 'file:',
    };
    installNetworkGuard(scope).begin(policy('block'));
    await scope.fetch('./assets/data.json');
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('checks Cache.add and addAll, which fetch past the wrapped fetch', async () => {
    const { scope } = fakeScope();
    const added: unknown[] = [];
    class FakeCache {
      async add(request: unknown) {
        added.push(request);
      }
      async addAll(_requests: unknown) {}
    }
    (scope as unknown as Record<string, unknown>).Cache = FakeCache;
    installNetworkGuard(scope).begin(policy('ask', ['ok.example']));
    const cache = new FakeCache();
    await cache.add('https://ok.example/a');
    await expect(cache.add('https://evil.example/')).rejects.toThrow(/evil\.example/);
    await expect(
      cache.addAll(['https://ok.example/b', 'https://evil.example/'] as never)
    ).rejects.toThrow(/evil\.example/);
    expect(added).toContain('https://ok.example/a');
  });
});

describe('network asker', () => {
  it('posts a request and resolves with the renderer answer', async () => {
    const posted: Array<Record<string, unknown>> = [];
    const asker = createNetworkAsker(
      message => posted.push(message as Record<string, unknown>),
      () => 'run-1'
    );
    const ticket = { allow: false };
    const answer = asker.ask('api.example', ticket);
    expect(posted[0]).toMatchObject({
      type: 'network-request',
      runId: 'run-1',
      host: 'api.example',
    });
    expect(
      asker.receive({ type: 'network-decision', requestId: posted[0]!.requestId, allow: true })
    ).toBe(true);
    await answer;
    expect(ticket.allow).toBe(true);
    // Ids are random, so code in the worker cannot guess one to answer itself.
    expect(posted[0]!.requestId).toMatch(/^net-[0-9a-f-]{36}$/);
    expect(asker.receive({ type: 'network-decision', requestId: 'unknown', allow: true })).toBe(
      false
    );
  });

  it('keeps tickets away from realm methods code in the worker can patch', () => {
    const set = Map.prototype.set;
    // A patch that would approve any question the moment it is stored.
    Map.prototype.set = function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      const entry = value as { ticket?: { allow: boolean }; resolve?: () => void };
      if (entry?.ticket) entry.ticket.allow = true;
      return set.call(this, key, value);
    };
    try {
      const asker = createNetworkAsker(
        () => undefined,
        () => 'run-1'
      );
      const ticket = { allow: false };
      void asker.ask('api.example', ticket);
      expect(ticket.allow).toBe(false);
    } finally {
      Map.prototype.set = set;
    }
  });

  it('answers open questions with Block when the run ends', async () => {
    const asker = createNetworkAsker(
      () => undefined,
      () => 'run-1'
    );
    const ticket = { allow: false };
    const answer = asker.ask('api.example', ticket);
    asker.cancelAll();
    await answer;
    expect(ticket.allow).toBe(false);
  });
});

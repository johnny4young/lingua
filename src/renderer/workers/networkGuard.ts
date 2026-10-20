import {
  decideNetworkHost,
  networkBlockedMessage,
  type NetworkRunPolicy,
} from '../../shared/networkPolicy';

/**
 * Network policy inside a runtime worker. The wrappers stay installed for the
 * worker's life (Pyodide captures `fetch` when `pyodide.http` is imported). A
 * policy set with `begin` stays in force until the next `begin`, so work user
 * code schedules for later is checked too; `exempt` opens named hosts around
 * the runtime's own network work, such as a package install.
 *
 * Best effort, not a sandbox: user code that reaches an API the guard does not
 * wrap (a dynamic `import()` of a URL, for one) is not stopped. The guard holds
 * its own references to the built-ins it uses, so code that replaces them
 * cannot make a request read as local.
 */

export interface NetworkGuardOptions {
  /** Absolute URLs under this prefix are the runtime's own assets and always pass. */
  runtimeAssetPrefix?: string;
  /**
   * Asks the renderer about a host and resolves once `ticket.allow` holds the
   * answer; absent where user code cannot wait (sync runtimes). The guard reads
   * the ticket, never the resolved value, so a patched `Promise.prototype.then`
   * cannot answer for the user.
   */
  ask?: (host: string, ticket: { allow: boolean }) => Promise<unknown>;
  /** Records a decided request for the trust log. */
  report?: (host: string, verdict: 'allowed' | 'blocked') => void;
}

export interface NetworkGuard {
  /** Puts `run` in force; an Allow policy lifts any earlier one. */
  begin: (run: NetworkRunPolicy) => void;
  /** Lets `hosts` through while the runtime's own `task` runs; every other host keeps the policy. */
  exempt: <T>(hosts: readonly string[], task: () => Promise<T>) => Promise<T>;
}

type Scope = typeof globalThis;
type Getter = (this: unknown) => unknown;

/** Constructors that open a connection from a worker. */
const CONNECTION_CONSTRUCTORS = ['WebSocket', 'EventSource', 'WebTransport', 'WebSocketStream'];
/** A nested worker would start with unwrapped globals. */
const WORKER_CONSTRUCTORS = ['Worker', 'SharedWorker'];
const NETWORK_PROTOCOLS = ['http:', 'https:', 'ws:', 'wss:'];

function getterOf(proto: object | undefined, key: string): Getter | undefined {
  return proto
    ? (Object.getOwnPropertyDescriptor(proto, key)?.get as Getter | undefined)
    : undefined;
}

/**
 * Replaces a global constructor with `guarded` without leaving a path back to
 * the original: no prototype link to it, and its prototype's `constructor`
 * points at the wrapper. Static constants (WebSocket.OPEN and the like) are copied.
 */
type Callable = (...args: never[]) => unknown;

function swapConstructor(globals: Record<string, unknown>, name: string, guarded: Callable): void {
  const original = globals[name] as Callable | undefined;
  if (typeof original !== 'function') return;
  for (const key of Object.getOwnPropertyNames(original)) {
    if (key === 'length' || key === 'name' || key === 'prototype') continue;
    const descriptor = Object.getOwnPropertyDescriptor(original, key);
    if (descriptor) Object.defineProperty(guarded, key, descriptor);
  }
  guarded.prototype = original.prototype;
  Object.defineProperty(original.prototype, 'constructor', {
    value: guarded,
    configurable: true,
    writable: true,
  });
  globals[name] = guarded;
}

/** True when `list` holds `value`, without Array.prototype methods user code can replace. */
function contains(list: readonly string[], value: string): boolean {
  for (let index = 0; index < list.length; index += 1) if (list[index] === value) return true;
  return false;
}

export function installNetworkGuard(
  scope: Scope = globalThis as Scope,
  options: NetworkGuardOptions = {}
): NetworkGuard {
  let run: NetworkRunPolicy | null = null;
  // Per-host counts, so overlapping exemptions end independently of their order.
  const exempted: Record<string, number> = Object.create(null);
  const isExempt = (host: string) => (exempted[host] ?? 0) > 0;
  // Index view of the global scope for the constructors swapped below.
  const globals = scope as unknown as Record<string, unknown>;

  // Built-ins captured before user code runs: it shares this realm and could replace them.
  const apply = Reflect.apply;
  const NativeURL = (globals.URL as typeof URL | undefined) ?? URL;
  const NativeString = String;
  const NativeTypeError = TypeError;
  const startsWith = String.prototype.startsWith;
  const slice = String.prototype.slice;
  const urlHref = getterOf(NativeURL.prototype, 'href')!;
  const urlHost = getterOf(NativeURL.prototype, 'host')!;
  const urlProtocol = getterOf(NativeURL.prototype, 'protocol')!;
  const NativeRequest =
    (globals.Request as typeof Request | undefined) ??
    (typeof Request === 'undefined' ? undefined : Request);
  const requestUrl = getterOf(NativeRequest?.prototype, 'url');
  const location = scope.location as Location | undefined;
  const base = location ? NativeString(location.href) : undefined;
  const ownProtocol = location ? NativeString(location.protocol) : undefined;

  type Target =
    { kind: 'pass' } | { kind: 'check'; host: string } | { kind: 'refuse'; label: string };

  /**
   * What a request target means, read once, exactly as the platform will.
   * Anything that does not parse or uses another scheme is refused while a
   * policy is in force: native fetch rejects it anyway, and a parse failure
   * must never read as "stays local".
   */
  const classify = (target: string): Target => {
    let parsed: URL;
    try {
      parsed = new NativeURL(target, base);
    } catch {
      return { kind: 'refuse', label: apply(slice, target, [0, 80]) as string };
    }
    const href = apply(urlHref, parsed, []) as string;
    if (
      options.runtimeAssetPrefix !== undefined &&
      apply(startsWith, href, [options.runtimeAssetPrefix])
    )
      return { kind: 'pass' };
    const protocol = apply(urlProtocol, parsed, []) as string;
    if (contains(NETWORK_PROTOCOLS, protocol))
      return { kind: 'check', host: apply(urlHost, parsed, []) as string };
    // In-process URLs, and the app's own files on desktop (file:), never reach the network.
    if (protocol === 'data:' || protocol === 'blob:' || protocol === ownProtocol)
      return { kind: 'pass' };
    return { kind: 'refuse', label: protocol };
  };

  const block = (host: string): never => {
    options.report?.(host, 'blocked');
    const error = new NativeTypeError(networkBlockedMessage(host));
    // The guard's own frames say nothing about the user's code.
    error.stack = `TypeError: ${error.message}`;
    throw error;
  };

  const settle = (host: string, allow: boolean) => {
    if (!run) return;
    const list = allow ? run.allowedHosts : run.blockedHosts;
    list[list.length] = host;
  };

  // Synchronous APIs cannot wait: an unanswered host under Ask is blocked.
  const checkSync = (target: string): void => {
    if (!run) return;
    const verdict = classify(target);
    if (verdict.kind === 'refuse') block(verdict.label);
    if (
      verdict.kind === 'check' &&
      !isExempt(verdict.host) &&
      decideNetworkHost(run, verdict.host) !== 'allow'
    )
      block(verdict.host);
  };

  const check = async (target: string): Promise<void> => {
    if (!run) return;
    const verdict = classify(target);
    if (verdict.kind === 'pass') return;
    if (verdict.kind === 'refuse') block(verdict.label);
    const host = (verdict as { host: string }).host;
    if (isExempt(host)) return;
    let decision = decideNetworkHost(run, host);
    if (decision === 'ask') {
      const ticket = { allow: false };
      if (options.ask) await options.ask(host, ticket);
      settle(host, ticket.allow);
      if (ticket.allow) options.report?.(host, 'allowed');
      decision = ticket.allow ? 'allow' : 'block';
    }
    if (decision === 'block') block(host);
  };

  /** The URL a fetch-style input will use: a Request's own URL, or anything else stringified once. */
  const targetOf = (input: unknown): { target: string; forwarded: unknown } => {
    if (requestUrl && NativeRequest && input instanceof NativeRequest) {
      // The native getter reads the Request's internal URL, past any own or subclass override.
      return { target: apply(requestUrl, input, []) as string, forwarded: input };
    }
    const target = NativeString(input);
    return { target, forwarded: target };
  };

  const originalFetch = scope.fetch;
  if (typeof originalFetch === 'function') {
    const guardedFetch = async function fetch(
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      const { target, forwarded } = targetOf(input);
      await check(target);
      return apply(originalFetch, scope, [forwarded, init]) as Promise<Response>;
    };
    // fetch also lives on the global scope's prototype; deleting the own
    // property must not bring the original back.
    for (let target: object | null = scope; target; target = Object.getPrototypeOf(target)) {
      if (Object.prototype.hasOwnProperty.call(target, 'fetch')) {
        Object.defineProperty(target, 'fetch', {
          value: guardedFetch,
          configurable: true,
          writable: true,
        });
      }
    }
  }

  // Cache.add and addAll fetch internally, past the wrapped fetch.
  const cache = (globals.Cache as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  const originalAdd = cache?.add as ((request: unknown) => Promise<void>) | undefined;
  if (cache && typeof originalAdd === 'function') {
    const guardedAdd = async function add(this: unknown, request: unknown) {
      const { target, forwarded } = targetOf(request);
      await check(target);
      return apply(originalAdd, this, [forwarded]) as Promise<void>;
    };
    cache.add = guardedAdd;
    cache.addAll = async function addAll(this: unknown, requests: Iterable<unknown>) {
      const pending: Promise<void>[] = [];
      for (const request of requests) pending[pending.length] = apply(guardedAdd, this, [request]);
      await Promise.all(pending);
    };
  }

  const xhr = globals.XMLHttpRequest as typeof XMLHttpRequest | undefined;
  if (xhr?.prototype?.open) {
    const originalOpen = xhr.prototype.open;
    xhr.prototype.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
      const target = NativeString(args[1]);
      checkSync(target);
      return apply(originalOpen, this, [args[0], target, ...args.slice(2)]);
    } as typeof originalOpen;
  }

  for (const name of CONNECTION_CONSTRUCTORS) {
    const Original = globals[name] as (new (url: string, ...rest: unknown[]) => object) | undefined;
    if (typeof Original !== 'function') continue;
    swapConstructor(globals, name, function (this: unknown, url: unknown, ...rest: unknown[]) {
      const target = NativeString(url);
      checkSync(target);
      return new Original(target, ...rest);
    });
  }

  for (const name of WORKER_CONSTRUCTORS) {
    const Original = globals[name] as (new (...args: unknown[]) => object) | undefined;
    if (typeof Original !== 'function') continue;
    swapConstructor(globals, name, function (this: unknown, ...args: unknown[]) {
      if (run && run.policy !== 'allow') {
        throw new NativeTypeError(
          `Lingua blocks ${name} while network access from running code is limited.`
        );
      }
      return new Original(...args);
    });
  }

  return {
    begin: next => {
      // Index copies: a persistent worker may still hold code that replaced the array iterator.
      const copy = (list: readonly string[]) => {
        const out: string[] = [];
        for (let index = 0; index < list.length; index += 1) out[index] = NativeString(list[index]);
        return out;
      };
      run =
        next.policy === 'allow'
          ? null
          : {
              policy: next.policy,
              allowedHosts: copy(next.allowedHosts),
              blockedHosts: copy(next.blockedHosts),
            };
    },
    exempt: async (hosts, task) => {
      for (let index = 0; index < hosts.length; index += 1)
        exempted[hosts[index]!] = (exempted[hosts[index]!] ?? 0) + 1;
      try {
        return await task();
      } finally {
        for (let index = 0; index < hosts.length; index += 1)
          exempted[hosts[index]!] = (exempted[hosts[index]!] ?? 1) - 1;
      }
    },
  };
}

/** Worker-side half of the Ask round trip: posts a request, settles the ticket when the renderer answers. */
export function createNetworkAsker(post: (message: unknown) => void, runId: () => string) {
  // Unguessable ids, so code in the worker cannot address an answer to its own question.
  const newId = crypto.randomUUID.bind(crypto);
  // A null-prototype record: a patched Map or Object method never sees a ticket.
  let pending: Record<string, { ticket: { allow: boolean }; resolve: () => void }> =
    Object.create(null);
  return {
    ask: (host: string, ticket: { allow: boolean }) =>
      new Promise<void>(resolve => {
        const requestId = `net-${newId()}`;
        pending[requestId] = { ticket, resolve };
        post({ type: 'network-request', runId: runId(), requestId, host });
      }),
    /** True when the message was a decision this asker was waiting for. */
    receive: (message: { type?: unknown; requestId?: unknown; allow?: unknown }) => {
      if (message.type !== 'network-decision' || typeof message.requestId !== 'string')
        return false;
      const entry = pending[message.requestId];
      if (!entry) return false;
      delete pending[message.requestId];
      entry.ticket.allow = message.allow === true;
      entry.resolve();
      return true;
    },
    /** Answers every open question with Block, for a run that ends while one is pending. */
    cancelAll: () => {
      const open = pending;
      pending = Object.create(null);
      for (const id in open) open[id]!.resolve();
    },
  };
}

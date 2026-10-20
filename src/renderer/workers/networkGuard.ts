import {
  decideNetworkHost,
  networkBlockedMessage,
  networkHostOf,
  type NetworkRunPolicy,
} from '../../shared/networkPolicy';

/**
 * Network policy inside a runtime worker. The wrappers stay installed for the
 * worker's life (Pyodide captures `fetch` when `pyodide.http` is imported) and
 * only enforce between `begin` and `end`, so the runtime's own loading passes.
 *
 * Best effort, not a sandbox: user code that reaches an API the guard does not
 * wrap (a dynamic `import()` of a URL, for one) is not stopped.
 */

export interface NetworkGuardOptions {
  /** URLs the runtime itself loads (its own assets) always pass. */
  isRuntimeAsset?: (url: string) => boolean;
  /** Asks the renderer about a host; absent where user code cannot wait (sync runtimes). */
  ask?: (host: string) => Promise<boolean>;
  /** Records a decided request for the trust log. */
  report?: (host: string, verdict: 'allowed' | 'blocked') => void;
}

export interface NetworkGuard {
  begin: (run: NetworkRunPolicy) => void;
  end: () => void;
}

type Scope = typeof globalThis;

function requestUrl(input: unknown): string | null {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return null;
}

export function installNetworkGuard(
  scope: Scope = globalThis as Scope,
  options: NetworkGuardOptions = {}
): NetworkGuard {
  let run: NetworkRunPolicy | null = null;
  // Index view of the global scope for the constructors swapped below.
  const globals = scope as unknown as Record<string, unknown>;
  const base = () => (scope.location as Location | undefined)?.href;

  // Settles a host for synchronous APIs, which cannot wait: an unanswered host under Ask is blocked.
  const syncVerdict = (url: string): { host: string | null; allow: boolean } => {
    const host = networkHostOf(url, base());
    if (!run || host === null || options.isRuntimeAsset?.(url)) return { host, allow: true };
    return { host, allow: decideNetworkHost(run, host) === 'allow' };
  };

  const settle = (host: string, allow: boolean) => {
    if (!run) return;
    (allow ? run.allowedHosts : run.blockedHosts).push(host);
  };

  const block = (host: string): never => {
    options.report?.(host, 'blocked');
    const error = new TypeError(networkBlockedMessage(host));
    // The guard's own frames say nothing about the user's code.
    error.stack = `TypeError: ${error.message}`;
    throw error;
  };

  const originalFetch = scope.fetch;
  if (typeof originalFetch === 'function') {
    const guardedFetch = async function fetch(
      this: unknown,
      input: RequestInfo | URL,
      init?: RequestInit
    ) {
      const url = requestUrl(input);
      const host = url === null ? null : networkHostOf(url, base());
      if (run && host !== null && url !== null && !options.isRuntimeAsset?.(url)) {
        let verdict = decideNetworkHost(run, host);
        if (verdict === 'ask') {
          const allow = options.ask ? await options.ask(host) : false;
          settle(host, allow);
          if (allow) options.report?.(host, 'allowed');
          verdict = allow ? 'allow' : 'block';
        }
        if (verdict === 'block') block(host);
      }
      return originalFetch.call(scope, input, init);
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

  const xhr = globals.XMLHttpRequest as typeof XMLHttpRequest | undefined;
  if (xhr?.prototype?.open) {
    const originalOpen = xhr.prototype.open;
    xhr.prototype.open = function open(this: XMLHttpRequest, ...args: unknown[]) {
      const url =
        typeof args[1] === 'string' ? args[1] : args[1] instanceof URL ? args[1].href : '';
      const { host, allow } = syncVerdict(url);
      if (!allow && host !== null) block(host);
      return (originalOpen as (...a: unknown[]) => void).apply(this, args);
    } as typeof originalOpen;
  }

  // Constructors that open a connection; each keeps its prototype and static constants.
  for (const name of ['WebSocket', 'EventSource'] as const) {
    const Original = globals[name] as
      (new (url: string | URL, ...rest: unknown[]) => object) | undefined;
    if (typeof Original !== 'function') continue;
    const Guarded = function (this: unknown, url: string | URL, ...rest: unknown[]) {
      const { host, allow } = syncVerdict(String(url));
      if (!allow && host !== null) block(host);
      return new Original(url, ...rest);
    } as unknown as typeof Original;
    Object.setPrototypeOf(Guarded, Original);
    Guarded.prototype = Original.prototype;
    globals[name] = Guarded;
  }

  // A nested worker would start with unwrapped globals.
  for (const name of ['Worker', 'SharedWorker'] as const) {
    const Original = globals[name] as (new (...args: unknown[]) => object) | undefined;
    if (typeof Original !== 'function') continue;
    const Guarded = function (this: unknown, ...args: unknown[]) {
      if (run && run.policy !== 'allow') {
        throw new TypeError(
          `Lingua blocks ${name} while network access from running code is limited.`
        );
      }
      return new Original(...args);
    } as unknown as typeof Original;
    Object.setPrototypeOf(Guarded, Original);
    Guarded.prototype = Original.prototype;
    globals[name] = Guarded;
  }

  return {
    begin: next => {
      run =
        next.policy === 'allow'
          ? null
          : {
              policy: next.policy,
              allowedHosts: [...next.allowedHosts],
              blockedHosts: [...next.blockedHosts],
            };
    },
    end: () => {
      run = null;
    },
  };
}

/** Worker-side half of the Ask round trip: posts a request, resolves when the renderer answers. */
export function createNetworkAsker(post: (message: unknown) => void, runId: () => string) {
  let next = 0;
  const pending = new Map<string, (allow: boolean) => void>();
  return {
    ask: (host: string) =>
      new Promise<boolean>(resolve => {
        const requestId = `net-${(next += 1)}`;
        pending.set(requestId, resolve);
        post({ type: 'network-request', runId: runId(), requestId, host });
      }),
    /** True when the message was a decision this asker was waiting for. */
    receive: (message: { type?: unknown; requestId?: unknown; allow?: unknown }) => {
      if (message.type !== 'network-decision' || typeof message.requestId !== 'string')
        return false;
      const resolve = pending.get(message.requestId);
      if (!resolve) return false;
      pending.delete(message.requestId);
      resolve(message.allow === true);
      return true;
    },
    /** Answers every open question with Block, for a run that ends while one is pending. */
    cancelAll: () => {
      for (const resolve of pending.values()) resolve(false);
      pending.clear();
    },
  };
}

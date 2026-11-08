/**
 * Starts the SQL host utilityProcess on first use, matches responses to
 * requests, and starts a new one after a crash or a restart. Pending requests
 * of a host that exits fail instead of hanging.
 */

import type { HostError, HostRequest } from './sqlHost/protocol';

/** The slice of Electron's UtilityProcess the supervisor uses. */
export interface HostChild {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  kill(): boolean;
}

export class SqlHostError<Detail extends { message: string } = HostError> extends Error {
  constructor(readonly detail: Detail) {
    super(detail.message);
    this.name = 'SqlHostError';
  }
}

/** A request without the id the supervisor stamps on it. */
export type SqlHostRequestBody<Request> = Request extends infer R ? (R extends Request ? Omit<R, 'id'> : never) : never;

/** How long a restart waits for the killed host to exit before the next one starts. */
const RETIRE_WAIT_MS = 5_000;

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout | null;
}

/** `stopped` shapes the failure of requests a host took down with it. */
export function createSqlHostSupervisor<Request extends { id: number } = HostRequest, Failure extends { message: string } = HostError>(
  fork: () => HostChild,
  stopped: (message: string) => Failure = (message) => ({ message }) as Failure
) {
  let child: HostChild | null = null;
  // A killed host may still hold files (a DuckDB lock) until it exits; the next fork waits for that.
  let retiring: Promise<void> | null = null;
  let nextId = 1;
  const pending = new Map<number, Pending>();

  const failAll = (message: string) => {
    for (const [id, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(new SqlHostError(stopped(message)));
      pending.delete(id);
    }
  };

  function start(): HostChild {
    const started = fork();
    started.on('message', (message) => {
      const response = message as { id: number; ok: true; result: unknown } | { id: number; ok: false; error: Failure };
      const entry = pending.get(response.id);
      if (!entry) return;
      pending.delete(response.id);
      if (entry.timer) clearTimeout(entry.timer);
      if (response.ok) entry.resolve(response.result);
      else entry.reject(new SqlHostError(response.error));
    });
    started.on('exit', () => {
      if (child !== started) return;
      child = null;
      failAll('The SQL host stopped.');
    });
    return started;
  }

  function retire(current: HostChild): Promise<void> {
    const exited = new Promise<void>(resolve => {
      const timer = setTimeout(resolve, RETIRE_WAIT_MS);
      timer.unref?.();
      current.on('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const waiting: Promise<void> = Promise.all([retiring, exited]).then(() => {
      if (retiring === waiting) retiring = null;
    });
    retiring = waiting;
    current.kill();
    return waiting;
  }

  function request<T>(body: SqlHostRequestBody<Request>, timeoutMs?: number): Promise<T> {
    if (!child && retiring) return retiring.then(() => request<T>(body, timeoutMs));
    child ??= start();
    const id = nextId++;
    const target = child;
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs === undefined
          ? null
          : setTimeout(() => {
              pending.delete(id);
              reject(new SqlHostError(stopped('The SQL host did not answer in time.')));
            }, timeoutMs);
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
      target.postMessage({ ...body, id });
    });
  }

  /** Stops the host and resolves once it exited, or after a bounded wait. */
  function stop(): Promise<void> {
    const current = child;
    child = null;
    failAll('The SQL host was restarted.');
    return current ? retire(current) : (retiring ?? Promise.resolve());
  }

  return {
    /** Sends one request; `timeoutMs` fails it without stopping the host. */
    request,

    /** Stops the host and every session in it; the next request starts a new one once it exited. */
    restart(): void {
      void stop();
    },

    isRunning: () => child !== null,

    dispose: stop,
  };
}

export type SqlHostSupervisor<Request extends { id: number } = HostRequest, Failure extends { message: string } = HostError> = ReturnType<
  typeof createSqlHostSupervisor<Request, Failure>
>;

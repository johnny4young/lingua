/**
 * The SQL host's request handler, free of any process transport so tests
 * drive it directly. One session per connection id, reused while its config
 * is unchanged; one open run per connection, closed when the next one starts.
 */

import net from 'node:net';
import type { CallContext, Handlers } from '@electron-stagewright/host-supervisor';
import type { SqlRemoteEngine } from '../../shared/sqlConnections';
import type { SqlDbIntrospect, SqlDbIntrospectResult } from '../../shared/sqlDb';
import type { RowEditStatement } from '../../shared/sqlRowEdits';
import { classifyConnectError, EditFailedError, readRowPage, runClock, type DriverRows, type DriverSession, type RowPager } from '../../shared/sqlDriver';
import { toJsonCell, type DriverFactory } from './driver';
import { SqlHostError } from './hostError';
import { createTunnelPool, TunnelError, type Tunnel, type TunnelPool } from './tunnel';
import { QUERY_CANCELLED_MESSAGE, type HostError, type HostExecuteResult, type HostFetchResult, type HostRequest, type HostSessionConfig, type HostTestResult, type SqlHostOps } from './protocol';

const TCP_PROBE_MS = 10_000;

interface Session {
  fingerprint: string;
  ready: Promise<DriverSession>;
  /** Lets go of the session's tunnel, if it has one. */
  release: () => Promise<void>;
  /** Statements on one connection run one after another. */
  queue: Promise<unknown>;
}

interface Run extends RowPager {
  connectionId: string;
  session: DriverSession;
}

const mapRow = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toJsonCell(value)]));

const fingerprintOf = (config: HostSessionConfig) => JSON.stringify(config);

const fail = (detail: HostError) => new SqlHostError<HostError>(detail);

function fileError(err: unknown): HostError {
  const code = (err as { code?: string }).code;
  return {
    message: err instanceof Error ? err.message : String(err),
    step: 'file',
    fix: code === 'ENOENT' ? 'file-missing' : 'file-unreadable',
  };
}

function probeTcp(address: string, port: number): Promise<number> {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: address, port, timeout: TCP_PROBE_MS });
    socket.once('connect', () => {
      socket.destroy();
      resolve(Math.round(performance.now() - start));
    });
    socket.once('timeout', () => {
      socket.destroy();
      reject(Object.assign(new Error(`No answer from port ${port}`), { code: 'ETIMEDOUT' }));
    });
    socket.once('error', (err) => reject(err));
  });
}

const catalogSessionId = (connectionId: string) => `${connectionId}#catalog`;
/** Staged edits run on their own connection, so they never join a transaction the user opened in the editor. */
const editsSessionId = (connectionId: string) => `${connectionId}#edits`;

/** The config a driver gets behind a tunnel: no SSH settings and no address, since the tunnel makes its sockets. */
function behindTunnel(config: HostSessionConfig): HostSessionConfig {
  const direct: HostSessionConfig = { ...config };
  delete direct.ssh;
  delete direct.address;
  return direct;
}

/** A connect failure as the renderer sees it: the tunnel's own step, the file, or the driver's classification. */
function connectError(config: HostSessionConfig, err: unknown): HostError {
  if (err instanceof TunnelError) return err.detail;
  return config.engine === 'sqlite' ? fileError(err) : classifyConnectError(err);
}

export function createSqlHost(drivers: Record<SqlRemoteEngine, DriverFactory>, tunnels: TunnelPool = createTunnelPool()) {
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();
  /** Statements still waiting for their first page, so Cancel can reach them. */
  const inflight = new Map<string, DriverSession>();

  async function dropSession(connectionId: string): Promise<void> {
    const session = sessions.get(connectionId);
    sessions.delete(connectionId);
    for (const [runId, run] of runs) if (run.connectionId === connectionId) runs.delete(runId);
    if (session) {
      await session.ready.then((s) => s.close()).catch(() => undefined);
      await session.release();
    }
  }

  /** A driver whose sockets are the tunnel's channels; the tunnel is let go when the driver cannot start. */
  async function throughTunnel(config: HostSessionConfig): Promise<{ driver: DriverSession; tunnel: Tunnel }> {
    const tunnel = await tunnels.acquire(config.ssh!);
    try {
      return { driver: await drivers[config.engine](behindTunnel(config), tunnel.socket), tunnel };
    } catch (err) {
      await tunnel.release();
      throw err;
    }
  }

  function sessionFor(config: HostSessionConfig): Session {
    const fingerprint = fingerprintOf(config);
    const current = sessions.get(config.connectionId);
    if (current && current.fingerprint === fingerprint) return current;
    if (current) void dropSession(config.connectionId);
    let tunnel: Tunnel | undefined;
    const ready = config.ssh
      ? throughTunnel(config).then((opened) => {
          tunnel = opened.tunnel;
          return opened.driver;
        })
      : drivers[config.engine](config);
    // A failed connect is retried by the next request.
    ready.catch(() => {
      if (sessions.get(config.connectionId)?.ready === ready) sessions.delete(config.connectionId);
    });
    const session: Session = { fingerprint, ready, queue: Promise.resolve(), release: async () => tunnel?.release() };
    sessions.set(config.connectionId, session);
    // A dropped connection is let go, so the next request connects again.
    void ready.then(
      (driver) =>
        driver.onLost?.(() => {
          if (sessions.get(config.connectionId) === session) void dropSession(config.connectionId);
        }),
      () => undefined
    );
    return session;
  }

  function serialize<T>(session: Session, work: () => Promise<T>): Promise<T> {
    const next = session.queue.then(work, work);
    session.queue = next.catch(() => undefined);
    return next;
  }

  /** Closes a run's rows even when fully read: a read-only run ends its transaction there. */
  async function closeRun(runId: string): Promise<void> {
    const run = runs.get(runId);
    runs.delete(runId);
    if (run) await run.rows.close().catch(() => undefined);
  }

  const readPage = (run: Run, maxRows: number, maxBytes: number): Promise<HostFetchResult> =>
    readRowPage(run, maxRows, maxBytes, mapRow, (row) => Buffer.byteLength(JSON.stringify(row)));

  async function execute(request: Extract<HostRequest, { type: 'execute' }>, signal?: AbortSignal): Promise<HostExecuteResult> {
    const { config, runId, sql, readWrite, window } = request;
    for (const [id, run] of runs) if (run.connectionId === config.connectionId) await closeRun(id);
    const session = sessionFor(config);
    return serialize(session, async () => {
      let driver: DriverSession;
      try {
        driver = await session.ready;
      } catch (err) {
        // A failed connect names its step, so the renderer can tell it from a SQL error.
        throw fail(connectError(config, err));
      }
      // Cancelled while it waited for its connection: the statement never runs.
      if (signal?.aborted) throw fail({ message: QUERY_CANCELLED_MESSAGE, cancelled: true });
      inflight.set(runId, driver);
      let rows: DriverRows;
      const clock = runClock();
      try {
        rows = await driver.run(sql, { readWrite });
      } finally {
        inflight.delete(runId);
      }
      clock.ran();
      const run: Run = { connectionId: config.connectionId, session: driver, rows, pending: [], done: false };
      runs.set(runId, run);
      try {
        const page = await readPage(run, window.maxRows, window.maxBytes);
        const phases = clock.phases(rows);
        const hasMore = !page.done;
        if (!hasMore) await closeRun(runId);
        return {
          columns: rows.columns,
          rows: page.rows,
          rowCount: page.rows.length,
          tooLarge: hasMore,
          rowCountIsLowerBound: hasMore,
          hasMore,
          ...(rows.affectedRows !== undefined ? { affectedRows: rows.affectedRows } : {}),
          ...(phases ? { phases } : {}),
        };
      } catch (err) {
        await closeRun(runId);
        throw err;
      }
    });
  }

  async function fetch(request: Extract<HostRequest, { type: 'fetch' }>): Promise<HostFetchResult> {
    const run = runs.get(request.runId);
    // A newer run on the connection closed it; an empty page would pass for the end of the result.
    if (!run) throw fail({ message: 'This result was closed by a newer run on the same connection.' });
    const page = await readPage(run, request.limit, request.maxBytes);
    if (page.done) await closeRun(request.runId);
    return page;
  }

  /**
   * Runs `work` until the caller aborts, then cancels the run's statement. The engine's own error
   * answers a cancel it honoured; one it could not honour answers with `restart` at once.
   */
  function untilAborted<T>(runId: string, signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    if (!signal) return work();
    let onAbort: () => void = () => undefined;
    const refused = new Promise<never>((_, reject) => {
      const stuck = () => reject(fail({ message: 'The query was cancelled, but the engine could not stop it.', cancelled: true, restart: true }));
      onAbort = () => {
        const target = inflight.get(runId) ?? runs.get(runId)?.session;
        // Nothing runs yet: the statement is still waiting for its connection.
        if (!target) return reject(fail({ message: QUERY_CANCELLED_MESSAGE, cancelled: true }));
        void target.cancel().then(cancelled => cancelled || stuck(), stuck);
      };
    });
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
    return Promise.race([work(), refused]).finally(() => signal.removeEventListener('abort', onAbort));
  }

  async function test(config: HostSessionConfig): Promise<HostTestResult> {
    let tcpMs: number | undefined;
    // Through a tunnel, the first hop is what this machine reaches.
    const first = config.ssh?.hops[0];
    const probe = first ? { address: first.host, port: first.port } : config.address ? { address: config.address, port: config.port ?? 0 } : null;
    if (config.engine !== 'sqlite' && probe) {
      try {
        tcpMs = await probeTcp(probe.address, probe.port);
      } catch (err) {
        throw fail({ ...classifyConnectError(err), step: 'tcp', fix: first ? 'ssh-unreachable' : 'unreachable' });
      }
    }
    let sshMs: number | undefined;
    let tunnel: Tunnel | undefined;
    let driverConfig = config;
    if (config.ssh) {
      const sshStart = performance.now();
      try {
        tunnel = await tunnels.acquire(config.ssh);
      } catch (err) {
        throw fail(connectError(config, err));
      }
      sshMs = Math.round(performance.now() - sshStart);
      driverConfig = behindTunnel(config);
    }
    const start = performance.now();
    let driver: DriverSession;
    try {
      driver = await drivers[config.engine](driverConfig, tunnel?.socket);
    } catch (err) {
      await tunnel?.release();
      throw fail(connectError(config, err));
    }
    const connectMs = Math.round(performance.now() - start);
    try {
      const serverStart = performance.now();
      const serverVersion = await driver.version();
      const tls = driver.tls?.();
      const encrypted = driver.encrypted?.();
      return {
        ...(tcpMs !== undefined ? { tcpMs } : {}),
        ...(sshMs !== undefined ? { sshMs } : {}),
        connectMs,
        serverMs: Math.round(performance.now() - serverStart),
        serverVersion,
        ...(tls ? { tls } : {}),
        ...(encrypted !== undefined ? { encrypted } : {}),
      };
    } finally {
      await driver.close().catch(() => undefined);
      await tunnel?.release();
    }
  }

  async function estimate(config: HostSessionConfig, sql: string): Promise<number | null> {
    const session = sessionFor(config);
    return serialize(session, async () => (await session.ready).estimateRows(sql));
  }

  async function introspect(config: HostSessionConfig, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult> {
    // Its own connection, so a catalog read never ends the user's transaction or open result.
    const session = sessionFor({ ...config, connectionId: catalogSessionId(config.connectionId) });
    return serialize(session, async () => {
      let driver: DriverSession;
      try {
        driver = await session.ready;
      } catch (err) {
        throw fail(connectError(config, err));
      }
      return driver.introspect(request);
    });
  }

  async function applyEdits(config: HostSessionConfig, statements: RowEditStatement[]): Promise<{ applied: number }> {
    const session = sessionFor({ ...config, connectionId: editsSessionId(config.connectionId) });
    return serialize(session, async () => {
      let driver: DriverSession;
      try {
        driver = await session.ready;
      } catch (err) {
        throw fail(connectError(config, err));
      }
      try {
        await driver.applyEdits(statements);
      } catch (err) {
        if (err instanceof EditFailedError) throw fail({ message: err.message, edit: err.failure });
        throw err;
      }
      return { applied: statements.length };
    });
  }

  /** One operation as data; a failure throws `SqlHostError`. */
  async function handle(request: HostRequest, signal?: AbortSignal): Promise<unknown> {
    switch (request.type) {
      case 'test':
        return test(request.config);
      case 'execute':
        return untilAborted(request.runId, signal, () => execute(request, signal));
      case 'fetch':
        return untilAborted(request.runId, signal, () => fetch(request));
      case 'close-run':
        await closeRun(request.runId);
        return null;
      case 'estimate':
        return estimate(request.config, request.sql);
      case 'introspect':
        return introspect(request.config, request.request);
      case 'apply-edits':
        return applyEdits(request.config, request.statements);
      case 'disconnect':
        await dropSession(request.connectionId);
        await dropSession(catalogSessionId(request.connectionId));
        await dropSession(editsSessionId(request.connectionId));
        return null;
    }
  }

  async function dispose(): Promise<void> {
    await Promise.all([...sessions.keys()].map(dropSession));
    tunnels.dispose();
  }

  const answer = <T>(request: HostRequest, context?: CallContext) => handle(request, context?.signal) as Promise<T>;
  /** The operations `serveHost` answers; each one is a request to `handle`. */
  const handlers: Handlers<SqlHostOps> = {
    test: config => answer({ type: 'test', config }),
    execute: (config, runId, sql, readWrite, window, context) => answer({ type: 'execute', config, runId, sql, readWrite, window }, context),
    fetch: (runId, limit, maxBytes, context) => answer({ type: 'fetch', runId, limit, maxBytes }, context),
    closeRun: runId => answer({ type: 'close-run', runId }),
    estimate: (config, sql) => answer({ type: 'estimate', config, sql }),
    introspect: (config, request) => answer({ type: 'introspect', config, request }),
    applyEdits: (config, statements) => answer({ type: 'apply-edits', config, statements }),
    disconnect: connectionId => answer({ type: 'disconnect', connectionId }),
  };

  return { handle, handlers, dispose };
}

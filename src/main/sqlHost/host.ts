/**
 * The SQL host's request handler, free of any process transport so tests
 * drive it directly. One session per connection id, reused while its config
 * is unchanged; one open run per connection, closed when the next one starts.
 */

import net from 'node:net';
import type { SqlRemoteEngine } from '../../shared/sqlConnections';
import type { SqlDbIntrospect, SqlDbIntrospectResult } from '../../shared/sqlDb';
import type { RowEditStatement } from '../../shared/sqlRowEdits';
import { classifyConnectError, EditFailedError, toJsonCell, type DriverFactory, type DriverRows, type DriverSession } from './driver';
import { createTunnelPool, TunnelError, type Tunnel, type TunnelPool } from './tunnel';
import type {
  HostCancelResult,
  HostError,
  HostExecuteResult,
  HostFetchResult,
  HostRequest,
  HostResponse,
  HostSessionConfig,
  HostTestResult,
} from './protocol';

const READ_BATCH = 500;
const TCP_PROBE_MS = 10_000;

interface Session {
  fingerprint: string;
  ready: Promise<DriverSession>;
  /** Lets go of the session's tunnel, if it has one. */
  release: () => Promise<void>;
  /** Statements on one connection run one after another. */
  queue: Promise<unknown>;
}

interface Run {
  connectionId: string;
  session: DriverSession;
  rows: DriverRows;
  pending: Array<Record<string, unknown>>;
  done: boolean;
}

const mapRow = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).map(([key, value]) => [key, toJsonCell(value)]));

const fingerprintOf = (config: HostSessionConfig) => JSON.stringify(config);

class HostRequestError extends Error {
  constructor(readonly detail: HostError) {
    super(detail.message);
  }
}

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

  /** Fills a page within `maxRows` and `maxBytes`, keeping what did not fit for the next one. */
  async function readPage(run: Run, maxRows: number, maxBytes: number): Promise<HostFetchResult> {
    const rows: Array<Record<string, unknown>> = [];
    let bytes = 0;
    while (rows.length < maxRows) {
      if (run.pending.length === 0) {
        if (run.done) break;
        const page = await run.rows.next(Math.min(READ_BATCH, maxRows - rows.length));
        run.pending = page.rows.map(mapRow);
        run.done = page.done;
        if (run.pending.length === 0) break;
      }
      const row = run.pending[0]!;
      const size = Buffer.byteLength(JSON.stringify(row));
      if (rows.length > 0 && bytes + size > maxBytes) break;
      rows.push(row);
      bytes += size;
      run.pending.shift();
    }
    return { rows, done: run.done && run.pending.length === 0, bytes };
  }

  async function execute(request: Extract<HostRequest, { type: 'execute' }>): Promise<HostExecuteResult> {
    const { config, runId, sql, readWrite, window } = request;
    for (const [id, run] of runs) if (run.connectionId === config.connectionId) await closeRun(id);
    const session = sessionFor(config);
    return serialize(session, async () => {
      let driver: DriverSession;
      try {
        driver = await session.ready;
      } catch (err) {
        // A failed connect names its step, so the renderer can tell it from a SQL error.
        throw new HostRequestError(connectError(config, err));
      }
      inflight.set(runId, driver);
      let rows: DriverRows;
      try {
        rows = await driver.run(sql, { readWrite });
      } finally {
        inflight.delete(runId);
      }
      const run: Run = { connectionId: config.connectionId, session: driver, rows, pending: [], done: false };
      runs.set(runId, run);
      try {
        const page = await readPage(run, window.maxRows, window.maxBytes);
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
    if (!run) throw new HostRequestError({ message: 'This result was closed by a newer run on the same connection.' });
    const page = await readPage(run, request.limit, request.maxBytes);
    if (page.done) await closeRun(request.runId);
    return page;
  }

  async function cancel(runId: string): Promise<HostCancelResult> {
    const target = inflight.get(runId) ?? runs.get(runId)?.session ?? null;
    if (!target) return { cancelled: false };
    const cancelled = await target.cancel();
    return cancelled ? { cancelled } : { cancelled: false, restart: true };
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
        throw new HostRequestError({ ...classifyConnectError(err), step: 'tcp', fix: first ? 'ssh-unreachable' : 'unreachable' });
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
        throw new HostRequestError(connectError(config, err));
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
      throw new HostRequestError(connectError(config, err));
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
        throw new HostRequestError(connectError(config, err));
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
        throw new HostRequestError(connectError(config, err));
      }
      try {
        await driver.applyEdits(statements);
      } catch (err) {
        if (err instanceof EditFailedError) throw new HostRequestError({ message: err.message, edit: err.failure });
        throw err;
      }
      return { applied: statements.length };
    });
  }

  async function handle(request: HostRequest): Promise<HostResponse> {
    try {
      let result: unknown;
      switch (request.type) {
        case 'test':
          result = await test(request.config);
          break;
        case 'execute':
          result = await execute(request);
          break;
        case 'fetch':
          result = await fetch(request);
          break;
        case 'close-run':
          await closeRun(request.runId);
          result = { closed: true };
          break;
        case 'cancel':
          result = await cancel(request.runId);
          break;
        case 'estimate':
          result = await estimate(request.config, request.sql);
          break;
        case 'introspect':
          result = await introspect(request.config, request.request);
          break;
        case 'apply-edits':
          result = await applyEdits(request.config, request.statements);
          break;
        case 'disconnect':
          await dropSession(request.connectionId);
          await dropSession(catalogSessionId(request.connectionId));
          await dropSession(editsSessionId(request.connectionId));
          result = { disconnected: true };
          break;
      }
      return { id: request.id, ok: true, result };
    } catch (err) {
      const error: HostError =
        err instanceof HostRequestError ? err.detail : { message: err instanceof Error ? err.message : String(err) };
      return { id: request.id, ok: false, error };
    }
  }

  async function dispose(): Promise<void> {
    await Promise.all([...sessions.keys()].map(dropSession));
    tunnels.dispose();
  }

  return { handle, dispose };
}

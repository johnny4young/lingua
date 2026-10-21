/**
 * The SQL host's request handler, free of any process transport so tests
 * drive it directly. One session per connection id, reused while its config
 * is unchanged; one open run per connection, closed when the next one starts.
 */

import net from 'node:net';
import type { SqlRemoteEngine } from '../../shared/sqlConnections';
import { classifyConnectError, toJsonCell, type DriverFactory, type DriverRows, type DriverSession } from './driver';
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

export function createSqlHost(drivers: Record<SqlRemoteEngine, DriverFactory>) {
  const sessions = new Map<string, Session>();
  const runs = new Map<string, Run>();
  /** Statements still waiting for their first page, so Cancel can reach them. */
  const inflight = new Map<string, DriverSession>();

  async function dropSession(connectionId: string): Promise<void> {
    const session = sessions.get(connectionId);
    sessions.delete(connectionId);
    for (const [runId, run] of runs) if (run.connectionId === connectionId) runs.delete(runId);
    if (session) await session.ready.then((s) => s.close()).catch(() => undefined);
  }

  function sessionFor(config: HostSessionConfig): Session {
    const fingerprint = fingerprintOf(config);
    const current = sessions.get(config.connectionId);
    if (current && current.fingerprint === fingerprint) return current;
    if (current) void dropSession(config.connectionId);
    const ready = drivers[config.engine](config);
    // A failed connect is retried by the next request.
    ready.catch(() => {
      if (sessions.get(config.connectionId)?.ready === ready) sessions.delete(config.connectionId);
    });
    const session: Session = { fingerprint, ready, queue: Promise.resolve() };
    sessions.set(config.connectionId, session);
    return session;
  }

  function serialize<T>(session: Session, work: () => Promise<T>): Promise<T> {
    const next = session.queue.then(work, work);
    session.queue = next.catch(() => undefined);
    return next;
  }

  async function closeRun(runId: string): Promise<void> {
    const run = runs.get(runId);
    runs.delete(runId);
    if (run && !run.done) await run.rows.close().catch(() => undefined);
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
        throw new HostRequestError(config.engine === 'sqlite' ? fileError(err) : classifyConnectError(err));
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
    if (!run) return { rows: [], done: true, bytes: 0 };
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
    if (config.engine !== 'sqlite' && config.address) {
      try {
        tcpMs = await probeTcp(config.address, config.port ?? 0);
      } catch (err) {
        throw new HostRequestError({ ...classifyConnectError(err), step: 'tcp', fix: 'unreachable' });
      }
    }
    const start = performance.now();
    let driver: DriverSession;
    try {
      driver = await drivers[config.engine](config);
    } catch (err) {
      throw new HostRequestError(config.engine === 'sqlite' ? fileError(err) : classifyConnectError(err));
    }
    const connectMs = Math.round(performance.now() - start);
    try {
      const serverStart = performance.now();
      const serverVersion = await driver.version();
      const tls = driver.tls?.();
      return {
        ...(tcpMs !== undefined ? { tcpMs } : {}),
        connectMs,
        serverMs: Math.round(performance.now() - serverStart),
        serverVersion,
        ...(tls ? { tls } : {}),
      };
    } finally {
      await driver.close().catch(() => undefined);
    }
  }

  async function estimate(config: HostSessionConfig, sql: string): Promise<number | null> {
    const session = sessionFor(config);
    return serialize(session, async () => (await session.ready).estimateRows(sql));
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
        case 'disconnect':
          await dropSession(request.connectionId);
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
  }

  return { handle, dispose };
}

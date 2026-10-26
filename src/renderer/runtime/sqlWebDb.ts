/**
 * The web build's database bridge: Turso and Neon connections opened for this
 * tab only. Tokens and passwords stay in this module's memory and are never
 * stored; requests go straight from the browser with fetch, so only servers
 * that answer cross-origin requests over HTTPS are reachable.
 */

import { parseConnectionDraft, httpEndpoint, WEB_SQL_ENGINES, type SqlConnectionDraft, type SqlConnectionV1 } from '../../shared/sqlConnections';
import { failedRun, type SqlDbBridge, type SqlDbCatalogView, type SqlDbConnectionView, type SqlDbRunResult, type SqlDbSaveResult, type SqlDbTestStep } from '../../shared/sqlDb';
import { classifyConnectError, EditFailedError, readRowPage, SqlConnectError, type DriverSession, type RowPager, type SqlDriverError } from '../../shared/sqlDriver';
import { openLibsql } from '../../shared/sqlHttp/libsql';
import { openNeon } from '../../shared/sqlHttp/neon';
import { MAX_HTTP_SQL_RESPONSE_BYTES, responseTooLarge, type HttpSqlTransport } from '../../shared/sqlHttp/transport';
import { rowEditProblem, rowEditStatements, rowEditTableFrom } from '../../shared/sqlRowEdits';
import { editGuard, runGuard } from '../../shared/sqlRunGuard';
import { isEstimableSqlStatement } from '../../shared/sqlStatements';
import { MAX_RESULT_PREVIEW_BYTES, MAX_RESULT_ROWS } from '../../shared/sqlWorkspace';

const MAX_SESSION_CONNECTIONS = 20;

/** fetch with no cookies, no referrer and no redirects, capped like the desktop transport. */
export const fetchTransport: HttpSqlTransport = async ({ url, headers, body, signal }) => {
  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers, body, credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer', ...(signal ? { signal } : {}) });
  } catch (err) {
    if ((err as { name?: string }).name === 'AbortError') throw err;
    // The browser says nothing more about a refused cross-origin request than about an unreachable server.
    throw new SqlConnectError(`Could not reach ${new URL(url).host}. A browser only reaches servers that allow cross-origin requests over HTTPS.`, { step: 'tcp', fix: 'unreachable' });
  }
  const reader = response.body?.getReader();
  if (!reader) return { status: response.status, body: '' };
  const decoder = new TextDecoder();
  let text = '';
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_HTTP_SQL_RESPONSE_BYTES) {
      await reader.cancel();
      throw responseTooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return { status: response.status, body: text + decoder.decode() };
};

const unsupported = <T>(value: T) => async () => value;
const encoder = new TextEncoder();
const rowSize = (row: Record<string, unknown>) => encoder.encode(JSON.stringify(row)).byteLength;
const same = (row: Record<string, unknown>) => row;

interface Run extends RowPager {
  connectionId: string;
  session: DriverSession;
}

interface PendingRun {
  session?: DriverSession;
  cancelled: boolean;
  /** Settles a wait on the driver handshake, which itself cannot be aborted. */
  cancel: () => void;
}

export function createWebSqlDb(transport: HttpSqlTransport = fetchTransport): SqlDbBridge {
  const connections = new Map<string, SqlConnectionV1>();
  const secrets = new Map<string, string>();
  const credentialRevisions = new Map<string, symbol>();
  const sessions = new Map<string, Promise<DriverSession>>();
  const runs = new Map<string, Run>();
  /** Reserve cancellation before opening the driver, including its initial handshake. */
  const waiting = new Map<string, PendingRun>();

  const view = (entry: SqlConnectionV1): SqlDbConnectionView => ({ ...entry, hasPassword: secrets.has(entry.id) });

  function open(entry: SqlConnectionV1, secret: string | undefined): Promise<DriverSession> {
    const endpoint = httpEndpoint(entry);
    if (!endpoint?.tls) throw new SqlConnectError('A browser reaches only HTTPS servers.', { step: 'tls', fix: 'tls-unsupported' });
    const origin = `https://${endpoint.host}${endpoint.port === 443 ? '' : `:${endpoint.port}`}`;
    if (entry.engine === 'libsql') return openLibsql({ origin, readOnly: entry.readOnly, ...(secret ? { token: secret } : {}) }, transport);
    return openNeon(
      {
        origin,
        host: entry.host!,
        readOnly: entry.readOnly,
        ...(entry.database ? { database: entry.database } : {}),
        ...(entry.user ? { user: entry.user } : {}),
        ...(secret !== undefined ? { password: secret } : {}),
      },
      transport
    );
  }

  /** The session for a connection id, or the catalog's and edits' own (`#catalog`, `#edits`), so Cancel stops only the run. */
  function sessionFor(entry: SqlConnectionV1, lane = ''): Promise<DriverSession> {
    const key = `${entry.id}${lane}`;
    const current = sessions.get(key);
    if (current) return current;
    if (entry.passwordMode !== 'none' && !secrets.has(entry.id)) return Promise.reject(new SqlConnectError('This connection needs its password.', { step: 'auth', fix: 'password-needed' }));
    const secret = secrets.get(entry.id);
    const ready = Promise.resolve().then(() => open(entry, secret));
    sessions.set(key, ready);
    // A failed connect is retried by the next request.
    ready.catch(() => {
      if (sessions.get(key) === ready) sessions.delete(key);
    });
    return ready;
  }

  async function drop(id: string): Promise<void> {
    for (const [runId, run] of runs) if (run.connectionId === id) runs.delete(runId);
    // Detach every old lane before awaiting any handshake: replacements may open meanwhile.
    const previous = ['', '#catalog', '#edits'].map((lane) => {
      const key = `${id}${lane}`;
      const session = sessions.get(key);
      sessions.delete(key);
      return session;
    });
    for (const session of previous) {
      await session?.then((driver) => driver.close()).catch(() => undefined);
    }
  }

  /** A refused password or token is forgotten, so the next run asks again. */
  function refused(entry: SqlConnectionV1, detail: SqlDriverError, revision: symbol | undefined): SqlDriverError {
    if (detail.fix !== 'auth' || entry.passwordMode === 'none') return detail;
    // A late refusal belongs to the credential used by that request, never its replacement.
    if (revision === undefined || credentialRevisions.get(entry.id) !== revision) return detail;
    secrets.delete(entry.id);
    void drop(entry.id);
    return { ...detail, fix: 'password-needed' };
  }

  async function closeRun(runId: string): Promise<void> {
    const run = runs.get(runId);
    runs.delete(runId);
    await run?.rows.close().catch(() => undefined);
  }

  const catalog = async (): Promise<SqlDbCatalogView> => ({
    connections: [],
    adhoc: [...connections.values()].map(view),
    used: 0,
    limit: null,
    vault: 'session',
    sessionOnly: true,
  });

  async function openAdhoc(draft: SqlConnectionDraft, password?: string): Promise<SqlDbSaveResult> {
    const parsed = parseConnectionDraft(draft);
    if (!parsed || !WEB_SQL_ENGINES.includes(parsed.engine) || !httpEndpoint(parsed)?.tls) return { ok: false, reason: 'invalid' };
    if (connections.size >= MAX_SESSION_CONNECTIONS) return { ok: false, reason: 'quota' };
    const stamp = new Date().toISOString();
    const entry: SqlConnectionV1 = {
      version: 1,
      id: `adhoc_${crypto.randomUUID().replaceAll('-', '')}`,
      ...parsed,
      passwordMode: parsed.passwordMode === 'none' ? 'none' : 'session',
      createdAt: stamp,
      updatedAt: stamp,
    };
    connections.set(entry.id, entry);
    credentialRevisions.set(entry.id, Symbol());
    if (password !== undefined && entry.passwordMode === 'session') secrets.set(entry.id, password);
    return { ok: true, connection: view(entry) };
  }

  return {
    catalog,
    save: unsupported<SqlDbSaveResult>({ ok: false, reason: 'invalid' }),
    openAdhoc,

    async delete(id) {
      const had = connections.delete(id);
      secrets.delete(id);
      credentialRevisions.delete(id);
      await drop(id);
      return { ok: had };
    },

    async sessionPassword(id, password, kind = 'database') {
      const entry = connections.get(id);
      if (!entry || kind !== 'database' || entry.passwordMode === 'none') return { ok: false };
      secrets.set(id, password);
      credentialRevisions.set(id, Symbol());
      await drop(id);
      return { ok: true };
    },

    trustHostKey: unsupported({ ok: false }),
    sshInfo: unsupported({ config: null, agent: { available: false } }),
    pickFile: unsupported({ canceled: true as const }),
    importFile: unsupported({ canceled: true as const }),
    importEnv: unsupported({ canceled: true as const }),
    exportCatalog: unsupported({ canceled: true as const }),

    async test(target) {
      const started = performance.now();
      const steps: SqlDbTestStep[] = [];
      const done = (ok: boolean, serverVersion?: string) => ({ ok, totalMs: Math.round(performance.now() - started), steps, ...(serverVersion ? { serverVersion } : {}) });
      const draft = 'connectionId' in target ? null : parseConnectionDraft(target.draft);
      const entry: SqlConnectionV1 | undefined =
        'connectionId' in target ? connections.get(target.connectionId) : draft ? { version: 1, id: 'test', ...draft, createdAt: '', updatedAt: '' } : undefined;
      if (!entry || !WEB_SQL_ENGINES.includes(entry.engine)) {
        steps.push({ id: 'server', status: 'failed', detail: 'This engine is available on Lingua Desktop.', fix: 'unknown' });
        return done(false);
      }
      const secret = 'connectionId' in target ? secrets.get(entry.id) : target.password;
      const begin = performance.now();
      let driver: DriverSession;
      try {
        if (entry.passwordMode !== 'none' && secret === undefined) throw new SqlConnectError('This connection needs its password.', { step: 'auth', fix: 'password-needed' });
        driver = await open(entry, secret);
      } catch (err) {
        const detail = classifyConnectError(err);
        steps.push({ id: detail.step ?? 'server', status: 'failed', detail: detail.message, fix: detail.fix ?? 'unknown' });
        return done(false);
      }
      const connectMs = Math.round(performance.now() - begin);
      try {
        const serverVersion = await driver.version();
        steps.push({ id: 'tls', status: 'ok', detail: 'https' });
        steps.push({ id: 'auth', status: 'ok', ms: connectMs, detail: entry.user ?? '' });
        steps.push({ id: 'server', status: 'ok', ms: 0, detail: `${serverVersion}${entry.readOnly ? ' · read-only' : ''}` });
        return done(true, serverVersion);
      } finally {
        await driver.close().catch(() => undefined);
      }
    },

    async execute(runId, connectionId, sql, options) {
      const started = performance.now();
      const entry = connections.get(connectionId);
      const fail = (status: SqlDbRunResult['status'], message: string, fix?: SqlDbRunResult['fix']) =>
        failedRun(entry?.engine ?? 'libsql', Math.round(performance.now() - started), status, message, fix);
      if (!entry) return fail('connection-failed', 'Unknown connection.');
      const { writes, refusal } = runGuard(entry, sql, options);
      if (refusal) return fail('sql-error', refusal, 'confirm-needed');
      let onCancel!: () => void;
      const cancelRequested = new Promise<null>((resolve) => {
        onCancel = () => resolve(null);
      });
      const pending: PendingRun = { cancelled: false, cancel: onCancel };
      const cancelled = () => fail('cancelled', 'Query cancelled');
      waiting.set(runId, pending);
      try {
        for (const [id, run] of runs) if (run.connectionId === connectionId) await closeRun(id);
        if (pending.cancelled) return cancelled();
        const revision = credentialRevisions.get(connectionId);
        let session: DriverSession | null;
        try {
          session = await Promise.race([sessionFor(entry), cancelRequested]);
        } catch (err) {
          const detail = refused(entry, classifyConnectError(err), revision);
          if (pending.cancelled) return cancelled();
          return fail('connection-failed', detail.message, detail.fix);
        }
        if (!session || pending.cancelled) return cancelled();
        pending.session = session;
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          void session.cancel();
        }, options.timeoutMs);
        try {
          // Once the statement is sent, a late Cancel cannot unsend it: keep its result.
          const rows = await session.run(sql, { readWrite: Boolean(options.readWrite) && writes });
          const run: Run = { connectionId, session, rows, pending: [], done: false };
          runs.set(runId, run);
          const page = await readRowPage(run, MAX_RESULT_ROWS, MAX_RESULT_PREVIEW_BYTES, same, rowSize);
          const hasMore = !page.done;
          if (!hasMore) await closeRun(runId);
          return {
            status: hasMore ? 'too-large' : 'success',
            engine: entry.engine,
            columns: rows.columns,
            rows: page.rows,
            rowCount: page.rows.length,
            tooLarge: hasMore,
            rowCountIsLowerBound: hasMore,
            hasMore,
            durationMs: Math.round(performance.now() - started),
            ...(rows.affectedRows !== undefined ? { affectedRows: rows.affectedRows } : {}),
          };
        } catch (err) {
          await closeRun(runId);
          if (timedOut) return fail('timeout', 'Query exceeded timeout');
          if (pending.cancelled) return cancelled();
          const message = err instanceof Error ? err.message : String(err);
          if (/cancel/i.test(message)) return fail('cancelled', message);
          const detail = err instanceof SqlConnectError ? refused(entry, classifyConnectError(err), revision) : null;
          return detail ? fail('connection-failed', detail.message, detail.fix) : fail('sql-error', message);
        } finally {
          clearTimeout(timer);
        }
      } finally {
        waiting.delete(runId);
      }
    },

    async fetch(runId, limit, maxBytes) {
      const run = runs.get(runId);
      if (!run) return { rows: [], done: true, bytes: 0, errorMessage: 'This result is closed or no longer available.' };
      try {
        const page = await readRowPage(run, limit, maxBytes, same, rowSize);
        if (page.done) await closeRun(runId);
        return page;
      } catch (err) {
        await closeRun(runId);
        return { rows: [], done: true, bytes: 0, errorMessage: err instanceof Error ? err.message : String(err) };
      }
    },

    async cancel(runId) {
      const pending = waiting.get(runId);
      if (pending) {
        pending.cancelled = true;
        pending.cancel();
      }
      const session = runs.get(runId)?.session ?? pending?.session;
      return { cancelled: session ? await session.cancel() : Boolean(pending) };
    },

    async closeRun(runId) {
      await closeRun(runId);
      return { ok: true as const };
    },

    async estimate(connectionId, sql) {
      const entry = connections.get(connectionId);
      if (!entry || !isEstimableSqlStatement(sql)) return null;
      try {
        return await (await sessionFor(entry, '#catalog')).estimateRows(sql);
      } catch {
        return null;
      }
    },

    async introspect(connectionId, request) {
      const entry = connections.get(connectionId);
      const revision = credentialRevisions.get(connectionId);
      if (!entry) return { errorMessage: 'Unknown connection.' };
      try {
        return await (await sessionFor(entry, '#catalog')).introspect(request);
      } catch (err) {
        const detail = err instanceof SqlConnectError ? refused(entry, classifyConnectError(err), revision) : { message: err instanceof Error ? err.message : String(err) };
        return { errorMessage: detail.message, ...(detail.fix ? { fix: detail.fix } : {}) };
      }
    },

    async applyEdits(connectionId, target, changes, confirmName) {
      const entry = connections.get(connectionId);
      let revision = credentialRevisions.get(connectionId);
      if (!entry) return { ok: false, reason: 'failed', message: 'Unknown connection.' };
      const blocked = editGuard(entry, confirmName);
      if (blocked) return blocked;
      try {
        const detail = await (await sessionFor(entry, '#catalog')).introspect({ level: 'detail', schema: target.schema, name: target.name, kind: 'table' });
        const table = rowEditTableFrom(entry.engine, target.schema, target.name, detail.detail?.columns ?? []);
        if (!table) return { ok: false, reason: 'not-editable', ...(detail.errorMessage ? { message: detail.errorMessage } : {}) };
        if (rowEditProblem(table, changes)) return { ok: false, reason: 'invalid' };
        const statements = rowEditStatements(table, changes, false);
        revision = credentialRevisions.get(connectionId);
        await (await sessionFor(entry, '#edits')).applyEdits(statements);
        return { ok: true, applied: statements.length };
      } catch (err) {
        if (err instanceof EditFailedError) return { ok: false, reason: 'failed', message: err.message, edit: err.failure };
        const detail = err instanceof SqlConnectError ? refused(entry, classifyConnectError(err), revision) : { message: err instanceof Error ? err.message : String(err) };
        return { ok: false, reason: 'failed', message: detail.message, ...(detail.fix ? { fix: detail.fix } : {}) };
      }
    },
  };
}

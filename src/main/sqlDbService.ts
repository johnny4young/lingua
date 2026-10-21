/**
 * Main's side of the desktop database client. The renderer names a
 * connection by id; main owns the catalog, reads the password from the
 * secret store, resolves and checks the host, re-checks the saved-connection
 * quota against the verified license tier, and enforces the production guard.
 */

import { randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { LicenseTier } from '../shared/license';
import { dbConnectionCeilingForTier } from '../shared/entitlements';
import { connectionSecretId, type SqlConnectionDraft, type SqlConnectionV1 } from '../shared/sqlConnections';
import type {
  SqlDbCatalogView,
  SqlDbConnectionView,
  SqlDbFetchResult,
  SqlDbRunOptions,
  SqlDbRunResult,
  SqlDbSaveResult,
  SqlDbTarget,
  SqlDbTestResult,
  SqlDbTestStep,
} from '../shared/sqlDb';
import { isEstimableSqlStatement, isWriteSqlStatement } from '../shared/sqlStatements';
import { MAX_RESULT_PREVIEW_BYTES, MAX_RESULT_ROWS } from '../shared/sqlWorkspace';
import type { SecretStore } from './secretStore';
import type { ConnectionCatalog } from './sqlConnectionCatalog';
import { SqlHostError, type SqlHostSupervisor } from './sqlHostSupervisor';
import type { HostCancelResult, HostExecuteResult, HostFetchResult, HostSessionConfig, HostTestResult } from './sqlHost/protocol';
import { isPrivateAddress, type LookupImpl } from './networkTargetPolicy';

export interface SqlDbServiceDeps {
  catalog: ConnectionCatalog;
  secrets: SecretStore;
  host: SqlHostSupervisor;
  /** The verified license tier; Free until the license runtime has loaded. */
  tier: () => Promise<LicenseTier>;
  /** Protected path family (Lingua data, keychains, SSH keys) a file must not live in. */
  blockedPath: (filePath: string) => string | null;
  lookup?: LookupImpl;
}

/** Failures main detects before the host runs anything. */
class GuardError extends Error {
  constructor(
    readonly status: SqlDbRunResult['status'],
    readonly fix: SqlDbRunResult['fix'],
    message: string
  ) {
    super(message);
  }
}

const defaultLookup: LookupImpl = async (hostname) => dns.lookup(hostname, { all: true, verbatim: true });

const MAX_ADHOC = 20;
const CANCEL_TIMEOUT_MS = 3_000;

/** The resolved file, so a symlink cannot point a checked path into a protected folder; a missing file resolves through its folder. */
function realFile(file: string): string {
  try {
    return realpathSync(file);
  } catch {
    try {
      return path.join(realpathSync(path.dirname(file)), path.basename(file));
    } catch {
      return file;
    }
  }
}

/** A saved password belongs to one target; another host, user or TLS mode must be given it again. */
function sameTarget(a: SqlConnectionDraft, b: SqlConnectionDraft): boolean {
  return (
    a.engine === b.engine &&
    a.host === b.host &&
    a.port === b.port &&
    a.database === b.database &&
    a.user === b.user &&
    a.path === b.path &&
    a.ssl?.mode === b.ssl?.mode &&
    a.ssl?.caPath === b.ssl?.caPath
  );
}

export function createSqlDbService(deps: SqlDbServiceDeps) {
  const lookup = deps.lookup ?? defaultLookup;
  /** Passwords asked once per session, and those of URL connections nobody saved. */
  const sessionPasswords = new Map<string, string>();
  const adhoc = new Map<string, SqlConnectionV1>();
  const runs = new Map<string, { owner: number; connectionId: string }>();

  const hostRunId = (owner: number, runId: string) => `${owner}:${runId}`;

  async function connection(id: string): Promise<SqlConnectionV1 | null> {
    return adhoc.get(id) ?? (await deps.catalog.get(id));
  }

  async function view(entry: SqlConnectionV1): Promise<SqlDbConnectionView> {
    const hasPassword =
      sessionPasswords.has(entry.id) ||
      (entry.passwordMode === 'keychain' && (await deps.secrets.get(connectionSecretId(entry.id))) !== null);
    return { ...entry, hasPassword };
  }

  function pathProblem(draft: SqlConnectionDraft): boolean {
    const files = [draft.path, draft.ssl?.caPath, draft.ssl?.certPath, draft.ssl?.keyPath];
    return files.some((file) => file !== undefined && (deps.blockedPath(file) !== null || deps.blockedPath(realFile(file)) !== null));
  }

  async function password(entry: SqlConnectionV1, explicit?: string): Promise<string | undefined> {
    if (explicit !== undefined) return explicit;
    if (entry.passwordMode === 'none') return undefined;
    const kept = sessionPasswords.get(entry.id) ?? (entry.passwordMode === 'keychain' ? await deps.secrets.get(connectionSecretId(entry.id)) : null);
    if (kept === null || kept === undefined) throw new GuardError('connection-failed', 'password-needed', 'This connection needs its password.');
    return kept;
  }

  /** Resolves the host once and pins the address the driver connects to. */
  async function resolve(entry: SqlConnectionV1 | SqlConnectionDraft): Promise<{ address: string; ms: number; isPrivate: boolean } | null> {
    if (entry.engine === 'sqlite' || !entry.host) return null;
    const start = performance.now();
    let addresses: Awaited<ReturnType<LookupImpl>>;
    try {
      addresses = await lookup(entry.host);
    } catch (err) {
      throw new GuardError('connection-failed', 'dns', `Could not resolve ${entry.host}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const first = addresses[0];
    if (!first) throw new GuardError('connection-failed', 'dns', `${entry.host} has no address.`);
    return { address: first.address, ms: Math.round(performance.now() - start), isPrivate: isPrivateAddress(first.address) };
  }

  async function configFor(entry: SqlConnectionV1, explicitPassword?: string): Promise<{ config: HostSessionConfig; resolved: Awaited<ReturnType<typeof resolve>> }> {
    if (pathProblem(entry)) throw new GuardError('blocked-target', 'blocked-path', 'This file is in a protected folder.');
    const resolved = await resolve(entry);
    const secret = await password(entry, explicitPassword);
    const config: HostSessionConfig = {
      connectionId: entry.id,
      engine: entry.engine,
      readOnly: entry.readOnly,
      ...(entry.engine === 'sqlite'
        ? { path: realFile(entry.path!) }
        : {
            address: resolved!.address,
            servername: entry.host!,
            ...(entry.port !== undefined ? { port: entry.port } : {}),
            ...(entry.database ? { database: entry.database } : {}),
            ...(entry.user ? { user: entry.user } : {}),
            ...(entry.ssl ? { ssl: entry.ssl } : {}),
          }),
      ...(secret !== undefined ? { password: secret } : {}),
    };
    return { config, resolved };
  }

  async function catalogView(): Promise<SqlDbCatalogView> {
    const saved = await deps.catalog.list();
    const limit = dbConnectionCeilingForTier(await deps.tier());
    return {
      connections: await Promise.all(saved.map(view)),
      adhoc: await Promise.all([...adhoc.values()].map(view)),
      used: saved.length,
      limit: Number.isFinite(limit) ? limit : null,
      vault: deps.secrets.status().mode,
    };
  }

  async function keepPassword(entry: SqlConnectionV1, value: string | undefined): Promise<boolean> {
    const id = connectionSecretId(entry.id);
    if (entry.passwordMode === 'none') {
      sessionPasswords.delete(entry.id);
      await deps.secrets.delete(id);
      return true;
    }
    if (value === undefined) {
      // Ask each session keeps nothing on disk, even a password saved earlier.
      if (entry.passwordMode === 'session') await deps.secrets.delete(id);
      return true;
    }
    if (entry.passwordMode === 'session') {
      sessionPasswords.set(entry.id, value);
      await deps.secrets.delete(id);
      return true;
    }
    sessionPasswords.delete(entry.id);
    return (await deps.secrets.set(id, value)).ok;
  }

  const service = {
    catalog: catalogView,

    async save(draft: SqlConnectionDraft, id: string | undefined, secret: string | undefined): Promise<SqlDbSaveResult> {
      if (pathProblem(draft)) return { ok: false, reason: 'invalid' };
      const before = id === undefined ? null : await deps.catalog.get(id);
      if (id !== undefined && !before) return { ok: false, reason: 'not-found' };
      // The old password goes before the new target is saved, so no run can pair the two.
      if (before && secret === undefined && !sameTarget(before, draft)) {
        sessionPasswords.delete(before.id);
        await deps.secrets.delete(connectionSecretId(before.id));
      }
      const ceiling = dbConnectionCeilingForTier(await deps.tier());
      const saved = await deps.catalog.save(draft, id, Number.isFinite(ceiling) ? ceiling : undefined);
      if (saved === 'quota') return { ok: false, reason: 'quota' };
      if (!saved) return { ok: false, reason: 'not-found' };
      await deps.host.request({ type: 'disconnect', connectionId: saved.id }).catch(() => undefined);
      if (!(await keepPassword(saved, secret))) return { ok: false, reason: 'secret-failed' };
      return { ok: true, connection: await view(saved) };
    },

    async remove(id: string): Promise<{ ok: boolean }> {
      adhoc.delete(id);
      sessionPasswords.delete(id);
      await deps.secrets.delete(connectionSecretId(id));
      if (deps.host.isRunning()) await deps.host.request({ type: 'disconnect', connectionId: id }).catch(() => undefined);
      return { ok: await deps.catalog.remove(id) };
    },

    /** A connection for this session only, at any quota; its password stays in memory. */
    async openAdhoc(draft: SqlConnectionDraft, secret: string | undefined): Promise<SqlDbSaveResult> {
      if (pathProblem(draft)) return { ok: false, reason: 'invalid' };
      if (adhoc.size >= MAX_ADHOC) return { ok: false, reason: 'quota' };
      const stamp = new Date().toISOString();
      const entry: SqlConnectionV1 = {
        version: 1,
        id: `adhoc_${randomUUID().replaceAll('-', '')}`,
        ...draft,
        passwordMode: draft.passwordMode === 'none' ? 'none' : 'session',
        createdAt: stamp,
        updatedAt: stamp,
      };
      adhoc.set(entry.id, entry);
      if (secret !== undefined && entry.passwordMode === 'session') sessionPasswords.set(entry.id, secret);
      return { ok: true, connection: await view(entry) };
    },

    /** The password asked for a connection that keeps it only for the session. */
    async sessionPassword(id: string, secret: string): Promise<{ ok: boolean }> {
      if (!(await connection(id))) return { ok: false };
      sessionPasswords.set(id, secret);
      return { ok: true };
    },

    async test(target: SqlDbTarget): Promise<SqlDbTestResult> {
      const started = performance.now();
      const steps: SqlDbTestStep[] = [];
      const done = (ok: boolean, serverVersion?: string): SqlDbTestResult => ({
        ok,
        totalMs: Math.round(performance.now() - started),
        steps,
        ...(serverVersion ? { serverVersion } : {}),
      });
      const entry: SqlConnectionV1 | null =
        'connectionId' in target
          ? await connection(target.connectionId)
          : { version: 1, id: `test_${randomUUID().replaceAll('-', '')}`, ...target.draft, createdAt: '', updatedAt: '' };
      if (!entry) {
        steps.push({ id: 'server', status: 'failed', detail: 'Unknown connection.', fix: 'unknown' });
        return done(false);
      }
      let built: Awaited<ReturnType<typeof configFor>>;
      try {
        built = await configFor(entry, 'draft' in target ? target.password : undefined);
      } catch (err) {
        const guard = err instanceof GuardError ? err : new GuardError('connection-failed', 'unknown', String(err));
        const id = guard.fix === 'dns' ? 'resolve' : guard.fix === 'blocked-path' ? (entry.engine === 'sqlite' ? 'file' : 'policy') : 'auth';
        steps.push({ id, status: 'failed', detail: guard.message, ...(guard.fix ? { fix: guard.fix } : {}) });
        return done(false);
      }
      const { config, resolved } = built;
      if (resolved) {
        steps.push({ id: 'resolve', status: 'ok', ms: resolved.ms, detail: `${entry.host} → ${resolved.address}` });
        steps.push({ id: 'policy', status: 'ok', ms: 0, detail: resolved.isPrivate ? 'private' : 'public' });
      }
      try {
        const result = await deps.host.request<HostTestResult>({ type: 'test', config }, 30_000);
        if (entry.engine === 'sqlite') {
          steps.push({ id: 'file', status: 'ok', ms: result.connectMs, detail: entry.path! });
        } else {
          if (result.tcpMs !== undefined) steps.push({ id: 'tcp', status: 'ok', ms: result.tcpMs, detail: `${resolved!.address}:${entry.port}` });
          const tls = entry.ssl?.mode ?? 'verify-full';
          // Postgres reports no certificate when prefer fell back to plain TCP.
          const plain = tls === 'disable' || (tls === 'prefer' && entry.engine === 'postgres' && !result.tls);
          steps.push(
            plain
              ? { id: 'tls', status: 'skipped', detail: tls }
              : { id: 'tls', status: 'ok', detail: [tls, result.tls?.subject && `CN ${result.tls.subject}`, result.tls?.validTo && `expires ${result.tls.validTo}`].filter(Boolean).join(' · ') }
          );
          steps.push({ id: 'auth', status: 'ok', ms: result.connectMs, detail: entry.user ?? '' });
        }
        steps.push({ id: 'server', status: 'ok', ms: result.serverMs, detail: `${result.serverVersion}${entry.readOnly ? ' · read-only' : ''}` });
        return done(true, result.serverVersion);
      } catch (err) {
        const detail = err instanceof SqlHostError ? err.detail : { message: String(err) };
        steps.push({ id: detail.step ?? 'server', status: 'failed', detail: detail.message, fix: detail.fix ?? 'unknown' });
        return done(false);
      }
    },

    async execute(owner: number, runId: string, connectionId: string, sql: string, options: SqlDbRunOptions): Promise<SqlDbRunResult> {
      const started = performance.now();
      const fail = (status: SqlDbRunResult['status'], message: string, fix?: SqlDbRunResult['fix']): SqlDbRunResult => ({
        status,
        engine: entry?.engine ?? 'postgres',
        columns: [],
        rows: [],
        rowCount: 0,
        tooLarge: false,
        rowCountIsLowerBound: false,
        hasMore: false,
        durationMs: Math.round(performance.now() - started),
        errorMessage: message,
        ...(fix ? { fix } : {}),
      });
      const entry = await connection(connectionId);
      if (!entry) return fail('connection-failed', 'Unknown connection.');
      const writes = isWriteSqlStatement(sql);
      // Production asks for the typed name before any write; lifting read-only always does.
      const confirmed = options.readWrite?.confirmName === entry.name;
      if (writes && entry.env === 'prod' && !confirmed) return fail('sql-error', 'Writes to production need the typed connection name.', 'confirm-needed');
      if (options.readWrite && !confirmed) return fail('sql-error', 'Type the connection name to run it read-write.', 'confirm-needed');
      const key = hostRunId(owner, runId);
      for (const [other, run] of runs) if (run.owner === owner && run.connectionId === connectionId) runs.delete(other);
      runs.set(key, { owner, connectionId });
      let timedOut = false;
      try {
        const { config } = await configFor(entry);
        const window = { maxRows: MAX_RESULT_ROWS, maxBytes: MAX_RESULT_PREVIEW_BYTES };
        const request = deps.host.request<HostExecuteResult>(
          { type: 'execute', config, runId: key, sql, readWrite: Boolean(options.readWrite) && writes, window },
          options.timeoutMs + 5_000
        );
        const timer = setTimeout(() => {
          timedOut = true;
          void service.cancel(owner, runId);
        }, options.timeoutMs);
        let result: HostExecuteResult;
        try {
          result = await request;
        } finally {
          clearTimeout(timer);
        }
        if (!result.hasMore) runs.delete(key);
        return {
          status: result.tooLarge ? 'too-large' : 'success',
          engine: entry.engine,
          columns: result.columns,
          rows: result.rows,
          rowCount: result.rowCount,
          tooLarge: result.tooLarge,
          rowCountIsLowerBound: result.rowCountIsLowerBound,
          hasMore: result.hasMore,
          durationMs: Math.round(performance.now() - started),
          ...(result.affectedRows !== undefined ? { affectedRows: result.affectedRows } : {}),
        };
      } catch (err) {
        runs.delete(key);
        if (err instanceof GuardError) return fail(err.status, err.message, err.fix);
        if (timedOut) return fail('timeout', 'Query exceeded timeout');
        const detail = err instanceof SqlHostError ? err.detail : { message: String(err) };
        if (/cancel|interrupt|query execution was interrupted/i.test(detail.message)) return fail('cancelled', detail.message);
        // A refused session password is forgotten, so the next run asks again.
        if (detail.fix === 'auth' && entry.passwordMode === 'session') {
          sessionPasswords.delete(entry.id);
          return fail('connection-failed', detail.message, 'password-needed');
        }
        return fail(detail.step ? 'connection-failed' : 'sql-error', detail.message, detail.fix);
      }
    },

    async fetch(owner: number, runId: string, limit: number, maxBytes: number): Promise<SqlDbFetchResult> {
      const key = hostRunId(owner, runId);
      if (!runs.has(key)) return { rows: [], done: true, bytes: 0 };
      try {
        const page = await deps.host.request<HostFetchResult>({ type: 'fetch', runId: key, limit, maxBytes });
        if (page.done) runs.delete(key);
        return page;
      } catch (err) {
        runs.delete(key);
        return { rows: [], done: true, bytes: 0, errorMessage: err instanceof Error ? err.message : String(err) };
      }
    },

    async cancel(owner: number, runId: string): Promise<{ cancelled: boolean }> {
      const key = hostRunId(owner, runId);
      if (!runs.has(key)) return { cancelled: false };
      // A host busy in a SQLite statement cannot even read the cancel, so silence restarts it too.
      const result = await deps.host
        .request<HostCancelResult>({ type: 'cancel', runId: key }, CANCEL_TIMEOUT_MS)
        .catch(() => ({ cancelled: false, restart: true }));
      // An engine that cannot stop a statement gets a new host; its sessions reconnect on the next run.
      if (result.restart) deps.host.restart();
      runs.delete(key);
      return { cancelled: result.cancelled || Boolean(result.restart) };
    },

    async closeRun(owner: number, runId: string): Promise<void> {
      const key = hostRunId(owner, runId);
      if (!runs.delete(key)) return;
      await deps.host.request({ type: 'close-run', runId: key }).catch(() => undefined);
    },

    async estimate(connectionId: string, sql: string): Promise<number | null> {
      const entry = await connection(connectionId);
      // EXPLAIN takes one statement; anything else is not estimated.
      if (!entry || !isEstimableSqlStatement(sql)) return null;
      try {
        const { config } = await configFor(entry);
        return await deps.host.request<number | null>({ type: 'estimate', config, sql }, 15_000);
      } catch {
        return null;
      }
    },

    /** Drops the runs of a renderer that went away. */
    releaseOwner(owner: number): void {
      for (const [key, run] of runs) {
        if (run.owner !== owner) continue;
        runs.delete(key);
        void deps.host.request({ type: 'close-run', runId: key }).catch(() => undefined);
      }
    },
  };
  return service;
}

export type SqlDbService = ReturnType<typeof createSqlDbService>;

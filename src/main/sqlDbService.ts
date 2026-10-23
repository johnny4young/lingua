/**
 * Main's side of the desktop database client. The renderer names a
 * connection by id; main owns the catalog, reads the password from the
 * secret store, resolves and checks the host (the first SSH hop through a
 * tunnel), re-checks the saved-connection quota against the verified license
 * tier, and enforces the production and Confirm every write guards.
 */

import { randomUUID } from 'node:crypto';
import { promises as dns } from 'node:dns';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { LicenseTier } from '../shared/license';
import { dbConnectionCeilingForTier } from '../shared/entitlements';
import { connectionSecretId, httpEndpoint, sameSshTarget, type SqlConnectionDraft, type SqlConnectionSsh, type SqlConnectionV1 } from '../shared/sqlConnections';
import {
  failedRun,
  type SqlDbCatalogView,
  type SqlDbApplyResult,
  type SqlDbConnectionView,
  type SqlDbEditTable,
  type SqlDbFetchResult,
  type SqlDbIntrospect,
  type SqlDbIntrospectResult,
  type SqlDbRunOptions,
  type SqlDbRunResult,
  type SqlDbSaveResult,
  type SqlDbSecretKind,
  type SqlDbTarget,
  type SqlDbTestResult,
  type SqlDbTestStep,
} from '../shared/sqlDb';
import { isEstimableSqlStatement } from '../shared/sqlStatements';
import { editGuard, runGuard } from '../shared/sqlRunGuard';
import { MAX_RESULT_PREVIEW_BYTES, MAX_RESULT_ROWS } from '../shared/sqlWorkspace';
import type { SecretStore } from './secretStore';
import type { ConnectionCatalog } from './sqlConnectionCatalog';
import { SqlHostError, type SqlHostSupervisor } from './sqlHostSupervisor';
import type { HostCancelResult, HostError, HostExecuteResult, HostFetchResult, HostSessionConfig, HostSshConfig, HostTestResult } from './sqlHost/protocol';
import { SshGuardError, type SshInfo, type SshTargets } from './sqlSsh/sshTargets';
import { exportText } from './sqlImport/linguaExport';
import { ROW_EDIT_BUDGET_MS, rowEditProblem, rowEditStatements, rowEditTableFrom, type RowEditChanges } from '../shared/sqlRowEdits';
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
  /** SSH tunnels; a connection with one fails without it. */
  ssh?: SshTargets;
}

/** The SSH password or key passphrase, next to the database password. */
const sshSecretId = (connectionId: string) => `${connectionSecretId(connectionId)}.ssh`;


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
    a.d1?.accountId === b.d1?.accountId &&
    a.d1?.databaseId === b.d1?.databaseId &&
    a.ssl?.mode === b.ssl?.mode &&
    a.ssl?.caPath === b.ssl?.caPath &&
    // A tunnel decides which machine answers for the database host.
    sameSshTarget(a.ssh, b.ssh)
  );
}

export function createSqlDbService(deps: SqlDbServiceDeps) {
  const lookup = deps.lookup ?? defaultLookup;
  /** Passwords asked at connect time (kept for the session, or until a keychain connection signs in), and those of URL connections nobody saved. */
  const sessionPasswords = new Map<string, string>();
  const sshSessionSecrets = new Map<string, string>();
  /** Secrets asked for a keychain connection that had none, kept there once they sign in. */
  const keepOnSuccess = new Set<string>();
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
    const mode = entry.ssh?.secretMode;
    const hasSshSecret = sshSessionSecrets.has(entry.id) || (mode === 'keychain' && (await deps.secrets.get(sshSecretId(entry.id))) !== null);
    return { ...entry, hasPassword, ...(entry.ssh && mode !== 'none' ? { hasSshSecret } : {}) };
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

  async function sshSecret(entry: SqlConnectionV1, explicit?: string): Promise<string | undefined> {
    const mode = entry.ssh?.secretMode;
    if (!mode || mode === 'none') return undefined;
    if (explicit !== undefined) return explicit;
    const kept = sshSessionSecrets.get(entry.id) ?? (mode === 'keychain' ? await deps.secrets.get(sshSecretId(entry.id)) : null);
    if (kept === null || kept === undefined) throw new GuardError('connection-failed', 'ssh-password-needed', 'The SSH sign-in needs its password or key passphrase.');
    return kept;
  }

  /** The host this machine connects to first: the first SSH hop, an HTTP engine's API host, or the database itself. */
  const firstHost = (entry: SqlConnectionV1 | SqlConnectionDraft): { host: string; port: number } | null => {
    const endpoint = httpEndpoint(entry);
    if (endpoint) return { host: endpoint.host, port: endpoint.port };
    if (entry.engine === 'sqlite' || !entry.host) return null;
    const hop = entry.ssh ? (entry.ssh.jumps?.[0] ?? entry.ssh) : null;
    return hop ? { host: hop.host, port: hop.port } : { host: entry.host, port: entry.port! };
  };

  /** Resolves the first host once and pins the address this machine connects to. */
  async function resolve(entry: SqlConnectionV1 | SqlConnectionDraft): Promise<{ address: string; ms: number; isPrivate: boolean } | null> {
    const target = firstHost(entry);
    if (!target) return null;
    const start = performance.now();
    let addresses: Awaited<ReturnType<LookupImpl>>;
    try {
      addresses = await lookup(target.host);
    } catch (err) {
      throw new GuardError('connection-failed', 'dns', `Could not resolve ${target.host}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const first = addresses[0];
    if (!first) throw new GuardError('connection-failed', 'dns', `${target.host} has no address.`);
    const isPrivate = isPrivateAddress(first.address);
    if (isPrivate && entry.allowPrivateHost === false) {
      throw new GuardError('blocked-target', 'blocked-host', `${target.host} is a private or local address, which this connection does not allow.`);
    }
    return { address: first.address, ms: Math.round(performance.now() - start), isPrivate };
  }

  async function tunnelFor(entry: SqlConnectionV1, firstAddress: string, explicitSsh?: string): Promise<HostSshConfig> {
    if (!deps.ssh) throw new GuardError('connection-failed', 'ssh-unreachable', 'SSH tunnels are not available.');
    try {
      return await deps.ssh.configFor(entry, firstAddress, await sshSecret(entry, explicitSsh));
    } catch (err) {
      if (err instanceof SshGuardError) throw new GuardError('connection-failed', err.fix, err.message);
      throw err;
    }
  }

  async function configFor(
    entry: SqlConnectionV1,
    explicitPassword?: string,
    explicitSsh?: string
  ): Promise<{ config: HostSessionConfig; resolved: Awaited<ReturnType<typeof resolve>> }> {
    if (pathProblem(entry)) throw new GuardError('blocked-target', 'blocked-path', 'This file is in a protected folder.');
    const resolved = await resolve(entry);
    const endpoint = httpEndpoint(entry);
    // A token over plain HTTP stays on this machine or the local network.
    if (endpoint && !endpoint.tls && resolved && !resolved.isPrivate) {
      throw new GuardError('blocked-target', 'blocked-host', `${endpoint.host} is a public address, and a libSQL token goes over plain HTTP only to a private or local server. Turn TLS on.`);
    }
    const secret = await password(entry, explicitPassword);
    const ssh = entry.ssh && !endpoint ? await tunnelFor(entry, resolved!.address, explicitSsh) : undefined;
    const config: HostSessionConfig = {
      connectionId: entry.id,
      engine: entry.engine,
      readOnly: entry.readOnly,
      ...(endpoint
        ? {
            // Requests go to the endpoint main resolved; Neon's connection string still names the database host.
            address: resolved!.address,
            servername: endpoint.host,
            port: endpoint.port,
            ssl: { mode: endpoint.tls ? 'verify-full' : 'disable' },
            ...(entry.host && entry.host !== endpoint.host ? { host: entry.host } : {}),
            ...(entry.database ? { database: entry.database } : {}),
            ...(entry.user ? { user: entry.user } : {}),
            ...(entry.d1 ? { d1: entry.d1 } : {}),
          }
        : entry.engine === 'sqlite'
        ? { path: realFile(entry.path!) }
        : {
            // Through a tunnel, the bastion resolves the database host.
            ...(ssh ? { ssh } : { address: resolved!.address }),
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

  /** A tunnel key inside ~/.ssh must be one the user chose or one already saved. */
  async function keyRefused(draft: SqlConnectionDraft): Promise<boolean> {
    if (!draft.ssh?.keyPath) return false;
    if (!deps.ssh) return true;
    const saved = (await deps.catalog.list()).flatMap((entry) => (entry.ssh?.keyPath ? [entry.ssh.keyPath] : []));
    return !deps.ssh.keyAllowed(draft.ssh, saved);
  }

  /** Keeps a host key to trust once, and drops an asked SSH secret the bastion refused. */
  function sshFailure(entry: SqlConnectionV1, detail: HostError): SqlDbRunResult['fix'] | undefined {
    deps.ssh?.remember(detail);
    if (detail.fix === 'ssh-auth' || detail.fix === 'ssh-key') {
      if (entry.ssh?.secretMode === 'session' || keepOnSuccess.delete(sshSecretId(entry.id))) {
        sshSessionSecrets.delete(entry.id);
        return 'ssh-password-needed';
      }
    }
    return undefined;
  }

  /** A refused password asked this session is forgotten, so the next run asks again. */
  function passwordRefused(entry: SqlConnectionV1, detail: HostError): boolean {
    if (detail.fix !== 'auth' || !(entry.passwordMode === 'session' || keepOnSuccess.delete(connectionSecretId(entry.id)))) return false;
    sessionPasswords.delete(entry.id);
    return true;
  }

  // Secret writes for one connection run one after another, so a sign-in cannot store a password a save just dropped.
  const secretQueues = new Map<string, Promise<unknown>>();
  function withSecrets<T>(connectionId: string, work: () => Promise<T>): Promise<T> {
    const next = (secretQueues.get(connectionId) ?? Promise.resolve()).then(work, work);
    const tail = next.catch(() => undefined);
    secretQueues.set(connectionId, tail);
    void tail.then(() => {
      if (secretQueues.get(connectionId) === tail) secretQueues.delete(connectionId);
    });
    return next;
  }

  /**
   * Moves secrets asked for a keychain connection into the keychain after they
   * signed in: only the values that signed in, and only while the connection
   * still points where it did.
   */
  function keepAsked(entry: SqlConnectionV1, config: HostSessionConfig): Promise<void> {
    return withSecrets(entry.id, async () => {
      const current = await deps.catalog.get(entry.id);
      for (const [id, memory, used] of [
        [connectionSecretId(entry.id), sessionPasswords, config.password],
        [sshSecretId(entry.id), sshSessionSecrets, config.ssh?.password ?? config.ssh?.passphrase],
      ] as const) {
        const value = memory.get(entry.id);
        if (!keepOnSuccess.has(id) || value === undefined || value !== used) continue;
        keepOnSuccess.delete(id);
        if (!current || !sameTarget(current, entry)) continue;
        if ((await deps.secrets.set(id, value)).ok) memory.delete(entry.id);
      }
    });
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
    // A save that only regroups or renames keeps an asked password on its way to the keychain.
    if (value !== undefined || entry.passwordMode !== 'keychain') keepOnSuccess.delete(id);
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

  async function keepSshSecret(entry: SqlConnectionV1, value: string | undefined): Promise<boolean> {
    const id = sshSecretId(entry.id);
    if (value !== undefined || entry.ssh?.secretMode !== 'keychain') keepOnSuccess.delete(id);
    const mode = entry.ssh?.secretMode ?? 'none';
    if (mode === 'none') {
      sshSessionSecrets.delete(entry.id);
      await deps.secrets.delete(id);
      return true;
    }
    if (value === undefined) {
      if (mode === 'session') await deps.secrets.delete(id);
      return true;
    }
    if (mode === 'session') {
      sshSessionSecrets.set(entry.id, value);
      await deps.secrets.delete(id);
      return true;
    }
    sshSessionSecrets.delete(entry.id);
    return (await deps.secrets.set(id, value)).ok;
  }

  async function saveNow(draft: SqlConnectionDraft, id: string | undefined, secret: string | undefined, sshSecretValue?: string): Promise<SqlDbSaveResult> {
    if (pathProblem(draft) || (await keyRefused(draft))) return { ok: false, reason: 'invalid' };
    const before = id === undefined ? null : await deps.catalog.get(id);
    if (id !== undefined && !before) return { ok: false, reason: 'not-found' };
    // The old password goes before the new target is saved, so no run can pair the two.
    if (before && secret === undefined && !sameTarget(before, draft)) {
      sessionPasswords.delete(before.id);
      await deps.secrets.delete(connectionSecretId(before.id));
    }
    if (before && sshSecretValue === undefined && !sameSshTarget(before.ssh, draft.ssh)) {
      sshSessionSecrets.delete(before.id);
      await deps.secrets.delete(sshSecretId(before.id));
    }
    const ceiling = dbConnectionCeilingForTier(await deps.tier());
    const saved = await deps.catalog.save(draft, id, Number.isFinite(ceiling) ? ceiling : undefined);
    if (saved === 'quota') return { ok: false, reason: 'quota' };
    if (!saved) return { ok: false, reason: 'not-found' };
    await deps.host.request({ type: 'disconnect', connectionId: saved.id }).catch(() => undefined);
    if (!(await keepPassword(saved, secret)) || !(await keepSshSecret(saved, sshSecretValue))) return { ok: false, reason: 'secret-failed' };
    return { ok: true, connection: await view(saved) };
  }

  async function removeNow(id: string): Promise<{ ok: boolean }> {
    adhoc.delete(id);
    sessionPasswords.delete(id);
    sshSessionSecrets.delete(id);
    keepOnSuccess.delete(connectionSecretId(id));
    keepOnSuccess.delete(sshSecretId(id));
    await deps.secrets.delete(connectionSecretId(id));
    await deps.secrets.delete(sshSecretId(id));
    if (deps.host.isRunning()) await deps.host.request({ type: 'disconnect', connectionId: id }).catch(() => undefined);
    return { ok: await deps.catalog.remove(id) };
  }

  const service = {
    catalog: catalogView,

    save(draft: SqlConnectionDraft, id: string | undefined, secret: string | undefined, sshSecretValue?: string): Promise<SqlDbSaveResult> {
      return id === undefined ? saveNow(draft, id, secret, sshSecretValue) : withSecrets(id, () => saveNow(draft, id, secret, sshSecretValue));
    },

    remove(id: string): Promise<{ ok: boolean }> {
      return withSecrets(id, () => removeNow(id));
    },

    /** A connection for this session only, at any quota; its password stays in memory. */
    async openAdhoc(draft: SqlConnectionDraft, secret: string | undefined, sshSecretValue?: string): Promise<SqlDbSaveResult> {
      if (pathProblem(draft) || (await keyRefused(draft))) return { ok: false, reason: 'invalid' };
      if (adhoc.size >= MAX_ADHOC) return { ok: false, reason: 'quota' };
      const stamp = new Date().toISOString();
      const entry: SqlConnectionV1 = {
        version: 1,
        id: `adhoc_${randomUUID().replaceAll('-', '')}`,
        ...draft,
        passwordMode: draft.passwordMode === 'none' ? 'none' : 'session',
        ...(draft.ssh ? { ssh: { ...draft.ssh, secretMode: draft.ssh.secretMode === 'none' ? 'none' : 'session' } } : {}),
        createdAt: stamp,
        updatedAt: stamp,
      };
      adhoc.set(entry.id, entry);
      if (secret !== undefined && entry.passwordMode === 'session') sessionPasswords.set(entry.id, secret);
      if (sshSecretValue !== undefined && entry.ssh?.secretMode === 'session') sshSessionSecrets.set(entry.id, sshSecretValue);
      return { ok: true, connection: await view(entry) };
    },

    /** A password asked at connect time: kept for the session, or in the keychain once it signs in for a keychain connection. */
    async sessionPassword(id: string, secret: string, kind: SqlDbSecretKind = 'database'): Promise<{ ok: boolean }> {
      const entry = await connection(id);
      if (!entry || (kind === 'ssh' && !entry.ssh)) return { ok: false };
      (kind === 'ssh' ? sshSessionSecrets : sessionPasswords).set(id, secret);
      const mode = kind === 'ssh' ? entry.ssh?.secretMode : entry.passwordMode;
      const secretId = kind === 'ssh' ? sshSecretId(id) : connectionSecretId(id);
      if (mode === 'keychain' && !adhoc.has(id)) keepOnSuccess.add(secretId);
      else keepOnSuccess.delete(secretId);
      return { ok: true };
    },

    /** Trusts the key a hop presented in its last failed sign-in, and only that key. */
    trustHostKey(host: string, port: number, fingerprint: string): Promise<boolean> {
      return deps.ssh ? deps.ssh.trust(host, port, fingerprint) : Promise.resolve(false);
    },

    /** Lets a draft name a key the user just picked inside ~/.ssh. */
    chooseSshKey(keyPath: string): void {
      deps.ssh?.chooseKey(keyPath);
    },

    /** The tunnels an import just listed; saving one exactly as listed may use its key. */
    offerImportedTunnels(tunnels: ReadonlyArray<SqlConnectionSsh>): void {
      deps.ssh?.offerImported(tunnels);
    },

    /** Every saved connection as Lingua's export; it holds no secret. */
    async exportCatalog(): Promise<{ text: string; count: number }> {
      const list = await deps.catalog.list();
      return { text: exportText(list, new Date()), count: list.length };
    },

    /** What ~/.ssh/config says about an alias and whether an agent answers; never a file's content. */
    sshInfo(alias: string): Promise<SshInfo> {
      return deps.ssh ? deps.ssh.info(alias) : Promise.resolve({ config: null, agent: { available: false } });
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
      if ('draft' in target && (await keyRefused(target.draft))) {
        steps.push({ id: 'ssh', status: 'failed', detail: 'Choose the key file again with Choose key.', fix: 'ssh-key' });
        return done(false);
      }
      let built: Awaited<ReturnType<typeof configFor>>;
      try {
        built = 'draft' in target ? await configFor(entry, target.password, target.sshPassword) : await configFor(entry);
      } catch (err) {
        const guard = err instanceof GuardError ? err : new GuardError('connection-failed', 'unknown', String(err));
        const id =
          guard.fix === 'dns'
            ? 'resolve'
            : guard.fix === 'blocked-host'
              ? 'policy'
              : guard.fix === 'blocked-path'
                ? entry.engine === 'sqlite'
                  ? 'file'
                  : 'policy'
                : guard.fix?.startsWith('ssh-')
                  ? 'ssh'
                  : 'auth';
        steps.push({ id, status: 'failed', detail: guard.message, ...(guard.fix ? { fix: guard.fix } : {}) });
        return done(false);
      }
      const { config, resolved } = built;
      const first = firstHost(entry);
      if (resolved) {
        steps.push({ id: 'resolve', status: 'ok', ms: resolved.ms, detail: `${first!.host} → ${resolved.address}` });
        steps.push({ id: 'policy', status: 'ok', ms: 0, detail: resolved.isPrivate ? 'private' : 'public' });
      }
      try {
        const result = await deps.host.request<HostTestResult>({ type: 'test', config }, 30_000);
        if (entry.engine === 'sqlite') {
          steps.push({ id: 'file', status: 'ok', ms: result.connectMs, detail: entry.path! });
        } else {
          if (result.tcpMs !== undefined) steps.push({ id: 'tcp', status: 'ok', ms: result.tcpMs, detail: `${resolved!.address}:${first!.port}` });
          if (entry.ssh) {
            const chain = [...(entry.ssh.jumps ?? []), entry.ssh].map((hop) => hop.host);
            steps.push({ id: 'ssh', status: 'ok', ms: result.sshMs ?? 0, detail: [...chain, `${entry.host}:${entry.port}`].join(' → ') });
          }
          const tls = entry.ssl?.mode ?? 'verify-full';
          // prefer may have fallen back to a plain session; the driver says so.
          const plain = tls === 'disable' || result.encrypted === false;
          steps.push(
            plain
              ? { id: 'tls', status: 'skipped', detail: tls }
              : { id: 'tls', status: 'ok', detail: [tls, result.tls?.subject && `CN ${result.tls.subject}`, result.tls?.validTo && `expires ${result.tls.validTo}`].filter(Boolean).join(' · ') }
          );
          steps.push({ id: 'auth', status: 'ok', ms: result.connectMs, detail: entry.user ?? '' });
        }
        steps.push({ id: 'server', status: 'ok', ms: result.serverMs, detail: `${result.serverVersion}${entry.readOnly ? ' · read-only' : ''}` });
        if ('connectionId' in target) await keepAsked(entry, config);
        return done(true, result.serverVersion);
      } catch (err) {
        const detail: HostError = err instanceof SqlHostError ? err.detail : { message: String(err) };
        sshFailure(entry, detail);
        const hostKey = detail.hostKey ? { host: detail.hostKey.host, port: detail.hostKey.port, fingerprint: detail.hostKey.fingerprint } : undefined;
        steps.push({ id: detail.step ?? 'server', status: 'failed', detail: detail.message, fix: detail.fix ?? 'unknown', ...(hostKey ? { hostKey } : {}) });
        return done(false);
      }
    },

    async execute(owner: number, runId: string, connectionId: string, sql: string, options: SqlDbRunOptions): Promise<SqlDbRunResult> {
      const started = performance.now();
      const fail = (status: SqlDbRunResult['status'], message: string, fix?: SqlDbRunResult['fix']) =>
        failedRun(entry?.engine ?? 'postgres', Math.round(performance.now() - started), status, message, fix);
      const entry = await connection(connectionId);
      if (!entry) return fail('connection-failed', 'Unknown connection.');
      const { writes, refusal } = runGuard(entry, sql, options);
      if (refusal) return fail('sql-error', refusal, 'confirm-needed');
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
        await keepAsked(entry, config);
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
        const sshFix = sshFailure(entry, detail);
        if (sshFix) return fail('connection-failed', detail.message, sshFix);
        if (passwordRefused(entry, detail)) return fail('connection-failed', detail.message, 'password-needed');
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

    /** One level of a connection's catalog; failures come back as a message, like a run's. */
    async introspect(connectionId: string, request: SqlDbIntrospect): Promise<SqlDbIntrospectResult> {
      const entry = await connection(connectionId);
      if (!entry) return { errorMessage: 'Unknown connection.' };
      try {
        const { config } = await configFor(entry);
        const result = await deps.host.request<SqlDbIntrospectResult>({ type: 'introspect', config, request }, 30_000);
        await keepAsked(entry, config);
        return result;
      } catch (err) {
        if (err instanceof GuardError) return { errorMessage: err.message, ...(err.fix ? { fix: err.fix } : {}) };
        const detail: HostError = err instanceof SqlHostError ? err.detail : { message: String(err) };
        const sshFix = sshFailure(entry, detail);
        if (sshFix) return { errorMessage: detail.message, fix: sshFix };
        if (passwordRefused(entry, detail)) return { errorMessage: detail.message, fix: 'password-needed' };
        return { errorMessage: detail.message, ...(detail.fix ? { fix: detail.fix } : {}) };
      }
    },

    /**
     * Staged edits on one table, in one transaction on their own connection.
     * Main reads the table's columns and primary key itself and builds the SQL
     * from the change set, so the renderer chooses values, never statements.
     */
    async applyEdits(connectionId: string, target: SqlDbEditTable, changes: RowEditChanges, confirmName?: string): Promise<SqlDbApplyResult> {
      const entry = await connection(connectionId);
      if (!entry) return { ok: false, reason: 'failed', message: 'Unknown connection.' };
      const refused = editGuard(entry, confirmName);
      if (refused) return refused;
      try {
        const { config } = await configFor(entry);
        const detail = await deps.host.request<SqlDbIntrospectResult>(
          { type: 'introspect', config, request: { level: 'detail', schema: target.schema, name: target.name, kind: 'table' } },
          30_000
        );
        const table = rowEditTableFrom(entry.engine, target.schema, target.name, detail.detail?.columns ?? []);
        if (!table) return { ok: false, reason: 'not-editable', ...(detail.errorMessage ? { message: detail.errorMessage } : {}) };
        if (rowEditProblem(table, changes)) return { ok: false, reason: 'invalid' };
        const result = await deps.host.request<{ applied: number }>({ type: 'apply-edits', config, statements: rowEditStatements(table, changes, false) }, ROW_EDIT_BUDGET_MS * 2);
        await keepAsked(entry, config);
        return { ok: true, applied: result.applied };
      } catch (err) {
        if (err instanceof GuardError) return { ok: false, reason: 'failed', message: err.message, ...(err.fix ? { fix: err.fix } : {}) };
        const detail: HostError = err instanceof SqlHostError ? err.detail : { message: String(err) };
        const sshFix = sshFailure(entry, detail);
        if (sshFix) return { ok: false, reason: 'failed', message: detail.message, fix: sshFix };
        if (passwordRefused(entry, detail)) return { ok: false, reason: 'failed', message: detail.message, fix: 'password-needed' };
        return { ok: false, reason: 'failed', message: detail.message, ...(detail.fix ? { fix: detail.fix } : {}), ...(detail.edit ? { edit: detail.edit } : {}) };
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

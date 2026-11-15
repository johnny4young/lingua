import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../../src/main/secretStore';
import { createConnectionCatalog } from '../../src/main/sqlConnectionCatalog';
import { createSqlDbService, type SqlDbServiceDeps } from '../../src/main/sqlDbService';
import { createHostKeyStore } from '../../src/main/sqlSsh/hostKeyStore';
import { createSshTargets } from '../../src/main/sqlSsh/sshTargets';
import { SqlHostError } from '../../src/main/sqlHostClient';
import { HostError, type CallOptions } from '@electron-stagewright/host-supervisor';
import type { LicenseTier } from '../../src/shared/license';
import type { SqlConnectionDraft } from '../../src/shared/sqlConnections';

const pg: SqlConnectionDraft = {
  name: 'orders-dev',
  engine: 'postgres',
  host: 'db.internal',
  port: 5432,
  database: 'orders',
  user: 'app',
  ssl: { mode: 'verify-full' },
  env: 'dev',
  readOnly: false,
  passwordMode: 'keychain',
};

function memorySecrets(): SecretStore {
  const values = new Map<string, string>();
  return {
    status: () => ({ mode: 'encrypted' }),
    set: async (id, value) => {
      values.set(id, value);
      return { ok: true, mode: 'encrypted' };
    },
    get: async (id) => values.get(id) ?? null,
    delete: async (id) => values.delete(id),
    list: async () => [...values.keys()],
  };
}

type Respond = (body: Record<string, unknown>, options?: CallOptions) => unknown;

/** Each host operation as the request body the tests match on. */
const bodies: Record<string, (args: unknown[]) => Record<string, unknown>> = {
  test: ([config]) => ({ type: 'test', config }),
  execute: ([config, runId, sql, readWrite, window]) => ({ type: 'execute', config, runId, sql, readWrite, window }),
  fetch: ([runId, limit, maxBytes]) => ({ type: 'fetch', runId, limit, maxBytes }),
  closeRun: ([runId]) => ({ type: 'close-run', runId }),
  estimate: ([config, sql]) => ({ type: 'estimate', config, sql }),
  introspect: ([config, request]) => ({ type: 'introspect', config, request }),
  applyEdits: ([config, statements]) => ({ type: 'apply-edits', config, statements }),
  disconnect: ([connectionId]) => ({ type: 'disconnect', connectionId }),
};

function fakeHost(respond: Respond = () => ({})) {
  const sent: Array<Record<string, unknown>> = [];
  const host = {
    respond,
    call: vi.fn((op: string, args: unknown[], options?: CallOptions) => {
      const body = bodies[op]!(args);
      sent.push(body);
      const answer = Promise.resolve().then(() => host.respond(body, options));
      const { signal, abortGraceMs } = options ?? {};
      if (!signal || abortGraceMs === undefined) return answer;
      // As the supervisor does: an aborted call waits for the host's answer, within the grace.
      const unsettled = new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => setTimeout(() => reject(new HostError('HOST_ABORT_UNSETTLED', 'unsettled')), abortGraceMs), { once: true })
      );
      return Promise.race([answer, unsettled]);
    }),
    kill: vi.fn(async () => undefined),
    state: 'running' as const,
  };
  return { host, sent };
}

let dir: string;
let tier: LicenseTier;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lingua-sqldb-'));
  tier = 'free';
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function service(respond?: Respond, extra: { lookupAddress?: string } = {}) {
  const secrets = memorySecrets();
  const { host, sent } = fakeHost(respond);
  const catalogPath = path.join(dir, 'sql-connections.json');
  const looked: string[] = [];
  const svc = createSqlDbService({
    ssh: createSshTargets({
      hostKeys: createHostKeyStore(path.join(dir, 'sql-ssh-host-keys.json')),
      home: '/home/me',
      readText: async () => null,
      blockedPath: (file) => (file.startsWith('/home/me/.ssh/') ? 'credentials' : null),
      agentSocket: () => '/tmp/agent.sock',
    }),
    catalog: createConnectionCatalog(catalogPath),
    secrets,
    host: host as unknown as SqlDbServiceDeps['host'],
    tier: async () => tier,
    blockedPath: (file) => (file.startsWith('/protected/') ? 'lingua-data' : null),
    lookup: async (name) => {
      looked.push(name);
      return [{ address: extra.lookupAddress ?? '10.0.4.12', family: 4 }];
    },
  });
  return { svc, secrets, host, sent, catalogPath, looked };
}

describe('saving connections', () => {
  it('keeps the password in the secret store, never in the catalog file or the view', async () => {
    const { svc, secrets, catalogPath } = service();
    const saved = await svc.save(pg, undefined, 'hunter2');
    expect(saved).toMatchObject({ ok: true, connection: { name: 'orders-dev', hasPassword: true } });
    const id = (saved as { connection: { id: string } }).connection.id;
    expect(await secrets.get(`db.${id}`)).toBe('hunter2');
    const file = readFileSync(catalogPath, 'utf-8');
    expect(file).not.toContain('hunter2');
    expect(JSON.stringify(await svc.catalog())).not.toContain('hunter2');
    if (process.platform !== 'win32') expect(statSync(catalogPath).mode & 0o777).toBe(0o600);
  });

  it('holds Free to three saved connections, re-checked in main, and paid tiers to none', async () => {
    const { svc } = service();
    for (let i = 0; i < 3; i++) expect((await svc.save({ ...pg, name: `c${i}` }, undefined, undefined)).ok).toBe(true);
    expect(await svc.save({ ...pg, name: 'c4' }, undefined, undefined)).toEqual({ ok: false, reason: 'quota' });
    // A session-only connection opens anyway and never counts.
    expect((await svc.openAdhoc({ ...pg, name: 'url' }, 'pw')).ok).toBe(true);
    expect(await svc.catalog()).toMatchObject({ used: 3, limit: 3, adhoc: [{ name: 'url', passwordMode: 'session', hasPassword: true }] });
    tier = 'pro';
    expect((await svc.save({ ...pg, name: 'c4' }, undefined, undefined)).ok).toBe(true);
    expect(await svc.catalog()).toMatchObject({ used: 4, limit: null });
  });

  it('refuses files in protected folders and deletes the password with the connection', async () => {
    const { svc, secrets } = service();
    expect(await svc.save({ name: 'f', engine: 'sqlite', path: '/protected/app.db', readOnly: false, passwordMode: 'none' }, undefined, undefined)).toEqual({ ok: false, reason: 'invalid' });
    const saved = (await svc.save(pg, undefined, 'pw')) as { connection: { id: string } };
    await svc.remove(saved.connection.id);
    expect(await secrets.get(`db.${saved.connection.id}`)).toBeNull();
    expect((await svc.catalog()).connections).toEqual([]);
  });
});

describe('passwords that belong to a target', () => {
  it('drops the stored password when the host, user or TLS mode changes without a new one', async () => {
    const { svc, secrets } = service();
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    // A rename keeps the password: same server, same user.
    expect(await svc.save({ ...pg, name: 'orders' }, id, undefined)).toMatchObject({ connection: { hasPassword: true } });
    expect(await svc.save({ ...pg, host: 'attacker.example' }, id, undefined)).toMatchObject({ connection: { hasPassword: false } });
    expect(await secrets.get(`db.${id}`)).toBeNull();
    await svc.save(pg, id, 'pw');
    expect(await svc.save({ ...pg, ssl: { mode: 'disable' } }, id, undefined)).toMatchObject({ connection: { hasPassword: false } });
    // Clearing the user is a change of target too.
    await svc.save(pg, id, 'pw');
    const { user: _user, ...withoutUser } = pg;
    expect(await svc.save(withoutUser, id, undefined)).toMatchObject({ connection: { hasPassword: false } });
    // With a new password the change is the user's choice.
    expect(await svc.save({ ...pg, user: 'admin' }, id, 'other')).toMatchObject({ connection: { hasPassword: true } });
  });

  it('removes the keychain copy when a connection switches to Ask each session', async () => {
    const { svc, secrets } = service();
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    await svc.save({ ...pg, passwordMode: 'session' }, id, undefined);
    expect(await secrets.get(`db.${id}`)).toBeNull();
  });

  it('caps session-only connections', async () => {
    const { svc } = service();
    for (let i = 0; i < 20; i++) expect((await svc.openAdhoc({ ...pg, name: `a${i}` }, undefined)).ok).toBe(true);
    expect(await svc.openAdhoc({ ...pg, name: 'one-more' }, undefined)).toEqual({ ok: false, reason: 'quota' });
  });

  it('refuses a SQLite path that links into a protected folder', async () => {
    const blocked = path.join(realpathSync(dir), 'protected');
    mkdirSync(blocked);
    writeFileSync(path.join(blocked, 'app.db'), '');
    symlinkSync(path.join(blocked, 'app.db'), path.join(dir, 'innocent.db'));
    const svc = createSqlDbService({
      catalog: createConnectionCatalog(path.join(dir, 'c.json')),
      secrets: memorySecrets(),
      host: fakeHost().host as unknown as SqlDbServiceDeps['host'],
      tier: async () => 'free',
      blockedPath: (file) => (file.startsWith(blocked) ? 'lingua-data' : null),
    });
    expect(await svc.save({ name: 'f', engine: 'sqlite', path: path.join(dir, 'innocent.db'), readOnly: true, passwordMode: 'none' }, undefined, undefined)).toEqual({
      ok: false,
      reason: 'invalid',
    });
    // A file that does not exist yet resolves through its folder.
    symlinkSync(blocked, path.join(dir, 'innocent-folder'));
    expect(await svc.save({ name: 'g', engine: 'sqlite', path: path.join(dir, 'innocent-folder', 'new.db'), readOnly: true, passwordMode: 'none' }, undefined, undefined)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
});

describe('running statements', () => {
  const ok = { columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false };

  it('sends the pinned address, the hostname for TLS and the stored password to the host', async () => {
    const { svc, sent } = service(() => ok);
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success', engine: 'postgres' });
    const execute = sent.find((body) => body.type === 'execute')!;
    expect(execute).toMatchObject({
      runId: '1:r1',
      readWrite: false,
      config: { address: '10.0.4.12', servername: 'db.internal', password: 'pw', readOnly: false },
    });
  });

  it('asks for a password the session does not have yet', async () => {
    const { svc } = service(() => ok);
    const id = ((await svc.save({ ...pg, passwordMode: 'session' }, undefined, undefined)) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'connection-failed', fix: 'password-needed' });
    await svc.sessionPassword(id, 'typed');
    expect(await svc.execute(1, 'r2', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
  });

  it('forgets a session password the server refused, so the next run asks again', async () => {
    let refuse = true;
    const { svc } = service(() => {
      if (refuse) throw new SqlHostError({ message: 'Access denied', step: 'auth', fix: 'auth' });
      return ok;
    });
    const id = ((await svc.save({ ...pg, passwordMode: 'session' }, undefined, undefined)) as { connection: { id: string } }).connection.id;
    await svc.sessionPassword(id, 'wrong');
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'connection-failed', fix: 'password-needed', errorMessage: 'Access denied' });
    refuse = false;
    expect(await svc.execute(1, 'r2', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ fix: 'password-needed' });
    await svc.sessionPassword(id, 'right');
    expect(await svc.execute(1, 'r3', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
  });

  it('keeps a password asked for a keychain connection in the keychain once it signs in, and forgets a refused one', async () => {
    let refuse = true;
    const { svc, secrets } = service(() => {
      if (refuse) throw new SqlHostError({ message: 'Access denied', step: 'auth', fix: 'auth' });
      return ok;
    });
    const id = ((await svc.save(pg, undefined, undefined)) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ fix: 'password-needed' });
    await svc.sessionPassword(id, 'wrong');
    expect(await svc.execute(1, 'r2', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ fix: 'password-needed', errorMessage: 'Access denied' });
    expect(await secrets.get(`db.${id}`)).toBeNull();
    refuse = false;
    await svc.sessionPassword(id, 'right');
    expect(await svc.execute(1, 'r3', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
    expect(await secrets.get(`db.${id}`)).toBe('right');
    // The keychain holds it now, so a refusal later is the server's answer, not a prompt.
    refuse = true;
    expect(await svc.execute(1, 'r4', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ fix: 'auth' });
  });

  it('still keeps an asked password after a save that only moves the connection to a group', async () => {
    const { svc, secrets } = service(() => ok);
    const id = ((await svc.save(pg, undefined, undefined)) as { connection: { id: string } }).connection.id;
    await svc.sessionPassword(id, 'typed');
    await svc.save({ ...pg, group: 'Ratfel' }, id, undefined);
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
    expect(await secrets.get(`db.${id}`)).toBe('typed');
  });

  it('never stores an asked password for a target a save changed while it signed in', async () => {
    const { svc, secrets } = service(() => ok);
    const id = ((await svc.save(pg, undefined, undefined)) as { connection: { id: string } }).connection.id;
    await svc.sessionPassword(id, 'for db.internal');
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const set = secrets.set.bind(secrets);
    let setCalls = 0;
    secrets.set = async (secretId, value) => {
      setCalls += 1;
      await gate;
      return set(secretId, value);
    };
    const run = svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(setCalls).toBe(1);
    const moved = svc.save({ ...pg, host: 'other.internal' }, id, undefined);
    // Without the per-connection queue the save would finish here, before the held keychain write.
    await new Promise((resolve) => setTimeout(resolve, 20));
    release();
    await Promise.all([run, moved]);
    expect(await secrets.get(`db.${id}`)).toBeNull();
  });

  it('keeps an asked password in memory only for an ask-each-session connection', async () => {
    const { svc, secrets } = service(() => ok);
    const id = ((await svc.save({ ...pg, passwordMode: 'session' }, undefined, undefined)) as { connection: { id: string } }).connection.id;
    await svc.sessionPassword(id, 'typed');
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
    expect(await secrets.get(`db.${id}`)).toBeNull();
  });

  it('guards production: a write needs the typed name, and lifting read-only always does', async () => {
    const { svc, sent } = service(() => ok);
    const prod = ((await svc.save({ ...pg, name: 'orders-prod', env: 'prod', readOnly: true }, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 'r1', prod, 'DELETE FROM orders', { timeoutMs: 1_000 })).toMatchObject({ status: 'sql-error', fix: 'confirm-needed' });
    expect(await svc.execute(1, 'r2', prod, 'DELETE FROM orders', { timeoutMs: 1_000, readWrite: { confirmName: 'orders' } })).toMatchObject({ fix: 'confirm-needed' });
    expect(sent.some((body) => body.type === 'execute')).toBe(false);
    expect(await svc.execute(1, 'r3', prod, 'DELETE FROM orders', { timeoutMs: 1_000, readWrite: { confirmName: 'orders-prod' } })).toMatchObject({ status: 'success' });
    expect(sent.find((body) => body.type === 'execute')).toMatchObject({ readWrite: true, config: { readOnly: true } });
    // Reads on production run without a confirm.
    expect(await svc.execute(1, 'r4', prod, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
  });

  it('on SQL Server runs only a proven single query without the typed name, since its batches need no semicolons', async () => {
    const { svc, sent } = service(() => ok);
    const prod = ((await svc.save({ ...pg, name: 'erp-prod', engine: 'sqlserver', port: 1433, env: 'prod', readOnly: true }, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 's1', prod, 'SELECT 1 COMMIT EXEC dbo.purge', { timeoutMs: 1_000 })).toMatchObject({ status: 'sql-error', fix: 'confirm-needed' });
    const readOnly = ((await svc.save({ ...pg, name: 'erp-ro', engine: 'sqlserver', port: 1433, readOnly: true }, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 's2', readOnly, "SELECT 1 AS [a']; DELETE FROM t; --']", { timeoutMs: 1_000 })).toMatchObject({ status: 'sql-error', fix: 'confirm-needed' });
    expect(sent.some((body) => body.type === 'execute')).toBe(false);
    expect(await svc.execute(1, 's3', readOnly, 'SELECT TOP (5) * FROM dbo.orders', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
    expect(await svc.execute(1, 's4', readOnly, 'DELETE FROM dbo.orders WHERE id = 1', { timeoutMs: 1_000, readWrite: { confirmName: 'erp-ro' } })).toMatchObject({ status: 'success' });
    expect(sent.filter((body) => body.type === 'execute').map((body) => body.readWrite)).toEqual([false, true]);
  });

  it('turns a connect failure into connection-failed with the fix, and a statement error into sql-error', async () => {
    let fail: unknown = new SqlHostError({ message: 'password authentication failed', step: 'auth', fix: 'auth' });
    const { svc } = service(() => {
      throw fail;
    });
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'connection-failed', fix: 'auth' });
    fail = new SqlHostError({ message: 'relation "x" does not exist' });
    expect(await svc.execute(1, 'r2', id, 'SELECT * FROM x', { timeoutMs: 1_000 })).toMatchObject({ status: 'sql-error', errorMessage: 'relation "x" does not exist' });
  });

  it('cancels its own runs only, and restarts the host when the engine cannot stop', async () => {
    const { svc, host } = service((body, options) => {
      if (body.type !== 'execute') return {};
      return new Promise((_, reject) =>
        options?.signal?.addEventListener('abort', () => reject(new SqlHostError({ message: 'The query was cancelled, but the engine could not stop it.', cancelled: true, restart: true })))
      );
    });
    const id = ((await svc.save({ name: 'f', engine: 'sqlite', path: '/data/app.db', readOnly: false, passwordMode: 'none' }, undefined, undefined)) as { connection: { id: string } }).connection.id;
    const running = svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await svc.cancel(2, 'r1')).toEqual({ cancelled: false });
    expect(await svc.cancel(1, 'r1')).toEqual({ cancelled: true });
    expect(await running).toMatchObject({ status: 'cancelled' });
    expect(host.kill).toHaveBeenCalledOnce();
  });
});

describe('estimates and cancel', () => {
  it('estimates one statement only, never a script or an ANALYZE', async () => {
    const { svc, sent } = service(() => 7);
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.estimate(id, 'DELETE FROM t WHERE id = 1')).toBe(7);
    expect(await svc.estimate(id, 'SELECT 1; DELETE FROM customers')).toBeNull();
    expect(await svc.estimate(id, 'ANALYZE customers')).toBeNull();
    expect(await svc.estimate(id, '/* hidden */ ANALYZE DELETE FROM t')).toBeNull();
    expect(await svc.estimate(id, 'DELETE /*!ANALYZE*/ FROM t')).toBeNull();
    // MySQL ends this comment at the first */ and would read ANALYZE DELETE.
    expect(await svc.estimate(id, '/* /* */ ANALYZE DELETE FROM t */ DELETE FROM t')).toBeNull();
    expect(await svc.estimate(id, '  update t set a = 1')).toBe(7);
    expect(sent.filter((body) => body.type === 'estimate')).toHaveLength(2);
  });

  it('introspects with the stored password and reports failures as a message', async () => {
    const { svc, sent } = service((body) => {
      if (body.type === 'introspect') throw new SqlHostError({ message: 'permission denied for schema audit' });
      return {};
    });
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.introspect(id, { level: 'objects', schema: 'audit' })).toEqual({ errorMessage: 'permission denied for schema audit' });
    expect(sent.at(-1)).toMatchObject({ type: 'introspect', config: { password: 'pw', address: '10.0.4.12' }, request: { level: 'objects', schema: 'audit' } });
    expect(await svc.introspect('c_missing', { level: 'schemas' })).toEqual({ errorMessage: 'Unknown connection.' });
  });

  it('asks again for a session password the server refused while introspecting', async () => {
    const { svc } = service((body) => {
      if (body.type === 'introspect') throw new SqlHostError({ message: 'password authentication failed', step: 'auth', fix: 'auth' });
      return {};
    });
    const id = ((await svc.save({ ...pg, passwordMode: 'session' }, undefined, undefined)) as { connection: { id: string } }).connection.id;
    expect(await svc.introspect(id, { level: 'schemas' })).toMatchObject({ fix: 'password-needed' });
    await svc.sessionPassword(id, 'wrong');
    expect(await svc.introspect(id, { level: 'schemas' })).toMatchObject({ fix: 'password-needed' });
    // The refused password was dropped, so the next call needs a new one before reaching the host.
    expect(await svc.introspect(id, { level: 'schemas' })).toEqual({ errorMessage: 'This connection needs its password.', fix: 'password-needed' });
  });

  it('cancels a run whose host has not started yet, without restarting it', async () => {
    const { svc, host } = service();
    const id = ((await svc.save({ name: 'f', engine: 'sqlite', path: path.join(dir, 'x.db'), readOnly: false, passwordMode: 'none' }, undefined, undefined)) as {
      connection: { id: string };
    }).connection.id;
    // As the supervisor does for a call no host has received: an abort fails it at once.
    host.call.mockImplementationOnce(
      (_op: string, _args: unknown[], options?: CallOptions) =>
        new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new HostError('HOST_CALL_ABORTED', 'The call was aborted'))))
    );
    const running = svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 60_000 });
    await vi.waitFor(() => expect(host.call).toHaveBeenLastCalledWith('execute', expect.anything(), expect.anything()));
    expect(await svc.cancel(1, 'r1')).toEqual({ cancelled: true });
    expect(await running).toMatchObject({ status: 'cancelled', errorMessage: 'The query was cancelled.' });
    expect(host.kill).not.toHaveBeenCalled();
  });

  it('restarts a host that does not answer a cancel', async () => {
    vi.useFakeTimers();
    try {
      const { svc, host } = service((body) => (body.type === 'execute' ? new Promise(() => undefined) : undefined));
      const id = ((await svc.save({ name: 'f', engine: 'sqlite', path: path.join(dir, 'x.db'), readOnly: false, passwordMode: 'none' }, undefined, undefined)) as {
        connection: { id: string };
      }).connection.id;
      const running = svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(0);
      expect(await svc.cancel(1, 'r1')).toEqual({ cancelled: true });
      expect(host.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await running).toMatchObject({ status: 'cancelled' });
      expect(host.kill).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

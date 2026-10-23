import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../../src/main/secretStore';
import { createConnectionCatalog } from '../../src/main/sqlConnectionCatalog';
import { createSqlDbService } from '../../src/main/sqlDbService';
import { createHostKeyStore } from '../../src/main/sqlSsh/hostKeyStore';
import { createSshTargets } from '../../src/main/sqlSsh/sshTargets';
import { SqlHostError, type SqlHostSupervisor } from '../../src/main/sqlHostSupervisor';
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

function fakeHost(respond: (body: Record<string, unknown>) => unknown = () => ({})) {
  const sent: Array<Record<string, unknown>> = [];
  const host = {
    request: vi.fn(async (body: Record<string, unknown>) => {
      sent.push(body);
      return respond(body);
    }),
    restart: vi.fn(),
    isRunning: () => true,
    dispose: vi.fn(),
  } as unknown as SqlHostSupervisor;
  return { host, sent };
}

let dir: string;
let tier: LicenseTier;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'lingua-sqldb-'));
  tier = 'free';
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function service(respond?: (body: Record<string, unknown>) => unknown, extra: { lookupAddress?: string } = {}) {
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
    host,
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
      host: fakeHost().host,
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
    let release!: () => void;
    const { svc, host } = service((body) => {
      if (body.type === 'execute') return new Promise((resolve) => (release = () => resolve(ok)));
      if (body.type === 'cancel') return { cancelled: false, restart: true };
      return {};
    });
    const id = ((await svc.save({ name: 'f', engine: 'sqlite', path: '/data/app.db', readOnly: false, passwordMode: 'none' }, undefined, undefined)) as { connection: { id: string } }).connection.id;
    const running = svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 60_000 });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(await svc.cancel(2, 'r1')).toEqual({ cancelled: false });
    expect(await svc.cancel(1, 'r1')).toEqual({ cancelled: true });
    expect(host.restart).toHaveBeenCalledOnce();
    release();
    await running;
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

  it('restarts a host that does not answer a cancel', async () => {
    vi.useFakeTimers();
    try {
      const { svc, host } = service((body) =>
        body.type === 'cancel' || body.type === 'execute' ? new Promise(() => undefined) : { columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false }
      );
      (host.request as ReturnType<typeof vi.fn>).mockImplementation((body: Record<string, unknown>, timeoutMs?: number) =>
        body.type === 'cancel' || body.type === 'execute'
          ? new Promise((_, reject) => (timeoutMs ? setTimeout(() => reject(new Error('timed out')), timeoutMs) : undefined))
          : Promise.resolve(undefined)
      );
      const id = ((await svc.save({ name: 'f', engine: 'sqlite', path: path.join(dir, 'x.db'), readOnly: false, passwordMode: 'none' }, undefined, undefined)) as {
        connection: { id: string };
      }).connection.id;
      void svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 60_000 });
      await vi.advanceTimersByTimeAsync(0);
      const cancelled = svc.cancel(1, 'r1');
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await cancelled).toEqual({ cancelled: true });
      expect(host.restart).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('testing a connection', () => {
  it('lists resolve, policy, TCP, TLS, auth and server with timings', async () => {
    const { svc } = service((body) =>
      body.type === 'test' ? { tcpMs: 9, connectMs: 35, serverMs: 4, serverVersion: 'PostgreSQL 16.4', tls: { subject: 'db.internal', validTo: 'Feb  1 2027' } } : {}
    );
    const result = await svc.test({ draft: pg, password: 'pw' });
    expect(result.ok).toBe(true);
    expect(result.steps.map((step) => `${step.id}:${step.status}`)).toEqual(['resolve:ok', 'policy:ok', 'tcp:ok', 'tls:ok', 'auth:ok', 'server:ok']);
    expect(result.steps.find((step) => step.id === 'policy')?.detail).toBe('private');
    expect(result.steps.find((step) => step.id === 'tls')?.detail).toBe('verify-full · CN db.internal · expires Feb  1 2027');
    expect(result.serverVersion).toBe('PostgreSQL 16.4');
  });

  it('shows TLS as skipped whenever the driver reports a plain session, whatever the engine', async () => {
    const { svc } = service((body) => (body.type === 'test' ? { tcpMs: 2, connectMs: 5, serverMs: 1, serverVersion: 'ClickHouse 24.8', encrypted: false } : {}));
    const result = await svc.test({ draft: { ...pg, engine: 'clickhouse', port: 8123, ssl: { mode: 'prefer' } }, password: 'pw' });
    expect(result.steps.find((step) => step.id === 'tls')).toMatchObject({ status: 'skipped', detail: 'prefer' });
  });

  it('names the step that failed and the fix', async () => {
    const { svc } = service(() => {
      throw new SqlHostError({ message: 'self-signed certificate in certificate chain', step: 'tls', fix: 'tls-untrusted' });
    });
    const result = await svc.test({ draft: pg, password: 'pw' });
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ id: 'tls', status: 'failed', fix: 'tls-untrusted' });
  });
});

describe('SSH tunnels and safety switches', () => {
  const tunnelled: SqlConnectionDraft = {
    ...pg,
    ssh: { host: 'bastion.example.net', port: 22, user: 'deploy', auth: 'password', secretMode: 'keychain', jumps: undefined },
  };

  it('resolves and checks the first hop, keeps the SSH password apart, and lets the bastion resolve the database', async () => {
    const { svc, sent, secrets, looked } = service(() => ({ connectMs: 1, serverMs: 1, serverVersion: 'PostgreSQL 16', tcpMs: 1, sshMs: 2 }));
    const saved = (await svc.save(tunnelled, undefined, 'db-pw', 'ssh-pw')) as { connection: { id: string; hasSshSecret: boolean } };
    expect(saved.connection.hasSshSecret).toBe(true);
    expect(await secrets.get(`db.${saved.connection.id}.ssh`)).toBe('ssh-pw');
    const result = await svc.test({ connectionId: saved.connection.id });
    expect(looked).toEqual(['bastion.example.net']);
    expect(result.steps.map((step) => step.id)).toEqual(['resolve', 'policy', 'tcp', 'ssh', 'tls', 'auth', 'server']);
    expect(result.steps.find((step) => step.id === 'ssh')?.detail).toBe('bastion.example.net → db.internal:5432');
    const config = sent.at(-1)!.config as Record<string, unknown>;
    expect(config).not.toHaveProperty('address');
    expect(config.ssh).toMatchObject({ auth: 'password', password: 'ssh-pw', target: { host: 'db.internal', port: 5432 }, hops: [{ host: '10.0.4.12', label: { host: 'bastion.example.net' } }] });
  });

  it('refuses a private first hop when the connection does not allow one', async () => {
    const { svc, sent } = service(() => ({}), { lookupAddress: '192.168.1.20' });
    const id = ((await svc.save({ ...tunnelled, allowPrivateHost: false }, undefined, 'pw', 'ssh')) as { connection: { id: string } }).connection.id;
    const result = await svc.test({ connectionId: id });
    expect(result.steps.at(-1)).toMatchObject({ id: 'policy', status: 'failed', fix: 'blocked-host' });
    expect(sent.filter((body) => body.type === 'test')).toHaveLength(0);
  });

  it('asks for a session SSH password, and again after the bastion refused it', async () => {
    const { svc } = service((body) => {
      if (body.type === 'execute') throw new SqlHostError({ message: 'All configured authentication methods failed', step: 'ssh', fix: 'ssh-auth' });
      return {};
    });
    const draft = { ...tunnelled, ssh: { ...tunnelled.ssh!, secretMode: 'session' as const } };
    const id = ((await svc.save(draft, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1000 })).toMatchObject({ fix: 'ssh-password-needed' });
    expect(await svc.sessionPassword(id, 'wrong', 'ssh')).toEqual({ ok: true });
    expect(await svc.execute(1, 'r2', id, 'SELECT 1', { timeoutMs: 1000 })).toMatchObject({ status: 'connection-failed', fix: 'ssh-password-needed' });
    // The refused password was dropped.
    expect(await svc.execute(1, 'r3', id, 'SELECT 1', { timeoutMs: 1000 })).toMatchObject({ errorMessage: expect.stringMatching(/SSH sign-in needs/) });
  });

  it('forgets both secrets when the bastion changes without new ones, since another machine answers for the database', async () => {
    const { svc, secrets } = service();
    const id = ((await svc.save(tunnelled, undefined, 'pw', 'ssh-pw')) as { connection: { id: string } }).connection.id;
    await svc.save({ ...tunnelled, ssh: { ...tunnelled.ssh!, host: 'other-bastion' } }, id, undefined);
    expect(await secrets.get(`db.${id}.ssh`)).toBeNull();
    expect(await secrets.get(`db.${id}`)).toBeNull();
  });

  it('forgets the database password when a tunnel is added, and the SSH secret when the jump chain changes', async () => {
    const { svc, secrets } = service();
    const direct = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    await svc.save(tunnelled, direct, undefined, 'ssh-pw');
    expect(await secrets.get(`db.${direct}`)).toBeNull();
    const keyed = { ...pg, ssh: { host: 'bastion', port: 22, user: 'deploy', auth: 'key' as const, keyPath: '/home/me/.ssh/id_ed25519', secretMode: 'keychain' as const, jumps: [{ host: 'jump-a', port: 22, user: 'deploy' }] } };
    svc.chooseSshKey('/home/me/.ssh/id_ed25519');
    const id = ((await svc.save(keyed, undefined, 'pw', 'passphrase')) as { connection: { id: string } }).connection.id;
    await svc.save({ ...keyed, ssh: { ...keyed.ssh, jumps: [{ host: 'jump-b', port: 22, user: 'deploy' }] } }, id, 'pw');
    expect(await secrets.get(`db.${id}.ssh`)).toBeNull();
    // Same chain, nothing forgotten.
    await svc.save({ ...keyed, ssh: { ...keyed.ssh, jumps: [{ host: 'jump-b', port: 22, user: 'deploy' }] } }, id, undefined, 'passphrase');
    await svc.save({ ...keyed, name: 'renamed', ssh: { ...keyed.ssh, jumps: [{ host: 'jump-b', port: 22, user: 'deploy' }] } }, id, undefined);
    expect(await secrets.get(`db.${id}.ssh`)).toBe('passphrase');
    expect(await secrets.get(`db.${id}`)).toBe('pw');
  });

  it('asks for the typed name before any write when Confirm every write is on', async () => {
    const { svc, sent } = service(() => ({ columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false, affectedRows: 1 }));
    const id = ((await svc.save({ ...pg, confirmWrites: true }, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.execute(1, 'w1', id, 'DELETE FROM t', { timeoutMs: 1000 })).toMatchObject({ fix: 'confirm-needed' });
    expect(await svc.execute(1, 'w2', id, 'SELECT 1', { timeoutMs: 1000 })).toMatchObject({ status: 'success' });
    expect(await svc.execute(1, 'w3', id, 'DELETE FROM t', { timeoutMs: 1000, readWrite: { confirmName: 'orders-dev' } })).toMatchObject({ status: 'success' });
    expect(sent.filter((body) => body.type === 'execute')).toHaveLength(2);
  });

  it('offers a key no one trusts in the test report, and trusts exactly that key once', async () => {
    const fingerprint = `SHA256:${'k'.repeat(43)}`;
    const { svc } = service((body) => {
      if (body.type === 'test') throw new SqlHostError({ message: 'unknown key', step: 'ssh', fix: 'ssh-host-unknown', hostKey: { host: 'bastion.example.net', port: 22, type: 'ssh-ed25519', fingerprint } });
      return {};
    });
    const id = ((await svc.save(tunnelled, undefined, 'pw', 'ssh-pw')) as { connection: { id: string } }).connection.id;
    const result = await svc.test({ connectionId: id });
    expect(result.steps.at(-1)).toEqual({ id: 'ssh', status: 'failed', detail: 'unknown key', fix: 'ssh-host-unknown', hostKey: { host: 'bastion.example.net', port: 22, fingerprint } });
    expect(await svc.trustHostKey('bastion.example.net', 22, `SHA256:${'x'.repeat(43)}`)).toBe(false);
    expect(await svc.trustHostKey('bastion.example.net', 22, fingerprint)).toBe(true);
  });

  it('takes a key inside ~/.ssh only once the user chose it, and keeps one already saved', async () => {
    const { svc, sent } = service();
    const keyed = { ...pg, ssh: { host: 'bastion', port: 22, user: 'deploy', auth: 'key' as const, keyPath: '/home/me/.ssh/id_work', secretMode: 'none' as const } };
    expect(await svc.save(keyed, undefined, 'pw')).toEqual({ ok: false, reason: 'invalid' });
    const test = await svc.test({ draft: keyed });
    expect(test.steps).toEqual([{ id: 'ssh', status: 'failed', detail: 'Choose the key file again with Choose key.', fix: 'ssh-key' }]);
    expect(sent.filter((body) => body.type === 'test')).toHaveLength(0);
    svc.chooseSshKey('/home/me/.ssh/id_work');
    const saved = (await svc.save(keyed, undefined, 'pw')) as { ok: boolean; connection: { id: string } };
    expect(saved.ok).toBe(true);
    // The next launch still takes the saved key, and not another one inside ~/.ssh.
    const later = service();
    expect(await later.svc.save(keyed, undefined, 'pw')).toMatchObject({ ok: true });
    expect(await later.svc.save({ ...keyed, ssh: { ...keyed.ssh, keyPath: '/home/me/.ssh/id_other' } }, undefined, 'pw')).toEqual({ ok: false, reason: 'invalid' });
  });
});


describe('staged edits', () => {
  const detail = (primaryKey: boolean) => ({
    detail: {
      columns: [
        { name: 'id', type: 'integer', nullable: false, primaryKey },
        { name: 'city', type: 'text', nullable: true },
      ],
    },
  });
  const changes = { updates: [{ key: { id: '7' }, values: { city: "O'Hare" } }], deletes: [], inserts: [] };
  const respond = (primaryKey = true) => (body: Record<string, unknown>) => (body.type === 'introspect' ? detail(primaryKey) : body.type === 'apply-edits' ? { applied: 1 } : {});

  it('binds SQL Server values as @p1, @p2… and never edits a ClickHouse table, whose sorting key is not unique', async () => {
    const { svc, sent } = service(respond());
    const erp = ((await svc.save({ ...pg, name: 'erp', engine: 'sqlserver', port: 1433 }, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.applyEdits(erp, { schema: 'dbo', name: 'orders' }, changes)).toEqual({ ok: true, applied: 1 });
    expect(sent.find((body) => body.type === 'apply-edits')).toMatchObject({ statements: [{ sql: 'UPDATE [dbo].[orders] SET [city] = @p1 WHERE [id] = @p2' }] });
    sent.length = 0;
    const events = ((await svc.save({ ...pg, name: 'events', engine: 'clickhouse', port: 8443 }, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.applyEdits(events, { schema: 'analytics', name: 'events' }, changes)).toEqual({ ok: false, reason: 'not-editable' });
    expect(sent.some((body) => body.type === 'introspect' || body.type === 'apply-edits')).toBe(false);
  });

  it('builds the SQL in main from its own read of the primary key and applies it on its own request', async () => {
    const { svc, sent } = service(respond());
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.applyEdits(id, { schema: 'public', name: 'orders' }, changes)).toEqual({ ok: true, applied: 1 });
    expect(sent.find((body) => body.type === 'introspect')).toMatchObject({ request: { level: 'detail', schema: 'public', name: 'orders', kind: 'table' } });
    expect(sent.find((body) => body.type === 'apply-edits')).toMatchObject({
      statements: [{ sql: 'UPDATE "public"."orders" SET "city" = $1 WHERE "id" = $2', params: ["O'Hare", '7'] }],
      config: { password: 'pw' },
    });
  });

  it('never edits read-only or production connections, and asks the typed name when every write must be confirmed', async () => {
    const { svc, sent } = service(respond());
    const save = async (draft: typeof pg) => ((await svc.save(draft, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.applyEdits(await save({ ...pg, readOnly: true }), { schema: 'public', name: 'orders' }, changes)).toEqual({ ok: false, reason: 'read-only' });
    expect(await svc.applyEdits(await save({ ...pg, name: 'p', env: 'prod' }), { schema: 'public', name: 'orders' }, changes)).toEqual({ ok: false, reason: 'production' });
    const careful = await save({ ...pg, name: 'careful', confirmWrites: true });
    expect(await svc.applyEdits(careful, { schema: 'public', name: 'orders' }, changes)).toEqual({ ok: false, reason: 'confirm-needed' });
    expect(sent.some((body) => body.type === 'apply-edits')).toBe(false);
    expect(await svc.applyEdits(careful, { schema: 'public', name: 'orders' }, changes, 'careful')).toEqual({ ok: true, applied: 1 });
  });

  it('refuses a table without a primary key and a change keyed by anything but the whole key', async () => {
    const keyless = service(respond(false));
    const id = ((await keyless.svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await keyless.svc.applyEdits(id, { schema: 'public', name: 'orders' }, changes)).toEqual({ ok: false, reason: 'not-editable' });
    const keyed = service(respond());
    const other = ((await keyed.svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await keyed.svc.applyEdits(other, { schema: 'public', name: 'orders' }, { ...changes, updates: [{ key: { city: 'x' }, values: { city: 'y' } }] })).toEqual({ ok: false, reason: 'invalid' });
    expect(keyed.sent.some((body) => body.type === 'apply-edits')).toBe(false);
  });

  it('says why when the transaction rolled back', async () => {
    const { svc } = service((body) => {
      if (body.type === 'introspect') return detail(true);
      throw new SqlHostError({ message: 'Change 1 would touch 0 rows instead of one.', edit: { kind: 'conflict', change: 1, touched: 0 } });
    });
    const id = ((await svc.save(pg, undefined, 'pw')) as { connection: { id: string } }).connection.id;
    expect(await svc.applyEdits(id, { schema: 'public', name: 'orders' }, changes)).toMatchObject({ ok: false, reason: 'failed', edit: { kind: 'conflict', change: 1, touched: 0 } });
  });
});

describe('HTTP engines', () => {
  const neon: SqlConnectionDraft = { name: 'shop', engine: 'neon', host: 'ep-cool-1.us-east-2.aws.neon.tech', port: 443, database: 'shop', user: 'app', ssl: { mode: 'verify-full' }, readOnly: false, passwordMode: 'keychain' };
  const d1: SqlConnectionDraft = { name: 'edge', engine: 'd1', d1: { accountId: 'a'.repeat(32), databaseId: '0f0e0d0c-1111-2222-3333-444455556666' }, readOnly: true, passwordMode: 'keychain' };
  const rows = { columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false };

  it("resolves and pins Neon's API host, and names the database host for the connection string", async () => {
    const { svc, sent, looked } = service(() => rows, { lookupAddress: '3.3.3.3' });
    const saved = await svc.save(neon, undefined, 'pw');
    const id = (saved as { connection: { id: string } }).connection.id;
    await svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 });
    expect(looked).toEqual(['api.us-east-2.aws.neon.tech']);
    expect(sent[sent.length - 1]).toMatchObject({
      type: 'execute',
      config: { engine: 'neon', address: '3.3.3.3', servername: 'api.us-east-2.aws.neon.tech', port: 443, ssl: { mode: 'verify-full' }, host: 'ep-cool-1.us-east-2.aws.neon.tech', database: 'shop', user: 'app', password: 'pw' },
    });
  });

  it("sends D1 to Cloudflare's API, and runs only proven reads on a read-only D1 connection", async () => {
    const { svc, sent, looked } = service(() => rows, { lookupAddress: '104.16.0.1' });
    const saved = await svc.save(d1, undefined, 'cf-token');
    const id = (saved as { connection: { id: string } }).connection.id;
    await svc.execute(1, 'r1', id, 'SELECT * FROM users', { timeoutMs: 1_000 });
    expect(looked).toEqual(['api.cloudflare.com']);
    expect(sent[sent.length - 1]).toMatchObject({ config: { engine: 'd1', servername: 'api.cloudflare.com', port: 443, d1: d1.d1, password: 'cf-token', readOnly: true } });
    const before = sent.length;
    expect(await svc.execute(1, 'r2', id, 'PRAGMA table_list', { timeoutMs: 1_000 })).toMatchObject({ status: 'sql-error', fix: 'confirm-needed' });
    expect(sent.length).toBe(before);
    expect(await svc.applyEdits(id, { schema: 'main', name: 'users' }, { updates: [], deletes: [], inserts: [] })).toEqual({ ok: false, reason: 'read-only' });
  });

  it('asks for the D1 token again once the database id changes', async () => {
    const { svc, secrets } = service();
    const saved = await svc.save({ ...d1, readOnly: false }, undefined, 'cf-token');
    const id = (saved as { connection: { id: string } }).connection.id;
    await svc.save({ ...d1, readOnly: false, d1: { ...d1.d1!, databaseId: '0f0e0d0c-1111-2222-3333-999999999999' } }, id, undefined);
    expect(await secrets.get(`db.${id}`)).toBeNull();
  });
});

describe('libSQL over plain HTTP', () => {
  const local: SqlConnectionDraft = { name: 'sqld', engine: 'libsql', host: 'db.example.com', port: 8080, ssl: { mode: 'disable' }, readOnly: false, passwordMode: 'keychain' };

  it('sends a token over plain HTTP only to a private or local address', async () => {
    const publicHost = service(() => ({ columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false }), { lookupAddress: '93.184.216.34' });
    const saved = await publicHost.svc.save(local, undefined, 'token');
    const id = (saved as { connection: { id: string } }).connection.id;
    expect(await publicHost.svc.execute(1, 'r1', id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'blocked-target', fix: 'blocked-host' });
    expect(publicHost.sent.some((body) => body.type === 'execute')).toBe(false);
    const test = await publicHost.svc.test({ draft: local, password: 'token' });
    expect(test.steps.at(-1)).toMatchObject({ id: 'policy', status: 'failed' });

    const privateHost = service(() => ({ columns: [], rows: [], rowCount: 0, tooLarge: false, rowCountIsLowerBound: false, hasMore: false }), { lookupAddress: '10.0.4.12' });
    const kept = await privateHost.svc.save(local, undefined, 'token');
    expect(await privateHost.svc.execute(1, 'r1', (kept as { connection: { id: string } }).connection.id, 'SELECT 1', { timeoutMs: 1_000 })).toMatchObject({ status: 'success' });
  });
});

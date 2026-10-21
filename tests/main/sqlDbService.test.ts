import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SecretStore } from '../../src/main/secretStore';
import { createConnectionCatalog } from '../../src/main/sqlConnectionCatalog';
import { createSqlDbService } from '../../src/main/sqlDbService';
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

function service(respond?: (body: Record<string, unknown>) => unknown) {
  const secrets = memorySecrets();
  const { host, sent } = fakeHost(respond);
  const catalogPath = path.join(dir, 'sql-connections.json');
  const svc = createSqlDbService({
    catalog: createConnectionCatalog(catalogPath),
    secrets,
    host,
    tier: async () => tier,
    blockedPath: (file) => (file.startsWith('/protected/') ? 'lingua-data' : null),
    lookup: async () => [{ address: '10.0.4.12', family: 4 }],
  });
  return { svc, secrets, host, sent, catalogPath };
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
    expect(sent.filter((body) => body.type === 'estimate')).toHaveLength(1);
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

  it('names the step that failed and the fix', async () => {
    const { svc } = service(() => {
      throw new SqlHostError({ message: 'self-signed certificate in certificate chain', step: 'tls', fix: 'tls-untrusted' });
    });
    const result = await svc.test({ draft: pg, password: 'pw' });
    expect(result.ok).toBe(false);
    expect(result.steps.at(-1)).toMatchObject({ id: 'tls', status: 'failed', fix: 'tls-untrusted' });
  });
});

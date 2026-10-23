import { describe, expect, it } from 'vitest';
import {
  asNeonDraft,
  connectionTarget,
  httpEndpoint,
  parseConnection,
  parseConnectionDraft,
  parseConnectionUrl,
  sameSshTarget,
  withoutUrlPassword,
} from '../../src/shared/sqlConnections';
import { dbConnectionCeilingForTier, withinDbConnectionBudget } from '../../src/shared/entitlements';

const pg = {
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

describe('parseConnectionUrl', () => {
  it('fills a Postgres draft from a pasted URL and keeps the password apart', () => {
    const parsed = parseConnectionUrl('postgres://app:p%40ss@db.internal:5433/orders?sslmode=require');
    expect(parsed).toEqual({
      draft: {
        name: 'orders',
        engine: 'postgres',
        host: 'db.internal',
        port: 5433,
        database: 'orders',
        user: 'app',
        ssl: { mode: 'require' },
        readOnly: false,
        passwordMode: 'keychain',
      },
      password: 'p@ss',
    });
  });

  it('reads MySQL ssl-mode names, IPv6 hosts and default ports', () => {
    const parsed = parseConnectionUrl('mysql://root@[::1]/billing?ssl-mode=VERIFY_IDENTITY');
    expect(parsed).toMatchObject({ draft: { engine: 'mysql', host: '::1', port: 3306, ssl: { mode: 'verify-full' }, passwordMode: 'none' } });
    expect('password' in parsed).toBe(false);
  });

  it('defaults SSL to verify-full and takes sqlite: absolute paths', () => {
    expect(parseConnectionUrl('postgresql://h/db')).toMatchObject({ draft: { ssl: { mode: 'verify-full' } } });
    expect(parseConnectionUrl('sqlite:///Users/me/app.db')).toEqual({
      draft: { name: 'app.db', engine: 'sqlite', path: '/Users/me/app.db', readOnly: false, passwordMode: 'none' },
    });
    expect(parseConnectionUrl('sqlite:C:\\data\\app.db')).toMatchObject({ draft: { path: 'C:\\data\\app.db' } });
  });

  it('reads SQL Server URLs in both forms, with encrypt and trustServerCertificate as the SSL mode', () => {
    expect(parseConnectionUrl('mssql://sa:pw@sql.internal/sales?encrypt=true&trustServerCertificate=true')).toEqual({
      draft: { name: 'sales', engine: 'sqlserver', host: 'sql.internal', port: 1433, database: 'sales', user: 'sa', ssl: { mode: 'require' }, readOnly: false, passwordMode: 'keychain' },
      password: 'pw',
    });
    expect(parseConnectionUrl('sqlserver://sql.internal:14330;database=sales;user=app;password=p;w=1;encrypt=false')).toEqual({
      draft: { name: 'sales', engine: 'sqlserver', host: 'sql.internal', port: 14330, database: 'sales', user: 'app', ssl: { mode: 'disable' }, readOnly: false, passwordMode: 'keychain' },
      password: 'p',
    });
    expect(parseConnectionUrl('sqlserver://sql.internal;initial catalog=hr')).toMatchObject({ draft: { database: 'hr', ssl: { mode: 'verify-full' }, passwordMode: 'none' } });
    expect(parseConnectionUrl('sqlserver://sql.internal;database={my;db};password={pa;ss}}w}')).toMatchObject({ draft: { database: 'my;db', name: 'my;db' }, password: 'pa;ss}w' });
    expect(parseConnectionUrl('sqlserver://sql.internal;password={unclosed')).toEqual({ error: 'invalid-url' });
    expect(parseConnectionUrl('sqlserver://;database=x')).toEqual({ error: 'missing-host' });
  });

  it('reads ClickHouse URLs, taking port 8123 without an SSL hint as plain HTTP', () => {
    expect(parseConnectionUrl('clickhouse://default@ch.internal/analytics')).toMatchObject({ draft: { engine: 'clickhouse', port: 8443, ssl: { mode: 'verify-full' } } });
    expect(parseConnectionUrl('clickhouse://default@localhost:8123/analytics')).toMatchObject({ draft: { port: 8123, ssl: { mode: 'disable' } } });
    expect(parseConnectionUrl('clickhouse://default@ch.internal/analytics?secure=false')).toMatchObject({ draft: { port: 8123, ssl: { mode: 'disable' } } });
    expect(parseConnectionUrl('clickhouse://default@ch.internal:8123/analytics?ssl=true')).toMatchObject({ draft: { port: 8123, ssl: { mode: 'require' } } });
  });

  it('names what is wrong without echoing the URL', () => {
    expect(parseConnectionUrl('sqlite:app.db')).toEqual({ error: 'relative-path' });
    expect(parseConnectionUrl('mongodb://x')).toEqual({ error: 'unsupported-scheme' });
    expect(parseConnectionUrl('postgres://:secret@/db')).toEqual({ error: 'invalid-url' });
    expect(parseConnectionUrl('postgres:///db')).toEqual({ error: 'missing-host' });
  });
});

describe('parseConnectionDraft', () => {
  it('rebuilds the draft and drops unknown keys, including a password', () => {
    const draft = parseConnectionDraft({ ...pg, password: 'hunter2', extra: 1 });
    expect(draft).toEqual(pg);
    expect(JSON.stringify(draft)).not.toContain('hunter2');
  });

  it('rejects bad hosts, ports, relative SQLite paths and a SQLite password mode', () => {
    expect(parseConnectionDraft({ ...pg, host: 'db internal' })).toBeNull();
    expect(parseConnectionDraft({ ...pg, host: 'user@db' })).toBeNull();
    // Network shares and device paths would make the OS authenticate to another machine.
    for (const path of ['\\\\server\\share\\app.db', '\\\\?\\C:\\app.db', '//server/share/app.db']) {
      expect(parseConnectionDraft({ name: 'f', engine: 'sqlite', path, readOnly: true, passwordMode: 'none' })).toBeNull();
      expect(parseConnectionDraft({ ...pg, ssl: { mode: 'verify-full', caPath: path } })).toBeNull();
    }
    expect(parseConnectionUrl('sqlite://server/share/app.db')).toEqual({ error: 'relative-path' });
    expect(parseConnectionDraft({ name: 'f', engine: 'sqlite', path: 'C:\\data\\app.db', readOnly: true, passwordMode: 'none' })).not.toBeNull();
    expect(parseConnectionDraft({ ...pg, port: 70_000 })).toBeNull();
    expect(parseConnectionDraft({ ...pg, ssl: { mode: 'verify-full', caPath: 'ca.pem' } })).toBeNull();
    expect(parseConnectionDraft({ name: 'f', engine: 'sqlite', path: 'app.db', readOnly: false, passwordMode: 'none' })).toBeNull();
    expect(parseConnectionDraft({ name: 'f', engine: 'sqlite', path: '/a.db', readOnly: false, passwordMode: 'keychain' })).toBeNull();
  });

  it('takes an SSH tunnel with jump hosts and the per-connection safety switches', () => {
    const ssh = {
      host: 'bastion.example.net',
      user: 'deploy',
      auth: 'key',
      keyPath: '/Users/me/.ssh/id_ed25519',
      secretMode: 'session',
      jumps: [{ host: 'jump.example.net', port: 2222, user: 'deploy' }],
    };
    expect(parseConnectionDraft({ ...pg, ssh, confirmWrites: true, allowPrivateHost: false })).toEqual({
      ...pg,
      ssh: { ...ssh, port: 22 },
      confirmWrites: true,
      allowPrivateHost: false,
    });
    // Defaults stay off the stored draft.
    expect(parseConnectionDraft({ ...pg, confirmWrites: false, allowPrivateHost: true })).toEqual(pg);
  });

  it('refuses an SSH tunnel whose auth and secret do not fit together', () => {
    const base = { host: 'bastion', user: 'deploy', port: 22 };
    for (const ssh of [
      { ...base, auth: 'key', secretMode: 'none' },
      { ...base, auth: 'password', secretMode: 'none' },
      { ...base, auth: 'agent', secretMode: 'keychain' },
      { ...base, auth: 'password', secretMode: 'session', jumps: [{ host: 'jump', user: 'u' }] },
      { ...base, auth: 'agent', secretMode: 'none', jumps: Array.from({ length: 4 }, () => ({ host: 'jump', user: 'u' })) },
      { ...base, auth: 'agent', secretMode: 'none', jumps: [{ host: 'jump', user: '' }] },
      { ...base, host: 'user@bastion', auth: 'agent', secretMode: 'none' },
      { ...base, auth: 'key', keyPath: 'id_rsa', secretMode: 'none' },
      { ...base, port: 0, auth: 'agent', secretMode: 'none' },
    ]) {
      expect(parseConnectionDraft({ ...pg, ssh })).toBeNull();
    }
    expect(parseConnectionDraft({ ...pg, confirmWrites: 'yes' })).toBeNull();
    expect(parseConnectionDraft({ ...pg, ssh: { ...base, auth: 'agent', secretMode: 'none' } })).toMatchObject({ ssh: { auth: 'agent' } });
  });

  it('parses a stored connection only with a safe id', () => {
    const stored = { version: 1, id: 'c_1', ...pg, createdAt: 'a', updatedAt: 'b' };
    expect(parseConnection(stored)).toMatchObject({ id: 'c_1', host: 'db.internal' });
    expect(parseConnection({ ...stored, id: '../x' })).toBeNull();
  });

  it('defaults a ClickHouse port to the one its TLS setting listens on', () => {
    const base = { name: 'ch', engine: 'clickhouse', host: 'ch.internal', readOnly: false, passwordMode: 'none' };
    expect(parseConnectionDraft(base)).toMatchObject({ port: 8443 });
    expect(parseConnectionDraft({ ...base, ssl: { mode: 'disable' } })).toMatchObject({ port: 8123 });
    expect(parseConnectionDraft({ ...base, engine: 'sqlserver' })).toMatchObject({ port: 1433 });
    expect(parseConnectionDraft({ ...base, engine: 'oracle' })).toBeNull();
  });

  it('labels a target without the user', () => {
    expect(connectionTarget({ engine: 'postgres', host: 'db', port: 5432, database: 'orders' })).toBe('db/orders');
    expect(connectionTarget({ engine: 'mysql', host: 'db', port: 3307 })).toBe('db:3307');
  });
});

describe('saved connection quota', () => {
  it('allows three on Free and any number on paid tiers', () => {
    expect(dbConnectionCeilingForTier('free')).toBe(3);
    expect(withinDbConnectionBudget('free', 3)).toBe(true);
    expect(withinDbConnectionBudget('free', 4)).toBe(false);
    expect(withinDbConnectionBudget('pro', 400)).toBe(true);
  });
});

describe('withoutUrlPassword', () => {
  it('drops the password and keeps the user, host and options', () => {
    expect(withoutUrlPassword('sqlserver://sql:1433;database=erp;password=S3;cret;user=app')).toBe('sqlserver://sql:1433;database=erp;user=app');
    expect(withoutUrlPassword('mssql://sql;Pwd=S3cret;encrypt=true')).toBe('mssql://sql;encrypt=true');
    // A braced value keeps its semicolons and doubled braces; an unclosed one keeps nothing after the host.
    expect(withoutUrlPassword('sqlserver://sql:1433;user=app;password={pa;ss}}w;rd};encrypt=true')).toBe('sqlserver://sql:1433;user=app;encrypt=true');
    expect(withoutUrlPassword('sqlserver://sql:1433;database=erp;password={pa;ss')).toBe('sqlserver://sql:1433');
    expect(withoutUrlPassword('postgres://app:s3cr:et@db:5432/orders?sslmode=disable')).toBe('postgres://app@db:5432/orders?sslmode=disable');
    expect(withoutUrlPassword('  mysql://root:pw@127.0.0.1/billing')).toBe('mysql://root@127.0.0.1/billing');
  });

  it('splits at the same @ as the URL parser when the password holds one', () => {
    const raw = 'postgres://app:p@ss@db.internal:5432/orders';
    expect(parseConnectionUrl(raw)).toMatchObject({ password: 'p@ss', draft: { host: 'db.internal' } });
    const shown = withoutUrlPassword(raw);
    expect(shown).toBe('postgres://app@db.internal:5432/orders');
    expect(shown).not.toContain('ss');
  });

  it('leaves a URL without a password as it was', () => {
    expect(withoutUrlPassword('postgres://app@db/orders')).toBe('postgres://app@db/orders');
    expect(withoutUrlPassword('sqlite:/tmp/a@b.db')).toBe('sqlite:/tmp/a@b.db');
    expect(withoutUrlPassword('postgres://db/orders?user=a@b')).toBe('postgres://db/orders?user=a@b');
  });
});

describe('sameSshTarget', () => {
  const ssh = { host: 'bastion', port: 22, user: 'deploy', auth: 'key' as const, keyPath: '/k', secretMode: 'keychain' as const, jumps: [{ host: 'jump', port: 22, user: 'deploy' }] };

  it('matches the same tunnel and nothing else', () => {
    expect(sameSshTarget(undefined, undefined)).toBe(true);
    expect(sameSshTarget(ssh, { ...ssh, secretMode: 'session' })).toBe(true);
    expect(sameSshTarget(ssh, undefined)).toBe(false);
    for (const change of [{ host: 'other' }, { port: 2222 }, { user: 'root' }, { auth: 'agent' as const }, { keyPath: '/other' }, { jumps: [] }, { jumps: [{ host: 'jump', port: 22, user: 'root' }] }]) {
      expect(sameSshTarget(ssh, { ...ssh, ...change }), JSON.stringify(change)).toBe(false);
    }
  });
});

describe('HTTP engines', () => {
  const token = 'eyJ.token.sig';

  it('reads a Turso libsql:// URL with its token as the password, and tls=0 as a local server', () => {
    expect(parseConnectionUrl(`libsql://orders-acme.turso.io?authToken=${token}`)).toEqual({
      draft: { name: 'orders-acme', engine: 'libsql', host: 'orders-acme.turso.io', port: 443, ssl: { mode: 'verify-full' }, readOnly: false, passwordMode: 'keychain' },
      password: token,
    });
    expect(parseConnectionUrl('libsql://127.0.0.1?tls=0')).toMatchObject({ draft: { host: '127.0.0.1', port: 8080, ssl: { mode: 'disable' }, passwordMode: 'none' } });
    expect(withoutUrlPassword(`libsql://orders-acme.turso.io?authToken=${token}&tls=1`)).toBe('libsql://orders-acme.turso.io?tls=1');
  });

  it('keeps libSQL to TLS on or off, with no database, user or tunnel', () => {
    const parsed = parseConnectionDraft({
      name: 'turso',
      engine: 'libsql',
      host: 'db.turso.io',
      database: 'x',
      user: 'y',
      ssl: { mode: 'verify-ca', caPath: '/ca.pem' },
      ssh: { host: 'bastion', port: 22, user: 'me', auth: 'agent', secretMode: 'none' },
      readOnly: false,
      passwordMode: 'keychain',
    });
    expect(parsed).toEqual({ name: 'turso', engine: 'libsql', host: 'db.turso.io', port: 443, ssl: { mode: 'verify-full' }, readOnly: false, passwordMode: 'keychain' });
  });

  it('takes Neon only on neon.tech, always over HTTPS on 443, and maps a pasted Postgres URL to it', () => {
    const neon = { name: 'shop', engine: 'neon', host: 'ep-cool-1.us-east-2.aws.neon.tech', port: 5432, database: 'shop', user: 'app', readOnly: false, passwordMode: 'keychain' };
    expect(parseConnectionDraft(neon)).toMatchObject({ port: 443, ssl: { mode: 'verify-full' } });
    expect(parseConnectionDraft({ ...neon, host: 'db.example.com' })).toBeNull();
    expect(parseConnectionDraft({ ...neon, host: 'evil.neon.tech.example.com' })).toBeNull();
    const pasted = parseConnectionUrl('postgresql://app:pw@ep-cool-1-pooler.us-east-2.aws.neon.tech/shop?sslmode=require');
    if ('error' in pasted) throw new Error(pasted.error);
    expect(asNeonDraft(pasted.draft)).toMatchObject({ engine: 'neon', host: 'ep-cool-1-pooler.us-east-2.aws.neon.tech', port: 443, database: 'shop', user: 'app' });
    expect(asNeonDraft({ ...pasted.draft, host: 'db.internal' })).toBeNull();
  });

  it('takes D1 by its account and database ids, which must be the ids Cloudflare prints, and a token', () => {
    const d1 = { name: 'edge', engine: 'd1', d1: { accountId: 'A'.repeat(32), databaseId: '0F0E0D0C-1111-2222-3333-444455556666' }, readOnly: true, passwordMode: 'keychain' };
    expect(parseConnectionDraft(d1)).toEqual({ ...d1, d1: { accountId: 'a'.repeat(32), databaseId: '0f0e0d0c-1111-2222-3333-444455556666' } });
    expect(parseConnectionDraft({ ...d1, d1: { ...d1.d1, accountId: '../../zones' } })).toBeNull();
    expect(parseConnectionDraft({ ...d1, d1: { ...d1.d1, databaseId: 'not-a-uuid' } })).toBeNull();
    expect(parseConnectionDraft({ ...d1, passwordMode: 'none' })).toBeNull();
    expect(connectionTarget(parseConnectionDraft(d1)!)).toBe('D1 0f0e0d0c-1111-2222-3333-444455556666');
  });

  it('names the host main resolves: Neon\'s API host, Cloudflare\'s for D1 and the server for libSQL', () => {
    expect(httpEndpoint({ engine: 'neon', host: 'ep-cool-1.us-east-2.aws.neon.tech' })).toEqual({ host: 'api.us-east-2.aws.neon.tech', port: 443, tls: true });
    expect(httpEndpoint({ engine: 'd1' })).toEqual({ host: 'api.cloudflare.com', port: 443, tls: true });
    expect(httpEndpoint({ engine: 'libsql', host: '127.0.0.1', port: 8080, ssl: { mode: 'disable' } })).toEqual({ host: '127.0.0.1', port: 8080, tls: false });
    expect(httpEndpoint({ engine: 'postgres', host: 'db' })).toBeNull();
  });
});

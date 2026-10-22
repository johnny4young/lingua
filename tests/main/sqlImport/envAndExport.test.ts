import { describe, expect, it } from 'vitest';
import { envCandidates } from '../../../src/main/sqlImport/envFile';
import { exportText, linguaCandidates } from '../../../src/main/sqlImport/linguaExport';
import type { SqlConnectionV1 } from '../../../src/shared/sqlConnections';

describe('.env import', () => {
  it('reads database URL keys, drops their passwords and marks production', () => {
    const text = [
      '# comment',
      'DATABASE_URL="postgres://app:s3cret@db.internal:5433/orders?sslmode=require"',
      'export ANALYTICS_DB_URL=mysql://reader@stats.internal/stats # trailing',
      'REDIS_URL=redis://cache:6379',
      "SHADOW_DATABASE_URL='${DATABASE_URL}_shadow'",
      'API_KEY=postgres://not-a-db-key',
    ].join('\n');
    const { found, skipped } = envCandidates(text, '.env.production');
    expect(skipped).toBe(1);
    expect(found.map((candidate) => candidate.origin)).toEqual(['DATABASE_URL · .env.production', 'ANALYTICS_DB_URL · .env.production']);
    expect(found[0]!.draft).toMatchObject({ engine: 'postgres', host: 'db.internal', port: 5433, database: 'orders', user: 'app', ssl: { mode: 'require' }, env: 'prod', readOnly: true, passwordMode: 'keychain' });
    expect(found[1]!.draft).toMatchObject({ engine: 'mysql', host: 'stats.internal', user: 'reader', passwordMode: 'none' });
    expect(JSON.stringify(found)).not.toContain('s3cret');
  });

  it('stays linear on long lines and keys, and reads Prisma and Heroku keys', () => {
    const started = performance.now();
    const hostile = [`DATABASE_URL=${' '.repeat(300_000)}x`, `${'A_'.repeat(100_000)}=1`, `DB_URL="${'#'.repeat(300_000)}`].join('\n');
    expect(envCandidates(hostile, '.env')).toEqual({ found: [], skipped: 0 });
    expect(performance.now() - started).toBeLessThan(1_000);
    const keys = ['DIRECT_URL', 'POSTGRES_URL_NON_POOLING', 'HEROKU_POSTGRESQL_RED_URL', 'PG_URI'].map((key) => `${key}=postgres://db/a`).join('\n');
    expect(envCandidates(keys, '.env').found.map((candidate) => candidate.origin)).toEqual(['DIRECT_URL · .env', 'POSTGRES_URL_NON_POOLING · .env', 'HEROKU_POSTGRESQL_RED_URL · .env', 'PG_URI · .env']);
  });

  it('names the environment from the file and leaves it unset for a plain .env', () => {
    expect(envCandidates('DATABASE_URL=postgres://db/a', '.env.development').found[0]!.draft.env).toBe('dev');
    expect(envCandidates('DATABASE_URL=postgres://db/a', '.env.staging').found[0]!.draft.env).toBe('staging');
    expect(envCandidates('DATABASE_URL=postgres://db/a', '.env').found[0]!.draft.env).toBeUndefined();
  });
});

describe('Lingua export', () => {
  const saved: SqlConnectionV1 = {
    version: 1,
    id: 'c_1',
    name: 'orders',
    engine: 'postgres',
    host: 'db.internal',
    port: 5432,
    user: 'app',
    ssl: { mode: 'verify-full' },
    readOnly: false,
    passwordMode: 'keychain',
    group: 'Ratfel',
    createdAt: '2026-10-22T00:00:00.000Z',
    updatedAt: '2026-10-22T00:00:00.000Z',
  };

  it('writes drafts without ids or timestamps and reads them back', () => {
    const text = exportText([saved], new Date('2026-10-22T12:00:00.000Z'));
    expect(text).not.toContain('c_1');
    expect(JSON.parse(text)).toMatchObject({ format: 'lingua.sql-connections', version: 1, exportedAt: '2026-10-22T12:00:00.000Z' });
    expect(linguaCandidates(text)).toEqual({ found: [{ draft: expect.objectContaining({ name: 'orders', group: 'Ratfel', host: 'db.internal' }) }], skipped: 0 });
  });

  it('refuses other JSON and leaves out entries that do not parse', () => {
    expect(linguaCandidates('{"connections": []}')).toBeNull();
    expect(linguaCandidates('not json')).toBeNull();
    expect(linguaCandidates(JSON.stringify({ format: 'lingua.sql-connections', connections: [{ name: 'x', engine: 'oracle' }] }))).toEqual({ found: [], skipped: 1 });
  });
});

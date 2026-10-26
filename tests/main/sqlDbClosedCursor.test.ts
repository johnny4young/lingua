import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSqlDbService } from '../../src/main/sqlDbService';
import { createConnectionCatalog } from '../../src/main/sqlConnectionCatalog';
import { createSqlHost } from '../../src/main/sqlHost/host';
import { openSqlite } from '../../src/main/sqlHost/sqlite';
import { SqlHostError, type SqlHostSupervisor } from '../../src/main/sqlHostSupervisor';
import type { HostRequest } from '../../src/main/sqlHost/protocol';
import type { SecretStore } from '../../src/main/secretStore';

let directory: string;
let disposeHost: () => Promise<void>;
let service: ReturnType<typeof createSqlDbService>;
let connectionId: string;

beforeEach(async () => {
  directory = mkdtempSync(path.join(tmpdir(), 'lingua-cursor-'));
  const file = path.join(directory, 'synthetic.sqlite');
  const database = new DatabaseSync(file);
  database.exec('CREATE TABLE fixture(id INTEGER PRIMARY KEY); WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<15000) INSERT INTO fixture SELECT x FROM n');
  database.close();
  const unexpected = async () => { throw new Error('Only the synthetic SQLite fixture is allowed'); };
  const host = createSqlHost({ sqlite: openSqlite, postgres: unexpected, mysql: unexpected, sqlserver: unexpected, clickhouse: unexpected, libsql: unexpected, neon: unexpected, d1: unexpected });
  disposeHost = () => host.dispose();
  let requestId = 0;
  const supervisor: SqlHostSupervisor = {
    async request<T>(body: Parameters<SqlHostSupervisor['request']>[0]): Promise<T> {
      const response = await host.handle({ id: ++requestId, ...body } as HostRequest);
      if (!response.ok) throw new SqlHostError(response.error);
      return response.result as T;
    },
    restart: () => { throw new Error('Unexpected restart in a cursor fixture'); },
    isRunning: () => true,
    dispose: () => { void host.dispose(); },
  };
  const catalog = createConnectionCatalog(path.join(directory, 'connections.json'));
  const saved = await catalog.save({ name: 'Synthetic read-only', engine: 'sqlite', path: file, readOnly: true, passwordMode: 'none' });
  if (!saved || typeof saved === 'string') throw new Error('Could not prepare synthetic connection');
  connectionId = saved.id;
  const secrets = { get: async () => null } as unknown as SecretStore;
  service = createSqlDbService({ catalog, secrets, host: supervisor, tier: async () => 'free', blockedPath: candidate => realpathSync(candidate) === realpathSync(file) ? null : 'fixture-only' });
});

afterEach(async () => { await disposeHost?.(); rmSync(directory, { recursive: true, force: true }); });

const openWindow = () => service.execute(1, 'window', connectionId, 'SELECT id FROM fixture ORDER BY id', { timeoutMs: 1000 });

describe('desktop SQL cursor ownership', () => {
  it('continues a live cursor for its owner', async () => {
    expect(await openWindow()).toMatchObject({ hasMore: true });
    const page = await service.fetch(1, 'window', 10, 1024);
    expect(page.rows).toHaveLength(10);
    expect(page.errorMessage).toBeUndefined();
  });

  it('reports an error when a newer run has invalidated the window', async () => {
    expect(await openWindow()).toMatchObject({ hasMore: true });
    expect(await service.execute(1, 'replacement', connectionId, 'SELECT 42 AS answer', { timeoutMs: 1000 })).toMatchObject({ status: 'success' });
    expect(await service.fetch(1, 'window', 10, 1024)).toMatchObject({ rows: [], done: true, errorMessage: expect.stringMatching(/closed|no longer available/i) });
  });

  it('reports an error after an explicit close instead of successful EOF', async () => {
    expect(await openWindow()).toMatchObject({ hasMore: true });
    await service.closeRun(1, 'window');
    expect(await service.fetch(1, 'window', 10, 1024)).toMatchObject({ rows: [], done: true, errorMessage: expect.stringMatching(/closed|no longer available/i) });
  });

  it('refuses an unknown owner without consuming the real owner\'s rows', async () => {
    expect(await openWindow()).toMatchObject({ hasMore: true });
    expect(await service.fetch(2, 'window', 10, 1024)).toMatchObject({ rows: [], done: true, errorMessage: expect.any(String) });
    const own = await service.fetch(1, 'window', 10, 1024);
    expect(own.rows).toHaveLength(10);
    expect(own.errorMessage).toBeUndefined();
  });
});

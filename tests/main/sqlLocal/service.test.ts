import { homedir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { withoutFolder } from '../../../src/main/sqlLocal/messages';
import { createSqlLocalService, nativeSqlEngineAvailable, type SqlLocalServiceDeps } from '../../../src/main/sqlLocal/service';
import { SqlHostError } from '../../../src/main/sqlHostSupervisor';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, utilityProcess: { fork: vi.fn() } }));
const { sqlLocalEnvironment } = await import('../../../src/main/sqlLocalProcess');

function fakeHost(answer: (body: Record<string, unknown>) => unknown) {
  const requests: Array<Record<string, unknown>> = [];
  let running = false;
  const host = {
    request: vi.fn(async (body: Record<string, unknown>) => {
      running = true;
      requests.push(body);
      return answer(body);
    }),
    restart: vi.fn(() => {
      running = false;
    }),
    isRunning: () => running,
    dispose: vi.fn(),
  };
  return { host: host as unknown as SqlLocalServiceDeps['host'], requests, restart: host.restart };
}

describe('native Local SQL service', () => {
  it('answers unavailable without starting a process when the build has no binding', async () => {
    const { host, requests } = fakeHost(() => null);
    const service = createSqlLocalService({ host, root: '/data/sql-local', available: () => false });
    expect(service.status()).toEqual({ available: false });
    expect(await service.open(1, false)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(requests).toEqual([]);
  });

  it('decides every path itself, one files and spill folder per window', async () => {
    const { host, requests } = fakeHost(body => (body.type === 'open' ? { engineId: 'e1', storageMode: 'opfs', version: 'v1.4.3', filesDir: 'x' } : null));
    const service = createSqlLocalService({ host, root: '/data/sql-local', available: () => true });
    await service.open(3, true);
    expect(requests[0]).toEqual({
      type: 'open',
      owner: 3,
      persist: true,
      paths: { database: path.join('/data/sql-local', 'lingua-sql.duckdb'), files: path.join('/data/sql-local', 'files', '3'), temp: path.join('/data/sql-local', 'tmp', '3') },
    });
    expect(service.status()).toEqual({ available: true, version: 'v1.4.3' });
  });

  it('restarts the process only for the window that opened the engine', async () => {
    const { host, restart } = fakeHost(body => (body.type === 'open' ? { engineId: `engine-${body.owner as number}`, storageMode: 'memory', version: 'v1.4.3', filesDir: 'x' } : null));
    const service = createSqlLocalService({ host, root: '/data/sql-local', available: () => true });
    await service.open(1, false);
    await service.open(2, false);
    expect(await service.terminate(2, 'engine-1', true)).toEqual({ ok: true, value: null });
    expect(restart).not.toHaveBeenCalled();
    await service.terminate(1, 'engine-1', true);
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it('keeps the home folder out of error messages', async () => {
    const { host } = fakeHost(() => {
      throw new SqlHostError({ message: `IO Error: Cannot open file "${path.join(homedir(), 'data.csv')}"` });
    });
    const service = createSqlLocalService({ host, root: '/data/sql-local', available: () => true });
    const reply = await service.query(1, 'c', 'SELECT 1');
    expect(reply).toEqual({ ok: false, error: { message: `IO Error: Cannot open file "~${path.sep}data.csv"` } });
  });

  it('resolves the binding without loading it', () => {
    const seen: string[] = [];
    expect(nativeSqlEngineAvailable(id => (seen.push(id), id))).toBe(true);
    expect(seen).toEqual(['@duckdb/node-api', `@duckdb/node-bindings-${process.platform}-${process.arch}/package.json`]);
    expect(
      nativeSqlEngineAvailable(() => {
        throw new Error('missing');
      })
    ).toBe(false);
  });
});

describe('Local SQL process environment', () => {
  it('passes only what the runtime needs and points HOME at Lingua’s folder', () => {
    const env = sqlLocalEnvironment({ PATH: '/bin', AWS_SECRET_ACCESS_KEY: 's', GITHUB_TOKEN: 't', OPENAI_API_KEY: 'k', HOME: '/Users/me', TZ: 'UTC', PGPASSWORD: 'p' }, '/data/sql-local/home');
    expect(env).toEqual({ PATH: '/bin', TZ: 'UTC', HOME: '/data/sql-local/home', USERPROFILE: '/data/sql-local/home' });
  });
});

describe('folder scrubbing', () => {
  it('removes a folder with either separator', () => {
    expect(withoutFolder('Cannot open "/a/b c/files/1/x.csv"', '/a/b c/files/1', '', true)).toBe('Cannot open "x.csv"');
    expect(withoutFolder('Cannot open "/a/b c/files/1\\x.csv"', '/a/b c/files/1', '', true)).toBe('Cannot open "x.csv"');
    expect(withoutFolder('home is /Users/me', '/Users/me', '~')).toBe('home is ~');
    expect(withoutFolder('a (b) [c]', '(b)', 'B')).toBe('a B [c]');
  });
});

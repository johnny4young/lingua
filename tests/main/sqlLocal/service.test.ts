import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withoutFolder } from '../../../src/main/sqlLocal/messages';
import { createSqlLocalService, nativeSqlEngineAvailable, type SqlLocalServiceDeps } from '../../../src/main/sqlLocal/service';
import { SqlHostError } from '../../../src/main/sqlHostSupervisor';

vi.mock('electron', () => ({ app: { getPath: () => '/tmp' }, utilityProcess: { fork: vi.fn() } }));
const { sqlLocalEnvironment } = await import('../../../src/main/sqlLocalProcess');

interface FakeHost {
  owner: number | null;
  requests: Array<Record<string, unknown>>;
  restart: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

/** One fake supervisor per window; `answer` sees each request with the host that got it. */
function fakeHosts(answer: (body: Record<string, unknown>, host: FakeHost) => unknown) {
  const hosts: FakeHost[] = [];
  const createHost = () => {
    let running = false;
    const fake: FakeHost = {
      owner: null,
      requests: [],
      restart: vi.fn(() => {
        running = false;
      }),
      dispose: vi.fn(async () => {
        running = false;
      }),
    };
    hosts.push(fake);
    return {
      request: vi.fn(async (body: Record<string, unknown>) => {
        running = true;
        if (typeof body.owner === 'number') fake.owner ??= body.owner;
        fake.requests.push(body);
        return answer(body, fake);
      }),
      restart: fake.restart,
      isRunning: () => running,
      dispose: fake.dispose,
    } as unknown as ReturnType<SqlLocalServiceDeps['createHost']>;
  };
  return { createHost, hosts, hostOf: (owner: number) => hosts.find(host => host.owner === owner)! };
}

const opened = (body: Record<string, unknown>, storageMode = 'memory') => ({ engineId: `engine-${body.owner as number}`, storageMode, version: 'v1.4.3', filesDir: 'x' });

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'lingua-sql-service-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('native Local SQL service', () => {
  it('answers unavailable without starting a process when the build has no binding', async () => {
    const { createHost, hosts } = fakeHosts(() => null);
    const service = createSqlLocalService({ createHost, root, available: () => false });
    expect(service.status()).toEqual({ available: false });
    expect(await service.open(1, false)).toMatchObject({ ok: false, error: { code: 'unavailable' } });
    expect(hosts).toEqual([]);
  });

  it('decides every path itself, one files and spill folder per window', async () => {
    const { createHost, hostOf } = fakeHosts(body => (body.type === 'open' ? opened(body, 'opfs') : null));
    const service = createSqlLocalService({ createHost, root, available: () => true });
    await service.open(3, true);
    expect(hostOf(3).requests[0]).toEqual({
      type: 'open',
      owner: 3,
      persist: true,
      paths: { database: path.join(root, 'lingua-sql.duckdb'), files: path.join(root, 'files', '3'), temp: path.join(root, 'tmp', '3') },
    });
    expect(service.status()).toEqual({ available: true, version: 'v1.4.3' });
  });

  it('runs each window in its own process and restarts only the caller’s', async () => {
    const { createHost, hosts, hostOf } = fakeHosts(body => (body.type === 'open' ? opened(body) : null));
    const service = createSqlLocalService({ createHost, root, available: () => true });
    await service.open(1, false);
    await service.open(2, false);
    await service.query(1, 'c', 'SELECT 1');
    expect(hosts).toHaveLength(2);
    expect(hostOf(1).requests.map(body => body.type)).toEqual(['open', 'query']);
    expect(await service.terminate(2, 'engine-1', true)).toEqual({ ok: true, value: null });
    expect(hostOf(1).restart).not.toHaveBeenCalled();
    await service.terminate(1, 'engine-1', true);
    expect(hostOf(1).restart).toHaveBeenCalledTimes(1);
    expect(hostOf(2).restart).not.toHaveBeenCalled();
  });

  it('gives the database file to one window at a time, across processes', async () => {
    const { createHost, hostOf } = fakeHosts(body => (body.type === 'open' ? opened(body, body.persist ? 'opfs' : 'memory') : null));
    const service = createSqlLocalService({ createHost, root, available: () => true });
    const [first, second] = await Promise.all([service.open(1, true), service.open(2, true)]);
    expect([first, second].map(reply => reply.ok && reply.value.storageMode)).toEqual(['opfs', 'memory']);
    expect(hostOf(2).requests[0]).toMatchObject({ persist: false });
    // The holder's process answers a clear, so the open file is never deleted under it.
    await service.clearDatabase();
    expect(hostOf(1).requests.at(-1)).toMatchObject({ type: 'clear-database' });
    // Once the holder lets go, the next window gets the file.
    await service.terminate(1, 'engine-1', false);
    expect(await service.open(2, true)).toMatchObject({ ok: true, value: { storageMode: 'opfs' } });
  });

  it('lets a released window’s process close its engine, stops it and removes its folders', async () => {
    const { createHost, hostOf, hosts } = fakeHosts(body => (body.type === 'open' ? opened(body) : null));
    const service = createSqlLocalService({ createHost, root, available: () => true });
    await service.open(4, false);
    await mkdir(path.join(root, 'files', '4'), { recursive: true });
    await mkdir(path.join(root, 'tmp', '4'), { recursive: true });
    service.releaseOwner(4);
    await service.open(4, false);
    expect(hostOf(4).requests.map(body => body.type)).toEqual(['open', 'dispose']);
    expect(hostOf(4).dispose).toHaveBeenCalledOnce();
    expect(hosts).toHaveLength(2);
    expect(hosts[1]!.requests.map(body => body.type)).toEqual(['open']);
    expect(existsSync(path.join(root, 'files', '4'))).toBe(false);
    expect(existsSync(path.join(root, 'tmp', '4'))).toBe(false);
  });

  it('removes every window’s leftover folders once when it starts', async () => {
    await mkdir(path.join(root, 'files', '9'), { recursive: true });
    await mkdir(path.join(root, 'tmp', '9'), { recursive: true });
    const { createHost } = fakeHosts(body => (body.type === 'open' ? opened(body) : null));
    const service = createSqlLocalService({ createHost, root, available: () => true });
    await service.open(1, false);
    expect(existsSync(path.join(root, 'files', '9'))).toBe(false);
    expect(existsSync(path.join(root, 'tmp', '9'))).toBe(false);
  });

  it('keeps the home folder out of error messages', async () => {
    const { createHost } = fakeHosts(() => {
      throw new SqlHostError({ message: `IO Error: Cannot open file "${path.join(homedir(), 'data.csv')}"` });
    });
    const service = createSqlLocalService({ createHost, root, available: () => true });
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

import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getPath: () => os.tmpdir() },
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

// No pid: killProcessTree falls back to child.kill, so no real group is signalled.
function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn(() => true);
  return child;
}

const euro = Buffer.from('€', 'utf8');

let workdir = '';

beforeEach(async () => {
  vi.resetModules();
  workdir = await mkdtemp(path.join(os.tmpdir(), 'lingua-install-lifecycle-'));
});

afterEach(async () => {
  await rm(workdir, { recursive: true, force: true });
});

describe('native dependency install lifecycle', () => {
  it('is killed by quit disposal while running and released after close', async () => {
    const { installNativeDependencies } = await import('../../src/main/nativeDependencyInstall');
    const { disposeNativeRuns } = await import('../../src/main/runners/nativeRunLifecycle');
    const child = createChild();
    const pending = installNativeDependencies({
      language: 'go',
      specifiers: ['github.com/gin-gonic/gin'],
      cwd: workdir,
      skipManifestCheck: true,
      spawnImpl: vi.fn(() => child) as never,
      platform: 'linux',
    });

    disposeNativeRuns();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');

    child.stdout.emit('data', euro.subarray(0, 1));
    child.stdout.emit('data', euro.subarray(1));
    child.emit('close', 0);
    await expect(pending).resolves.toMatchObject({ stdout: '€' });
    child.kill.mockClear();
    disposeNativeRuns();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('launches Windows tools by absolute PATH entry and bundle.bat through COMSPEC', async () => {
    const { installNativeDependencies } = await import('../../src/main/nativeDependencyInstall');
    await writeFile(path.join(workdir, 'go.exe'), '');
    await writeFile(path.join(workdir, 'bundle.bat'), '');
    const comspec = path.join(workdir, 'cmd.exe');
    const userEnv = { PATH: workdir, PATHEXT: '.COM;.EXE;.BAT;.CMD', COMSPEC: comspec };

    for (const [language, specifier, expected] of [
      ['go', 'github.com/gin-gonic/gin', [path.join(workdir, 'go.exe'), ['get', '--', 'github.com/gin-gonic/gin']]],
      ['ruby', 'rails', [comspec, ['/d', '/c', path.join(workdir, 'bundle.bat'), 'add', '--', 'rails']]],
    ] as const) {
      const child = createChild();
      const spawnImpl = vi.fn(() => child);
      const pending = installNativeDependencies({
        language,
        specifiers: [specifier],
        cwd: workdir,
        userEnv,
        skipManifestCheck: true,
        spawnImpl: spawnImpl as never,
        platform: 'win32',
      });
      await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1));
      expect((spawnImpl.mock.calls[0] as unknown[]).slice(0, 2)).toEqual(expected);
      child.emit('close', 0);
      await pending;
    }
  });

  it('reports a missing Windows tool instead of spawning a cwd-resolvable bare name', async () => {
    const { installNativeDependencies } = await import('../../src/main/nativeDependencyInstall');
    const spawnImpl = vi.fn();
    const result = await installNativeDependencies({
      language: 'rust',
      specifiers: ['serde'],
      cwd: workdir,
      userEnv: { PATH: workdir },
      skipManifestCheck: true,
      spawnImpl: spawnImpl as never,
      platform: 'win32',
    });
    expect(result.status).toBe('missing-binary');
    expect(spawnImpl).not.toHaveBeenCalled();
  });
});

describe('npm dependency install lifecycle', () => {
  it('is killed by quit disposal and decodes split UTF-8 log chunks', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const { installJsDependencyBatch, __resetActiveInstallsForTests } = await import(
      '../../src/main/dependencies'
    );
    const { disposeNativeRuns } = await import('../../src/main/runners/nativeRunLifecycle');
    const child = createChild();
    const spawnImpl = vi.fn(() => child);
    const logs: string[] = [];
    const pending = installJsDependencyBatch({
      runId: 'lifecycle-npm',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnImpl as never,
      platform: 'linux',
      onLog: (_stream, chunk) => logs.push(chunk),
    });
    await vi.waitFor(() => expect(spawnImpl).toHaveBeenCalledTimes(1));

    child.stdout.emit('data', euro.subarray(0, 2));
    child.stdout.emit('data', euro.subarray(2));
    disposeNativeRuns();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    child.emit('close', null, 'SIGKILL');
    await expect(pending).resolves.toMatchObject({ outcome: 'cancelled' });
    expect(logs.join('')).toBe('€');
    __resetActiveInstallsForTests();
  });
});

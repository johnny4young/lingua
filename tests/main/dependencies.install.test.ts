/**
 * RL-025 Slice B — main-side install spawn safety + outcome mapping.
 *
 * Pins:
 *   - Platform-safe launcher: direct `npm` on POSIX and explicit
 *     `cmd.exe /d /c npm.cmd` on Windows, always with shell:false.
 *   - Safe argv shape (no -g, no --prefix, --no-audit / --no-fund /
 *     --no-progress wired).
 *   - Specifier validation (invalid names never reach npm).
 *   - Unsaved tab refusal (no filePath → `no-package-json` failure
 *     without ever spawning).
 *   - Missing package.json refusal (fold A).
 *   - Pre-flight integrity check (fold C — already-installed names
 *     short-circuit without spawning).
 *   - Exit-code mapping (0 → success, non-zero → failed with
 *     exit-nonzero, ENOENT → binary-missing).
 *   - Cancel path (SIGTERM kill + `cancelled` outcome).
 *   - Streamed log onLog callback receives stdout / stderr chunks.
 */

import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getPath: vi.fn(() => '/tmp/lingua-install-test'),
}));

vi.mock('electron', () => ({
  app: { getPath: mocks.getPath },
}));

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

describe('installJsDependencyBatch', () => {
  let workdir = '';

  beforeEach(async () => {
    vi.resetModules();
    workdir = await mkdtemp(path.join(os.tmpdir(), 'lingua-install-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    await rm(workdir, { recursive: true, force: true });
    const { __resetActiveInstallsForTests } = await import(
      '../../src/main/dependencies'
    );
    __resetActiveInstallsForTests();
  });

  it('refuses an unsaved tab without spawning (no filePath)', async () => {
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const spawnSpy = vi.fn();
    const result = await installJsDependencyBatch({
      runId: 'r1',
      filePath: '',
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('no-package-json');
    expect(result.statuses.lodash).toBe('failed');
  });

  it('refuses every specifier that fails npm-name validation', async () => {
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const spawnSpy = vi.fn();
    const result = await installJsDependencyBatch({
      runId: 'r2',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['../../etc/passwd', '/abs', '.relative'],
      spawnImpl: spawnSpy as never,
    });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('invalid-specifier');
    expect(Object.keys(result.statuses)).toEqual([]);
  });

  it('refuses without spawning when the cwd has no package.json (fold A)', async () => {
    await mkdir(path.join(workdir, 'node_modules'), { recursive: true });
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const spawnSpy = vi.fn();
    const result = await installJsDependencyBatch({
      runId: 'r3',
      filePath: path.join(workdir, 'loose.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('no-package-json');
  });

  it('short-circuits already-installed names without spawning (fold C)', async () => {
    await mkdir(path.join(workdir, 'node_modules', 'lodash'), {
      recursive: true,
    });
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const spawnSpy = vi.fn();
    const result = await installJsDependencyBatch({
      runId: 'r4',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('success');
    expect(result.statuses.lodash).toBe('skipped-preflight');
  });

  it('spawns npm directly on POSIX with shell:false and the locked argv shape', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const promise = installJsDependencyBatch({
      runId: 'r5',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash', '@scope/pkg'],
      spawnImpl: spawnSpy as never,
      platform: 'linux',
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    const [bin, argv, opts] = spawnSpy.mock.calls[0]!;
    expect(bin).toBe('npm');
    expect(argv).toEqual([
      'install',
      'lodash',
      '@scope/pkg',
      '--no-audit',
      '--no-fund',
      '--no-progress',
      '--save',
    ]);
    // Closed shape: no global flags, no --prefix, shell:false.
    expect(argv).not.toContain('-g');
    expect(argv).not.toContain('--global');
    expect(argv).not.toContain('--prefix');
    const options = opts as { shell?: boolean; cwd?: string };
    expect(options.shell).toBe(false);
    expect(options.cwd).toBe(workdir);

    child.emit('close', 0);
    const result = await promise;
    expect(result.outcome).toBe('success');
    expect(result.statuses.lodash).toBe('installed');
    expect(result.statuses['@scope/pkg']).toBe('installed');
  });

  it('spawns npm.cmd through an explicit command interpreter on Windows', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    // A trusted launcher directory on PATH — the launcher must resolve to an
    // ABSOLUTE path from here, never to an unqualified name cmd.exe would
    // look up in the untrusted project cwd first (CWE-427).
    const npmHome = path.join(workdir, 'npm-home');
    await mkdir(npmHome, { recursive: true });
    await writeFile(path.join(npmHome, 'npm.cmd'), '@echo off\r\n');
    const comspec = path.join(workdir, 'cmd.exe');
    vi.stubEnv('COMSPEC', comspec);
    vi.stubEnv('PATH', npmHome);
    vi.stubEnv('PATHEXT', '.COM;.EXE;.BAT;.CMD');
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const promise = installJsDependencyBatch({
      runId: 'r5-win32',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash', '@scope/pkg'],
      spawnImpl: spawnSpy as never,
      platform: 'win32',
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));

    const [bin, argv, opts] = spawnSpy.mock.calls[0]!;
    expect(bin).toBe(comspec);
    expect(argv).toEqual([
      '/d',
      '/c',
      path.join(npmHome, 'npm.cmd'),
      'install',
      'lodash',
      '@scope/pkg',
      '--no-audit',
      '--no-fund',
      '--no-progress',
      '--save',
    ]);
    const options = opts as {
      shell?: boolean;
      env?: NodeJS.ProcessEnv;
      windowsHide?: boolean;
    };
    expect(options.shell).toBe(false);
    expect(options.windowsHide).toBe(true);
    expect(options.env).toMatchObject({
      COMSPEC: comspec,
      PATH: npmHome,
      PATHEXT: '.COM;.EXE;.BAT;.CMD',
      // Defense in depth: cmd.exe must skip cwd for any unqualified name
      // npm's own children resolve.
      NoDefaultCurrentDirectoryInExePath: '1',
    });

    child.emit('close', 0);
    expect((await promise).outcome).toBe('success');
  });

  it('fails with binary-missing instead of spawning when npm.cmd is not on the allowlisted PATH', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    vi.stubEnv('COMSPEC', path.join(workdir, 'cmd.exe'));
    // PATH points at a real directory that has no npm.cmd; the launcher must
    // NOT fall back to an unqualified npm.cmd (cwd-resolvable) name.
    vi.stubEnv('PATH', workdir);
    const spawnSpy = vi.fn();
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = await installJsDependencyBatch({
      runId: 'r5-win32-no-npm',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
      platform: 'win32',
    });

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('binary-missing');
    expect(result.statuses.lodash).toBe('failed');
  });

  it('fails with binary-missing instead of guessing cmd.exe when COMSPEC is absent', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const npmHome = path.join(workdir, 'npm-home');
    await mkdir(npmHome, { recursive: true });
    await writeFile(path.join(npmHome, 'npm.cmd'), '@echo off\r\n');
    vi.stubEnv('COMSPEC', '');
    vi.stubEnv('PATH', npmHome);
    const spawnSpy = vi.fn();
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = await installJsDependencyBatch({
      runId: 'r5-win32-no-comspec',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
      platform: 'win32',
    });

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('binary-missing');
  });

  it('rejects relative COMSPEC and PATH entries instead of resolving them from cwd', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    await writeFile(path.join(workdir, 'npm.cmd'), '@echo off\r\n');
    vi.stubEnv('COMSPEC', 'cmd.exe');
    vi.stubEnv('PATH', '.');
    const spawnSpy = vi.fn();
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const result = await installJsDependencyBatch({
      runId: 'r5-win32-relative-launchers',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
      platform: 'win32',
    });

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('binary-missing');
  });

  it('maps a non-zero exit to a failed outcome with exit-nonzero reason', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const promise = installJsDependencyBatch({
      runId: 'r6',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    child.stderr.emit('data', Buffer.from('npm ERR! network ETIMEDOUT\n'));
    child.emit('close', 1);
    const result = await promise;
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('exit-nonzero');
    expect(result.statuses.lodash).toBe('failed');
    expect(result.exitCode).toBe(1);
  });

  it('keeps the SIGKILL escalation alive after a timeout resolves', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    vi.useFakeTimers();
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const promise = installJsDependencyBatch({
      runId: 'timeout-1',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
    const result = await promise;
    expect(result.outcome).toBe('timed-out');
    expect(result.failureReason).toBe('timeout');
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');

    await vi.advanceTimersByTimeAsync(200);
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('refuses to reuse an active runId without spawning a second npm process', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const firstChild = createChild();
    const spawnSpy = vi.fn(() => firstChild as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const first = installJsDependencyBatch({
      runId: 'dup-run',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));

    const second = await installJsDependencyBatch({
      runId: 'dup-run',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['date-fns'],
      spawnImpl: spawnSpy as never,
    });
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    expect(second.outcome).toBe('failed');
    expect(second.failureReason).toBe('unknown');
    expect(second.statuses['date-fns']).toBe('failed');

    firstChild.emit('close', 0);
    await first;
  });

  it('maps an ENOENT spawn error to binary-missing', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const promise = installJsDependencyBatch({
      runId: 'r7',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    const err = Object.assign(new Error('spawn npm ENOENT'), {
      code: 'ENOENT',
    });
    child.emit('error', err);
    const result = await promise;
    expect(result.outcome).toBe('failed');
    expect(result.failureReason).toBe('binary-missing');
  });

  it('caps onLog volume after the log cap is reached', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const cap = 1024 * 1024;
    const logs: Array<{ stream: string; chunk: string }> = [];
    const promise = installJsDependencyBatch({
      runId: 'cap-1',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      onLog: (stream, chunk) => logs.push({ stream, chunk }),
      spawnImpl: spawnSpy as never,
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    // First chunk exceeds the cap; second chunk arrives after the
    // truncation marker has fired. The second must NOT reach onLog.
    child.stdout.emit('data', Buffer.from('x'.repeat(cap + 1024)));
    child.stdout.emit('data', Buffer.from('post-truncation tail\n'));
    child.emit('close', 0);
    await promise;
    const stdoutBytes = logs
      .filter((entry) => entry.stream === 'stdout')
      .reduce((sum, entry) => sum + entry.chunk.length, 0);
    expect(stdoutBytes).toBeLessThanOrEqual(cap + 64);
    expect(
      logs.some((entry) => entry.chunk.includes('[output truncated]'))
    ).toBe(true);
    expect(
      logs.some((entry) => entry.chunk.includes('post-truncation tail'))
    ).toBe(false);
  });

  it('streams stdout / stderr chunks to the onLog callback', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const { installJsDependencyBatch } = await import(
      '../../src/main/dependencies'
    );
    const logs: Array<{ stream: string; chunk: string }> = [];
    const promise = installJsDependencyBatch({
      runId: 'r8',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      onLog: (stream, chunk) => logs.push({ stream, chunk }),
      spawnImpl: spawnSpy as never,
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    child.stdout.emit('data', Buffer.from('added 1 package\n'));
    child.stderr.emit('data', Buffer.from('npm notice ok\n'));
    child.emit('close', 0);
    await promise;
    expect(logs).toEqual([
      { stream: 'stdout', chunk: 'added 1 package\n' },
      { stream: 'stderr', chunk: 'npm notice ok\n' },
    ]);
  });

  it('cancels an active install via cancelJsDependencyInstall', async () => {
    await writeFile(path.join(workdir, 'package.json'), '{}');
    const child = createChild();
    const spawnSpy = vi.fn(() => child as never);
    const {
      installJsDependencyBatch,
      cancelJsDependencyInstall,
    } = await import('../../src/main/dependencies');
    const promise = installJsDependencyBatch({
      runId: 'r9',
      filePath: path.join(workdir, 'app.js'),
      specifiers: ['lodash'],
      spawnImpl: spawnSpy as never,
    });
    await vi.waitFor(() => expect(spawnSpy).toHaveBeenCalledTimes(1));
    const cancelled = cancelJsDependencyInstall('r9');
    expect(cancelled).toBe(true);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    child.emit('close', null, 'SIGTERM');
    const result = await promise;
    expect(result.outcome).toBe('cancelled');
    expect(result.failureReason).toBe('cancelled');
  });
});

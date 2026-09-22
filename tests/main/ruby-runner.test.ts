import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import * as fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, unknown>();
  const execFileAsync = vi.fn();
  const execFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsync,
  });
  return {
    handlers,
    execFile,
    execFileAsync,
    spawn: vi.fn(),
    writeFile: vi.fn(),
    getPath: vi.fn(() => '/tmp/lingua-ruby-test'),
    probeSignals: [] as AbortSignal[],
  };
});

vi.mock('../../src/main/runners/spawnNativeRun', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/main/runners/spawnNativeRun')>();
  const { mockNativeVersionProbe } = await import('../utils/mockNativeVersionProbe');
  return {
    ...actual,
    spawnNativeRun: mockNativeVersionProbe(
      actual.spawnNativeRun,
      (command, args, options) => mocks.execFileAsync(command, args, options),
      signal => {
        if (signal) mocks.probeSignals.push(signal);
      }
    ),
  };
});

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const mocked = { ...actual, writeFile: (...args: Parameters<typeof actual.writeFile>) => mocks.writeFile(...args) };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    getPath: mocks.getPath,
  },
  ipcMain: {
    handle: (channel: string, handler: unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('node:child_process', () => ({
  default: {
    execFile: mocks.execFile,
    spawn: mocks.spawn,
  },
  execFile: mocks.execFile,
  spawn: mocks.spawn,
}));

type RubyRunHandler = (
  event: unknown,
  source: unknown,
  options?: unknown
) => Promise<RubyRunResult>;
type RubyStopHandler = (
  event: unknown,
  runId?: unknown
) => Promise<{ stopped: boolean }>;

function handlerFor<T>(channel: string): T {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`Missing handler for ${channel}`);
  return handler as T;
}

function createChildProcess() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { resume: ReturnType<typeof vi.fn> };
    stderr: EventEmitter & { resume: ReturnType<typeof vi.fn> };
    stdin: {
      // `on` mirrors the runtime contract: the runner attaches a stdin
      // 'error' listener (async EPIPE guard) before writing.
      on: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      end: ReturnType<typeof vi.fn>;
    };
    kill: ReturnType<typeof vi.fn>;
    pid?: number;
  };
  // `resume` mirrors the runtime contract: the shared spawn engine hands
  // a stream past the output cap to `resume()` so the pipe drains without
  // accumulating (internal discard-after-truncation).
  child.stdout = Object.assign(new EventEmitter(), { resume: vi.fn() });
  child.stderr = Object.assign(new EventEmitter(), { resume: vi.fn() });
  child.stdin = {
    on: vi.fn(),
    write: vi.fn(),
    end: vi.fn(),
  };
  child.kill = vi.fn(() => true);
  return child;
}

describe('main ruby runner', () => {
  let tempRoot: string;

  beforeEach(async () => {
    vi.resetModules();
    mocks.handlers.clear();
    const actualFs = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    mocks.writeFile.mockReset().mockImplementation(actualFs.writeFile);
    mocks.execFile.mockReset();
    mocks.execFileAsync.mockReset();
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'ruby 3.3.6 (2024-11-05 revision 75015a4f5e) [arm64-darwin23]\n',
      stderr: '',
    });
    mocks.probeSignals.length = 0;
    mocks.spawn.mockReset();
    mocks.getPath.mockReturnValue('/tmp/lingua-ruby-test');
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-ruby-runner-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('owns Stop before runtime detection completes and never spawns cancelled source', async () => {
    mocks.spawn.mockImplementation(() => { throw new Error('Unexpected child spawn'); });
    let completeDetection!: (value: { stdout: string; stderr: string }) => void;
    mocks.execFileAsync.mockImplementationOnce(() => new Promise(resolve => {
      completeDetection = resolve;
    }));
    const { registerRubyHandlers } = await import('../../src/main/ruby-runner');
    registerRubyHandlers();
    const run = handlerFor<RubyRunHandler>('ruby:run');
    const stop = handlerFor<RubyStopHandler>('ruby:stop');
    const pending = run({}, 'console.log("cancelled")', { runId: 'preparing' });
    await vi.waitFor(() => expect(completeDetection).toBeTypeOf('function'));
    const stopped = await stop({}, 'preparing');
    expect(mocks.probeSignals).toHaveLength(1);
    expect(mocks.probeSignals[0]?.aborted).toBe(true);
    completeDetection({ stdout: 'ruby 3.3.6\n', stderr: '' });
    const result = await pending;
    expect(stopped).toEqual({ stopped: true });
    expect(result.kind).toBe('stopped');
    expect(mocks.spawn).not.toHaveBeenCalled();
    await expect(stop({}, 'preparing')).resolves.toEqual({ stopped: false });
  });

  it.each([false, true])('cleans cancelled staging and preserves the next Stop owner (write fails: %s)', async (fails) => {
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    const { writeFile: realWrite } = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
    let stagedPath: string | undefined;
    const write = mocks.writeFile.mockImplementationOnce(async (...args: Parameters<typeof realWrite>) => {
      stagedPath = String(args[0]);
      await held;
      if (fails) throw new Error('staging failed');
      await realWrite(...args);
    });
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);
    try {
      const { registerRubyHandlers } = await import('../../src/main/ruby-runner');
      registerRubyHandlers();
      const run = handlerFor<RubyRunHandler>('ruby:run');
      const stop = handlerFor<RubyStopHandler>('ruby:stop');
      const old = run({}, `/*${'x'.repeat(5000)}*/`, { runId: 'staging' });
      await vi.waitFor(() => expect(stagedPath).toBeTypeOf('string'));
      await expect(stop({}, 'staging')).resolves.toEqual({ stopped: true });
      const current = run({}, 'setInterval(() => {}, 1000)', { runId: 'current' });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      release();
      await expect(old).resolves.toMatchObject({ kind: 'stopped' });
      expect(mocks.spawn).toHaveBeenCalledTimes(1);
      await expect(fsPromises.access(path.dirname(stagedPath!))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(stop({}, 'current')).resolves.toEqual({ stopped: true });
      child.emit('close', null);
      await expect(current).resolves.toMatchObject({ kind: 'stopped' });
    } finally {
      release();
      child.emit('close', null);
      write.mockImplementation(realWrite);
    }
  });

  it('rejects reuse of an in-flight identity without replacing its Stop owner', async () => {
    const child = createChildProcess();
    mocks.spawn.mockReturnValue(child);
    const { registerRubyHandlers } = await import('../../src/main/ruby-runner');
    registerRubyHandlers();
    const run = handlerFor<RubyRunHandler>('ruby:run');
    const stop = handlerFor<RubyStopHandler>('ruby:stop');
    const first = run({}, 'setInterval(() => {}, 1000)', { runId: 'owned' });
    await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
    // Settle an accidental duplicate spawn as well, so the failing regression
    // does not leave a timeout/child listener behind.
    mocks.spawn.mockImplementation(() => {
      queueMicrotask(() => child.emit('close', 0));
      return child;
    });
    const duplicate = await run({}, 'console.log("duplicate")', { runId: 'owned' });
    const stopped = await stop({}, 'owned');
    child.emit('close', null);
    const result = await first;
    expect(duplicate.kind).toBe('error');
    expect(stopped).toEqual({ stopped: true });
    expect(result.kind).toBe('stopped');
    expect(mocks.spawn).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------------
  // implementation note — parseRubyVersion shape parser
  // ----------------------------------------------------------------

  describe('parseRubyVersion (implementation note)', () => {
    it('extracts semver + platform from the canonical macOS line', async () => {
      const { parseRubyVersion } = await import('../../src/main/ruby-runner');
      expect(
        parseRubyVersion(
          'ruby 3.3.6 (2024-11-05 revision 75015a4f5e) [arm64-darwin23]'
        )
      ).toEqual({ semver: '3.3.6', platform: 'arm64-darwin23' });
    });

    it('handles patchlevel suffixes (3.2.2p53)', async () => {
      const { parseRubyVersion } = await import('../../src/main/ruby-runner');
      // The semver parser intentionally stops at the third dotted
      // component; patchlevel suffixes do not pollute the displayed
      // version. Platform still picks up the bracket suffix.
      expect(
        parseRubyVersion(
          'ruby 3.2.2p53 (2023-03-30 revision e51014f9c0) [x86_64-linux]'
        )
      ).toEqual({ semver: '3.2.2', platform: 'x86_64-linux' });
    });

    it('returns empty object when both shapes fail to parse', async () => {
      const { parseRubyVersion } = await import('../../src/main/ruby-runner');
      expect(parseRubyVersion('some other tool 1.0')).toEqual({});
    });

    it('returns the platform alone when semver is unparseable', async () => {
      const { parseRubyVersion } = await import('../../src/main/ruby-runner');
      expect(parseRubyVersion('ruby head [arm64-darwin23]')).toEqual({
        platform: 'arm64-darwin23',
      });
    });
  });

  // ----------------------------------------------------------------
  // detectRuby
  // ----------------------------------------------------------------

  describe('detectRuby', () => {
    it('returns installed + parsed semver/platform on success', async () => {
      const { detectRuby, __resetRubyDetectCache } = await import('../../src/main/ruby-runner');
      __resetRubyDetectCache();
      const result = await detectRuby();
      expect(result.installed).toBe(true);
      expect(result.version).toContain('ruby 3.3.6');
      expect(result.semver).toBe('3.3.6');
      expect(result.platform).toBe('arm64-darwin23');
    });

    it('returns installed=false with an actionable error when ruby is missing', async () => {
      const { detectRuby, __resetRubyDetectCache } = await import('../../src/main/ruby-runner');
      __resetRubyDetectCache();
      mocks.execFileAsync.mockRejectedValueOnce(new Error('ENOENT'));
      const result = await detectRuby();
      expect(result.installed).toBe(false);
      expect(result.error).toMatch(/Ruby is not installed/);
      expect(result.error).toContain('ruby-lang.org');
    });
  });

  // ----------------------------------------------------------------
  // implementation note — per-project .ruby-version honoring
  // ----------------------------------------------------------------

  describe('findRubyVersionFile (implementation note)', () => {
    it('walks up the tree to find the nearest .ruby-version', async () => {
      const project = path.join(tempRoot, 'project');
      const nested = path.join(project, 'lib', 'inner');
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(project, '.ruby-version'), '3.3.6\n', 'utf-8');
      const { findRubyVersionFile } = await import('../../src/main/ruby-runner');
      await expect(
        findRubyVersionFile(path.join(nested, 'main.rb'))
      ).resolves.toBe('3.3.6');
    });

    it('returns null for Scratchpad tabs (no filePath)', async () => {
      const { findRubyVersionFile } = await import('../../src/main/ruby-runner');
      await expect(findRubyVersionFile(undefined)).resolves.toBeNull();
    });

    it('rejects suspicious version strings containing path separators', async () => {
      const project = path.join(tempRoot, 'malicious');
      await mkdir(project, { recursive: true });
      await writeFile(
        path.join(project, '.ruby-version'),
        '../../../etc/passwd',
        'utf-8'
      );
      const { findRubyVersionFile } = await import('../../src/main/ruby-runner');
      await expect(
        findRubyVersionFile(path.join(project, 'main.rb'))
      ).resolves.toBeNull();
    });

    it('returns null when no .ruby-version anywhere up the tree', async () => {
      const project = path.join(tempRoot, 'empty');
      await mkdir(project, { recursive: true });
      const { findRubyVersionFile } = await import('../../src/main/ruby-runner');
      await expect(
        findRubyVersionFile(path.join(project, 'main.rb'))
      ).resolves.toBeNull();
    });
  });

  // ----------------------------------------------------------------
  // runRuby — happy path + caps + stop + error + missing-binary
  // ----------------------------------------------------------------

  describe('ruby:run handler', () => {
    async function loadRunner() {
      const mod = await import('../../src/main/ruby-runner');
      mod.registerRubyHandlers();
      mod.__resetRubyDetectCache();
      return mod;
    }

    it('returns success when the spawned ruby exits with code 0', async () => {
      await loadRunner();
      const child = createChildProcess();
      mocks.spawn.mockReturnValue(child);
      const handler = handlerFor<RubyRunHandler>('ruby:run');
      const promise = handler({}, 'puts "Hello, Ruby!"', { timeoutMs: 5000 });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      child.stdout.emit('data', Buffer.from('Hello, Ruby!\n'));
      child.emit('close', 0);
      const result = await promise;
      expect(result.kind).toBe('success');
      expect(result.stdout).toBe('Hello, Ruby!\n');
      expect(result.exitCode).toBe(0);
      expect(result.timeoutMs).toBe(5000);
    });

    it('implementation: streams live stdout/stderr chunks to the sender during interactive runs', async () => {
      await loadRunner();
      const child = createChildProcess();
      mocks.spawn.mockReturnValue(child);
      const sender = Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false), send: vi.fn() });
      const handler = handlerFor<RubyRunHandler>('ruby:run');
      const promise = handler({ sender }, 'STDIN.gets', {
        runId: 'ruby-stream',
        timeoutMs: 5000,
        interactive: true,
      });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      child.stdout.emit('data', Buffer.from('live-out'));
      child.stderr.emit('data', Buffer.from('live-err'));
      expect(sender.send).toHaveBeenCalledWith('runtime:output-chunk', {
        runId: 'ruby-stream',
        stream: 'stdout',
        chunk: 'live-out',
      });
      expect(sender.send).toHaveBeenCalledWith('runtime:output-chunk', {
        runId: 'ruby-stream',
        stream: 'stderr',
        chunk: 'live-err',
      });
      child.emit('close', 0);
      await expect(promise).resolves.toMatchObject({ kind: 'success' });
    });

    it('implementation: does not stream chunks for non-interactive runs', async () => {
      await loadRunner();
      const child = createChildProcess();
      mocks.spawn.mockReturnValue(child);
      const sender = Object.assign(new EventEmitter(), { isDestroyed: vi.fn(() => false), send: vi.fn() });
      const handler = handlerFor<RubyRunHandler>('ruby:run');
      const promise = handler({ sender }, 'puts 1', {
        runId: 'ruby-batch',
        timeoutMs: 5000,
      });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      child.stdout.emit('data', Buffer.from('batched'));
      child.emit('close', 0);
      await expect(promise).resolves.toMatchObject({ kind: 'success' });
      expect(sender.send).not.toHaveBeenCalled();
    });

    it('reports error kind for non-zero exit', async () => {
      await loadRunner();
      const child = createChildProcess();
      mocks.spawn.mockReturnValue(child);
      const handler = handlerFor<RubyRunHandler>('ruby:run');
      const promise = handler({}, 'raise "boom"', { timeoutMs: 5000 });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      child.stderr.emit('data', Buffer.from("boom (RuntimeError)\n"));
      child.emit('close', 1);
      const result = await promise;
      expect(result.kind).toBe('error');
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('RuntimeError');
      expect(result.error).toContain('RuntimeError');
    });

    it('caps oversized stdout/stderr at the 1 MiB limit', async () => {
      await loadRunner();
      const child = createChildProcess();
      mocks.spawn.mockReturnValue(child);
      const handler = handlerFor<RubyRunHandler>('ruby:run');
      const promise = handler({}, 'puts "x" * 2_000_000', { timeoutMs: 5000 });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      child.stdout.emit('data', Buffer.alloc(2 * 1024 * 1024, 'x'));
      child.emit('close', 0);
      const result = await promise;
      expect(result.stdout.length).toBeLessThan(2 * 1024 * 1024);
      expect(result.stdout).toContain('[stdout truncated]');
    });

    it('returns missing-binary when ruby is not installed', async () => {
      await loadRunner();
      mocks.execFileAsync.mockRejectedValueOnce(new Error('ENOENT'));
      const handler = handlerFor<RubyRunHandler>('ruby:run');
      const result = await handler({}, 'puts 1', { timeoutMs: 1000 });
      expect(result.kind).toBe('missing-binary');
      expect(result.error).toMatch(/Ruby is not installed/);
    });

    it('ruby:stop terminates the registered run by runId', async () => {
      await loadRunner();
      const child = createChildProcess();
      mocks.spawn.mockReturnValue(child);
      const runHandler = handlerFor<RubyRunHandler>('ruby:run');
      const stopHandler = handlerFor<RubyStopHandler>('ruby:stop');
      const runPromise = runHandler({}, 'sleep 10', {
        runId: 'run-1',
        timeoutMs: 30_000,
      });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      const stopResult = await stopHandler({}, 'run-1');
      expect(stopResult).toEqual({ stopped: true });
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      // Resolve the spawn naturally so the test exits.
      child.emit('close', null);
      const result = await runPromise;
      expect(result.kind).toBe('stopped');
    });

    it('parent timeout fires SIGTERM and resolves with timeout kind', async () => {
      await loadRunner();
      const child = createChildProcess();
      mocks.spawn.mockReturnValue(child);
      const handler = handlerFor<RubyRunHandler>('ruby:run');
      // Short real-timer timeout — the parent kill timer fires after
      // 100 ms (the clamp floor) so the test stays bounded without
      // needing fake timers (fake timers interact badly with
      // `await mkdtemp` because the fs/promises callbacks need the
      // real event loop).
      const runPromise = handler({}, 'loop { }', { timeoutMs: 100 });
      await vi.waitFor(() => expect(mocks.spawn).toHaveBeenCalledTimes(1));
      // Wait for the kill timer to elapse + microtasks to settle.
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(child.kill).toHaveBeenCalledWith('SIGTERM');
      child.emit('close', null);
      const result = await runPromise;
      expect(result.kind).toBe('timeout');
      expect(result.timeoutMs).toBe(100);
    });
  });
});

import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
    getPath: vi.fn(() => '/tmp/lingua-ruby-test'),
  };
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
    stdout: EventEmitter;
    stderr: EventEmitter;
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
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
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
    mocks.execFile.mockReset();
    mocks.execFileAsync.mockReset();
    mocks.execFileAsync.mockResolvedValue({
      stdout: 'ruby 3.3.6 (2024-11-05 revision 75015a4f5e) [arm64-darwin23]\n',
      stderr: '',
    });
    mocks.spawn.mockReset();
    mocks.getPath.mockReturnValue('/tmp/lingua-ruby-test');
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'lingua-ruby-runner-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  // ----------------------------------------------------------------
  // Fold A — parseRubyVersion shape parser
  // ----------------------------------------------------------------

  describe('parseRubyVersion (fold A)', () => {
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
  // Fold D — per-project .ruby-version honoring
  // ----------------------------------------------------------------

  describe('findRubyVersionFile (fold D)', () => {
    it('walks up the tree to find the nearest .ruby-version', async () => {
      const project = path.join(tempRoot, 'project');
      const nested = path.join(project, 'lib', 'inner');
      await mkdir(nested, { recursive: true });
      await writeFile(path.join(project, '.ruby-version'), '3.3.6\n', 'utf-8');
      const { findRubyVersionFile } = await import('../../src/main/ruby-runner');
      expect(findRubyVersionFile(path.join(nested, 'main.rb'))).toBe('3.3.6');
    });

    it('returns null for Scratchpad tabs (no filePath)', async () => {
      const { findRubyVersionFile } = await import('../../src/main/ruby-runner');
      expect(findRubyVersionFile(undefined)).toBeNull();
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
      expect(findRubyVersionFile(path.join(project, 'main.rb'))).toBeNull();
    });

    it('returns null when no .ruby-version anywhere up the tree', async () => {
      const project = path.join(tempRoot, 'empty');
      await mkdir(project, { recursive: true });
      const { findRubyVersionFile } = await import('../../src/main/ruby-runner');
      expect(findRubyVersionFile(path.join(project, 'main.rb'))).toBeNull();
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

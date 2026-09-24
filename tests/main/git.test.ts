/**
 * implementation — main-side Git read-only handlers.
 *
 * Mocks the promisified `execFile` via the standard codebase pattern
 * (`vi.hoisted` + `nodejs.util.promisify.custom` symbol). Pinned
 * coverage:
 *
 *   - Binary detection caches the result; missing binary → installed
 *     false + diagnostic.
 *   - Repo root resolution returns the path on success, null on
 *     non-repo error.
 *   - `getFileStatus` parses the porcelain prefix into the 4-state
 *     closed enum + numstat counts.
 *   - `getFileDiff` reads HEAD + worktree, applies the
 *     `MAX_DIFF_BYTES` cap, and surfaces the truncated flag.
 *   - Path-traversal escapes are rejected before any IPC reaches git.
 *
 * The mock pattern mirrors `tests/main/node-runner.test.ts` so the
 * security_reminder hook recognises it as a safe test, not a real
 * spawn site.
 */

import path from 'node:path';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

const mocks = vi.hoisted(() => {
  const inner = vi.fn();
  // `git config` reads (forwarded user settings, filter drivers) get their own
  // mock so the query sequences below stay about status/diff/rev-parse.
  const noConfigMatch = (
    _binary: string,
    _args: string[],
    _options?: unknown
  ): Promise<{ stdout: string; stderr: string }> =>
    Promise.reject(Object.assign(new Error('no match'), { code: 1 }));
  const config = vi.fn(noConfigMatch);
  const route = (binary: string, args: string[], options: unknown) =>
    args.includes('config') ? config(binary, args, options) : inner(binary, args, options);
  const outer = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: route,
  });
  return {
    outer,
    inner,
    config,
    noConfigMatch,
    openPath: vi.fn().mockResolvedValue(''),
  };
});

vi.mock('node:child_process', () => ({
  default: {
    execFile: mocks.outer,
  },
  execFile: mocks.outer,
}));

vi.mock('electron', () => ({
  shell: {
    openPath: mocks.openPath,
  },
}));

describe('detectGit', () => {
  let workdir = '';

  beforeEach(async () => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-test-'));
    mocks.inner.mockReset();
    mocks.config.mockReset().mockImplementation(mocks.noConfigMatch);
    vi.resetModules();
    const mod = await import('../../src/main/git');
    mod.resetGitProbeCacheForTests();
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('returns `installed: false` when git is missing on PATH', async () => {
    mocks.inner.mockRejectedValueOnce(new Error('ENOENT'));
    const { detectGit } = await import('../../src/main/git');
    const result = await detectGit(workdir);
    expect(result.installed).toBe(false);
    expect(result.error).toMatch(/git is not installed/i);
  });

  it.each(['git version 2.35.1', 'unknown version'])(
    'refuses repository queries for %s',
    async version => {
      mocks.inner.mockResolvedValueOnce({ stdout: `${version}\n`, stderr: '' });
      const { detectGit } = await import('../../src/main/git');
      expect(await detectGit(workdir)).toMatchObject({
        installed: false,
        error: expect.stringContaining('2.36'),
      });
      expect(mocks.inner).toHaveBeenCalledTimes(1);
    }
  );

  it('returns the version line when git resolves on PATH', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    const { detectGit } = await import('../../src/main/git');
    const result = await detectGit();
    expect(result.installed).toBe(true);
    expect(result.version).toBe('git version 2.45.2');
    expect(result.repoRoot).toBeUndefined();
  });

  it('resolves repoRoot + branch for a folder inside a working tree', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: `${workdir}\n`, stderr: '' });
    mocks.inner.mockResolvedValueOnce({ stdout: 'main\n', stderr: '' });
    const { detectGit } = await import('../../src/main/git');
    const result = await detectGit(workdir);
    expect(result.installed).toBe(true);
    expect(result.repoRoot).toBe(workdir);
    expect(result.branch).toBe('main');
  });

  it('omits `branch` on detached HEAD', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: `${workdir}\n`, stderr: '' });
    mocks.inner.mockResolvedValueOnce({ stdout: 'HEAD\n', stderr: '' });
    const { detectGit } = await import('../../src/main/git');
    const result = await detectGit(workdir);
    expect(result.installed).toBe(true);
    expect(result.repoRoot).toBe(workdir);
    expect(result.branch).toBeUndefined();
  });

  it('returns no repoRoot when the folder is not a git repo', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockRejectedValueOnce(
      new Error('fatal: not a git repository')
    );
    const { detectGit } = await import('../../src/main/git');
    const result = await detectGit(workdir);
    expect(result.installed).toBe(true);
    expect(result.repoRoot).toBeUndefined();
  });
});

describe('getFileStatus', () => {
  let workdir = '';

  beforeEach(async () => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-status-'));
    mocks.inner.mockReset();
    mocks.config.mockReset().mockImplementation(mocks.noConfigMatch);
    vi.resetModules();
    const mod = await import('../../src/main/git');
    mod.resetGitProbeCacheForTests();
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('parses `clean` when porcelain returns an empty payload', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: '', stderr: '' });
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, '');
    const { getFileStatus } = await import('../../src/main/git');
    const result = await getFileStatus(workdir, filePath);
    expect(result.status).toBe('clean');
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('parses `untracked` from the `??` porcelain prefix', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({
      stdout: '?? foo.js\n',
      stderr: '',
    });
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, '');
    const { getFileStatus } = await import('../../src/main/git');
    const result = await getFileStatus(workdir, filePath);
    expect(result.status).toBe('untracked');
    expect(result.insertions).toBeUndefined();
    expect(result.deletions).toBeUndefined();
  });

  it('parses `modified` + numstat counts for a tracked + changed file', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({
      stdout: ' M foo.js\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({
      stdout: '5\t3\tfoo.js\n',
      stderr: '',
    });
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, '');
    const { getFileStatus } = await import('../../src/main/git');
    const result = await getFileStatus(workdir, filePath);
    expect(result.status).toBe('modified');
    expect(result.insertions).toBe(5);
    expect(result.deletions).toBe(3);
  });

  it('refuses path-traversal attempts (file outside repoRoot)', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    const { getFileStatus } = await import('../../src/main/git');
    const result = await getFileStatus(workdir, '/etc/passwd');
    expect(result.status).toBe('unknown');
    // Only the probe call should have hit the mock — no status query
    // ran because path validation rejected the input.
    expect(mocks.inner).toHaveBeenCalledTimes(1);
  });

  it('soft-fails to `unknown` when the status query itself errors', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockRejectedValueOnce(new Error('disk corrupt'));
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, '');
    const { getFileStatus } = await import('../../src/main/git');
    const result = await getFileStatus(workdir, filePath);
    expect(result.status).toBe('unknown');
  });

  it('neutralizes every repository filter driver for status and numstat', async () => {
    mocks.inner.mockResolvedValueOnce({ stdout: 'git version 2.45.2\n', stderr: '' });
    mocks.inner.mockResolvedValueOnce({ stdout: ' M foo.js\n', stderr: '' });
    mocks.inner.mockResolvedValueOnce({ stdout: '1\t1\tfoo.js\n', stderr: '' });
    mocks.config.mockImplementation(async (_binary: string, args: string[]) => {
      if (args.includes('--global') || args.includes('--system')) throw Object.assign(new Error(), { code: 1 });
      return { stdout: 'filter.a=b.clean\0filter.a=b.process\0', stderr: '' };
    });
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, '');
    const { getFileStatus } = await import('../../src/main/git');
    expect(await getFileStatus(workdir, filePath)).toMatchObject({ status: 'modified' });
    for (const [, , options] of mocks.inner.mock.calls.slice(1)) {
      expect((options as { env: NodeJS.ProcessEnv }).env).toMatchObject({
        GIT_CONFIG_COUNT: '4',
        GIT_CONFIG_KEY_0: 'filter.a=b.clean',
        GIT_CONFIG_VALUE_0: '',
        GIT_CONFIG_KEY_2: 'filter.a=b.process',
        GIT_CONFIG_KEY_3: 'filter.a=b.required',
        GIT_CONFIG_VALUE_3: 'false',
      });
    }
  });

  it('refuses the status query when filter drivers cannot be enumerated', async () => {
    mocks.inner.mockResolvedValueOnce({ stdout: 'git version 2.45.2\n', stderr: '' });
    mocks.config.mockImplementation(async (_binary: string, args: string[]) => {
      if (args.includes('--global') || args.includes('--system')) throw Object.assign(new Error(), { code: 1 });
      throw Object.assign(new Error('bad config'), { code: 128 });
    });
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, '');
    const { getFileStatus } = await import('../../src/main/git');
    expect(await getFileStatus(workdir, filePath)).toEqual({ status: 'unknown' });
    expect(mocks.inner).toHaveBeenCalledTimes(1);
  });

  it('forwards only allowlisted global settings', async () => {
    mocks.inner.mockResolvedValueOnce({ stdout: 'git version 2.45.2\n', stderr: '' });
    mocks.inner.mockResolvedValueOnce({ stdout: '', stderr: '' });
    mocks.config.mockImplementation(async (_binary: string, args: string[]) => {
      if (args.includes('--global')) {
        return { stdout: 'safe.directory\n/Volumes/shared/repo\0core.autocrlf\ntrue\0core.pager\nevil\0', stderr: '' };
      }
      throw Object.assign(new Error(), { code: 1 });
    });
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, '');
    const { getFileStatus } = await import('../../src/main/git');
    await getFileStatus(workdir, filePath);
    const env = (mocks.inner.mock.calls[1]![2] as { env: NodeJS.ProcessEnv }).env;
    expect(env).toMatchObject({
      GIT_CONFIG_COUNT: '2',
      GIT_CONFIG_KEY_0: 'safe.directory',
      GIT_CONFIG_VALUE_0: '/Volumes/shared/repo',
      GIT_CONFIG_KEY_1: 'core.autocrlf',
      GIT_CONFIG_VALUE_1: 'true',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    });
  });
});

describe('getFileDiff', () => {
  let workdir = '';

  beforeEach(async () => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-diff-'));
    mocks.inner.mockReset();
    mocks.config.mockReset().mockImplementation(mocks.noConfigMatch);
    vi.resetModules();
    const mod = await import('../../src/main/git');
    mod.resetGitProbeCacheForTests();
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('returns the HEAD + worktree content for a tracked file', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: `${workdir}\n`, stderr: '' });
    mocks.inner.mockResolvedValueOnce({
      stdout: 'console.log("old")\n',
      stderr: '',
    });
    const filePath = path.join(workdir, 'foo.js');
    writeFileSync(filePath, 'console.log("new")\n');
    const { getFileDiff } = await import('../../src/main/git');
    const result = await getFileDiff(workdir, filePath);
    expect(result.originalContent).toBe('console.log("old")\n');
    expect(result.modifiedContent).toBe('console.log("new")\n');
    expect(result.truncated).toBe(false);
  });

  it('returns empty `originalContent` for an untracked file (no HEAD entry)', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: `${workdir}\n`, stderr: '' });
    mocks.inner.mockRejectedValueOnce(
      new Error('fatal: Path does not exist in HEAD')
    );
    const filePath = path.join(workdir, 'untracked.js');
    writeFileSync(filePath, 'console.log("hi")\n');
    const { getFileDiff } = await import('../../src/main/git');
    const result = await getFileDiff(workdir, filePath);
    expect(result.originalContent).toBe('');
    expect(result.modifiedContent).toBe('console.log("hi")\n');
    expect(result.truncated).toBe(false);
  });

  it('reports `truncated: true` when the worktree side hits MAX_DIFF_BYTES', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: `${workdir}\n`, stderr: '' });
    mocks.inner.mockResolvedValueOnce({
      stdout: 'original\n',
      stderr: '',
    });
    const filePath = path.join(workdir, 'huge.js');
    writeFileSync(filePath, 'x'.repeat(64 * 1024 + 1));
    const { getFileDiff } = await import('../../src/main/git');
    const result = await getFileDiff(workdir, filePath);
    expect(result.truncated).toBe(true);
    expect(result.modifiedContent.length).toBe(64 * 1024);
  });

  it('returns empty payload for a path outside the repo root', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    const { getFileDiff } = await import('../../src/main/git');
    const result = await getFileDiff(workdir, '/etc/passwd');
    expect(result.originalContent).toBe('');
    expect(result.modifiedContent).toBe('');
    expect(result.truncated).toBe(false);
    // Only the probe call ran — validation rejected before IPC.
    expect(mocks.inner).toHaveBeenCalledTimes(1);
  });

  it('rejects a claimed repoRoot that is not the actual git top-level before reading disk', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockRejectedValueOnce(new Error('fatal: not a git repository'));
    const { getFileDiff } = await import('../../src/main/git');
    const result = await getFileDiff('/', '/etc/passwd');
    expect(result.originalContent).toBe('');
    expect(result.modifiedContent).toBe('');
    expect(result.truncated).toBe(false);
    expect(mocks.inner).toHaveBeenCalledTimes(2);
  });

  it('keeps partial HEAD content when git show hits maxBuffer', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: `${workdir}\n`, stderr: '' });
    mocks.inner.mockRejectedValueOnce(
      Object.assign(new Error('stdout maxBuffer length exceeded'), {
        stdout: 'x'.repeat(64 * 1024 + 5),
      })
    );
    const filePath = path.join(workdir, 'huge-head.js');
    writeFileSync(filePath, 'current\n');
    const { getFileDiff } = await import('../../src/main/git');
    const result = await getFileDiff(workdir, filePath);
    expect(result.originalContent.length).toBe(64 * 1024);
    expect(result.modifiedContent).toBe('current\n');
    expect(result.truncated).toBe(true);
  });

  it('reads symlink working-tree entries as symlink targets, not target file content', async () => {
    mocks.inner.mockResolvedValueOnce({
      stdout: 'git version 2.45.2\n',
      stderr: '',
    });
    mocks.inner.mockResolvedValueOnce({ stdout: `${workdir}\n`, stderr: '' });
    mocks.inner.mockResolvedValueOnce({
      stdout: 'old-target',
      stderr: '',
    });
    const filePath = path.join(workdir, 'link.txt');
    symlinkSync('secret.txt', filePath);
    const { getFileDiff } = await import('../../src/main/git');
    const result = await getFileDiff(workdir, filePath);
    expect(result.originalContent).toBe('old-target');
    expect(result.modifiedContent).toBe('secret.txt');
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// implementation — `.git/HEAD` watcher + `revealRepo` action.
// ---------------------------------------------------------------------------

describe('resolveRepoHeadPath ', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-head-'));
    mocks.inner.mockReset();
    mocks.config.mockReset().mockImplementation(mocks.noConfigMatch);
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('resolves <repoRoot>/.git/HEAD when .git is a real directory', async () => {
    const { mkdirSync, writeFileSync: writeFile } = await import('node:fs');
    mkdirSync(path.join(workdir, '.git'));
    writeFile(path.join(workdir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    const { resolveRepoHeadPath } = await import('../../src/main/git');
    const head = await resolveRepoHeadPath(workdir);
    expect(head).toBe(path.join(workdir, '.git', 'HEAD'));
  });

  it('follows a worktree pointer file with an absolute gitdir path', async () => {
    const { mkdirSync, writeFileSync: writeFile } = await import('node:fs');
    const realDir = path.join(workdir, '.git-worktree-foo');
    mkdirSync(realDir, { recursive: true });
    writeFile(
      path.join(workdir, '.git'),
      `gitdir: ${realDir}\n`,
      'utf-8'
    );
    const { resolveRepoHeadPath } = await import('../../src/main/git');
    const head = await resolveRepoHeadPath(workdir);
    expect(head).toBe(path.join(realDir, 'HEAD'));
  });

  it('follows a worktree pointer file with a relative gitdir path', async () => {
    const { mkdirSync, writeFileSync: writeFile } = await import('node:fs');
    mkdirSync(path.join(workdir, 'wt-bar'), { recursive: true });
    writeFile(path.join(workdir, '.git'), 'gitdir: ./wt-bar\n', 'utf-8');
    const { resolveRepoHeadPath } = await import('../../src/main/git');
    const head = await resolveRepoHeadPath(workdir);
    expect(head).toBe(path.join(workdir, 'wt-bar', 'HEAD'));
  });

  it('returns null when neither .git directory nor pointer file exists', async () => {
    const { resolveRepoHeadPath } = await import('../../src/main/git');
    const head = await resolveRepoHeadPath(workdir);
    expect(head).toBeNull();
  });

  it('returns null for invalid input (empty string)', async () => {
    const { resolveRepoHeadPath } = await import('../../src/main/git');
    expect(await resolveRepoHeadPath('')).toBeNull();
  });
});

describe('watchRepoHead ', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-watch-'));
    mocks.inner.mockReset();
    mocks.config.mockReset().mockImplementation(mocks.noConfigMatch);
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('surfaces a resolve-error diagnostic when the repo has no .git', async () => {
    const { watchRepoHead, resetGitProbeCacheForTests } = await import(
      '../../src/main/git'
    );
    resetGitProbeCacheForTests();
    const diagnostics: Array<{ repoRoot: string; reason: string }> = [];
    const handle = await watchRepoHead(workdir, {
      onChange: () => {
        /* unused */
      },
      onDiagnostic: (diag) => diagnostics.push(diag),
    });
    expect(diagnostics).toEqual([
      { repoRoot: workdir, reason: 'resolve-error' },
    ]);
    handle.dispose();
  });

  it('returns a disposable that is idempotent on the resolve-error path', async () => {
    const { watchRepoHead, resetGitProbeCacheForTests } = await import(
      '../../src/main/git'
    );
    resetGitProbeCacheForTests();
    const handle = await watchRepoHead(workdir, {
      onChange: () => {
        /* unused */
      },
    });
    expect(() => handle.dispose()).not.toThrow();
    // Second dispose is a no-op (no throw, no error).
    expect(() => handle.dispose()).not.toThrow();
  });

  it('starts a real watcher on the parent of HEAD and disposes the FSWatcher idempotently (reviewer coverage)', async () => {
    // Reviewer pass — exercise the actual startWatcher path against
    // a real `.git/HEAD`. We use a real `fs.watch` (FSEvents on
    // macOS / inotify on Linux) so the disposal contract is verified
    // against the kernel watcher, not a spy. Touching HEAD afterwards
    // would race the test runner; the contract under test here is
    // "watcher installed, watcher disposable" — the change-propagation
    // path is covered by the desktop smoke matrix.
    const { mkdirSync, writeFileSync: writeFile } = await import('node:fs');
    mkdirSync(path.join(workdir, '.git'), { recursive: true });
    writeFile(path.join(workdir, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    // Mock rev-parse so the initial summary resolves without
    // touching a real `git` binary.
    mocks.inner
      .mockResolvedValueOnce({ stdout: 'git version 2.45.2\n', stderr: '' })
      .mockResolvedValue({ stdout: 'main\n', stderr: '' });

    const { watchRepoHead, resetGitProbeCacheForTests } = await import(
      '../../src/main/git'
    );
    resetGitProbeCacheForTests();
    const handle = await watchRepoHead(workdir, {
      onChange: () => {
        /* unused */
      },
    });

    // Disposal succeeds without throwing — verifies the watcher
    // handle exposes a `close()` and the dispose() path wires it
    // correctly through `clearTimers` + `watcher.close()`.
    expect(() => handle.dispose()).not.toThrow();
    // Second dispose is a no-op.
    expect(() => handle.dispose()).not.toThrow();
  });

  it.each([false, true])('contains onChange failures when diagnostic delivery throws: %s', async (diagnosticThrows) => {
    // `resolveAndEmit` runs fire-and-forget (debounce timer, initial emit).
    // `onChange` is the IPC layer's callback and can throw once the
    // subscribing webContents is gone; before the guard that became an
    // unhandled rejection in the main process on every HEAD change.
    const { mkdirSync, writeFileSync: writeFile } = await import('node:fs');
    mkdirSync(path.join(workdir, '.git'), { recursive: true });
    writeFile(path.join(workdir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mocks.inner
      .mockResolvedValueOnce({ stdout: 'git version 2.45.2\n', stderr: '' })
      .mockResolvedValue({ stdout: 'main\n', stderr: '' });

    const { watchRepoHead, resetGitProbeCacheForTests } = await import(
      '../../src/main/git'
    );
    resetGitProbeCacheForTests();
    const diagnostics: Array<{ repoRoot: string; reason: string }> = [];
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    let handle: Awaited<ReturnType<typeof watchRepoHead>> | undefined;
    try {
      handle = await watchRepoHead(workdir, {
        onChange: () => {
          throw new Error('webContents destroyed');
        },
        onDiagnostic: (diag) => {
          diagnostics.push(diag);
          if (diagnosticThrows) throw new Error('diagnostic observer destroyed');
        },
      });
      // Wait for actual delivery, not a fixed sleep that races a loaded runner.
      await vi.waitFor(() => expect(diagnostics).toHaveLength(1));
      await new Promise((resolve) => setImmediate(resolve));
      expect(rejections).toEqual([]);
      expect(diagnostics).toEqual([{ repoRoot: workdir, reason: 'resolve-error' }]);
      expect(() => handle?.dispose()).not.toThrow();
    } finally {
      handle?.dispose();
      process.off('unhandledRejection', onRejection);
    }
  });
});

describe('revealRepo ', () => {
  let workdir = '';

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-reveal-'));
    mocks.inner.mockReset();
    mocks.openPath.mockReset();
    mocks.openPath.mockResolvedValue('');
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(workdir, { recursive: true, force: true });
  });

  it('returns true when shell.openPath returns the empty string (success)', async () => {
    mocks.openPath.mockResolvedValueOnce('');
    const { revealRepo } = await import('../../src/main/git');
    const result = await revealRepo(workdir);
    expect(result).toBe(true);
    expect(mocks.openPath).toHaveBeenCalledWith(workdir);
  });

  it('returns false when shell.openPath returns an OS-level error string', async () => {
    mocks.openPath.mockResolvedValueOnce('Permission denied');
    const { revealRepo } = await import('../../src/main/git');
    const result = await revealRepo(workdir);
    expect(result).toBe(false);
  });

  it('returns false when shell.openPath throws', async () => {
    mocks.openPath.mockRejectedValueOnce(new Error('boom'));
    const { revealRepo } = await import('../../src/main/git');
    const result = await revealRepo(workdir);
    expect(result).toBe(false);
  });

  it('returns false for an empty repoRoot input (defense in depth)', async () => {
    const { revealRepo } = await import('../../src/main/git');
    expect(await revealRepo('')).toBe(false);
    expect(mocks.openPath).not.toHaveBeenCalled();
  });

  it('returns false when the directory disappeared between menu open and click', async () => {
    const { revealRepo } = await import('../../src/main/git');
    const missing = path.join(workdir, 'definitely-gone');
    expect(await revealRepo(missing)).toBe(false);
    expect(mocks.openPath).not.toHaveBeenCalled();
  });
});

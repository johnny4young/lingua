/**
 * RL-102 Slice 1 — main-side Git read-only handlers.
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
  const outer = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: inner,
  });
  return { outer, inner };
});

vi.mock('node:child_process', () => ({
  default: {
    execFile: mocks.outer,
  },
  execFile: mocks.outer,
}));

describe('detectGit', () => {
  let workdir = '';

  beforeEach(async () => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-test-'));
    mocks.inner.mockReset();
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
});

describe('getFileDiff', () => {
  let workdir = '';

  beforeEach(async () => {
    workdir = mkdtempSync(path.join(tmpdir(), 'lingua-git-diff-'));
    mocks.inner.mockReset();
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

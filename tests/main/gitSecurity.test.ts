import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ shell: { openPath: vi.fn() } }));
import {
  detectGit,
  getFileDiff,
  getFileStatus,
  resetGitProbeCacheForTests,
} from '../../src/main/git';

let root: string;
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
    },
  });

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), 'lingua-git-security-')));
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.name', 'Fixture');
  git(root, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(root, 'sample.txt'), 'before\n');
  git(root, 'add', '--', 'sample.txt');
  git(root, 'commit', '-m', 'fixture');
  resetGitProbeCacheForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('read-only Git trust boundary', () => {
  it('does not execute a repository fsmonitor when reading file status', async () => {
    git(root, 'config', 'core.fsmonitor', 'echo invoked > fsmonitor-marker');
    // Prove this configuration invokes a hook with ordinary Git, not merely
    // that a missing executable silently failed to write our marker.
    git(root, 'status', '--porcelain=v1', '--', 'sample.txt');
    expect(existsSync(path.join(root, 'fsmonitor-marker'))).toBe(true);
    rmSync(path.join(root, 'fsmonitor-marker'));
    writeFileSync(path.join(root, 'sample.txt'), 'after\n');
    expect(await getFileStatus(root, path.join(root, 'sample.txt'))).toMatchObject({
      status: 'modified',
    });
    expect(existsSync(path.join(root, 'fsmonitor-marker'))).toBe(false);
  });

  it('ignores inherited Git root redirection and config injection', async () => {
    const expectedRoot = git(root, 'rev-parse', '--show-toplevel').trim();
    vi.stubEnv('GIT_DIR', path.join(root, 'missing-repository'));
    vi.stubEnv('GIT_CONFIG_COUNT', '1');
    vi.stubEnv('GIT_CONFIG_KEY_0', 'core.fsmonitor');
    vi.stubEnv('GIT_CONFIG_VALUE_0', 'echo invoked > env-marker');
    expect(await detectGit(root)).toMatchObject({ installed: true, repoRoot: expectedRoot });
    expect(await getFileStatus(root, path.join(root, 'sample.txt'))).toMatchObject({
      status: 'clean',
    });
    expect(existsSync(path.join(root, 'env-marker'))).toBe(false);
  });

  it('reads original bytes without external diff or text conversion', async () => {
    writeFileSync(path.join(root, '.gitattributes'), '*.txt diff=untrusted\n');
    git(root, 'config', 'diff.untrusted.command', 'echo invoked > diff-marker');
    git(root, 'config', 'diff.untrusted.textconv', 'echo invoked > textconv-marker');
    writeFileSync(path.join(root, 'sample.txt'), 'after\n');
    expect(await getFileDiff(root, path.join(root, 'sample.txt'))).toMatchObject({
      originalContent: 'before\n',
      modifiedContent: 'after\n',
    });
    expect(await getFileStatus(root, path.join(root, 'sample.txt'))).toMatchObject({
      status: 'modified',
      insertions: 1,
      deletions: 1,
    });
    expect(existsSync(path.join(root, 'diff-marker'))).toBe(false);
    expect(existsSync(path.join(root, 'textconv-marker'))).toBe(false);
  });

  it('opens a legitimate submodule without inspecting its configuration from the parent', async () => {
    // Construct a real absorbed submodule without the shell-based submodule
    // add/clone orchestration (which can outlive its parent on Windows).
    // The trust boundary under test is opening its gitdir pointer and gitlink.
    const moduleRoot = path.join(root, 'module');
    const gitDir = path.join(root, '.git', 'modules', 'module');
    mkdirSync(path.dirname(gitDir), { recursive: true });
    git(root, 'init', '-b', 'main', '--separate-git-dir', gitDir, moduleRoot);
    writeFileSync(path.join(moduleRoot, 'child.txt'), 'child\n');
    git(moduleRoot, 'add', '--', 'child.txt');
    git(moduleRoot, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'fixture');
    git(root, 'config', '--file', '.gitmodules', 'submodule.module.path', 'module');
    git(root, 'config', '--file', '.gitmodules', 'submodule.module.url', './module');
    git(root, 'add', '--', '.gitmodules', 'module');
    expect(readFileSync(path.join(moduleRoot, '.git'), 'utf8')).toContain('gitdir:');
    expect(git(root, 'ls-files', '--stage', '--', 'module')).toMatch(/^160000 /);
    expect(git(moduleRoot, 'rev-parse', '--show-superproject-working-tree').trim())
      .toBe(git(root, 'rev-parse', '--show-toplevel').trim());
    git(moduleRoot, 'config', 'core.fsmonitor', 'echo invoked > child-marker');
    expect(await detectGit(moduleRoot)).toMatchObject({ installed: true, repoRoot: git(moduleRoot, 'rev-parse', '--show-toplevel').trim() });
    expect(await getFileStatus(moduleRoot, path.join(moduleRoot, 'child.txt'))).toMatchObject({ status: 'clean' });
    expect(existsSync(path.join(moduleRoot, 'child-marker'))).toBe(false);
  });

  it('resolves nested project directories and legitimate worktrees with external metadata', async () => {
    mkdirSync(path.join(root, 'nested'));
    expect(await detectGit(path.join(root, 'nested'))).toMatchObject({ repoRoot: git(root, 'rev-parse', '--show-toplevel').trim() });
    const worktree = path.join(root, 'linked');
    git(root, 'worktree', 'add', '-b', 'linked', worktree);
    expect(readFileSync(path.join(worktree, '.git'), 'utf8')).toContain('gitdir:');
    expect(await detectGit(worktree)).toMatchObject({
      installed: true,
      repoRoot: git(worktree, 'rev-parse', '--show-toplevel').trim(),
      branch: 'linked',
    });
    expect(await getFileStatus(worktree, path.join(worktree, 'sample.txt'))).toMatchObject({
      status: 'clean',
    });
  });
});

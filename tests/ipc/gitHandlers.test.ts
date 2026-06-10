/**
 * RL-102 hardening — approved-scope gate on the git IPC handlers.
 *
 * The git layer is the one IPC surface that receives raw absolute paths
 * (the repo toplevel can sit above any rootId capability). These tests pin
 * the gate added in src/main/ipc/git.ts: a repoRoot/folderPath that does
 * not intersect the user-approved scope (or that falls in the filesystem
 * denylist) must short-circuit to the inert fallback shape WITHOUT the
 * underlying git function ever running. The intersection logic itself is
 * exercised against the real approvals registry in fileSystem.test.ts
 * (`pathIntersectsApprovedScope`); here it is mocked so each branch of the
 * gate is isolated.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  detectGit: vi.fn(),
  getFileStatus: vi.fn(),
  getFileDiff: vi.fn(),
  revealRepo: vi.fn(),
  watchRepoHead: vi.fn(),
  pathIntersectsApprovedScope: vi.fn(),
  isPathBlocked: vi.fn(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mocks.handlers.set(channel, handler);
    },
  },
}));

vi.mock('../../src/main/git', () => ({
  detectGit: mocks.detectGit,
  getFileStatus: mocks.getFileStatus,
  getFileDiff: mocks.getFileDiff,
  revealRepo: mocks.revealRepo,
  watchRepoHead: mocks.watchRepoHead,
}));

vi.mock('../../src/main/ipc/fileSystem', () => ({
  pathIntersectsApprovedScope: mocks.pathIntersectsApprovedScope,
}));

vi.mock('../../src/main/ipc/permissions', () => ({
  isPathBlocked: mocks.isPathBlocked,
}));

import {
  registerGitHandlers,
  _resetGitHeadWatchersForTests,
} from '../../src/main/ipc/git';

const APPROVED = '/home/user/projects/app';
const UNAPPROVED = '/home/user/other-repo';

function handlerFor(channel: string): (...args: unknown[]) => unknown {
  const handler = mocks.handlers.get(channel);
  if (!handler) throw new Error(`No handler registered for ${channel}`);
  return handler;
}

function fakeSender() {
  return {
    sender: {
      id: 7,
      isDestroyed: () => false,
      send: vi.fn(),
      once: vi.fn(),
    },
  };
}

beforeEach(() => {
  mocks.handlers.clear();
  _resetGitHeadWatchersForTests();
  mocks.detectGit.mockReset();
  mocks.getFileStatus.mockReset();
  mocks.getFileDiff.mockReset();
  mocks.revealRepo.mockReset();
  mocks.watchRepoHead.mockReset();
  mocks.pathIntersectsApprovedScope.mockReset();
  mocks.isPathBlocked.mockReset();
  // Default: nothing blocked, approval decided per-test.
  mocks.isPathBlocked.mockReturnValue(false);
  mocks.pathIntersectsApprovedScope.mockImplementation(
    async (candidate: string) => candidate === APPROVED
  );
  registerGitHandlers();
});

describe('git IPC approved-scope gate', () => {
  it('git:status short-circuits to unknown for an unapproved repoRoot', async () => {
    const status = handlerFor('git:status');
    await expect(status({}, UNAPPROVED, 'src/a.ts')).resolves.toEqual({
      status: 'unknown',
    });
    expect(mocks.getFileStatus).not.toHaveBeenCalled();
  });

  it('git:status forwards an approved repoRoot', async () => {
    mocks.getFileStatus.mockResolvedValue({ status: 'modified' });
    const status = handlerFor('git:status');
    await expect(status({}, APPROVED, 'src/a.ts')).resolves.toEqual({
      status: 'modified',
    });
    expect(mocks.getFileStatus).toHaveBeenCalledWith(APPROVED, 'src/a.ts');
  });

  it('git:diff never reads file contents for an unapproved repoRoot', async () => {
    const diff = handlerFor('git:diff');
    await expect(diff({}, UNAPPROVED, 'src/a.ts')).resolves.toEqual({
      originalContent: '',
      modifiedContent: '',
      truncated: false,
    });
    expect(mocks.getFileDiff).not.toHaveBeenCalled();
  });

  it('git:diff rejects a denylisted repoRoot even when approved', async () => {
    mocks.isPathBlocked.mockReturnValue(true);
    const diff = handlerFor('git:diff');
    await expect(diff({}, APPROVED, 'src/a.ts')).resolves.toEqual({
      originalContent: '',
      modifiedContent: '',
      truncated: false,
    });
    expect(mocks.getFileDiff).not.toHaveBeenCalled();
  });

  it('git:reveal returns false for an unapproved repoRoot', async () => {
    const reveal = handlerFor('git:reveal');
    await expect(reveal({}, UNAPPROVED)).resolves.toBe(false);
    expect(mocks.revealRepo).not.toHaveBeenCalled();
  });

  it('git:watch-head refuses to install a watcher for an unapproved repoRoot', async () => {
    const watch = handlerFor('git:watch-head');
    await expect(watch(fakeSender(), UNAPPROVED)).resolves.toEqual({
      ok: false,
    });
    expect(mocks.watchRepoHead).not.toHaveBeenCalled();
  });

  it('git:watch-head installs a watcher for an approved repoRoot', async () => {
    mocks.watchRepoHead.mockResolvedValue({ dispose: vi.fn() });
    const watch = handlerFor('git:watch-head');
    await expect(watch(fakeSender(), APPROVED)).resolves.toEqual({ ok: true });
    expect(mocks.watchRepoHead).toHaveBeenCalledTimes(1);
  });

  it('git:detect degrades an unapproved folderPath to binary-only detection', async () => {
    mocks.detectGit.mockResolvedValue({ installed: true, version: 'git 2.44' });
    const detect = handlerFor('git:detect');
    await detect({}, UNAPPROVED);
    // The unapproved path must never reach detectGit — it is called with
    // undefined (binary probe only, no repo walk on the supplied path).
    expect(mocks.detectGit).toHaveBeenCalledWith(undefined);
  });

  it('git:detect forwards an approved folderPath', async () => {
    mocks.detectGit.mockResolvedValue({ installed: true, version: 'git 2.44' });
    const detect = handlerFor('git:detect');
    await detect({}, APPROVED);
    expect(mocks.detectGit).toHaveBeenCalledWith(APPROVED);
  });
});

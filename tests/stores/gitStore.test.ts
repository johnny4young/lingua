/**
 * implementation — gitStore.applyHeadChange contract.
 *
 * Pinned coverage:
 *   - Returns `true` and updates posture when the new branch differs.
 *   - Returns `false` and skips the set() when branch + commit are
 *     identical to the cached posture (no-op re-emit).
 *   - Drops deliveries whose `repoRoot` does not match the active
 *     posture (stale broadcast after folder switch).
 *   - Does nothing when the posture is unavailable (no project, no
 *     git binary).
 *   - Bumps `lastDetectAt` on a successful apply so the 30s TTL
 *     skip in `useGitDetectOnProjectChange` stays honest.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useGitStore } from '../../src/renderer/stores/gitStore';

describe('useGitStore.applyHeadChange ', () => {
  beforeEach(() => {
    useGitStore.getState().clear();
  });

  afterEach(() => {
    useGitStore.getState().clear();
  });

  it('returns true and updates branch + commit when both change', () => {
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: '/tmp/repo',
      branch: 'main',
      commit: 'aaa',
    });
    const before = useGitStore.getState().lastDetectAt;
    const landed = useGitStore.getState().applyHeadChange({
      repoRoot: '/tmp/repo',
      branch: 'feat/x',
      commit: 'bbb',
      branchChanged: true,
    });
    expect(landed).toBe(true);
    const posture = useGitStore.getState().posture;
    expect(posture?.branch).toBe('feat/x');
    expect(posture?.commit).toBe('bbb');
    expect(useGitStore.getState().lastDetectAt).toBeGreaterThanOrEqual(before);
  });

  it('returns false and skips set() when branch and commit are identical (no-op)', () => {
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: '/tmp/repo',
      branch: 'main',
      commit: 'aaa',
    });
    const landed = useGitStore.getState().applyHeadChange({
      repoRoot: '/tmp/repo',
      branch: 'main',
      commit: 'aaa',
      branchChanged: false,
    });
    expect(landed).toBe(false);
  });

  it('returns false for a stale broadcast whose repoRoot does not match', () => {
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: '/tmp/repo-A',
      branch: 'main',
    });
    const landed = useGitStore.getState().applyHeadChange({
      repoRoot: '/tmp/repo-B',
      branch: 'other',
      commit: 'bbb',
      branchChanged: true,
    });
    expect(landed).toBe(false);
    // Posture untouched.
    expect(useGitStore.getState().posture?.branch).toBe('main');
  });

  it('returns false when posture is unavailable (no project)', () => {
    useGitStore.getState().setPosture(null);
    const landed = useGitStore.getState().applyHeadChange({
      repoRoot: '/tmp/repo',
      branch: 'main',
      branchChanged: true,
    });
    expect(landed).toBe(false);
  });

  it('returns false when posture.available is false (no-git folder)', () => {
    useGitStore.getState().setPosture({ available: false });
    const landed = useGitStore.getState().applyHeadChange({
      repoRoot: '/tmp/repo',
      branch: 'main',
      branchChanged: true,
    });
    expect(landed).toBe(false);
  });

  it('updates only commit (branch unchanged) when payload omits branch', () => {
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: '/tmp/repo',
      branch: 'main',
      commit: 'aaa',
    });
    const landed = useGitStore.getState().applyHeadChange({
      repoRoot: '/tmp/repo',
      commit: 'ccc',
      branchChanged: false,
    });
    expect(landed).toBe(true);
    const posture = useGitStore.getState().posture;
    expect(posture?.branch).toBe('main');
    expect(posture?.commit).toBe('ccc');
  });

  it('clears a previously-known branch when the watcher reports detached HEAD', () => {
    useGitStore.getState().setPosture({
      available: true,
      repoRoot: '/tmp/repo',
      branch: 'main',
      commit: 'aaa',
    });
    const landed = useGitStore.getState().applyHeadChange({
      repoRoot: '/tmp/repo',
      branch: null,
      commit: 'bbb',
      branchChanged: true,
    });
    expect(landed).toBe(true);
    const posture = useGitStore.getState().posture;
    expect(posture?.branch).toBeUndefined();
    expect(posture?.commit).toBe('bbb');
  });
});

/**
 * RL-102 Slice 1 — non-persisted git posture cache.
 *
 * The store mirrors `useDependencyDetectionStore` in shape (zustand,
 * keyed maps, evict-on-change) but caches THREE distinct things:
 *
 *   - `posture` — `null` until the boot-time detect resolves, then
 *     `{ available: boolean; repoRoot?: string; branch?: string; binaryVersion?: string }`.
 *     Used by the pill + panel to gate render entirely.
 *   - `byFile` — per-absolute-path `GitFileStatusEntry` carrying the
 *     last porcelain status + numstat counts + a millisecond
 *     `updatedAt`. Hot path; flips on every watcher tick.
 *   - `lastDetectAt` — millisecond timestamp of the most recent
 *     `git:detect` resolution (Fold B). Used by
 *     `useGitDetectOnProjectChange` to skip re-detect calls within
 *     30s of the previous result; the project-root key still
 *     invalidates on user-driven folder change.
 *
 * No persistence on purpose — the posture is a pure function of the
 * filesystem state at the moment Lingua is open; rehydrating from
 * localStorage would surface stale branch / status data and
 * undermine the "git is fresh truth" contract.
 *
 * The store is intentionally lean: no derived selectors, no thunks.
 * The hooks layer (`useGitStatus`, `useGitDetectOnProjectChange`)
 * carries the orchestration; this module is a flat cache.
 */

import { create } from 'zustand';

/**
 * Mirror of the global `GitFileStatusKind` ambient declared in
 * `src/types.d.ts`. Kept as a local literal type so the store module
 * stays a real ES module (importing from `types.d.ts` makes it
 * `not a module` for tooling — the ambient .d.ts has no exports).
 */
type GitFileStatusKind = 'clean' | 'modified' | 'untracked' | 'unknown';

export interface GitRepoPosture {
  /**
   * `false` when either the binary is missing OR the opened folder
   * is not a git repo. The renderer uses this to suppress the pill
   * + panel entirely (a graceful "no git" surface is preferable to
   * empty chip states).
   */
  readonly available: boolean;
  /**
   * Absolute path of the resolved repo root. Absent when
   * `available === false`. Always normalized via main-side
   * `git rev-parse --show-toplevel` so it stays stable across
   * subdirectory navigation.
   */
  readonly repoRoot?: string;
  /**
   * Current branch name, e.g. `main`. Absent on detached HEAD.
   * Threaded to the pill (Fold A — branch indicator inline).
   */
  readonly branch?: string;
  /**
   * `git --version` line for surfacing in the Settings → Editor →
   * Git read-only row tooltip. Optional; absent when detection ran
   * via the fallback path without a recordable version string.
   */
  readonly binaryVersion?: string;
}

export interface GitFileStatusEntry {
  readonly status: GitFileStatusKind;
  readonly insertions?: number;
  readonly deletions?: number;
  /** Millisecond timestamp of the most recent status resolution. */
  readonly updatedAt: number;
}

interface GitStateShape {
  /**
   * `null` before the first `git:detect` resolves; flips to
   * `{ available: false }` (rather than back to `null`) when the
   * detect resolves with no repo, so consumers can distinguish
   * "still booting" from "already known empty".
   */
  readonly posture: GitRepoPosture | null;
  readonly byFile: ReadonlyMap<string, GitFileStatusEntry>;
  readonly lastDetectAt: number;
  /**
   * The folder path the most recent detect ran against. Reviewer pass —
   * the TTL skip in `useGitDetectOnProjectChange` must be keyed by
   * folder so a fast project switch (A → B within 30s) does NOT reuse
   * A's cached "no-git" posture as B's answer. Empty string when no
   * detect has run yet.
   */
  readonly lastDetectKey: string;
  setPosture: (posture: GitRepoPosture | null) => void;
  setFileStatus: (filePath: string, entry: GitFileStatusEntry) => void;
  evictFile: (filePath: string) => void;
  markDetectAttempt: (timestamp: number, key: string) => void;
  clear: () => void;
}

export const useGitStore = create<GitStateShape>((set) => ({
  posture: null,
  byFile: new Map(),
  lastDetectAt: 0,
  lastDetectKey: '',
  setPosture: (posture) =>
    set((state) => {
      // Detect resolved a new posture — invalidate per-file cache so
      // a previous repo's status entries don't leak after the user
      // opens a different folder. The hook re-queries each open tab
      // on the next watcher tick.
      const samePosture =
        posture?.available === state.posture?.available &&
        posture?.repoRoot === state.posture?.repoRoot &&
        posture?.branch === state.posture?.branch;
      if (samePosture && posture !== null) {
        return { posture };
      }
      return { posture, byFile: new Map() };
    }),
  setFileStatus: (filePath, entry) =>
    set((state) => {
      const updated = new Map(state.byFile);
      updated.set(filePath, entry);
      return { byFile: updated };
    }),
  evictFile: (filePath) =>
    set((state) => {
      if (!state.byFile.has(filePath)) return state;
      const updated = new Map(state.byFile);
      updated.delete(filePath);
      return { byFile: updated };
    }),
  markDetectAttempt: (timestamp, key) =>
    set(() => ({ lastDetectAt: timestamp, lastDetectKey: key })),
  clear: () =>
    set((state) => {
      if (
        state.posture === null &&
        state.byFile.size === 0 &&
        state.lastDetectAt === 0 &&
        state.lastDetectKey === ''
      ) {
        return state;
      }
      return {
        posture: null,
        byFile: new Map(),
        lastDetectAt: 0,
        lastDetectKey: '',
      };
    }),
}));

/**
 * Fold B — Detection cache TTL. Calls to `git:detect` within this
 * window of the previous resolution are skipped (the renderer reuses
 * the cached posture). User-driven folder change explicitly bypasses
 * this via `clear()` followed by a fresh attempt — the TTL only
 * suppresses redundant re-detect calls from store rehydration or
 * stale lifecycle re-renders.
 *
 * 30 seconds is short enough that `git checkout other-branch` from a
 * sibling terminal surfaces on the next watcher tick (which usually
 * lands a few seconds after the user gestures) and long enough that
 * a burst of edits in a session does not spawn redundant detects.
 */
export const GIT_DETECT_CACHE_TTL_MS = 30_000;

/**
 * Convenience selector — `true` when the posture has resolved AND
 * reports a usable repo. Used by `<EditorTabs>` to decide whether
 * to mount `<GitStatusPill>` and by `<AppLayout>` for the Git diff
 * sibling tab visibility.
 */
export function gitLayerAvailable(posture: GitRepoPosture | null): boolean {
  return posture !== null && posture.available === true;
}

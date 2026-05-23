/**
 * RL-102 Slice 1 — boot-time detect for the Git read-only layer.
 *
 * Runs on every project root change
 * (`useProjectStore.currentProject`). The `lastDetectAt` field in
 * `useGitStore` (fold B) suppresses redundant re-detect calls within
 * `GIT_DETECT_CACHE_TTL_MS` so React re-renders or transient store
 * rehydration don't burn an IPC trip per render.
 *
 * Emits `git.layer_attached { repoState }` (fold D) once per posture
 * transition. Three closed-enum values: `'git-repo'` when the folder
 * resolved to a working tree, `'no-git'` when git is installed but
 * the folder is not a repo, `'no-binary'` when the binary itself
 * wasn't found.
 */

import { useEffect } from 'react';
import {
  GIT_DETECT_CACHE_TTL_MS,
  useGitStore,
  type GitRepoPosture,
} from '../stores/gitStore';
import { useProjectStore } from '../stores/projectStore';
import { trackGitLayerAttached } from './gitTelemetry';

export function useGitDetectOnProjectChange(): void {
  const rootPath = useProjectStore(
    (state) => state.currentProject?.rootPath ?? null
  );
  const rootId = useProjectStore(
    (state) => state.currentProject?.rootId ?? null
  );

  useEffect(() => {
    const bridge = window.lingua?.git;
    const { setPosture, markDetectAttempt, lastDetectAt, lastDetectKey } =
      useGitStore.getState();

    // Web build / preload not present — set posture to `available:
    // false` so the renderer's render gates short-circuit cleanly
    // (and consumers can tell "detect ran, no bridge" apart from
    // "detect still pending"). Emit no-binary telemetry once.
    if (!bridge) {
      setPosture({ available: false });
      trackGitLayerAttached('no-binary');
      return;
    }

    // No project open — clear posture; nothing to detect against.
    if (!rootPath) {
      setPosture(null);
      return;
    }

    // Fold B — TTL cache, keyed by folder. Reviewer pass: the
    // previous shape compared `now - lastDetectAt` globally, which
    // suppressed the detect on a fast project switch (A → B within
    // 30s would reuse A's posture as B's). Pinning the cache to the
    // key fixes that — a folder change resets the TTL implicitly.
    const detectKey = `${rootPath}::${rootId ?? ''}`;
    const now = Date.now();
    if (
      lastDetectKey === detectKey &&
      now - lastDetectAt < GIT_DETECT_CACHE_TTL_MS
    ) {
      return;
    }

    let cancelled = false;
    bridge
      .detect(rootPath)
      .then((result) => {
        if (cancelled) return;
        markDetectAttempt(Date.now(), detectKey);
        const posture: GitRepoPosture = result.installed
          ? {
              available: typeof result.repoRoot === 'string',
              ...(result.repoRoot ? { repoRoot: result.repoRoot } : {}),
              ...(result.branch ? { branch: result.branch } : {}),
              ...(result.version ? { binaryVersion: result.version } : {}),
            }
          : { available: false };
        setPosture(posture);
        // Telemetry fires once per transition. The store comparator
        // in setPosture would short-circuit a no-op flip, but the
        // telemetry call here unconditionally captures the resolved
        // state (intent is "we attempted, here's the answer").
        if (!result.installed) {
          trackGitLayerAttached('no-binary');
        } else if (result.repoRoot) {
          trackGitLayerAttached('git-repo');
        } else {
          trackGitLayerAttached('no-git');
        }
      })
      .catch(() => {
        // Defensive: a thrown IPC settles posture to "no git" so
        // the pill stays suppressed instead of advertising stale
        // state from a prior project. No telemetry on throw — the
        // failure mode is indistinguishable from "no binary" from
        // the renderer's point of view.
        if (cancelled) return;
        markDetectAttempt(Date.now(), detectKey);
        setPosture({ available: false });
      });

    return () => {
      cancelled = true;
    };
  }, [rootPath, rootId]);
}

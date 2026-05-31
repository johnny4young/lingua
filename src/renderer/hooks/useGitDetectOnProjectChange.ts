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
import { getActiveTab, useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { gitWatchHeadSuppressedByMagicComment } from '../utils/magicComments';
import { trackGitHeadChanged, trackGitLayerAttached } from './gitTelemetry';

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

  // RL-102 Slice 2 — subscribe to `.git/HEAD` watch broadcasts once
  // the boot detect resolves to a real repo. Renderer keeps the
  // posture cache cheap-updated (no full detect re-run on a sibling
  // checkout). Subscribes per-repoRoot so a folder switch tears the
  // previous watcher down cleanly via the cleanup function.
  const repoRoot = useGitStore((state) =>
    state.posture?.available ? state.posture.repoRoot : null
  );
  useEffect(() => {
    const bridge = window.lingua?.git;
    if (!bridge || !repoRoot) return;
    if (!bridge.watchHead || !bridge.onHeadChanged) return;

    let cancelled = false;
    const offChange = bridge.onHeadChanged((payload) => {
      if (cancelled) return;
      // Fold F — per-file opt-out from HEAD refresh. Skip the
      // store update entirely when the ACTIVE tab carries the
      // `// @git-watch-head off` directive. We scope the check
      // to the active tab (rather than ALL open tabs) because
      // the user's intent is "the file I'm looking at right now
      // should not blink"; an inactive tab's directive does not
      // imply the same intent. If the user later switches tabs,
      // the next head change fires normally for the new active.
      const activeTab = getActiveTab(useEditorStore.getState());
      if (
        activeTab &&
        gitWatchHeadSuppressedByMagicComment(
          activeTab.language ?? '',
          activeTab.content ?? ''
        )
      ) {
        return;
      }
      const landed = useGitStore.getState().applyHeadChange(payload);
      // Telemetry: only fire when (a) the store accepted the
      // update AND (b) the branch actually changed. Pure
      // commit-only updates land silently — the dashboard only
      // wants signal for visible posture transitions.
      if (landed && payload.branchChanged) {
        trackGitHeadChanged('git-repo', payload.branchChanged);
      }
    });
    const offFailed = bridge.onHeadWatcherFailed?.((payload) => {
      if (cancelled) return;
      if (payload.reason !== 'give-up') return;
      // Surface a one-shot diagnostic notice when the watcher
      // permanently bails. The renderer's caller does not need to
      // react beyond letting the user know — the pill still shows
      // the LAST-known branch from the boot detect; what they lose
      // is automatic refresh on subsequent checkouts.
      useUIStore.getState().pushStatusNotice({
        tone: 'warning',
        messageKey: 'git.headWatch.diagnostic.giveUp',
      });
    });

    const watchPromise = bridge.watchHead(repoRoot).catch(() => {
      // Silent — `onHeadWatcherFailed` already handles surfacing.
      return { ok: false };
    });

    return () => {
      cancelled = true;
      offChange();
      if (offFailed) offFailed();
      // Pair unwatch with the watch promise instead of firing it
      // immediately. If React cleans this effect up before the IPC
      // handler finishes installing the watcher, an immediate
      // unwatch would race ahead, find no entry, and the later
      // watch resolution would leak an fs.watch handle.
      void watchPromise
        .then(() => bridge.unwatchHead?.(repoRoot))
        .catch(() => {
          /* sender already gone */
        });
    };
  }, [repoRoot]);
}

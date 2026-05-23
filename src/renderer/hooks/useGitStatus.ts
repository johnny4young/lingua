/**
 * RL-102 Slice 1 — per-file git status driver.
 *
 * Subscribes to:
 *   1. `useGitStore.posture` — re-queries open tabs after a folder
 *      switch so previous statuses don't bleed into the new repo.
 *   2. `useEditorStore.tabs` — queries any newly-opened tab's
 *      status once mount lands. Closed tabs evict their cached
 *      status to keep memory bounded.
 *   3. `window.lingua.fs.onChanged` — debounced re-query on every
 *      external change matching an open tab path.
 *
 * Implementation notes:
 *
 *   - Per-file debounce of 300 ms keeps the spawn rate sane under a
 *     keystroke burst (Monaco saves dirty buffers asynchronously
 *     through the file system, which then fires `fs:changed`).
 *   - One concurrent IPC trip per file at most. New events arriving
 *     while a query is in-flight reset the debounce timer; the
 *     next-tick query batches the bursty changes into a single
 *     status read after the in-flight query lands.
 *   - Magic-comment opt-out (`// @git-ignore-status`) is checked
 *     against the live tab content so a user can toggle suppression
 *     without saving.
 *   - Slice 1.1 removed the settings master toggle; the per-file
 *     magic-comment directive is the opt-out that prevents spawns.
 */

import { useEffect, useRef } from 'react';
import { gitStatusSuppressedByMagicComment } from '../utils/magicComments';
import { useEditorStore } from '../stores/editorStore';
import { useGitStore } from '../stores/gitStore';
import { useProjectStore } from '../stores/projectStore';
import type { FileTab } from '../types';

const GIT_STATUS_DEBOUNCE_MS = 300;

interface PendingQuery {
  timer: number | null;
  inFlight: boolean;
  needsRefresh: boolean;
}

function shouldQueryFor(tab: FileTab): boolean {
  if (!tab.filePath) return false;
  // Skip the per-file query when the user has dropped the magic
  // comment in the buffer. The pill render still respects the
  // setting separately, but skipping the IPC keeps the spawn rate
  // honest on opt-out files.
  if (gitStatusSuppressedByMagicComment(tab.language ?? '', tab.content)) {
    return false;
  }
  return true;
}

export function useGitStatus(): void {
  const tabs = useEditorStore((state) => state.tabs);
  const posture = useGitStore((state) => state.posture);
  const currentProjectRootId = useProjectStore(
    (state) => state.currentProject?.rootId ?? null
  );

  // Per-file debounce + in-flight tracking. Keyed by absolute
  // filePath; survives the hook lifetime via a ref so the
  // `useEffect` dep array can rebuild without losing timers.
  const pendingRef = useRef<Map<string, PendingQuery>>(new Map());

  // Resolved repo root — pulled from posture so the IPC layer can
  // path-validate against the same root the renderer trusts. When
  // posture flips, the previous map is cleared by `setPosture` in
  // the store; we mirror that here by cancelling any in-flight
  // timers (preventing a stale status from landing on the new
  // repo's pill).
  useEffect(() => {
    // Copy the ref value once on mount so the cleanup function
    // closes over a stable target. The ref itself never re-binds
    // (it's a useRef), but ESLint's react-hooks/exhaustive-deps
    // flags the late-read pattern defensively — the copy makes the
    // intent explicit.
    const pending = pendingRef.current;
    return () => {
      for (const entry of pending.values()) {
        if (entry.timer !== null) {
          window.clearTimeout(entry.timer);
        }
      }
      pending.clear();
    };
  }, []);

  useEffect(() => {
    const bridge = window.lingua?.git;
    if (!bridge) return;
    if (!posture?.available || !posture.repoRoot) return;
    const repoRoot = posture.repoRoot;

    const { setFileStatus } = useGitStore.getState();

    const enqueue = (filePath: string): void => {
      let entry = pendingRef.current.get(filePath);
      if (!entry) {
        entry = {
          timer: null,
          inFlight: false,
          needsRefresh: false,
        };
        pendingRef.current.set(filePath, entry);
      }
      if (entry.timer !== null) {
        window.clearTimeout(entry.timer);
      }
      if (entry.inFlight) {
        entry.needsRefresh = true;
      }
      entry.timer = window.setTimeout(async () => {
        entry.timer = null;
        if (entry.inFlight) {
          // Another tick is already executing for this file. Keep a
          // sticky refresh marker on the SAME entry object so the
          // in-flight completion schedules one more read.
          entry.needsRefresh = true;
          return;
        }
        entry.inFlight = true;
        try {
          const status = await bridge.status(repoRoot, filePath);
          setFileStatus(filePath, {
            status: status.status,
            ...(typeof status.insertions === 'number'
              ? { insertions: status.insertions }
              : {}),
            ...(typeof status.deletions === 'number'
              ? { deletions: status.deletions }
              : {}),
            updatedAt: Date.now(),
          });
        } catch {
          // Soft-fail to `unknown` — better than a stale state.
          setFileStatus(filePath, {
            status: 'unknown',
            updatedAt: Date.now(),
          });
        } finally {
          entry.inFlight = false;
          if (entry.needsRefresh) {
            entry.needsRefresh = false;
            enqueue(filePath);
          }
        }
      }, GIT_STATUS_DEBOUNCE_MS);
    };

    // On posture change, prime the cache for every currently-open
    // tab whose filePath is under the new repoRoot.
    for (const tab of tabs) {
      if (!shouldQueryFor(tab)) continue;
      enqueue(tab.filePath as string);
    }

    // Watcher subscription. Debounced per file; only fires for
    // paths that map to an open tab to avoid status queries for
    // background files the user isn't looking at.
    const unsubscribe = window.lingua.fs.onChanged((event) => {
      if (currentProjectRootId && event.rootId !== currentProjectRootId) return;
      // Resolve the event's relativePath against the project root
      // to compare with the open tab list. The tab's `filePath` is
      // an absolute path; we match via `endsWith(relativePath)` for
      // safety (the project root may differ slightly in normalization).
      for (const tab of tabs) {
        if (!shouldQueryFor(tab)) continue;
        const filePath = tab.filePath as string;
        if (event.relativePath && filePath.endsWith(event.relativePath)) {
          enqueue(filePath);
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [posture?.available, posture?.repoRoot, tabs, currentProjectRootId]);

  // Evict cached status entries for closed tabs so the byFile map
  // stays bounded. This runs every render because `tabs` is the
  // dep; the `evictFile` action is a no-op when the key is absent.
  useEffect(() => {
    const openPaths = new Set(
      tabs.map((tab) => tab.filePath).filter((p): p is string => Boolean(p))
    );
    const { byFile, evictFile } = useGitStore.getState();
    for (const filePath of byFile.keys()) {
      if (!openPaths.has(filePath)) {
        evictFile(filePath);
      }
    }
  }, [tabs]);
}

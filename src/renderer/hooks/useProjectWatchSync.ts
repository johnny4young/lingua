import { useEffect, useRef } from 'react';
import i18next from 'i18next';
import { useEditorStore } from '../stores/editorStore';
import { useProjectStore } from '../stores/projectStore';
import { useUIStore } from '../stores/uiStore';
import { trackGitExternalModificationReload } from './gitTelemetry';
import type { FileTreeNode } from '../stores/projectTree';

export const PROJECT_WATCH_REFRESH_DEBOUNCE_MS = 150;

/**
 * RL-024 Slice 1 fold D — gate the "file was deleted externally"
 * notice. After every refresh, we walk the new tree and compare
 * against open tabs; a tab whose `relativePath` no longer exists
 * triggers a one-shot status notice. Debounced so a vendored
 * dependency wipe doesn't spam 200 toasts. The timestamp lives in
 * a ref so it resets cleanly between project switches (a
 * module-scoped value would let a notice in project A suppress a
 * legitimate notice in project B fired moments after the switch).
 */
const STALE_TAB_NOTICE_DEBOUNCE_MS = 1500;

/**
 * RL-102 Slice 2 — per-tab debounce window for the
 * reload-from-disk notice. A save-storm (e.g. `prettier --write`
 * touching the file 3x in rapid succession) coalesces into one
 * notice; a slower stream of legitimate external edits surfaces a
 * notice per quiet period.
 */
const RELOAD_NOTICE_DEBOUNCE_MS = 500;

/**
 * RL-102 Slice 2 fold D — threshold at which a multi-tab modify
 * event collapses into ONE batched notice ("3 files changed on disk")
 * instead of N individual notices. Below the threshold, per-tab
 * notices keep the user oriented to which file changed.
 */
const RELOAD_BATCH_THRESHOLD = 3;

function collectFilePaths(nodes: ReadonlyArray<FileTreeNode>): Set<string> {
  const out = new Set<string>();
  const walk = (list: ReadonlyArray<FileTreeNode>): void => {
    for (const node of list) {
      if (node.isDirectory) {
        if (node.children) walk(node.children);
      } else {
        out.add(node.path);
      }
    }
  };
  walk(nodes);
  return out;
}

function collectLoadedDirs(nodes: ReadonlyArray<FileTreeNode>): Set<string> {
  // Set of directory paths whose `children` have actually been
  // loaded. Used to filter out "still unexpanded" tabs whose file
  // legitimately isn't in the tree yet.
  const out = new Set<string>();
  // The project root is always loaded once we have `nodes`.
  out.add('');
  const walk = (list: ReadonlyArray<FileTreeNode>): void => {
    for (const node of list) {
      if (node.isDirectory && node.children) {
        out.add(node.path);
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return out;
}

function parentRelativeOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/');
  return idx === -1 ? '' : relativePath.slice(0, idx);
}

function maybePushStaleTabNotice(
  lastNoticeAtRef: { current: number },
  activeRootIdRef: { current: string | null },
  previousTree?: {
    rootId: string;
    loadedDirs: ReadonlySet<string>;
  }
): void {
  const { currentProject, nodes } = useProjectStore.getState();
  if (!currentProject) return;
  // Reset the debounce timestamp if the project switched since the
  // last notice — otherwise a notice in project A would suppress a
  // legitimate notice in project B for up to STALE_TAB_NOTICE_DEBOUNCE_MS.
  if (activeRootIdRef.current !== currentProject.rootId) {
    activeRootIdRef.current = currentProject.rootId;
    lastNoticeAtRef.current = 0;
  }
  const { tabs } = useEditorStore.getState();
  const loadedDirs = collectLoadedDirs(nodes);
  if (previousTree?.rootId === currentProject.rootId) {
    for (const dir of previousTree.loadedDirs) {
      loadedDirs.add(dir);
    }
  }
  const presentFiles = collectFilePaths(nodes);
  for (const tab of tabs) {
    if (!tab.rootId || tab.rootId !== currentProject.rootId) continue;
    if (!tab.relativePath) continue;
    const parent = parentRelativeOf(tab.relativePath);
    // Only fire when the containing directory is or was loaded during
    // this watcher refresh; an unexpanded dir's child legitimately
    // isn't in `nodes` yet.
    if (!loadedDirs.has(parent)) continue;
    if (presentFiles.has(tab.relativePath)) continue;
    // Found a tab whose file just vanished from the loaded tree.
    const now = Date.now();
    if (now - lastNoticeAtRef.current < STALE_TAB_NOTICE_DEBOUNCE_MS) return;
    lastNoticeAtRef.current = now;
    useUIStore.getState().pushStatusNotice({
      tone: 'warning',
      messageKey: 'fileTree.staleTab.deletedExternally',
      values: { name: tab.name },
    });
    // Only surface one notice per refresh — debounce upstream will
    // squelch repeated bursts. Stop walking once we've fired.
    return;
  }
}

/**
 * RL-102 Slice 2 — schedule a reload-from-disk notice for the tab
 * matching `event.relativePath` (if any). Accumulates pending
 * tab-ids in `batchRef`; after `RELOAD_NOTICE_DEBOUNCE_MS` of
 * quiet, flushes either ONE batched notice (≥
 * `RELOAD_BATCH_THRESHOLD` tabs) or N individual notices.
 *
 * Per-tab inner debounce: if the same tab's file modifies twice
 * within the window, the timer resets and we still fire only one
 * notice for that tab.
 *
 * Self-induced saves (renderer wrote the file via `fs:write`) are
 * filtered downstream by comparing in-memory content to disk content
 * at notice-fire time. The comparison happens in `pushReloadNotice`;
 * a write whose result content equals the tab buffer (the common
 * case after `saveTab`) silently skips the notice.
 */
type ReloadBatchRef = {
  pendingTabIds: Set<string>;
  timer: number | null;
};

type ReloadCandidate = {
  tabId: string;
  tabName: string;
  diskSnapshot: string;
  isDirty: boolean;
};

function maybeScheduleReloadNotice(
  event: {
    rootId: string;
    relativePath: string;
    eventType: string;
    filename: string | null;
  },
  batchRef: { current: ReloadBatchRef }
): void {
  // Only react to content-modification events. `'rename'` events
  // arrive for creates AND deletes; deletes route through the
  // stale-tab notice path, and creates do not concern open tabs.
  if (event.eventType !== 'change') return;
  // The watcher payload's relativePath aggregates to the parent dir
  // when the platform drops the filename (Linux inotify under load).
  // Skip those — we cannot identify a single tab.
  if (event.filename === null) return;

  const { tabs } = useEditorStore.getState();
  const match = tabs.find(
    (tab) =>
      tab.rootId === event.rootId &&
      tab.relativePath === event.relativePath
  );
  if (!match) return;

  batchRef.current.pendingTabIds.add(match.id);

  if (batchRef.current.timer !== null) {
    window.clearTimeout(batchRef.current.timer);
  }
  batchRef.current.timer = window.setTimeout(() => {
    batchRef.current.timer = null;
    const pending = Array.from(batchRef.current.pendingTabIds);
    batchRef.current.pendingTabIds.clear();
    if (pending.length === 0) return;
    if (pending.length >= RELOAD_BATCH_THRESHOLD) {
      pushBatchedReloadNotice(pending);
    } else {
      for (const tabId of pending) {
        void pushReloadNotice(tabId);
      }
    }
  }, RELOAD_NOTICE_DEBOUNCE_MS);
}

/**
 * Reload a single tab from disk. Reads via `fs:read`, then calls
 * `editorStore.setTabContentFromDisk` (the RL-024 Slice 2 action).
 * Skips silently when:
 *   - tab vanished between schedule + fire (close race),
 *   - disk content matches the in-memory buffer (self-induced
 *     save echo), or
 *   - IPC throws (transient — next watch event re-triggers).
 *
 * Telemetry: emits `git.external_modification_reload` with the
 * resolved outcome.
 */
async function readReloadCandidate(
  tabId: string
): Promise<ReloadCandidate | null> {
  const { tabs } = useEditorStore.getState();
  const tab = tabs.find((t) => t.id === tabId);
  if (!tab || !tab.rootId || !tab.relativePath) return null;

  // Self-induced echo gate — read current disk content and compare
  // to the in-memory buffer. When they match (the common case for
  // an in-app save), suppress the notice. When they differ, the
  // disk genuinely changed and the user deserves a prompt.
  let rawDiskContent: string | null;
  try {
    const result = await window.lingua.fs.read(tab.rootId, tab.relativePath);
    rawDiskContent = typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
  if (rawDiskContent === null) return null;
  if (rawDiskContent === tab.content) return null;
  return {
    tabId,
    tabName: tab.name,
    diskSnapshot: rawDiskContent,
    isDirty: tab.isDirty,
  };
}

function confirmDirtyReload(): boolean {
  return window.confirm(
    `${i18next.t('git.externalReload.confirm.title')}\n\n${i18next.t('git.externalReload.confirm.body')}`
  );
}

function applyReloadCandidate(candidate: ReloadCandidate): void {
  useEditorStore
    .getState()
    .setTabContentFromDisk(candidate.tabId, candidate.diskSnapshot);
}

async function applyBatchedReload(
  tabIds: ReadonlyArray<string>
): Promise<void> {
  const candidates = (
    await Promise.all(tabIds.map((tabId) => readReloadCandidate(tabId)))
  ).filter((candidate): candidate is ReloadCandidate => candidate !== null);
  if (candidates.length === 0) return;
  if (candidates.some((candidate) => candidate.isDirty)) {
    const ok = confirmDirtyReload();
    if (!ok) {
      trackGitExternalModificationReload('user-rejected');
      return;
    }
  }
  for (const candidate of candidates) {
    applyReloadCandidate(candidate);
    trackGitExternalModificationReload('user-accepted');
  }
}

async function pushReloadNotice(tabId: string): Promise<void> {
  const candidate = await readReloadCandidate(tabId);
  if (!candidate) return;

  const tone: 'info' | 'warning' = candidate.isDirty ? 'warning' : 'info';

  useUIStore.getState().pushStatusNotice({
    tone,
    messageKey: candidate.isDirty
      ? 'git.externalReload.dirty.body'
      : 'git.externalReload.clean.body',
    values: { fileName: candidate.tabName },
    actions: [
      {
        labelKey: candidate.isDirty
          ? 'git.externalReload.dirty.action'
          : 'git.externalReload.clean.action',
        onClick: () => {
          // Dirty tab → confirm before discarding local edits.
          // Native confirm() is the cheapest UX that respects the
          // "no silent file mutation" principle. Copy comes from
          // i18next so Spanish-locale users see localized prompt
          // text (reviewer fix — earlier draft hardcoded EN).
          if (candidate.isDirty) {
            const ok = confirmDirtyReload();
            if (!ok) {
              trackGitExternalModificationReload('user-rejected');
              return;
            }
          }
          applyReloadCandidate(candidate);
          trackGitExternalModificationReload('user-accepted');
        },
      },
    ],
    onDismiss: (mode) => {
      // Dismiss attribution — only fire the rejected outcome when
      // the user manually dismissed without clicking the CTA. A
      // CTA dismiss is handled inside the action's onClick above
      // (which fires either user-accepted OR user-rejected from
      // the confirm flow). The 'auto' dismiss path is the timeout
      // banner self-clearing; treat as rejected (the user did
      // nothing).
      if (mode === 'cta') return;
      trackGitExternalModificationReload('user-rejected');
    },
  });
}

/**
 * Fold D — surface ONE notice for a batched set of tab-ids.
 * Single Reload action re-reads each tab from disk and applies the
 * reload directly after the user clicks the batched CTA. Dirty tabs
 * still require confirmation before local edits are discarded.
 * Skips silently when no tabs match.
 */
function pushBatchedReloadNotice(tabIds: ReadonlyArray<string>): void {
  const tabs = useEditorStore.getState().tabs.filter((t) =>
    tabIds.includes(t.id)
  );
  if (tabs.length === 0) return;
  useUIStore.getState().pushStatusNotice({
    tone: 'warning',
    messageKey: 'git.externalReload.batch.body',
    values: { count: tabs.length },
    actions: [
      {
        labelKey: 'git.externalReload.batch.action',
        onClick: () => {
          void applyBatchedReload(tabIds);
        },
      },
    ],
    // Emit the rejection telemetry on manual / auto dismiss so the
    // batched path has parity with the per-tab path's dismiss
    // attribution. CTA dismisses are handled inside
    // `applyBatchedReload`, which fires accept / reject events after
    // re-reading disk content.
    onDismiss: (mode) => {
      if (mode === 'cta') return;
      trackGitExternalModificationReload('user-rejected');
    },
  });
}

export function useProjectWatchSync(): void {
  const refreshTimerRef = useRef<number | null>(null);
  const lastStaleNoticeAtRef = useRef<number>(0);
  const activeRootIdRef = useRef<string | null>(null);
  // RL-102 Slice 2 — per-mount reload-notice accumulator. Lives in
  // a ref so multiple `fs:on-changed` events within the debounce
  // window collapse into one timer + one decision.
  const reloadBatchRef = useRef<ReloadBatchRef>({
    pendingTabIds: new Set<string>(),
    timer: null,
  });

  useEffect(() => {
    const unsubscribe = window.lingua.fs.onChanged((event) => {
      const { currentProject } = useProjectStore.getState();
      if (!currentProject || event.rootId !== currentProject.rootId) {
        return;
      }

      // RL-102 Slice 2 — reload-from-disk notice. Hooked at
      // event-arrival (not after refresh) because the watcher
      // payload already names the changed file; we do not need
      // the tree refresh to identify a tab match.
      maybeScheduleReloadNotice(event, reloadBatchRef);

      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = window.setTimeout(async () => {
        refreshTimerRef.current = null;
        const { currentProject, refreshTree } = useProjectStore.getState();
        if (!currentProject) {
          return;
        }

        const previousTree = {
          rootId: currentProject.rootId,
          loadedDirs: collectLoadedDirs(useProjectStore.getState().nodes),
        };
        try {
          await refreshTree();
        } catch {
          return;
        }
        // RL-024 Slice 1 fold D — after refresh, surface any tab
        // whose file got deleted on disk. Debounced + scoped to
        // already-loaded directories so the notice never fires for
        // a file that simply lives in an unexpanded subtree.
        maybePushStaleTabNotice(
          lastStaleNoticeAtRef,
          activeRootIdRef,
          previousTree
        );
      }, PROJECT_WATCH_REFRESH_DEBOUNCE_MS);
    });

    // Snapshot the ref so the cleanup function reads the same
    // object even if React's StrictMode swaps refs across the
    // double-invoke. (react-hooks/exhaustive-deps lint.)
    const batchRefSnapshot = reloadBatchRef.current;
    return () => {
      if (refreshTimerRef.current !== null) {
        window.clearTimeout(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      if (batchRefSnapshot.timer !== null) {
        window.clearTimeout(batchRefSnapshot.timer);
        batchRefSnapshot.timer = null;
      }
      batchRefSnapshot.pendingTabIds.clear();

      unsubscribe();
    };
  }, []);
}

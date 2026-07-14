import i18next from 'i18next';
import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import { useEditorStore } from '../stores/editorStore';
import { useUIStore } from '../stores/uiStore';
import type { FileTab } from '../types';
import { trackGitExternalModificationReload } from './gitTelemetry';

const RELOAD_NOTICE_DEBOUNCE_MS = 500;
const RELOAD_BATCH_THRESHOLD = 3;

export interface ReloadBatchState {
  pendingTabIds: Set<string>;
  timer: number | null;
}

interface ReloadCandidate {
  tabId: string;
  tabName: string;
  diskSnapshot: string;
  isDirty: boolean;
}

export function createReloadBatchState(): ReloadBatchState {
  return { pendingTabIds: new Set(), timer: null };
}

export function findReloadTargetId(
  event: FsChangedEvent,
  tabs: ReadonlyArray<Pick<FileTab, 'id' | 'rootId' | 'relativePath'>>
): string | null {
  if (event.eventType !== 'change' || event.filename === null) return null;
  return (
    tabs.find(
      tab => tab.rootId === event.rootId && tab.relativePath === event.relativePath
    )?.id ?? null
  );
}

export function scheduleReloadNotice(
  event: FsChangedEvent,
  batchRef: { current: ReloadBatchState }
): void {
  const tabId = findReloadTargetId(event, useEditorStore.getState().tabs);
  if (!tabId) return;

  batchRef.current.pendingTabIds.add(tabId);
  if (batchRef.current.timer !== null) window.clearTimeout(batchRef.current.timer);
  batchRef.current.timer = window.setTimeout(() => {
    batchRef.current.timer = null;
    const pending = Array.from(batchRef.current.pendingTabIds);
    batchRef.current.pendingTabIds.clear();
    if (pending.length === 0) return;
    if (pending.length >= RELOAD_BATCH_THRESHOLD) {
      pushBatchedReloadNotice(pending);
    } else {
      for (const pendingTabId of pending) void pushReloadNotice(pendingTabId);
    }
  }, RELOAD_NOTICE_DEBOUNCE_MS);
}

export function clearReloadBatchState(batch: ReloadBatchState): void {
  if (batch.timer !== null) {
    window.clearTimeout(batch.timer);
    batch.timer = null;
  }
  batch.pendingTabIds.clear();
}

async function readReloadCandidate(tabId: string): Promise<ReloadCandidate | null> {
  const tab = useEditorStore.getState().tabs.find(candidate => candidate.id === tabId);
  if (!tab || !tab.rootId || !tab.relativePath) return null;

  let rawDiskContent: string | null;
  try {
    const result = await window.lingua.fs.read(
      asRootId(tab.rootId),
      asRelativePath(tab.relativePath)
    );
    rawDiskContent = typeof result === 'string' ? result : null;
  } catch {
    return null;
  }
  if (rawDiskContent === null || rawDiskContent === tab.content) return null;
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
  useEditorStore.getState().setTabContentFromDisk(candidate.tabId, candidate.diskSnapshot);
}

async function applyBatchedReload(tabIds: ReadonlyArray<string>): Promise<void> {
  const candidates = (
    await Promise.all(tabIds.map(tabId => readReloadCandidate(tabId)))
  ).filter((candidate): candidate is ReloadCandidate => candidate !== null);
  if (candidates.length === 0) return;
  if (candidates.some(candidate => candidate.isDirty) && !confirmDirtyReload()) {
    trackGitExternalModificationReload('user-rejected');
    return;
  }
  for (const candidate of candidates) {
    applyReloadCandidate(candidate);
    trackGitExternalModificationReload('user-accepted');
  }
}

async function pushReloadNotice(tabId: string): Promise<void> {
  const candidate = await readReloadCandidate(tabId);
  if (!candidate) return;

  useUIStore.getState().pushStatusNotice({
    tone: candidate.isDirty ? 'warning' : 'info',
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
          if (candidate.isDirty && !confirmDirtyReload()) {
            trackGitExternalModificationReload('user-rejected');
            return;
          }
          applyReloadCandidate(candidate);
          trackGitExternalModificationReload('user-accepted');
        },
      },
    ],
    onDismiss: mode => {
      if (mode !== 'cta') trackGitExternalModificationReload('user-rejected');
    },
  });
}

function pushBatchedReloadNotice(tabIds: ReadonlyArray<string>): void {
  const tabs = useEditorStore.getState().tabs.filter(tab => tabIds.includes(tab.id));
  if (tabs.length === 0) return;
  useUIStore.getState().pushStatusNotice({
    tone: 'warning',
    messageKey: 'git.externalReload.batch.body',
    values: { count: tabs.length },
    actions: [
      {
        labelKey: 'git.externalReload.batch.action',
        onClick: () => void applyBatchedReload(tabIds),
      },
    ],
    onDismiss: mode => {
      if (mode !== 'cta') trackGitExternalModificationReload('user-rejected');
    },
  });
}

import { prepareNotebookDocument } from '../stores/notebookDocumentOpen';
import { asRelativePath, asRootId } from '../../shared/fs/brandedIds';
import { computeContentHash } from '../../shared/contentHash';
import type { FileTab } from '../types/editor';
import { useEditorStore } from '../stores/editorStore';
import { useNotebookStore } from '../stores/notebookStore';
import {
  notebookDocumentSnapshot,
} from '../stores/notebookDocumentPersistence';
import type { ReloadCandidate } from './projectWatchReload';

/** Notebook-only disk evidence work stays behind an actual notebook watch event. */
export async function readNotebookReloadCandidate(
  tab: FileTab,
  latestTab: FileTab,
  rawDiskContent: string
): Promise<ReloadCandidate | null> {
  if ((await computeContentHash(rawDiskContent)) === tab.notebookDocumentHash) return null;
  return {
    tabId: tab.id,
    tabName: tab.name,
    diskSnapshot: rawDiskContent,
    isDirty: latestTab.isDirty,
    notebookSnapshot: notebookDocumentSnapshot(tab.id),
    rootId: tab.rootId,
    relativePath: tab.relativePath,
  };
}

export async function applyNotebookReloadCandidate(
  tab: FileTab,
  candidate: ReloadCandidate,
  confirmDirtyReload: () => boolean
): Promise<void> {
  // The notice is a preview, not permission to discard edits made later.
  const current = notebookDocumentSnapshot(tab.id);
  if (tab.rootId !== candidate.rootId || tab.relativePath !== candidate.relativePath) return;
  if (current !== candidate.notebookSnapshot && !confirmDirtyReload()) return;
  const latest = await window.lingua.fs
    .read(asRootId(tab.rootId!), asRelativePath(tab.relativePath!))
    .catch(() => null);
  if (latest !== candidate.diskSnapshot) return;
  const prepared = await prepareNotebookDocument(candidate.diskSnapshot);
  const stillOwned = () => {
    const live = useEditorStore.getState().tabs.find(t => t.id === tab.id);
    return (
      live?.kind === 'notebook' &&
      live.rootId === candidate.rootId &&
      live.relativePath === candidate.relativePath &&
      notebookDocumentSnapshot(tab.id) === current
    );
  };
  if (!prepared || !stillOwned()) return;
  // Tear down the old heap; imported output remains stale evidence only.
  const session = await import('../runtime/notebookSession');
  if (!stillOwned()) return;
  session.disposeNotebookSession(tab.id);
  useNotebookStore
    .getState()
    .installImportedNotebook(tab.id, prepared.document.notebook, prepared.document.executionOrder);
  useEditorStore.setState(state => ({
    tabs: state.tabs.map(t =>
      t.id === tab.id
        ? { ...t, content: prepared.content, notebookDocumentHash: prepared.hash, isDirty: false }
        : t
    ),
  }));
}

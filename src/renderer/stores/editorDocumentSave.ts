import { flushNotebookDocumentDrafts } from './notebookDocumentDrafts';
import type { EditorGet, EditorSet } from './editorStoreContext';
import { useProjectStore } from './projectStore';
import { useRecentFilesStore } from './recentFilesStore';
import { useDependencyDetectionStore } from './dependencyDetectionStore';
import { useRecipeStore } from './recipeStore';
import { useResultStore } from './resultStore';
import { isWorkspaceTab } from './editorTabUtils';
import { FileWriteRejectedError, persistTab } from './editorPersistence';
import { useUIStore } from './uiStore';
import { asRootId } from '../../shared/fs/brandedIds';
import { notebookDocumentSnapshot } from './notebookDocumentPersistence';
import type { FileTab } from '../types/editor';

/** Commit disk metadata without losing edits that arrive during a save. */
export function createDocumentSaveAction(set: EditorSet, get: EditorGet) {
  const saveTab = async (
    id: string,
    forceSaveAs = false,
    snapshot?: string | null
  ): Promise<boolean> => {
    flushNotebookDocumentDrafts(id);
    const { tabs } = get();
    const tab = tabs.find(t => t.id === id);
    if (!tab) return false;
    // Workspace tabs have no disk representation; their current
    // query/request/tool state is auto-persisted to the owning workspace
    // store. A Save / Save-As gesture (Cmd+S, palette) would
    // otherwise open a file dialog and write the empty `content` to
    // disk. There is nothing pending here (unlike notebooks), so we
    // no-op silently rather than surfacing a notice.
    if (isWorkspaceTab(tab)) {
      return false;
    }

    const notebookSnapshot =
      tab.kind === 'notebook'
        ? snapshot === undefined
          ? notebookDocumentSnapshot(id)
          : snapshot
        : null;

    const previousPath = tab.filePath;
    const previousRootId = tab.rootId;
    const previousLanguage = tab.language;
    const savedTab =
      tab.kind === 'notebook'
        ? await (
            await import('./notebookDocumentWrite')
          ).persistNotebookDocument(
            tab,
            forceSaveAs,
            () => get().tabs.some(t => t.id === id),
            notebookSnapshot
          )
        : await persistTab(tab, forceSaveAs).catch((error: unknown) => {
            notifySaveFailed(tab.name, error);
            return null;
          });
    if (!savedTab) return false;
    if (tab.kind === 'notebook' && !get().tabs.some(t => t.id === id)) {
      if (
        savedTab.rootId &&
        savedTab.rootId !== useProjectStore.getState().currentProject?.rootId &&
        !get().tabs.some(t => t.rootId === savedTab.rootId)
      ) {
        await window.lingua.fs.revokeRoot(asRootId(savedTab.rootId)).catch(() => {});
      }
      return false;
    }

    set(state => ({
      tabs: state.tabs.map(t => {
        if (t.id !== id) return t;
        // Keystrokes that landed while the save (format + disk write)
        // was in flight must survive: committing the pre-save snapshot
        // verbatim would revert the text AND clear isDirty, so closing
        // the tab afterwards silently drops that work. Adopt the saved
        // metadata (path, rootId, language) but keep the newer content
        // marked dirty so the close-guard still fires.
        if (tab.kind === 'notebook') {
          return {
            ...t,
            name: savedTab.name,
            rootId: savedTab.rootId,
            relativePath: savedTab.relativePath,
            filePath: savedTab.filePath,
            content: savedTab.content,
            notebookDocumentHash: savedTab.notebookDocumentHash,
            isDirty: notebookDocumentSnapshot(id) !== savedTab.content,
          };
        }
        const committed = withLiveTabState(savedTab, t, tab);
        if (t.content !== tab.content) {
          return { ...committed, content: t.content, isDirty: true };
        }
        return committed;
      }),
    }));

    // Save-As that changed the language invalidates
    // the result-store snapshot ring for the saved tab. Re-read
    // `activeTabId` at this point (not the value captured before the
    // async `persistTab` hop) so that if the user switched tabs
    // mid-save we do NOT drop the new active tab's snapshot ring.
    // `useAutoRun` already clears the ring on tab switch; if the
    // user navigated away during the file picker, the ring belongs
    // to a different tab and we must leave it alone.
    if (savedTab.language !== previousLanguage && get().activeTabId === id) {
      useResultStore.getState().clearLastSuccessfulSnapshot();
    }
    if (savedTab.language !== previousLanguage) {
      useDependencyDetectionStore.getState().evictTab(id);
    }
    if (tab.recipeBindingId !== undefined && savedTab.recipeBindingId === undefined) {
      useRecipeStore.getState().unbindRecipe(id);
    }

    if (previousRootId && previousRootId !== savedTab.rootId) {
      const rootStillUsed = get().tabs.some(t => t.id !== id && t.rootId === previousRootId);
      const projectRootId = useProjectStore.getState().currentProject?.rootId;
      if (!rootStillUsed && previousRootId !== projectRootId) {
        await window.lingua.fs.revokeRoot(asRootId(previousRootId)).catch(() => {});
      }
    }

    if (savedTab.filePath && (forceSaveAs || previousPath !== savedTab.filePath)) {
      useRecentFilesStore.getState().addRecentFile({
        filePath: savedTab.filePath,
        name: savedTab.name,
        language: savedTab.language,
      });
    }

    return true;
  };

  return saveTab;
}

function notifySaveFailed(name: string, error: unknown): void {
  const detail =
    error instanceof Error && !(error instanceof FileWriteRejectedError) && error.message
      ? error.message
      : undefined;
  useUIStore.getState().pushStatusNotice({
    tone: 'error',
    messageKey: 'editor.save.failed',
    values: { name },
    ...(detail ? { detail } : {}),
  });
}

/** Disk metadata belongs to Save; same-language session state remains live. */
function withLiveTabState(saved: FileTab, live: FileTab, original: FileTab): FileTab {
  const committed: FileTab =
    saved.language === live.language
      ? {
          ...live,
          name: saved.name,
          filePath: saved.filePath,
          rootId: saved.rootId,
          relativePath: saved.relativePath,
          content: saved.content,
          isDirty: saved.isDirty,
        }
      : {
          // Language-changing Save As retains its capability pruning.
          ...saved,
          executionState: live.executionState,
          parseError: live.parseError,
        };
  // Save cannot leave saveTab's recipe store unbound while the tab keeps the id.
  if (original.recipeBindingId !== undefined && saved.recipeBindingId === undefined)
    delete committed.recipeBindingId;
  // A consumed override must not return, and one persistTab cleared (a
  // retitling or language-changing picker save) must not be restored.
  if (
    live.nextRunTimeoutOverrideMs === undefined ||
    (original.nextRunTimeoutOverrideMs !== undefined &&
      saved.nextRunTimeoutOverrideMs === undefined)
  )
    delete committed.nextRunTimeoutOverrideMs;
  return committed;
}

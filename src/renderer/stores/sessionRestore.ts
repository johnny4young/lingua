/**
 * Rebuilds the saved session into editor tabs. Loaded on the first restore, so
 * the translator stays off the startup graph; `sessionStore` keeps the guard.
 */
import {
  useEditorStore,
  SQL_WORKSPACE_TAB_ID,
  HTTP_WORKSPACE_TAB_ID,
  UTILITIES_WORKSPACE_TAB_ID,
} from './editorStore';
import { useRecipeStore } from './recipeStore';
import { useUIStore } from './uiStore';
import { notifyBlockedPath } from '../utils/blockedPath';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { coerceRuntimeMode } from '../../shared/runtimeModes';
import { isWorkerRunnerLanguage } from '../../shared/languageFamilies';
import type { RelativePath, RootId } from '../../shared/fs/brandedIds';
import { MAX_INPUT_ARGS_PER_SET, sanitizeInputSets } from './editorTabUtils';
import { loadLastAnswer } from './tabLastAnswer';
import {
  armPendingSessionRestoreSnapshot,
  clearPendingSessionRestoreSnapshot,
  dropRestorePrompt,
  getPendingSessionRestoreSnapshot,
  RESTORE_SESSION_PROMPT_KEY,
  setPendingSessionRestoreSnapshot,
  useSessionStore,
} from './sessionStore';

export async function restoreSavedSession(options: { only?: number }): Promise<void> {
  const { only } = options;
  // Pin the session first so reopening one tab keeps the others offered after autosave.
  if (only !== undefined && !getPendingSessionRestoreSnapshot()) armPendingSessionRestoreSnapshot();
  const pendingSnapshot = getPendingSessionRestoreSnapshot();
  const snapshot = pendingSnapshot ?? useSessionStore.getState();
  const picked = only === undefined ? snapshot : { savedTabs: snapshot.savedTabs.slice(only, only + 1), savedActiveIndex: 0 };
  const { savedTabs, savedActiveIndex } = picked;
  if (only !== undefined && savedTabs.length === 0) return;
  if (savedTabs.length === 0) {
    if (pendingSnapshot) {
      clearPendingSessionRestoreSnapshot();
    }
    return;
  }

  // Older sessions carry no answers, so the summary module loads only when one does.
  // A chunk that fails to load costs the answers, never the restore.
  const dropAnswer = (): undefined => undefined;
  const sanitizeLastAnswer = savedTabs.some(tab => tab.lastAnswer !== undefined)
    ? await loadLastAnswer().then(module => module.sanitizeLastAnswer, () => dropAnswer)
    : dropAnswer;

  const restored: Array<
    Parameters<ReturnType<typeof useEditorStore.getState>['restoreTabs']>[0][number] & {
      id: string;
    }
  > = [];

  // Restore is intentionally a translator, not a blind hydrate. It
  // converts the persisted session shape into the current `FileTab`
  // contract while preserving user intent across older workspace models.
  // SQL/HTTP MODEL rework — collapse legacy per-query/request
  // workspace tabs to a SINGLE stable workspace tab per kind. A
  // pre-rework session could hold N `sql` tabs (one per query) and
  // M `http` tabs; the new model keeps at most one of each. The
  // collection rehydrates from `useWorkspaceSqlStore` /
  // `useWorkspaceToolStore` regardless of how many session entries
  // pointed at it, so we keep the FIRST occurrence of each kind and
  // drop the rest. `savedActiveIndex` is remapped after the loop so
  // the active selection survives the collapse.
  let sqlWorkspaceRestored = false;
  let httpWorkspaceRestored = false;
  let utilitiesWorkspaceRestored = false;

  // Map each surviving saved index to the id it restored to, so we
  // can remap `savedActiveIndex` after collapsing duplicates. A
  // dropped duplicate maps to the stable id its kind collapsed onto
  // (so an active legacy duplicate still focuses the right tab).
  const savedIndexToRestoredId: Array<string | null> = [];

  for (let savedIdx = 0; savedIdx < savedTabs.length; savedIdx += 1) {
    const saved = savedTabs[savedIdx]!;
    let content = saved.content;
    let rootId: RootId | undefined;
    let relativePath: RelativePath | undefined;
    const restoredLastAnswer = sanitizeLastAnswer(saved.lastAnswer);
    const lastAnswerField = restoredLastAnswer ? { lastAnswer: restoredLastAnswer } : {};

    if (saved.filePath) {
      // re-mint a single-file capability for the
      // persisted tab. If the mint fails (path no longer exists,
      // denied, or not approved), fall through with empty content
      // so the user does not lose the tab outright.
      try {
        const reopen = await window.lingua.fs.reopenFile(saved.filePath);
        if (reopen.ok) {
          rootId = reopen.rootId;
          relativePath = reopen.fileRelativePath;
          content = await window.lingua.fs.read(rootId, relativePath);
        } else {
          // Name the denylist refusal so a restored tab whose
          // file now sits in a protected family explains itself.
          if (reopen.error === 'blocked') {
            void notifyBlockedPath(saved.filePath);
          }
          content = `// File not found: ${saved.name}\n`;
        }
      } catch {
        content = `// File not found: ${saved.name}\n`;
      }
    }

    const language =
      saved.kind === 'notebook'
        ? saved.language
        : saved.filePath
          ? resolveFileLanguageOrPlaintext(saved.filePath)
          : saved.language;

    // Restore the runtime mode for JS/TS
    // tabs, coercing missing / unknown / unimplemented values
    // back to `'worker'`. Non-JS/TS tabs always coerce to
    // `null`, so the spread below leaves `runtimeMode`
    // undefined on the restored FileTab.
    const restoredRuntimeMode = coerceRuntimeMode(saved.runtimeMode, language);

    // Restore the buffer only when the
    // resolved language still supports stdin. The editorStore
    // restore path also drops it via `dropStdinIfUnsupported`,
    // but trimming here keeps the in-memory tab structure
    // honest about which fields are live.
    const stdinSupported = isWorkerRunnerLanguage(language);
    const restoredStdinBuffer =
      stdinSupported && typeof saved.stdinBuffer === 'string' ? saved.stdinBuffer : undefined;
    const restoredInputSets = stdinSupported ? sanitizeInputSets(saved.inputSets) : [];
    const restoredActiveInputSetId =
      stdinSupported &&
      typeof saved.activeInputSetId === 'string' &&
      restoredInputSets.some(inputSet => inputSet.id === saved.activeInputSetId)
        ? saved.activeInputSetId
        : undefined;
    const restoredInputArgs =
      stdinSupported && Array.isArray(saved.inputArgs)
        ? saved.inputArgs
            .filter((arg): arg is string => typeof arg === 'string')
            .slice(0, MAX_INPUT_ARGS_PER_SET)
        : [];
    const restoredRecipeBindingId =
      language === 'javascript' &&
      typeof saved.recipeBindingId === 'string' &&
      saved.recipeBindingId.length > 0
        ? saved.recipeBindingId
        : undefined;

    // Restore the notebook discriminator AND
    // reuse the original tabId so the per-tab notebook payload
    // in `useNotebookStore` (keyed by tabId) lines up with the
    // restored FileTab. If the saved entry is missing
    // `notebookTabId` or the notebook store has no entry under
    // that key (settings reset, manual localStorage purge), we
    // still restore the discriminator and let NotebookView
    // create a blank notebook on first render — better than
    // dropping the tab outright.
    const restoredAsNotebook =
      saved.kind === 'notebook' &&
      typeof saved.notebookTabId === 'string' &&
      saved.notebookTabId.length > 0;

    // Workspace model rework — restore SQL / HTTP / Utilities tabs to
    // the SINGLE stable workspace id per kind. The collection of
    // queries/requests and active utility selection rehydrate from
    // their own stores, so the session entry only needs to re-create
    // the container tab. A corrupt entry (`kind: 'sql'`/`'http'`/
    // `'utilities'` with no
    // `workspaceTabId`) drops the discriminator and falls back to a
    // plain code tab, matching the prior contract for hand-edited
    // sessions. LEGACY sessions with N per-query tabs collapse:
    // the FIRST `sql` / FIRST `http` entry restores; later
    // duplicates are skipped (but still remap their active index
    // onto the surviving stable tab).
    const isSqlWorkspaceEntry =
      saved.kind === 'sql' &&
      typeof saved.workspaceTabId === 'string' &&
      saved.workspaceTabId.length > 0;
    const isHttpWorkspaceEntry =
      saved.kind === 'http' &&
      typeof saved.workspaceTabId === 'string' &&
      saved.workspaceTabId.length > 0;
    const isUtilitiesWorkspaceEntry =
      saved.kind === 'utilities' &&
      typeof saved.workspaceTabId === 'string' &&
      saved.workspaceTabId.length > 0;

    if (isSqlWorkspaceEntry) {
      // Collapse: a SQL workspace tab already restored → skip this
      // duplicate but point its active index at the surviving tab.
      if (sqlWorkspaceRestored) {
        savedIndexToRestoredId.push(SQL_WORKSPACE_TAB_ID);
        continue;
      }
      sqlWorkspaceRestored = true;
      restored.push({
        id: SQL_WORKSPACE_TAB_ID,
        // Stable workspace label — never a single query name.
        name: 'SQL',
        language: 'sql',
        content: '',
        kind: 'sql' as const,
        ...lastAnswerField,
      });
      savedIndexToRestoredId.push(SQL_WORKSPACE_TAB_ID);
      continue;
    }

    if (isHttpWorkspaceEntry) {
      if (httpWorkspaceRestored) {
        savedIndexToRestoredId.push(HTTP_WORKSPACE_TAB_ID);
        continue;
      }
      httpWorkspaceRestored = true;
      restored.push({
        id: HTTP_WORKSPACE_TAB_ID,
        name: 'HTTP',
        language: 'http',
        content: '',
        kind: 'http' as const,
        ...lastAnswerField,
      });
      savedIndexToRestoredId.push(HTTP_WORKSPACE_TAB_ID);
      continue;
    }

    if (isUtilitiesWorkspaceEntry) {
      if (utilitiesWorkspaceRestored) {
        savedIndexToRestoredId.push(UTILITIES_WORKSPACE_TAB_ID);
        continue;
      }
      utilitiesWorkspaceRestored = true;
      restored.push({
        id: UTILITIES_WORKSPACE_TAB_ID,
        name: 'Utilities',
        language: 'utilities',
        content: '',
        kind: 'utilities' as const,
        ...lastAnswerField,
      });
      savedIndexToRestoredId.push(UTILITIES_WORKSPACE_TAB_ID);
      continue;
    }

    const restoredId = restoredAsNotebook ? saved.notebookTabId! : crypto.randomUUID();
    let notebookDocumentHash = saved.notebookDocumentHash;
    if (restoredAsNotebook) {
      const { restoreNotebookDocument } = await import('./notebookDocumentRecovery');
      const recovered = await restoreNotebookDocument(
        restoredId,
        saved,
        Boolean(rootId),
        content
      );
      content = recovered.content;
      notebookDocumentHash = recovered.notebookDocumentHash;
    }

    restored.push({
      id: restoredId,
      name: saved.name,
      language,
      content,
      filePath: saved.filePath,
      rootId,
      relativePath,
      ...(restoredRuntimeMode !== null ? { runtimeMode: restoredRuntimeMode } : {}),
      // `restoreTabs` coerces an unsupported or tampered value.
      ...(typeof saved.workflowMode === 'string' ? { workflowMode: saved.workflowMode } : {}),
      ...(restoredStdinBuffer !== undefined ? { stdinBuffer: restoredStdinBuffer } : {}),
      ...(restoredInputSets.length > 0 ? { inputSets: restoredInputSets } : {}),
      ...(restoredActiveInputSetId !== undefined
        ? { activeInputSetId: restoredActiveInputSetId }
        : {}),
      ...(restoredInputArgs.length > 0 ? { inputArgs: restoredInputArgs } : {}),
      ...(restoredRecipeBindingId !== undefined
        ? { recipeBindingId: restoredRecipeBindingId }
        : {}),
      ...(restoredAsNotebook ? { kind: 'notebook' as const, notebookDocumentHash } : {}),
      ...lastAnswerField,
    });
    savedIndexToRestoredId.push(restoredId);
  }

  // Bypass the tier ceiling — restoring a prior session must
  // grandfather the user's workspace, not truncate it. Resolve the
  // active id through the saved-index → restored-id remap so a
  // collapsed legacy workspace duplicate still focuses the right
  // surviving tab. A dropped (non-workspace) entry maps to null,
  // so we fall back to no active tab in that edge case.
  const activeId =
    savedActiveIndex >= 0 && savedActiveIndex < savedIndexToRestoredId.length
      ? (savedIndexToRestoredId[savedActiveIndex] ?? null)
      : null;
  dropRestorePrompt();
  useEditorStore.getState().restoreTabs(restored, activeId, { append: only !== undefined || pendingSnapshot?.partial === true });
  const recipeStore = useRecipeStore.getState();
  for (const tab of restored) {
    if (tab.recipeBindingId !== undefined) {
      recipeStore.bindRecipeToTab(tab.id, tab.recipeBindingId);
    }
  }
  const activeRestoredTab = restored.find(tab => tab.id === activeId);
  if (activeRestoredTab?.recipeBindingId !== undefined) {
    useUIStore.getState().openBottomPanel('recipe');
  }
  const ui = useUIStore.getState();
  if (pendingSnapshot && ui.statusNotice?.messageKey === RESTORE_SESSION_PROMPT_KEY) ui.dismissStatusNotice('cta');
  if (pendingSnapshot && only !== undefined) {
    const rest = pendingSnapshot.savedTabs.filter((_, index) => index !== only);
    const active = pendingSnapshot.savedActiveIndex;
    const restActive = active === only ? Math.min(only, rest.length - 1) : active > only ? active - 1 : active;
    setPendingSessionRestoreSnapshot(rest.length > 0 ? { savedTabs: rest, savedActiveIndex: restActive, partial: true } : null);
  } else if (pendingSnapshot) {
    clearPendingSessionRestoreSnapshot();
  }
}

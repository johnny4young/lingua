/**
 * Persisted editor-session boundary.
 *
 * The store records only enough data to rebuild the visible workspace after a
 * reload: untitled tab content, disk-backed paths, active index, and stable ids
 * for surfaces whose data lives in their own persisted stores. Restore treats
 * the saved blob as stale/tamperable: disk tabs must re-mint file capabilities,
 * runtime modes are coerced through the shared enum guard, and legacy SQL/HTTP
 * workspace tabs collapse to the current one-tab-per-workspace model.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { EditorState, FileTab, InputSet } from '../types/editor';
import type { Language } from '../types/language';
import { createMigrate } from './persistence/migrationRegistry';
import { useEditorStore } from './editorStore';
import type { RuntimeMode } from '../../shared/runtimeModes';
import type { WorkflowMode } from '../../shared/workflowMode';
import type { LastAnswer } from '../utils/lastAnswer';

interface SessionTab {
  name: string;
  language: Language;
  /** Content for in-memory tabs; empty string for disk-backed tabs (re-read on restore). */
  content: string;
  /**
   * Display absolute path. Used at restore time only as an approval
   * lookup key for `fs:reopen-file`; the renderer never performs disk
   * I/O against this path directly.
   */
  filePath?: string;
  /**
   * per-tab runtime mode for JS/TS tabs. Missing /
   * unknown values are coerced back to `'worker'` for JS/TS at
   * restore time via `coerceRuntimeMode`, so a tampered or
   * legacy session entry never lands in an unimplemented mode.
   */
  runtimeMode?: RuntimeMode;
  /**
   * per-tab pre-set stdin buffer. Persisted
   * so a tab that ships an `input()` example survives a reload
   * alongside the editor content. Restored only for tabs whose
   * resolved language still supports stdin (JS / TS / Python); the
   * editorStore drops the field on rename / restore for any other
   * language.
   */
  stdinBuffer?: string;
  /** Named stdin/argv snapshots and the currently loaded draft. */
  inputSets?: InputSet[];
  activeInputSetId?: string;
  inputArgs?: string[];
  /**
   * Persisted recipe binding for tabs opened from
   * the Recipes overlay. Runtime run-results stay transient in
   * recipeStore; this id is enough to restore the prompt panel after
   * a reload.
   */
  recipeBindingId?: string;
  /** Scratchpad / Run / Debug choice; absent in sessions saved before it was persisted. */
  workflowMode?: WorkflowMode;
  /**
   * Discriminator flag persisted so the restore
   * path knows to route the tab through `<NotebookView>` instead of
   * the Monaco editor surface. The notebook payload itself lives in
   * the isolated `lingua-notebook-state` store keyed by the tab id
   * captured in `notebookTabId` below.
   *
   * Widened to `'sql'` / `'http'`, then
   * `'utilities'`. These route restore through full-screen workspace
   * tab surfaces instead of Monaco.
   *
   * SQL/HTTP MODEL rework — SQL and HTTP are now COLLECTION workspaces:
   * there is at most ONE SQL tab and ONE HTTP tab, each carrying a
   * stable constant id (`SQL_WORKSPACE_TAB_ID` / `HTTP_WORKSPACE_TAB_ID`).
   * The collection of queries/requests lives in `useWorkspaceSqlStore`
   * / `useWorkspaceToolStore` and rehydrates from its OWN localStorage
   * key, independent of the session tab. A session no longer encodes
   * per-query/request tabs; restore collapses any legacy duplicates to
   * the single workspace tab per kind (see `restoreSession`).
   */
  kind?: 'notebook' | 'sql' | 'http' | 'utilities';
  /**
   * Original tabId captured at save time. Notebook
   * state in `useNotebookStore` is keyed by tabId; without this
   * field, restoring would mint a fresh UUID and orphan the
   * persisted notebook entry. Only populated when `kind === 'notebook'`.
   */
  notebookTabId?: string;
  notebookDocumentHash?: string | null;
  /**
   * Original tabId captured at save time for SQL / HTTP / Utilities
   * workspace tabs.
   *
   * SQL/HTTP MODEL rework — the workspace tab now carries a stable
   * constant id, so saving always records that constant here and restore
   * reuses it. LEGACY sessions (pre-rework) recorded a per-query/request
   * UUID; restore tolerates those by collapsing every legacy `sql` /
   * `http` entry to the single stable workspace tab per kind. The
   * collection itself rehydrates from its own store key regardless, so
   * the legacy per-query id is no longer load-bearing for data recovery.
   * Only populated when `kind === 'sql'`, `kind === 'http'`, or
   * `kind === 'utilities'`.
   */
  workspaceTabId?: string;
  /** Last run's answer summary; absent in older sessions and for tabs that never ran. */
  lastAnswer?: LastAnswer;
}

interface SessionState {
  savedTabs: SessionTab[];
  savedActiveIndex: number;
  /** Tabs the pinned ask-mode snapshot still offers; in memory only, so Start can follow it. */
  pendingRestoreTabs: number;
  saveSession: () => void;
  /** `only` reopens one saved tab beside the open ones; the rest stay offered. */
  restoreSession: (options?: { only?: number }) => Promise<void>;
}

export interface PendingSessionRestoreSnapshot {
  savedTabs: SessionTab[];
  savedActiveIndex: number;
  /** Some tabs were already reopened, so restoring the rest must keep the open tabs. */
  partial?: boolean;
}

let pendingSessionRestoreSnapshot: PendingSessionRestoreSnapshot | null = null;
let restoreInFlight: Promise<void> | null = null;

/** Replaces the pinned snapshot and the count Start follows. */
export function setPendingSessionRestoreSnapshot(snapshot: PendingSessionRestoreSnapshot | null): void {
  pendingSessionRestoreSnapshot = snapshot;
  useSessionStore.setState({ pendingRestoreTabs: snapshot?.savedTabs.length ?? 0 });
}

/** The ask-mode prompt that offers the pinned snapshot; any restore of it answers the prompt. */
export const RESTORE_SESSION_PROMPT_KEY = 'editor.restoreSession.prompt';

function cloneSessionTabs(tabs: readonly SessionTab[]): SessionTab[] {
  return tabs.map(tab => ({ ...tab }));
}

/**
 * Ask-mode boot prompt guard.
 *
 * The saved-session store keeps auto-saving in ask mode so future restarts have
 * a fresh snapshot. That means the visible "Restore last session" prompt cannot
 * read `savedTabs` lazily at click time: onboarding, a new manual tab, or any
 * normal edit may have already replaced the persisted snapshot. Keep the boot
 * snapshot in memory until an explicit restore consumes it, so both the prompt
 * CTA and the palette fallback restore the same previous-session tabs they
 * advertised even if `savedTabs` changes after boot.
 */
export function armPendingSessionRestoreSnapshot(): number {
  const { savedTabs, savedActiveIndex } = useSessionStore.getState();
  setPendingSessionRestoreSnapshot(savedTabs.length === 0 ? null : { savedTabs: cloneSessionTabs(savedTabs), savedActiveIndex });
  return savedTabs.length;
}

export function getPendingSessionRestoreTabCount(): number {
  return pendingSessionRestoreSnapshot?.savedTabs.length ?? 0;
}

export function clearPendingSessionRestoreSnapshot(): void {
  setPendingSessionRestoreSnapshot(null);
}

/** The boot snapshot an explicit restore would bring back, if one is armed. */
export function getPendingSessionRestoreSnapshot(): Readonly<PendingSessionRestoreSnapshot> | null {
  return pendingSessionRestoreSnapshot;
}

/**
 * Per-tab arm of {@link sessionSnapshotEqual}. Compares only the
 * fields `saveSession()` serializes into a `SessionTab`, with the
 * same conditional semantics: `content` matters only for tabs without
 * a `filePath` (disk-backed tabs persist `content: ''` and re-read
 * from disk on restore), and the tab `id` matters because it feeds
 * `notebookTabId` / `workspaceTabId` and the saved active index.
 * Transient fields (`isDirty`, `executionState`, `parseError`, cursor
 * state) are deliberately ignored — mutating them cannot change the
 * persisted snapshot.
 */
function sessionTabEqual(a: FileTab, b: FileTab): boolean {
  if (a === b) return true;
  if (a.filePath !== b.filePath) return false;
  return (
    a.id === b.id &&
    a.name === b.name &&
    (a.kind !== 'notebook' || a.notebookDocumentHash === b.notebookDocumentHash) &&
    a.language === b.language &&
    // Notebook content is the last saved baseline, needed to recover dirty cells.
    // Other disk-backed tabs still persist no buffer content.
    (a.filePath && a.kind !== 'notebook' ? true : a.content === b.content) &&
    a.runtimeMode === b.runtimeMode &&
    a.workflowMode === b.workflowMode &&
    a.stdinBuffer === b.stdinBuffer &&
    inputSetsEqual(a.inputSets, b.inputSets) &&
    a.activeInputSetId === b.activeInputSetId &&
    stringArrayEqual(a.inputArgs, b.inputArgs) &&
    a.recipeBindingId === b.recipeBindingId &&
    a.lastAnswer === b.lastAnswer &&
    a.kind === b.kind
  );
}

function stringArrayEqual(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

function inputSetsEqual(
  a: readonly InputSet[] | undefined,
  b: readonly InputSet[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  return a.every((inputSet, index) => {
    const other = b[index];
    return (
      other !== undefined &&
      inputSet.id === other.id &&
      inputSet.name === other.name &&
      inputSet.stdin === other.stdin &&
      stringArrayEqual(inputSet.args, other.args)
    );
  });
}

/**
 * Equality over the EXACT editor-store projection
 * `saveSession()` serializes. `useSessionAutoSave` calls this with
 * zustand's `(state, prevState)` pair to skip re-arming the debounced
 * session save when a mutation cannot change the persisted snapshot
 * (`pendingReveal`, `isDirty` churn, per-run `setTabExecutionState`
 * flips). Referential fast paths keep it O(1) for any mutation that
 * does not replace the `tabs` array.
 *
 * BINDING CONTRACT: every field `saveSession()` reads must be compared
 * here (via {@link sessionTabEqual}) with the same conditional
 * semantics. When `saveSession` learns a new field, this helper must
 * learn it in the same commit — `tests/stores/sessionStore.test.ts`
 * enforces the pairing by asserting that states judged equal serialize
 * byte-identically and that every persisted field flips the equality.
 */
export function sessionSnapshotEqual(
  a: Pick<EditorState, 'tabs' | 'activeTabId'>,
  b: Pick<EditorState, 'tabs' | 'activeTabId'>
): boolean {
  if (a.activeTabId !== b.activeTabId) return false;
  if (a.tabs === b.tabs) return true;
  if (a.tabs.length !== b.tabs.length) return false;
  return a.tabs.every((tab, index) => sessionTabEqual(tab, b.tabs[index]!));
}

export const useSessionStore = create<SessionState>()(
  persist(
    (set) => ({
      savedTabs: [],
      savedActiveIndex: -1,
      pendingRestoreTabs: 0,

      saveSession: () => {
        const { tabs, activeTabId } = useEditorStore.getState();
        const savedTabs: SessionTab[] = tabs.map(tab => ({
          name: tab.name,
          language: tab.language,
          // Disk-backed tabs persist only the path; restore re-reads via
          // a freshly minted capability so we never persist file content
          // we are about to re-fetch anyway. Untitled tabs persist their
          // content so the user does not lose unsaved work.
          content: tab.filePath && tab.kind !== 'notebook' ? '' : tab.content,
          ...(tab.kind === 'notebook' ? { notebookDocumentHash: tab.notebookDocumentHash } : {}),
          filePath: tab.filePath,
          // Persist the runtime mode alongside the
          // tab. Non-JS/TS tabs have `runtimeMode === undefined`, so
          // the field is omitted from the serialized output.
          runtimeMode: tab.runtimeMode,
          workflowMode: tab.workflowMode,
          // Persist the per-tab stdin buffer
          // so an exploration session that ships pre-set input
          // survives a reload. The editor store drops the field on
          // rename / restore for languages that don't support it,
          // so a tampered persisted entry can't leak the buffer onto
          // a Rust / Go / JSON tab.
          stdinBuffer: tab.stdinBuffer,
          inputSets: tab.inputSets,
          activeInputSetId: tab.activeInputSetId,
          inputArgs: tab.inputArgs,
          recipeBindingId: tab.recipeBindingId,
          lastAnswer: tab.lastAnswer,
          // Preserve the notebook discriminator + the
          // original tabId so the per-tab notebook payload in
          // `useNotebookStore` survives a reload (the store is keyed
          // by tabId; without this, restore would mint a fresh UUID
          // and the persisted notebook would be orphaned).
          //
          // Same treatment for SQL / HTTP / Utilities
          // workspace tabs. The discriminator routes restore through the
          // workspace tab surface, and `workspaceTabId` pins the original id
          // so the stable tab can be re-created without treating it like a
          // disk-backed document.
          kind:
            tab.kind === 'notebook' ||
            tab.kind === 'sql' ||
            tab.kind === 'http' ||
            tab.kind === 'utilities'
              ? tab.kind
              : undefined,
          notebookTabId: tab.kind === 'notebook' ? tab.id : undefined,
          workspaceTabId:
            tab.kind === 'sql' || tab.kind === 'http' || tab.kind === 'utilities'
              ? tab.id
              : undefined,
        }));
        const activeIndex = tabs.findIndex(t => t.id === activeTabId);
        set({ savedTabs, savedActiveIndex: activeIndex });
      },

      restoreSession: (options = {}) => {
        // A double click, or the prompt racing Start, must not restore the same tabs twice.
        restoreInFlight ??= import('./sessionRestore')
          .then(module => module.restoreSavedSession(options))
          .finally(() => {
            restoreInFlight = null;
          });
        return restoreInFlight;
      },
    }),
    {
      name: 'lingua-session',
      version: 2,
      migrate: createMigrate('lingua-session'),
      // Only the serializable snapshot belongs in localStorage. Actions and
      // live editor/UI state are rebuilt from the store creators at runtime.
      partialize: state => ({
        savedTabs: state.savedTabs,
        savedActiveIndex: state.savedActiveIndex,
      }),
    }
  )
);

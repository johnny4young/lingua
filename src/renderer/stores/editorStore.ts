import { create } from 'zustand';
import type { EditorState, FileTab, Language } from '../types';
import { getActiveAppLanguage } from '../i18n';
import { defaultCodeForLanguage, extensionForLanguage } from '../utils/languageMeta';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { joinAbsolute } from '../utils/filePath';
import {
  formatSource,
  isFormatterSupported,
  type FormatterFailure,
} from '../utils/formatters';
import i18next from 'i18next';
import { useProjectStore } from './projectStore';
import { useRecentFilesStore } from './recentFilesStore';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';
import { currentEffectiveTier } from '../hooks/useEntitlement';
import { isLanguageAllowed, withinTabBudget } from '../../shared/entitlements';
import { pushUpsellNotice } from '../utils/upsellNotice';
import { trackEvent } from '../utils/telemetry';
import {
  coerceRuntimeMode,
  defaultRuntimeModeFor,
  isRuntimeModeImplemented,
  languageHasRuntimeModes,
  type RuntimeMode,
} from '../../shared/runtimeModes';

function runtimeModeForNewTab(
  language: Language,
  explicit?: RuntimeMode
): RuntimeMode | undefined {
  if (!languageHasRuntimeModes(language)) return undefined;
  if (explicit !== undefined) return coerceRuntimeMode(explicit, language) ?? undefined;
  const settingsDefault = useSettingsStore.getState().defaultRuntimeMode;
  return (
    coerceRuntimeMode(settingsDefault, language) ??
    defaultRuntimeModeFor(language) ??
    undefined
  );
}

function runtimeModeForRestoredTab(
  language: Language,
  persisted?: RuntimeMode
): RuntimeMode | undefined {
  return coerceRuntimeMode(persisted, language) ?? undefined;
}

export const createDefaultTab = (language: Language = 'javascript'): FileTab => {
  const id = crypto.randomUUID();
  const short = id.slice(0, 8);
  // RL-019 Slice 1 — JS/TS tabs adopt the per-app default mode (fold
  // B). Non-JS/TS tabs deliberately omit the field.
  const runtimeMode = runtimeModeForNewTab(language);
  return {
    id,
    name: `untitled-${short}.${extensionForLanguage(language)}`,
    language,
    content: defaultCodeForLanguage(language),
    isDirty: false,
    runtimeMode,
  };
};

export { languageFromPath } from '../utils/language';

const FORMATTER_FAILURE_NOTICE: Record<FormatterFailure, { tone: 'error' | 'info'; messageKey: string } | null> = {
  unsupported: null,
  'parse-error': { tone: 'error', messageKey: 'editor.formatOnSave.parseError' },
  'binary-missing': { tone: 'error', messageKey: 'editor.formatOnSave.binaryMissing' },
  'web-unavailable': { tone: 'info', messageKey: 'editor.formatOnSave.webUnavailable' },
  unknown: { tone: 'error', messageKey: 'editor.formatOnSave.unknownError' },
};

/**
 * Try to format `content` when `formatOnSave` is enabled and the tab's
 * language has a formatter strategy. Emits a dismissable status notice on
 * failure but never throws — we always fall back to saving the original
 * content so format issues never block persistence.
 */
async function resolveFormattedContent(
  tab: FileTab
): Promise<string> {
  const { formatOnSave } = useSettingsStore.getState();
  if (!formatOnSave) return tab.content;
  if (!isFormatterSupported(tab.language)) return tab.content;

  const result = await formatSource(tab.language, tab.content);
  if (result.ok) return result.formatted;

  const notice = FORMATTER_FAILURE_NOTICE[result.failure];
  if (notice) {
    useUIStore.getState().pushStatusNotice({
      tone: notice.tone,
      messageKey: notice.messageKey,
      values: { name: tab.name },
      detail: result.message,
    });
  }
  return tab.content;
}

function basename(filePath: string): string {
  return filePath.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? filePath;
}

/**
 * RL-077 — write the tab to disk through the capability registry.
 *
 *   - If the tab already carries a `{ rootId, relativePath }` pair
 *     and we are not in Save-As, write through that capability.
 *   - Otherwise prompt the save dialog: main mints a fresh capability
 *     bound to the parent directory of the chosen target, and we
 *     write the file under that capability's relative path.
 *
 * `tab.filePath` is kept up to date as a display-only string for
 * tooltips and session-store persistence, but is never sent to an IPC
 * handler — every actual filesystem touch goes through `rootId`.
 */
async function persistTab(
  tab: FileTab,
  forceSaveAs = false
): Promise<
  | (FileTab & { filePath: string; rootId: string; relativePath: string })
  | null
> {
  let rootId: string | undefined = tab.rootId;
  let relativePath: string | undefined = tab.relativePath;
  let absolutePath: string | undefined = tab.filePath;
  let mintedRootId: string | null = null;

  const needsPicker = forceSaveAs || !rootId || !relativePath;
  if (needsPicker) {
    const result = await window.lingua.fs.saveDialog(tab.name);
    if (result.canceled) return null;
    rootId = result.rootId;
    mintedRootId = result.rootId;
    relativePath = result.fileRelativePath;
    absolutePath = joinAbsolute(result.rootPath, result.fileRelativePath);
  }

  if (!rootId || !relativePath || !absolutePath) {
    return null;
  }

  const name = basename(absolutePath);
  const language = resolveFileLanguageOrPlaintext(name);
  const runtimeMode = runtimeModeForRestoredTab(language, tab.runtimeMode);
  const nextTab: FileTab & { filePath: string; rootId: string; relativePath: string } = {
    ...tab,
    filePath: absolutePath,
    rootId,
    relativePath,
    name,
    language,
    runtimeMode,
  };
  let content: string;
  try {
    content = await resolveFormattedContent(nextTab);
    const wrote = await window.lingua.fs.write(rootId, relativePath, content);
    if (!wrote) {
      if (mintedRootId) await window.lingua.fs.revokeRoot(mintedRootId).catch(() => {});
      return null;
    }
  } catch (error) {
    if (mintedRootId) await window.lingua.fs.revokeRoot(mintedRootId).catch(() => {});
    throw error;
  }

  return {
    ...nextTab,
    content,
    isDirty: false,
  };
}

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  pendingReveal: null,

  requestReveal: (target) => {
    // `line` must be at least 1 — Monaco rejects 0-indexed positions. We clamp
    // defensively so upstream surfaces (Project Search, Go to Symbol) can stay
    // agnostic about Monaco's 1-indexed contract.
    if (!target.filePath && !target.tabId) {
      throw new Error('requestReveal requires either filePath or tabId');
    }
    const safeLine = Math.max(1, Math.floor(target.line));
    const safeColumn =
      target.column === undefined ? undefined : Math.max(1, Math.floor(target.column));
    set({
      pendingReveal: {
        filePath: target.filePath,
        tabId: target.tabId,
        line: safeLine,
        column: safeColumn,
      },
    });
  },

  clearPendingReveal: () => set({ pendingReveal: null }),

  addTab: (tab) => {
    const { tabs } = get();
    if (!isLanguageAllowed(currentEffectiveTier(), tab.language)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraLanguages'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'languages-extended',
        tier: currentEffectiveTier(),
      });
      return;
    }
    // RL-060: block new-tab creation once the Free ceiling is hit. Users
    // already over the ceiling (grandfathered data from before gating
    // shipped) keep their tabs; only additions past the ceiling are
    // refused so nobody loses work in the upgrade.
    if (!withinTabBudget(currentEffectiveTier(), tabs.length + 1)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraTabs'),
      });
      // RL-065 — emit feature.blocked so the consenting user's
      // telemetry reflects the friction. Allowlist already permits
      // this event with `entitlement` + `tier`.
      void trackEvent('feature.blocked', {
        entitlement: 'tabs',
        tier: currentEffectiveTier(),
      });
      return;
    }
    // RL-019 Slice 1 — defensively assign a runtime mode if the
    // caller forgot. Most call sites go through `createDefaultTab`
    // which already sets it, but `addTab({ ...tab, content })`
    // callers might rebuild the object and lose the field.
    const runtimeMode = runtimeModeForNewTab(tab.language, tab.runtimeMode);
    const newTab: FileTab = { ...tab, isDirty: false, runtimeMode };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
  },

  restoreTabs: (tabs, activeTabId) =>
    set({
      tabs: tabs.map((tab) => ({
        ...tab,
        isDirty: false,
        // RL-019 Slice 1 — backfill missing runtime modes for JS/TS
        // tabs restored from a pre-Slice-1 session. Non-JS/TS tabs
        // never carry the field.
        runtimeMode: runtimeModeForRestoredTab(tab.language, tab.runtimeMode),
      })),
      activeTabId: activeTabId ?? null,
    }),

  removeTab: (id) =>
    set((state) => {
      const target = state.tabs.find((t) => t.id === id);
      const tabs = state.tabs.filter((t) => t.id !== id);
      const activeTabId =
        state.activeTabId === id
          ? tabs[tabs.length - 1]?.id ?? null
          : state.activeTabId;
      // RL-077 — revoke a tab-private capability when the last tab
      // using it goes away. Project-tree opens share the active
      // project's `rootId` (revoked centrally by `closeProject`), so
      // we leave that one alone; single-file picker / deep-link /
      // session-restore mints are unique per tab and would otherwise
      // accumulate in main's registry until app shutdown.
      if (target?.rootId) {
        const stillUsed = tabs.some((t) => t.rootId === target.rootId);
        const projectRootId =
          useProjectStore.getState().currentProject?.rootId;
        if (!stillUsed && target.rootId !== projectRootId) {
          void window.lingua.fs
            .revokeRoot(target.rootId)
            .catch(() => {});
        }
      }
      return { tabs, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateContent: (id, content) =>
    set((state) => ({
      // RL-070 — clear lifecycle markers when the user edits the buffer.
      // A stale `error` dot or `running` state would mislead the user
      // about the current code's outcome; reset to `idle` so the next
      // run produces a fresh signal.
      tabs: state.tabs.map((t) =>
        t.id === id
          ? {
              ...t,
              content,
              isDirty: true,
              executionState: 'idle' as const,
              parseError: null,
            }
          : t
      ),
    })),

  setTabExecutionState: (id, executionState, parseError = null) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, executionState, parseError } : t
      ),
    })),

  setTabRuntimeMode: (id, mode) => {
    const { tabs } = get();
    const target = tabs.find((t) => t.id === id);
    if (!target) return;
    if (!languageHasRuntimeModes(target.language)) {
      // Non-JS/TS tabs do not own a runtime-mode surface. Refuse
      // silently — the selector is hidden so this branch is only
      // reachable via a programmatic / palette / shortcut call.
      return;
    }
    if (!isRuntimeModeImplemented(mode)) {
      // RL-019 Slice 1 fold G — surface a status notice when the
      // user (via shortcut, palette, or programmatic call) tries to
      // switch into a mode that has not landed yet. The notice
      // names the slice that will deliver it.
      const noticeKey =
        mode === 'node'
          ? 'runtimeMode.notice.notImplementedNode'
          : 'runtimeMode.notice.notImplementedBrowserPreview';
      useUIStore.getState().pushStatusNotice({
        tone: 'info',
        messageKey: noticeKey,
      });
      return;
    }
    if (target.runtimeMode === mode) return;
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, runtimeMode: mode } : t
      ),
    }));
    // RL-019 Slice 1 fold G — confirm the change with a soft
    // status-notice toast. The selector itself flips immediately;
    // this is the audit trail for users who change modes via the
    // keyboard cycle or the command palette.
    useUIStore.getState().pushStatusNotice({
      tone: 'info',
      messageKey: 'runtimeMode.changedNotice',
      values: { mode: i18next.t(`runtimeMode.mode.${mode === 'browser-preview' ? 'browserPreview' : mode}`) },
    });
    // RL-019 Slice 1 fold A — funnel telemetry for runtime-mode
    // adoption. Both `mode` and `language` are closed enums; the
    // shared allowlist + worker mirror enforce the contract.
    void trackEvent('runtime.mode_changed', {
      mode,
      language: target.language,
    });
  },

  markSaved: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isDirty: false } : t
      ),
    })),

  openFile: async (rootId, relativePath, name, language, displayPath) => {
    const { tabs } = get();

    const existing = tabs.find(
      (t) => t.rootId === rootId && t.relativePath === relativePath
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    if (!withinTabBudget(currentEffectiveTier(), tabs.length + 1)) {
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraTabs'),
      });
      // RL-065 — same emit on the openFile gate so both rejection
      // paths surface a feature.blocked event.
      void trackEvent('feature.blocked', {
        entitlement: 'tabs',
        tier: currentEffectiveTier(),
      });
      return;
    }

    const content = await window.lingua.fs.read(rootId, relativePath);
    const filePath = displayPath ?? relativePath;

    const newTab: FileTab = {
      id: crypto.randomUUID(),
      name,
      language,
      content,
      isDirty: false,
      rootId,
      relativePath,
      filePath,
      // RL-019 Slice 1 — disk-backed JS/TS opens adopt the per-app
      // default runtime mode; non-JS/TS files leave the field unset.
      runtimeMode: runtimeModeForNewTab(language),
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));

    useRecentFilesStore.getState().addRecentFile({ filePath, name, language });
  },

  openFileFromDisk: async () => {
    const result = await window.lingua.fs.selectFile();
    if (result.canceled) return;
    const language = resolveFileLanguageOrPlaintext(result.fileName);
    const { tabs } = get();
    const filePath = joinAbsolute(result.rootPath, result.fileRelativePath);

    const existing = tabs.find(
      (t) =>
        (t.rootId === result.rootId && t.relativePath === result.fileRelativePath) ||
        t.filePath === filePath
    );
    if (existing) {
      await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
      set({ activeTabId: existing.id });
      return;
    }

    if (!withinTabBudget(currentEffectiveTier(), tabs.length + 1)) {
      await window.lingua.fs.revokeRoot(result.rootId).catch(() => {});
      pushUpsellNotice({
        messageKey: 'upsell.freeCeilingReached',
        featureLabel: i18next.t('upsell.feature.extraTabs'),
      });
      void trackEvent('feature.blocked', {
        entitlement: 'tabs',
        tier: currentEffectiveTier(),
      });
      return;
    }

    const newTab: FileTab = {
      id: crypto.randomUUID(),
      name: result.fileName,
      language,
      content: result.content,
      isDirty: false,
      rootId: result.rootId,
      relativePath: result.fileRelativePath,
      filePath,
      // RL-019 Slice 1 — same JS/TS default mode as openFile().
      runtimeMode: runtimeModeForNewTab(language),
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));

    useRecentFilesStore
      .getState()
      .addRecentFile({ filePath, name: result.fileName, language });
  },

  saveActiveTab: async () => {
    const { activeTabId, saveTabById } = get();
    if (!activeTabId) return;
    await saveTabById(activeTabId);
  },

  saveActiveTabAs: async () => {
    const { activeTabId, saveTabById } = get();
    if (!activeTabId) return;
    await saveTabById(activeTabId, true);
  },

  saveTabById: async (id, forceSaveAs = false) => {
    const { tabs } = get();
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return false;

    const previousPath = tab.filePath;
    const previousRootId = tab.rootId;
    const savedTab = await persistTab(tab, forceSaveAs);
    if (!savedTab) return false;

    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? savedTab : t)),
    }));

    if (previousRootId && previousRootId !== savedTab.rootId) {
      const rootStillUsed = tabs.some(
        (t) => t.id !== id && t.rootId === previousRootId
      );
      const projectRootId = useProjectStore.getState().currentProject?.rootId;
      if (!rootStillUsed && previousRootId !== projectRootId) {
        await window.lingua.fs.revokeRoot(previousRootId).catch(() => {});
      }
    }

    if (forceSaveAs || previousPath !== savedTab.filePath) {
      useRecentFilesStore.getState().addRecentFile({
        filePath: savedTab.filePath,
        name: savedTab.name,
        language: savedTab.language,
      });
    }

    return true;
  },

  closeTab: async (id) => {
    const { tabs, removeTab, saveTabById } = get();
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return true;

    if (!tab.isDirty) {
      removeTab(id);
      return true;
    }

    // Show confirmation dialog
    const response = await window.lingua.confirmCloseTab(
      tab.name,
      getActiveAppLanguage()
    );
    if (response === 0) {
      const saved = await saveTabById(id);
      if (!saved) return false;
      removeTab(id);
      return true;
    } else if (response === 1) {
      // Discard
      removeTab(id);
      return true;
    }
    // Cancel
    return false;
  },

  duplicateActiveTab: () => {
    const { tabs, activeTabId, addTab } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    addTab({
      id: crypto.randomUUID(),
      name: `Copy of ${tab.name}`,
      language: tab.language,
      content: tab.content,
    });
  },

  /**
   * Rename a tab in place. The new name flows through
   * `resolveFileLanguageOrPlaintext` so a `.py` → `.go` rename also
   * flips the Monaco language. The tab is marked dirty because the
   * on-disk filename diverges from the in-memory one until the next
   * save reuses Save As.
   *
   * No-ops when the tab does not exist or the trimmed name is empty,
   * so accidental Enter on an empty rename input does not silently
   * destroy the filename.
   */
  renameTab: (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    set((state) => {
      const next = state.tabs.map((tab) => {
        if (tab.id !== id) return tab;
        if (tab.name === trimmed) return tab;
        const language = resolveFileLanguageOrPlaintext(trimmed);
        const runtimeMode = runtimeModeForRestoredTab(language, tab.runtimeMode);
        return {
          ...tab,
          name: trimmed,
          language,
          runtimeMode,
          isDirty: true,
        };
      });
      return { tabs: next };
    });
  },

  /**
   * Close every tab whose id is NOT the supplied one. Each dirty tab
   * still funnels through `closeTab` so the existing
   * `confirmCloseTab` prompt is honored — the user cannot lose
   * unsaved work via this bulk action even when triggered by a
   * single context-menu click.
   */
  closeOtherTabs: async (id) => {
    const { tabs, closeTab } = get();
    const targets = tabs.filter((tab) => tab.id !== id).map((tab) => tab.id);
    for (const tabId of targets) {
      const closed = await closeTab(tabId);
      if (!closed) break;
    }
  },

  /**
   * Close every tab to the right of the supplied id, preserving the
   * pivot. Same dirty-check contract as `closeOtherTabs`.
   */
  closeTabsToRight: async (id) => {
    const { tabs, closeTab } = get();
    const pivot = tabs.findIndex((tab) => tab.id === id);
    if (pivot < 0) return;
    const targets = tabs.slice(pivot + 1).map((tab) => tab.id);
    for (const tabId of targets) {
      const closed = await closeTab(tabId);
      if (!closed) break;
    }
  },

  /**
   * Close every open tab. Goes through `closeTab` per-tab so dirty
   * prompts still fire — the user can cancel mid-batch.
   */
  closeAllTabs: async () => {
    const { tabs, closeTab } = get();
    const targets = tabs.map((tab) => tab.id);
    for (const tabId of targets) {
      const closed = await closeTab(tabId);
      if (!closed) break;
    }
  },
}));

import { create } from 'zustand';
import type { EditorState, FileTab, Language } from '../types';
import { getActiveAppLanguage } from '../i18n';
import { defaultCodeForLanguage, extensionForLanguage } from '../utils/languageMeta';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import {
  formatSource,
  isFormatterSupported,
  type FormatterFailure,
} from '../utils/formatters';
import { useRecentFilesStore } from './recentFilesStore';
import { useSettingsStore } from './settingsStore';
import { useUIStore } from './uiStore';

export const createDefaultTab = (language: Language = 'javascript'): FileTab => {
  const id = crypto.randomUUID();
  const short = id.slice(0, 8);
  return {
    id,
    name: `untitled-${short}.${extensionForLanguage(language)}`,
    language,
    content: defaultCodeForLanguage(language),
    isDirty: false,
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
  return filePath.split('/').pop() ?? filePath.split('\\').pop() ?? filePath;
}

async function persistTab(
  tab: FileTab,
  forceSaveAs = false
): Promise<(FileTab & { filePath: string }) | null> {
  const targetPath =
    forceSaveAs || !tab.filePath
      ? await window.lingua.fs.saveDialog(tab.name)
      : tab.filePath;

  if (!targetPath) {
    return null;
  }

  const name = basename(targetPath);
  const language = resolveFileLanguageOrPlaintext(name);
  const nextTab: FileTab & { filePath: string } = {
    ...tab,
    filePath: targetPath,
    name,
    language,
  };
  const content = await resolveFormattedContent(nextTab);
  await window.lingua.fs.write(targetPath, content);

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
    const newTab: FileTab = { ...tab, isDirty: false };
    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));
  },

  removeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== id);
      const activeTabId =
        state.activeTabId === id
          ? tabs[tabs.length - 1]?.id ?? null
          : state.activeTabId;
      return { tabs, activeTabId };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),

  updateContent: (id, content) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, content, isDirty: true } : t
      ),
    })),

  markSaved: (id) =>
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === id ? { ...t, isDirty: false } : t
      ),
    })),

  openFile: async (filePath, name, language) => {
    const { tabs } = get();

    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    const content = await window.lingua.fs.read(filePath);

    const newTab: FileTab = {
      id: crypto.randomUUID(),
      name,
      language,
      content,
      isDirty: false,
      filePath,
    };

    set((state) => ({
      tabs: [...state.tabs, newTab],
      activeTabId: newTab.id,
    }));

    useRecentFilesStore.getState().addRecentFile({ filePath, name, language });
  },

  openFileFromDisk: async () => {
    const filePath = await window.lingua.fs.selectFile();
    if (!filePath) return;
    const name = filePath.split('/').pop() ?? filePath.split('\\').pop() ?? 'file';
    const language = resolveFileLanguageOrPlaintext(name);
    await get().openFile(filePath, name, language);
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
    const savedTab = await persistTab(tab, forceSaveAs);
    if (!savedTab) return false;

    set((state) => ({
      tabs: state.tabs.map((t) => (t.id === id ? savedTab : t)),
    }));

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
}));

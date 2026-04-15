import { create } from 'zustand';
import type { EditorState, FileTab, Language } from '../types';
import { getActiveAppLanguage } from '../i18n';
import { defaultCodeForLanguage, extensionForLanguage } from '../utils/languageMeta';
import { resolveFileLanguageOrPlaintext } from '../utils/language';
import { useRecentFilesStore } from './recentFilesStore';

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

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [],
  activeTabId: null,

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
    const { tabs, activeTabId, saveActiveTabAs } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    // If no filePath, delegate to Save As
    if (!tab.filePath) {
      await saveActiveTabAs();
      return;
    }

    await window.lingua.fs.write(tab.filePath, tab.content);
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tab.id ? { ...t, isDirty: false } : t
      ),
    }));
  },

  saveActiveTabAs: async () => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    const chosenPath = await window.lingua.fs.saveDialog(tab.name);
    if (!chosenPath) return;

    await window.lingua.fs.write(chosenPath, tab.content);
    const name = chosenPath.split('/').pop() ?? chosenPath.split('\\').pop() ?? tab.name;
    const language = resolveFileLanguageOrPlaintext(name);
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tab.id
          ? { ...t, filePath: chosenPath, name, language, isDirty: false }
          : t
      ),
    }));

    useRecentFilesStore.getState().addRecentFile({ filePath: chosenPath, name, language });
  },

  closeTab: async (id) => {
    const { tabs, removeTab } = get();
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
      // Save first
      if (tab.filePath) {
        await window.lingua.fs.write(tab.filePath, tab.content);
      } else {
        const chosenPath = await window.lingua.fs.saveDialog(tab.name);
        if (!chosenPath) return false; // User cancelled Save As
        await window.lingua.fs.write(chosenPath, tab.content);
        const name = chosenPath.split('/').pop() ?? chosenPath.split('\\').pop() ?? tab.name;
        const language = resolveFileLanguageOrPlaintext(name);
        useRecentFilesStore.getState().addRecentFile({
          filePath: chosenPath,
          name,
          language,
        });
      }
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

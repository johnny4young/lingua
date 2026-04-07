import { create } from 'zustand';
import type { EditorState, FileTab, Language } from '../types';
import { defaultCodeForLanguage, extensionForLanguage } from '../utils/languageMeta';

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

const initialTab = createDefaultTab('javascript');

export const useEditorStore = create<EditorState>((set, get) => ({
  tabs: [initialTab],
  activeTabId: initialTab.id,

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

    // If already open, just activate the tab
    const existing = tabs.find((t) => t.filePath === filePath);
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }

    // Read file content from disk
    const content = await window.runlang.fs.read(filePath);

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
  },

  saveActiveTab: async () => {
    const { tabs, activeTabId } = get();
    const tab = tabs.find((t) => t.id === activeTabId);
    if (!tab || !tab.filePath) return;

    await window.runlang.fs.write(tab.filePath, tab.content);
    set((state) => ({
      tabs: state.tabs.map((t) =>
        t.id === tab.id ? { ...t, isDirty: false } : t
      ),
    }));
  },
}));

import { create } from 'zustand';
import type { EditorState, FileTab, Language } from '../types';

const DEFAULT_CONTENT: Record<Language, string> = {
  javascript: '// Welcome to RunLang\nconsole.log("Hello, World!");\n',
  typescript: '// Welcome to RunLang\nconst greeting: string = "Hello, World!";\nconsole.log(greeting);\n',
  go: '// Welcome to RunLang\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n',
  python: '# Welcome to RunLang\nprint("Hello, World!")\n',
  rust: '// Welcome to RunLang\nfn main() {\n    println!("Hello, World!");\n}\n',
};

let tabCounter = 0;

const EXT: Record<Language, string> = {
  javascript: 'js',
  typescript: 'ts',
  go: 'go',
  python: 'py',
  rust: 'rs',
};

export const createDefaultTab = (language: Language = 'javascript'): FileTab => {
  tabCounter++;
  return {
    id: `tab-${tabCounter}`,
    name: `untitled-${tabCounter}.${EXT[language]}`,
    language,
    content: DEFAULT_CONTENT[language],
    isDirty: false,
  };
};

/** Detect language from file extension */
export function languageFromPath(filePath: string): Language {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) return 'typescript';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx') || filePath.endsWith('.mjs'))
    return 'javascript';
  if (filePath.endsWith('.go')) return 'go';
  if (filePath.endsWith('.py')) return 'python';
  if (filePath.endsWith('.rs')) return 'rust';
  return 'javascript';
}

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

    tabCounter++;
    const newTab: FileTab = {
      id: `tab-${tabCounter}`,
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

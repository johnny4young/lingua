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

const createDefaultTab = (language: Language = 'javascript'): FileTab => {
  tabCounter++;
  const ext: Record<Language, string> = {
    javascript: 'js',
    typescript: 'ts',
    go: 'go',
    python: 'py',
    rust: 'rs',
  };
  return {
    id: `tab-${tabCounter}`,
    name: `untitled-${tabCounter}.${ext[language]}`,
    language,
    content: DEFAULT_CONTENT[language],
    isDirty: false,
  };
};

const initialTab = createDefaultTab('javascript');

export const useEditorStore = create<EditorState>((set) => ({
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
}));

export { createDefaultTab };

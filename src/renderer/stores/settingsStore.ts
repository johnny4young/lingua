import { create } from 'zustand';
import type { SettingsState } from '../types';

export const useSettingsStore = create<SettingsState>((set) => ({
  theme: 'dark',
  editorTheme: 'vs-dark',
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
  showLineNumbers: true,
  wordWrap: false,
  minimap: false,

  setTheme: (theme) => set({ theme }),
  setEditorTheme: (editorTheme) => set({ editorTheme }),
  setFontSize: (fontSize) => set({ fontSize }),
  setFontFamily: (fontFamily) => set({ fontFamily }),
  toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
  toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
}));

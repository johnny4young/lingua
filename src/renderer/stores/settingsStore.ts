import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SettingsState } from '../types';

const APP_LANGUAGES = ['system', 'en', 'es'] as const;

function isAppLanguage(value: unknown): value is SettingsState['language'] {
  return typeof value === 'string' && (APP_LANGUAGES as readonly string[]).includes(value);
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: 'dark',
      editorTheme: 'lingua-dark',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
      showLineNumbers: true,
      wordWrap: false,
      minimap: false,
      layoutPreset: 'horizontal',
      loopProtection: true,
      maxLoopIterations: 10_000,
      hideUndefined: true,
      restoreSession: false,
      language: 'system',

      setTheme: (theme) => set({ theme }),
      setEditorTheme: (editorTheme) => set({ editorTheme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
      setLayoutPreset: (layoutPreset) => set({ layoutPreset }),
      toggleLoopProtection: () => set((s) => ({ loopProtection: !s.loopProtection })),
      setMaxLoopIterations: (maxLoopIterations) => set({ maxLoopIterations }),
      toggleHideUndefined: () => set((s) => ({ hideUndefined: !s.hideUndefined })),
      toggleRestoreSession: () => set((s) => ({ restoreSession: !s.restoreSession })),
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'lingua-settings',
      // Omit functions from persistence
      partialize: (state) => ({
        theme: state.theme,
        editorTheme: state.editorTheme,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        showLineNumbers: state.showLineNumbers,
        wordWrap: state.wordWrap,
        minimap: state.minimap,
        layoutPreset: state.layoutPreset,
        loopProtection: state.loopProtection,
        maxLoopIterations: state.maxLoopIterations,
        hideUndefined: state.hideUndefined,
        restoreSession: state.restoreSession,
        language: state.language,
      }),
      merge: (persistedState, currentState) => {
        const merged = {
          ...currentState,
          ...(persistedState as Partial<SettingsState> | undefined),
        };

        return {
          ...merged,
          language: isAppLanguage(merged.language) ? merged.language : currentState.language,
        };
      },
    }
  )
);

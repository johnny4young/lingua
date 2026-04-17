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
      fontLigatures: true,
      showLineNumbers: true,
      wordWrap: false,
      minimap: false,
      layoutPreset: 'horizontal',
      loopProtection: true,
      maxLoopIterations: 10_000,
      hideUndefined: true,
      restoreSession: false,
      formatOnSave: false,
      syncShellWithEditorTheme: true,
      language: 'system',
      lastSeenVersion: null,
      hasCompletedTour: false,

      setTheme: (theme) => set({ theme }),
      setEditorTheme: (editorTheme) => set({ editorTheme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setFontFamily: (fontFamily) => set({ fontFamily }),
      toggleFontLigatures: () => set((s) => ({ fontLigatures: !s.fontLigatures })),
      toggleLineNumbers: () => set((s) => ({ showLineNumbers: !s.showLineNumbers })),
      toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),
      toggleMinimap: () => set((s) => ({ minimap: !s.minimap })),
      setLayoutPreset: (layoutPreset) => set({ layoutPreset }),
      toggleLoopProtection: () => set((s) => ({ loopProtection: !s.loopProtection })),
      setMaxLoopIterations: (maxLoopIterations) => set({ maxLoopIterations }),
      toggleHideUndefined: () => set((s) => ({ hideUndefined: !s.hideUndefined })),
      toggleRestoreSession: () => set((s) => ({ restoreSession: !s.restoreSession })),
      toggleFormatOnSave: () => set((s) => ({ formatOnSave: !s.formatOnSave })),
      toggleSyncShellWithEditorTheme: () =>
        set((s) => ({ syncShellWithEditorTheme: !s.syncShellWithEditorTheme })),
      applyThemePreset: (preset) =>
        set((state) => ({
          theme: preset.theme,
          editorTheme: preset.editorTheme,
          fontFamily: preset.fontFamily,
          fontSize: preset.fontSize,
          fontLigatures: preset.fontLigatures,
          layoutPreset: preset.layoutPreset,
          syncShellWithEditorTheme:
            preset.syncShellWithEditorTheme ?? state.syncShellWithEditorTheme,
        })),
      setLanguage: (language) => set({ language }),
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
      setHasCompletedTour: (hasCompletedTour) => set({ hasCompletedTour }),
    }),
    {
      name: 'lingua-settings',
      // Omit functions from persistence
      partialize: (state) => ({
        theme: state.theme,
        editorTheme: state.editorTheme,
        fontSize: state.fontSize,
        fontFamily: state.fontFamily,
        fontLigatures: state.fontLigatures,
        showLineNumbers: state.showLineNumbers,
        wordWrap: state.wordWrap,
        minimap: state.minimap,
        layoutPreset: state.layoutPreset,
        loopProtection: state.loopProtection,
        maxLoopIterations: state.maxLoopIterations,
        hideUndefined: state.hideUndefined,
        restoreSession: state.restoreSession,
        formatOnSave: state.formatOnSave,
        syncShellWithEditorTheme: state.syncShellWithEditorTheme,
        language: state.language,
        lastSeenVersion: state.lastSeenVersion,
        hasCompletedTour: state.hasCompletedTour,
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

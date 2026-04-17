import { useEffect } from 'react';
import { isDarkEditorTheme } from '../components/Settings/settingsOptions';
import { useSettingsStore } from '../stores/settingsStore';
import { applyAppTheme } from '../utils/appTheme';

/**
 * Resolve the effective shell polarity. When `syncShellWithEditorTheme` is
 * on (default), the shell follows the chosen Monaco theme's polarity so the
 * console and run-result panels stay visually consistent with the editor.
 * When off, the user's explicit `theme` setting wins.
 */
export function resolveEffectiveShellTheme(
  theme: 'dark' | 'light',
  editorTheme: string,
  syncShellWithEditorTheme: boolean
): 'dark' | 'light' {
  if (!syncShellWithEditorTheme) return theme;
  return isDarkEditorTheme(editorTheme) ? 'dark' : 'light';
}

export function useAppTheme() {
  const theme = useSettingsStore((state) => state.theme);
  const editorTheme = useSettingsStore((state) => state.editorTheme);
  const syncShellWithEditorTheme = useSettingsStore(
    (state) => state.syncShellWithEditorTheme
  );

  const effectiveTheme = resolveEffectiveShellTheme(
    theme,
    editorTheme,
    syncShellWithEditorTheme
  );

  useEffect(() => {
    applyAppTheme(effectiveTheme);
  }, [effectiveTheme]);
}

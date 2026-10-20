import { useEffect } from 'react';
import { isDarkEditorTheme } from '../utils/editorThemeCatalog';
import { useSettingsStore } from '../stores/settingsStore';
import { applyAppTheme, systemEditorTheme } from '../utils/appTheme';
import type { ThemePreference } from '../types/settings';

/**
 * Resolve the effective shell polarity. The
 * `syncShellWithEditorTheme` toggle is gone; shell polarity always
 * follows the chosen Monaco theme so the console and run-result panels
 * stay visually consistent with the editor (the previous opt-out
 * surfaced visual inconsistency as a "feature"; design system 101
 * makes consistency the default).
 *
 * The third argument is retained for transient callers (e.g.
 * `RichValueChart` passes `true`) but is intentionally ignored — the
 * function always returns the editor-derived polarity. Future
 * refactors can drop the parameter entirely once all callers update.
 */
export function resolveEffectiveShellTheme(
  _theme: ThemePreference,
  editorTheme: string,
  _syncShellWithEditorTheme: boolean = true
): 'dark' | 'light' {
  return isDarkEditorTheme(editorTheme) ? 'dark' : 'light';
}

export function useAppTheme() {
  const theme = useSettingsStore((state) => state.theme);
  const editorTheme = useSettingsStore((state) => state.editorTheme);

  const effectiveTheme = resolveEffectiveShellTheme(theme, editorTheme);

  useEffect(() => {
    applyAppTheme(effectiveTheme);
  }, [effectiveTheme]);

  // System keeps the Lingua editor theme in step with the OS preference.
  useEffect(() => {
    if (theme !== 'system' || typeof window.matchMedia !== 'function') return;
    const sync = () => {
      const next = systemEditorTheme();
      if (useSettingsStore.getState().editorTheme !== next) {
        useSettingsStore.setState({ editorTheme: next });
      }
    };
    sync();
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, [theme]);
}

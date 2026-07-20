import { useEffect } from 'react';
import { isDarkEditorTheme } from '../utils/editorThemeCatalog';
import { useSettingsStore } from '../stores/settingsStore';
import { applyAppTheme } from '../utils/appTheme';

/**
 * Resolve the effective shell polarity. implementation — the
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
  _theme: 'dark' | 'light',
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
}

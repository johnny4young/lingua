import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore', () => {
  const initialState = useSettingsStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState(initialState, true);
  });

  it('should have correct defaults', () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.editorTheme).toBe('lingua-dark');
    expect(state.fontSize).toBe(14);
    expect(state.showLineNumbers).toBe(true);
    expect(state.wordWrap).toBe(false);
    expect(state.minimap).toBe(false);
    expect(state.layoutPreset).toBe('horizontal');
  });

  it('should set theme', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('should set editor theme', () => {
    useSettingsStore.getState().setEditorTheme('dracula');
    expect(useSettingsStore.getState().editorTheme).toBe('dracula');
  });

  it('should set font size', () => {
    useSettingsStore.getState().setFontSize(18);
    expect(useSettingsStore.getState().fontSize).toBe(18);
  });

  it('should set font family', () => {
    useSettingsStore.getState().setFontFamily('Menlo');
    expect(useSettingsStore.getState().fontFamily).toBe('Menlo');
  });

  it('should toggle line numbers', () => {
    expect(useSettingsStore.getState().showLineNumbers).toBe(true);
    useSettingsStore.getState().toggleLineNumbers();
    expect(useSettingsStore.getState().showLineNumbers).toBe(false);
    useSettingsStore.getState().toggleLineNumbers();
    expect(useSettingsStore.getState().showLineNumbers).toBe(true);
  });

  it('should toggle word wrap', () => {
    expect(useSettingsStore.getState().wordWrap).toBe(false);
    useSettingsStore.getState().toggleWordWrap();
    expect(useSettingsStore.getState().wordWrap).toBe(true);
  });

  it('should toggle minimap', () => {
    expect(useSettingsStore.getState().minimap).toBe(false);
    useSettingsStore.getState().toggleMinimap();
    expect(useSettingsStore.getState().minimap).toBe(true);
  });

  it('should set layout preset', () => {
    useSettingsStore.getState().setLayoutPreset('vertical');
    expect(useSettingsStore.getState().layoutPreset).toBe('vertical');

    useSettingsStore.getState().setLayoutPreset('editor-only');
    expect(useSettingsStore.getState().layoutPreset).toBe('editor-only');

    useSettingsStore.getState().setLayoutPreset('horizontal');
    expect(useSettingsStore.getState().layoutPreset).toBe('horizontal');
  });

  it('should default restoreSession to false', () => {
    expect(useSettingsStore.getState().restoreSession).toBe(false);
  });

  it('should toggle restoreSession', () => {
    useSettingsStore.getState().toggleRestoreSession();
    expect(useSettingsStore.getState().restoreSession).toBe(true);
    useSettingsStore.getState().toggleRestoreSession();
    expect(useSettingsStore.getState().restoreSession).toBe(false);
  });

  it('should default formatOnSave to false', () => {
    expect(useSettingsStore.getState().formatOnSave).toBe(false);
  });

  it('should toggle formatOnSave', () => {
    useSettingsStore.getState().toggleFormatOnSave();
    expect(useSettingsStore.getState().formatOnSave).toBe(true);
    useSettingsStore.getState().toggleFormatOnSave();
    expect(useSettingsStore.getState().formatOnSave).toBe(false);
  });

  it('should default fontLigatures to true and toggle cleanly', () => {
    expect(useSettingsStore.getState().fontLigatures).toBe(true);
    useSettingsStore.getState().toggleFontLigatures();
    expect(useSettingsStore.getState().fontLigatures).toBe(false);
    useSettingsStore.getState().toggleFontLigatures();
    expect(useSettingsStore.getState().fontLigatures).toBe(true);
  });

  it('applyThemePreset updates theming fields and leaves safety prefs alone', () => {
    useSettingsStore.setState({ loopProtection: true, formatOnSave: true, restoreSession: true });

    useSettingsStore.getState().applyThemePreset({
      theme: 'light',
      editorTheme: 'solarized-light',
      fontFamily: 'Menlo, monospace',
      fontSize: 18,
      fontLigatures: false,
      layoutPreset: 'vertical',
      syncShellWithEditorTheme: false,
    });

    const state = useSettingsStore.getState();
    expect(state.theme).toBe('light');
    expect(state.editorTheme).toBe('solarized-light');
    expect(state.fontFamily).toBe('Menlo, monospace');
    expect(state.fontSize).toBe(18);
    expect(state.fontLigatures).toBe(false);
    expect(state.layoutPreset).toBe('vertical');
    expect(state.syncShellWithEditorTheme).toBe(false);
    // Preset must not override safety/workflow preferences
    expect(state.loopProtection).toBe(true);
    expect(state.formatOnSave).toBe(true);
    expect(state.restoreSession).toBe(true);
  });

  it('applyThemePreset keeps the current sync flag when the preset omits it', () => {
    useSettingsStore.setState({ syncShellWithEditorTheme: false });
    useSettingsStore.getState().applyThemePreset({
      theme: 'dark',
      editorTheme: 'lingua-dark',
      fontFamily: 'Menlo, monospace',
      fontSize: 14,
      fontLigatures: false,
      layoutPreset: 'horizontal',
    });
    expect(useSettingsStore.getState().syncShellWithEditorTheme).toBe(false);
  });

  it('should default syncShellWithEditorTheme to true and toggle cleanly', () => {
    expect(useSettingsStore.getState().syncShellWithEditorTheme).toBe(true);
    useSettingsStore.getState().toggleSyncShellWithEditorTheme();
    expect(useSettingsStore.getState().syncShellWithEditorTheme).toBe(false);
    useSettingsStore.getState().toggleSyncShellWithEditorTheme();
    expect(useSettingsStore.getState().syncShellWithEditorTheme).toBe(true);
  });

  it('should default language to system', () => {
    expect(useSettingsStore.getState().language).toBe('system');
  });

  it('should default lastSeenVersion to null', () => {
    expect(useSettingsStore.getState().lastSeenVersion).toBeNull();
  });

  it('should default hasCompletedTour to false', () => {
    expect(useSettingsStore.getState().hasCompletedTour).toBe(false);
  });

  it('should default suppressTourAutoStart to false and persist toggles', () => {
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(false);
    useSettingsStore.getState().setSuppressTourAutoStart(true);
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(true);
    useSettingsStore.getState().setSuppressTourAutoStart(false);
    expect(useSettingsStore.getState().suppressTourAutoStart).toBe(false);
  });

  it('should set language to es', () => {
    useSettingsStore.getState().setLanguage('es');
    expect(useSettingsStore.getState().language).toBe('es');
  });

  it('should set language to en', () => {
    useSettingsStore.getState().setLanguage('en');
    expect(useSettingsStore.getState().language).toBe('en');
  });

  it('should set language back to system', () => {
    useSettingsStore.getState().setLanguage('en');
    useSettingsStore.getState().setLanguage('system');
    expect(useSettingsStore.getState().language).toBe('system');
  });

  it('should persist the last seen release version', () => {
    useSettingsStore.getState().setLastSeenVersion('0.1.0');
    expect(useSettingsStore.getState().lastSeenVersion).toBe('0.1.0');
  });

  it('should persist guided tour completion', () => {
    useSettingsStore.getState().setHasCompletedTour(true);
    expect(useSettingsStore.getState().hasCompletedTour).toBe(true);
  });

  it('defaults shortcutOverrides to an empty map', () => {
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({});
  });

  it('defaults themePack to "default" and applies a pack wholesale', () => {
    expect(useSettingsStore.getState().themePack).toBe('default');
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    const state = useSettingsStore.getState();
    expect(state.themePack).toBe('solarized-daylight');
    expect(state.theme).toBe('light');
    expect(state.editorTheme).toBe('solarized-light');
    expect(state.fontLigatures).toBe(false);
  });

  it('applyThemePack with an unknown id is a no-op', () => {
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    useSettingsStore.getState().applyThemePack('does-not-exist');
    expect(useSettingsStore.getState().themePack).toBe('solarized-daylight');
  });

  it('keeps a persisted theme pack only when the stored appearance fields still match it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          themePack: 'solarized-daylight',
          theme: 'light',
          editorTheme: 'solarized-light',
          fontFamily: 'Menlo, monospace',
          fontSize: 14,
          fontLigatures: false,
          layoutPreset: 'horizontal',
          syncShellWithEditorTheme: true,
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().themePack).toBe('solarized-daylight');
  });

  it('drops a persisted theme pack back to default when the stored appearance no longer matches it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          themePack: 'solarized-daylight',
          theme: 'light',
          editorTheme: 'solarized-light',
          fontFamily: 'Menlo, monospace',
          fontSize: 20,
          fontLigatures: false,
          layoutPreset: 'horizontal',
          syncShellWithEditorTheme: true,
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.themePack).toBe('default');
    expect(state.fontSize).toBe(20);
  });

  it('manual appearance edit flips themePack back to default', () => {
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    useSettingsStore.getState().setFontSize(20);
    expect(useSettingsStore.getState().themePack).toBe('default');
    expect(useSettingsStore.getState().fontSize).toBe(20);
  });

  it('applyThemePack does not touch safety/workflow prefs', () => {
    useSettingsStore.setState({
      loopProtection: true,
      formatOnSave: true,
      restoreSession: true,
    });
    useSettingsStore.getState().applyThemePack('solarized-daylight');
    const state = useSettingsStore.getState();
    expect(state.loopProtection).toBe(true);
    expect(state.formatOnSave).toBe(true);
    expect(state.restoreSession).toBe(true);
  });

  it('defaults keymapPreset to "default" and applies a preset by id', () => {
    expect(useSettingsStore.getState().keymapPreset).toBe('default');
    useSettingsStore.getState().applyKeymapPreset('sublime');
    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('sublime');
    expect(state.shortcutOverrides['nav-go-to-symbol']?.[0].tokens).toEqual(['Mod', 'R']);
  });

  it('applyKeymapPreset with an unknown id is a no-op', () => {
    useSettingsStore.getState().applyKeymapPreset('sublime');
    useSettingsStore.getState().applyKeymapPreset('does-not-exist');
    expect(useSettingsStore.getState().keymapPreset).toBe('sublime');
  });

  it('keeps a persisted keymap preset only when the stored overrides still match it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          keymapPreset: 'sublime',
          shortcutOverrides: {
            'nav-go-to-symbol': [{ tokens: ['Mod', 'R'] }],
            'view-toggle-console': [{ tokens: ['Mod', 'Backtick'] }],
          },
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().keymapPreset).toBe('sublime');
  });

  it('drops a persisted keymap preset back to default when stored overrides no longer match it', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          keymapPreset: 'sublime',
          shortcutOverrides: {
            'view-toggle-sidebar': [{ tokens: ['Mod', 'Shift', 'B'] }],
          },
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('default');
    expect(state.shortcutOverrides['view-toggle-sidebar']?.[0].tokens).toEqual([
      'Mod',
      'Shift',
      'B',
    ]);
  });

  it('manual override flips keymapPreset back to default', () => {
    useSettingsStore.getState().applyKeymapPreset('sublime');
    useSettingsStore.getState().setShortcutOverride('view-toggle-sidebar', [
      { tokens: ['Mod', 'Shift', 'B'] },
    ]);
    expect(useSettingsStore.getState().keymapPreset).toBe('default');
  });

  it('resetShortcutOverrides clears preset back to default', () => {
    useSettingsStore.getState().applyKeymapPreset('sublime');
    useSettingsStore.getState().resetShortcutOverrides();
    const state = useSettingsStore.getState();
    expect(state.keymapPreset).toBe('default');
    expect(state.shortcutOverrides).toEqual({});
  });

  it('setShortcutOverride stores combos keyed by shortcut id', () => {
    useSettingsStore.getState().setShortcutOverride('view-toggle-sidebar', [
      { tokens: ['Mod', 'Shift', 'B'] },
    ]);
    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(overrides['view-toggle-sidebar']?.[0].tokens).toEqual(['Mod', 'Shift', 'B']);
  });

  it('clearShortcutOverride removes a single entry without touching the rest', () => {
    useSettingsStore.getState().setShortcutOverride('view-toggle-sidebar', [
      { tokens: ['Mod', 'Shift', 'B'] },
    ]);
    useSettingsStore.getState().setShortcutOverride('file-save', [
      { tokens: ['Mod', 'Alt', 'S'] },
    ]);
    useSettingsStore.getState().clearShortcutOverride('file-save');
    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(overrides['file-save']).toBeUndefined();
    expect(overrides['view-toggle-sidebar']).toBeDefined();
  });

  it('resetShortcutOverrides empties the map', () => {
    useSettingsStore.getState().setShortcutOverride('file-save', [
      { tokens: ['Mod', 'Alt', 'S'] },
    ]);
    useSettingsStore.getState().resetShortcutOverrides();
    expect(useSettingsStore.getState().shortcutOverrides).toEqual({});
  });

  it('drops malformed shortcut overrides during rehydration', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          shortcutOverrides: {
            'view-toggle-sidebar': [{ tokens: ['Mod', 'Shift', 'B'] }],
            'unknown-id': [{ tokens: ['Mod', 'Q'] }],
            'file-save': 'not-an-array',
            'nav-quick-open': [{ tokens: [] }],
            'view-toggle-console': [{ tokens: ['J'] }],
          },
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    const overrides = useSettingsStore.getState().shortcutOverrides;
    expect(Object.keys(overrides)).toEqual(['view-toggle-sidebar']);
    expect(overrides['view-toggle-sidebar']?.[0].tokens).toEqual(['Mod', 'Shift', 'B']);
  });

  it('should ignore an invalid persisted language during rehydration', async () => {
    localStorage.setItem(
      'lingua-settings',
      JSON.stringify({
        state: {
          language: 'fr',
        },
        version: 0,
      })
    );

    await (
      useSettingsStore as typeof useSettingsStore & {
        persist: { rehydrate: () => Promise<void> };
      }
    ).persist.rehydrate();

    expect(useSettingsStore.getState().language).toBe('system');
  });
});

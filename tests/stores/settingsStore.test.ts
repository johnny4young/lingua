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

  it('should default language to system', () => {
    expect(useSettingsStore.getState().language).toBe('system');
  });

  it('should default lastSeenVersion to null', () => {
    expect(useSettingsStore.getState().lastSeenVersion).toBeNull();
  });

  it('should default hasCompletedTour to false', () => {
    expect(useSettingsStore.getState().hasCompletedTour).toBe(false);
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

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/stores/settingsStore';

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      theme: 'dark',
      editorTheme: 'vs-dark',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      showLineNumbers: true,
      wordWrap: false,
      minimap: false,
    });
  });

  it('should have correct defaults', () => {
    const state = useSettingsStore.getState();
    expect(state.theme).toBe('dark');
    expect(state.editorTheme).toBe('vs-dark');
    expect(state.fontSize).toBe(14);
    expect(state.showLineNumbers).toBe(true);
    expect(state.wordWrap).toBe(false);
    expect(state.minimap).toBe(false);
  });

  it('should set theme', () => {
    useSettingsStore.getState().setTheme('light');
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('should set editor theme', () => {
    useSettingsStore.getState().setEditorTheme('hc-black');
    expect(useSettingsStore.getState().editorTheme).toBe('hc-black');
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
});

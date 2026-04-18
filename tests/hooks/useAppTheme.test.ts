import { beforeEach, describe, expect, it } from 'vitest';
import { resolveEffectiveShellTheme } from '@/hooks/useAppTheme';
import { useSettingsStore } from '@/stores/settingsStore';

describe('resolveEffectiveShellTheme', () => {
  it('follows the editor theme polarity when sync is on', () => {
    expect(resolveEffectiveShellTheme('dark', 'vs', true)).toBe('light');
    expect(resolveEffectiveShellTheme('dark', 'solarized-light', true)).toBe('light');
    expect(resolveEffectiveShellTheme('light', 'lingua-dark', true)).toBe('dark');
    expect(resolveEffectiveShellTheme('light', 'one-dark-pro', true)).toBe('dark');
  });

  it('honors the explicit theme setting when sync is off', () => {
    expect(resolveEffectiveShellTheme('dark', 'vs', false)).toBe('dark');
    expect(resolveEffectiveShellTheme('light', 'lingua-dark', false)).toBe('light');
  });

  it('falls back to dark for unknown editor themes when sync is on', () => {
    // Matches the unknown-theme contract in `isDarkEditorTheme`.
    expect(resolveEffectiveShellTheme('light', 'plugin-provided-mystery-theme', true)).toBe('dark');
  });
});

describe('setTheme + resolveEffectiveShellTheme integration', () => {
  const initialSettings = useSettingsStore.getState();

  beforeEach(() => {
    useSettingsStore.setState(initialSettings, true);
  });

  it('the explicit shell choice flips the effective shell even when the editor theme is dark', () => {
    useSettingsStore.setState({
      syncShellWithEditorTheme: true,
      editorTheme: 'lingua-dark',
      theme: 'dark',
    });
    useSettingsStore.getState().setTheme('light');

    const state = useSettingsStore.getState();
    const effective = resolveEffectiveShellTheme(
      state.theme,
      state.editorTheme,
      state.syncShellWithEditorTheme
    );
    expect(effective).toBe('light');
  });
});

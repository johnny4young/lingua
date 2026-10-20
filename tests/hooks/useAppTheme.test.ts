import { describe, expect, it } from 'vitest';
import { resolveEffectiveShellTheme } from '@/hooks/useAppTheme';

describe('resolveEffectiveShellTheme', () => {
  it('always follows the editor theme polarity ', () => {
    expect(resolveEffectiveShellTheme('dark', 'vs')).toBe('light');
    expect(resolveEffectiveShellTheme('dark', 'solarized-light')).toBe('light');
    expect(resolveEffectiveShellTheme('light', 'lingua-dark')).toBe('dark');
    expect(resolveEffectiveShellTheme('light', 'one-dark-pro')).toBe('dark');
  });

  it('ignores the `syncShellWithEditorTheme` argument (the user opt-out was removed)', () => {
    // Third arg is retained for backward-compat with existing
    // callers; the helper unconditionally derives polarity from the
    // editor theme so the shell + editor stay visually consistent.
    expect(resolveEffectiveShellTheme('dark', 'vs', false)).toBe('light');
    expect(resolveEffectiveShellTheme('light', 'lingua-dark', false)).toBe('dark');
  });

  it('falls back to dark for unknown editor themes', () => {
    expect(resolveEffectiveShellTheme('light', 'plugin-provided-mystery-theme')).toBe('dark');
  });
});

describe('useAppTheme with the System preference', () => {
  it('moves the Lingua editor theme when the OS switches', async () => {
    const { renderHook, act } = await import('@testing-library/react');
    const { useAppTheme } = await import('../../src/renderer/hooks/useAppTheme');
    const { useSettingsStore } = await import('../../src/renderer/stores/settingsStore');
    const listeners = new Set<() => void>();
    const query = {
      matches: true,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: () => query });
    useSettingsStore.setState({ theme: 'system', editorTheme: 'lingua-light' });
    const { unmount } = renderHook(() => useAppTheme());
    expect(useSettingsStore.getState().editorTheme).toBe('lingua-dark');
    query.matches = false;
    act(() => listeners.forEach((fn) => fn()));
    expect(useSettingsStore.getState().editorTheme).toBe('lingua-light');
    expect(document.documentElement.classList.contains('light')).toBe(true);
    unmount();
    expect(listeners.size).toBe(0);
  });
});

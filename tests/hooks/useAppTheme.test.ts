import { describe, expect, it } from 'vitest';
import { resolveEffectiveShellTheme } from '@/hooks/useAppTheme';

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

import { describe, expect, it } from 'vitest';
import { resolveEffectiveShellTheme } from '@/hooks/useAppTheme';

describe('resolveEffectiveShellTheme', () => {
  it('always follows the editor theme polarity (Slice 2)', () => {
    expect(resolveEffectiveShellTheme('dark', 'vs')).toBe('light');
    expect(resolveEffectiveShellTheme('dark', 'solarized-light')).toBe('light');
    expect(resolveEffectiveShellTheme('light', 'lingua-dark')).toBe('dark');
    expect(resolveEffectiveShellTheme('light', 'one-dark-pro')).toBe('dark');
  });

  it('ignores the `syncShellWithEditorTheme` argument (Slice 2 removed the user opt-out)', () => {
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

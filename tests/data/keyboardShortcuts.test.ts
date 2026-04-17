import { describe, expect, it } from 'vitest';
import {
  KEYBOARD_SHORTCUTS,
  SHORTCUT_GROUPS,
  filterShortcuts,
  formatShortcutCombo,
  formatShortcutToken,
  resolveShortcutDisplayPlatform,
  resolveModLabel,
} from '@/data/keyboardShortcuts';

const identity = (key: string) => key;

describe('keyboardShortcuts catalog', () => {
  it('groups every shortcut under a declared group', () => {
    const groupIds = new Set(SHORTCUT_GROUPS.map((group) => group.id));
    for (const shortcut of KEYBOARD_SHORTCUTS) {
      expect(groupIds.has(shortcut.group)).toBe(true);
    }
  });

  it('keeps shortcut ids unique so list keys stay stable', () => {
    const ids = KEYBOARD_SHORTCUTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers the high-traffic shortcuts dispatched by useGlobalShortcuts', () => {
    const ids = new Set(KEYBOARD_SHORTCUTS.map((entry) => entry.id));
    for (const required of [
      'run-toggle',
      'file-save',
      'file-save-as',
      'file-open',
      'file-close-tab',
      'nav-quick-open',
      'nav-go-to-symbol',
      'nav-project-search',
      'overlay-command-palette',
      'overlay-settings',
      'overlay-close',
      'view-toggle-sidebar',
      'view-toggle-console',
    ]) {
      expect(ids.has(required)).toBe(true);
    }
  });
});

describe('formatShortcutToken', () => {
  it('detects mac display combos for desktop darwin and browser Mac platforms', () => {
    expect(resolveShortcutDisplayPlatform('darwin')).toBe('darwin');
    expect(resolveShortcutDisplayPlatform('web', 'MacIntel')).toBe('darwin');
    expect(resolveShortcutDisplayPlatform('web', 'Win32')).toBe('other');
    expect(resolveShortcutDisplayPlatform('linux')).toBe('other');
  });

  it('maps the Mod token to the cmd glyph on macOS and Ctrl elsewhere', () => {
    expect(resolveModLabel('darwin')).toBe('⌘');
    expect(resolveModLabel('other')).toBe('Ctrl');
  });

  it('renders named special tokens with symbols on macOS', () => {
    expect(formatShortcutToken('Shift', 'darwin')).toBe('⇧');
    expect(formatShortcutToken('Alt', 'darwin')).toBe('⌥');
    expect(formatShortcutToken('Enter', 'darwin')).toBe('↵');
  });

  it('renders word-form modifier names on non-Mac platforms', () => {
    expect(formatShortcutToken('Shift', 'linux')).toBe('Shift');
    expect(formatShortcutToken('Alt', 'win32')).toBe('Alt');
    expect(formatShortcutToken('Escape', 'linux')).toBe('Esc');
    expect(formatShortcutToken('Backslash', 'linux')).toBe('\\');
    expect(formatShortcutToken('Comma', 'linux')).toBe(',');
  });

  it('uppercases single-character tokens so lowercase catalog entries render cleanly', () => {
    expect(formatShortcutToken('s', 'linux')).toBe('S');
  });

  it('passes multi-character unknown tokens through unchanged', () => {
    expect(formatShortcutToken('F5', 'linux')).toBe('F5');
  });
});

describe('formatShortcutCombo', () => {
  it('concatenates tokens without a separator on macOS (matches system HIG)', () => {
    expect(formatShortcutCombo({ tokens: ['Mod', 'Shift', 'P'] }, 'darwin')).toBe('⌘⇧P');
  });

  it('uses + separators on non-mac platforms', () => {
    expect(formatShortcutCombo({ tokens: ['Mod', 'Shift', 'P'] }, 'linux')).toBe('Ctrl+Shift+P');
  });
});

describe('filterShortcuts', () => {
  it('returns a copy of the catalog when the query is blank', () => {
    const result = filterShortcuts(KEYBOARD_SHORTCUTS, '   ', 'linux', identity);
    expect(result).toHaveLength(KEYBOARD_SHORTCUTS.length);
    expect(result).not.toBe(KEYBOARD_SHORTCUTS);
  });

  it('matches against the translated label', () => {
    const result = filterShortcuts(
      KEYBOARD_SHORTCUTS,
      'save',
      'linux',
      (key) => (key.endsWith('save.label') ? 'Save' : key)
    );
    expect(result.some((entry) => entry.id === 'file-save')).toBe(true);
  });

  it('matches against keywords', () => {
    const result = filterShortcuts(KEYBOARD_SHORTCUTS, 'hotkey', 'linux', identity);
    // No keyword is literally "hotkey", so this should be empty
    expect(result).toHaveLength(0);
    const keyworded = filterShortcuts(KEYBOARD_SHORTCUTS, 'fuzzy', 'linux', identity);
    expect(keyworded.some((entry) => entry.id === 'nav-quick-open')).toBe(true);
  });

  it('matches against rendered combo text so users can search by keystroke', () => {
    const result = filterShortcuts(KEYBOARD_SHORTCUTS, 'ctrl+b', 'linux', identity);
    expect(result.some((entry) => entry.id === 'view-toggle-sidebar')).toBe(true);

    const macResult = filterShortcuts(KEYBOARD_SHORTCUTS, '⌘B', 'darwin', identity);
    expect(macResult.some((entry) => entry.id === 'view-toggle-sidebar')).toBe(true);
  });
});

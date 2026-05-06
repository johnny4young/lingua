import { describe, expect, it } from 'vitest';
import {
  SHORTCUT_PRESET_VERSION,
  buildShortcutPreset,
  parseShortcutPreset,
  serializeShortcutPreset,
} from '@/utils/shortcutPreset';

describe('shortcutPreset', () => {
  it('round-trips a well-formed preset through serialize → parse', () => {
    const preset = buildShortcutPreset(
      {
        'view-toggle-sidebar': [{ tokens: ['Mod', 'Shift', 'B'] }],
      },
      'my-keymap'
    );
    const parsed = parseShortcutPreset(serializeShortcutPreset(preset));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.preset.version).toBe(SHORTCUT_PRESET_VERSION);
      expect(parsed.preset.name).toBe('my-keymap');
      expect(parsed.preset.overrides['view-toggle-sidebar']?.[0].tokens).toEqual([
        'Mod',
        'Shift',
        'B',
      ]);
    }
  });

  it('rejects invalid JSON with a discriminated failure reason', () => {
    const result = parseShortcutPreset('not-json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-json');
  });

  it('rejects an unsupported version', () => {
    const raw = JSON.stringify({ version: 99, overrides: {} });
    const result = parseShortcutPreset(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-version');
  });

  it('drops unknown shortcut ids, malformed combos, and non-editable combos', () => {
    const raw = JSON.stringify({
      version: SHORTCUT_PRESET_VERSION,
      overrides: {
        'view-toggle-sidebar': [{ tokens: ['Mod', 'J'] }], // ok
        'unknown-id': [{ tokens: ['Mod', 'K'] }], // drop — unknown id
        'nav-quick-open': [{ tokens: [] }], // drop — empty
        'nav-go-to-symbol': [{ tokens: ['Mod', 'Shift', 'R'] }], // drop — browser refresh
        // drop — non-editable (no Mod/Alt)
        'view-toggle-console': [{ tokens: ['K'] }],
        'file-save': 'not-an-array', // drop — wrong shape
      },
    });
    const result = parseShortcutPreset(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.preset.overrides)).toEqual(['view-toggle-sidebar']);
    }
  });

  it('drops imported combos that conflict with an earlier shortcut in the catalog', () => {
    const raw = JSON.stringify({
      version: SHORTCUT_PRESET_VERSION,
      overrides: {
        'file-save': [{ tokens: ['Mod', 'S'] }],
        'view-toggle-sidebar': [{ tokens: ['Mod', 'S'] }],
      },
    });
    const result = parseShortcutPreset(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.preset.overrides['file-save']?.[0].tokens).toEqual(['Mod', 'S']);
      expect(result.preset.overrides['view-toggle-sidebar']).toBeUndefined();
    }
  });

  it('flags a missing version field as unsupported-version', () => {
    const raw = JSON.stringify({ overrides: {} });
    const result = parseShortcutPreset(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unsupported-version');
  });

  it('rejects a top-level array as invalid-shape', () => {
    const result = parseShortcutPreset('[1, 2, 3]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-shape');
  });
});

import { describe, expect, it } from 'vitest';
import { KEYBOARD_SHORTCUTS } from '@/data/keyboardShortcuts';
import {
  DEFAULT_KEYMAP_PRESET_ID,
  KEYMAP_PRESETS,
  findKeymapPreset,
  isKnownKeymapPresetId,
} from '@/data/keymapPresets';

describe('keymapPresets catalog', () => {
  it('always includes a default preset with no overrides', () => {
    const def = findKeymapPreset(DEFAULT_KEYMAP_PRESET_ID);
    expect(def).toBeDefined();
    expect(def?.overrides).toEqual({});
  });

  it('keeps preset ids unique', () => {
    const ids = KEYMAP_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('only references shortcut ids that exist in the catalog', () => {
    const knownIds = new Set(KEYBOARD_SHORTCUTS.map((entry) => entry.id));
    for (const preset of KEYMAP_PRESETS) {
      for (const key of Object.keys(preset.overrides)) {
        expect(knownIds.has(key), `preset ${preset.id} references unknown shortcut ${key}`).toBe(
          true
        );
      }
    }
  });

  it('ships at least one non-default preset (internal acceptance criterion)', () => {
    const alternates = KEYMAP_PRESETS.filter((preset) => preset.id !== DEFAULT_KEYMAP_PRESET_ID);
    expect(alternates.length).toBeGreaterThanOrEqual(1);
    for (const alt of alternates) {
      expect(Object.keys(alt.overrides).length).toBeGreaterThan(0);
    }
  });

  it('ships the Classic IDE preset with JetBrains-style overrides', () => {
    const preset = findKeymapPreset('classic-ide');
    expect(preset).toBeDefined();
    expect(preset?.overrides['nav-go-to-symbol']?.[0].tokens).toEqual(['Mod', 'Alt', 'O']);
    expect(preset?.overrides['view-toggle-console']?.[0].tokens).toEqual(['Mod', 'J']);
  });

  it('isKnownKeymapPresetId rejects unknown and non-string inputs', () => {
    expect(isKnownKeymapPresetId(DEFAULT_KEYMAP_PRESET_ID)).toBe(true);
    expect(isKnownKeymapPresetId('not-a-preset')).toBe(false);
    expect(isKnownKeymapPresetId(undefined)).toBe(false);
    expect(isKnownKeymapPresetId(null)).toBe(false);
    expect(isKnownKeymapPresetId(42)).toBe(false);
  });
});

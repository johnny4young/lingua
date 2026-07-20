import { describe, expect, it } from 'vitest';
import { FONT_FAMILIES } from '@/components/Settings/settingsOptions';
import {
  DEFAULT_THEME_PACK_ID,
  THEME_PACKS,
  findThemePack,
  isKnownThemePackId,
} from '@/data/themePacks';

describe('themePacks catalog', () => {
  it('always ships a default pack', () => {
    const def = findThemePack(DEFAULT_THEME_PACK_ID);
    expect(def).toBeDefined();
  });

  it('keeps pack ids unique', () => {
    const ids = THEME_PACKS.map((pack) => pack.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ships at least one alternate pack (internal acceptance criterion)', () => {
    const alternates = THEME_PACKS.filter((pack) => pack.id !== DEFAULT_THEME_PACK_ID);
    expect(alternates.length).toBeGreaterThanOrEqual(1);
  });

  it('ships the Nord Night pack with a dark nord editor theme', () => {
    const pack = findThemePack('nord-night');
    expect(pack).toBeDefined();
    expect(pack?.appearance.theme).toBe('dark');
    expect(pack?.appearance.editorTheme).toBe('nord-night');
  });

  it('every pack exposes the full appearance contract', () => {
    for (const pack of THEME_PACKS) {
      expect(['dark', 'light']).toContain(pack.appearance.theme);
      expect(typeof pack.appearance.editorTheme).toBe('string');
      expect(typeof pack.appearance.fontFamily).toBe('string');
      expect(pack.appearance.fontSize).toBeGreaterThan(0);
      expect(['horizontal', 'vertical', 'editor-only']).toContain(
        pack.appearance.layoutPreset
      );
    }
  });

  it('every pack uses a fontFamily present in the shared FONT_FAMILIES catalog', () => {
    const knownValues = new Set(FONT_FAMILIES.map((entry) => entry.value));
    for (const pack of THEME_PACKS) {
      expect(
        knownValues.has(pack.appearance.fontFamily),
        `pack ${pack.id} uses fontFamily not in FONT_FAMILIES: ${pack.appearance.fontFamily}`
      ).toBe(true);
    }
  });

  it('isKnownThemePackId rejects unknown and non-string inputs', () => {
    expect(isKnownThemePackId(DEFAULT_THEME_PACK_ID)).toBe(true);
    expect(isKnownThemePackId('not-a-pack')).toBe(false);
    expect(isKnownThemePackId(undefined)).toBe(false);
    expect(isKnownThemePackId(null)).toBe(false);
    expect(isKnownThemePackId(99)).toBe(false);
  });
});

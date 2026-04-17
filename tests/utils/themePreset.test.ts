import { describe, expect, it } from 'vitest';
import {
  THEME_PRESET_VERSION,
  buildThemePreset,
  parseThemePreset,
  serializeThemePreset,
} from '@/utils/themePreset';

const BASE_INPUT = {
  theme: 'dark' as const,
  editorTheme: 'lingua-dark',
  fontFamily: "'JetBrains Mono', monospace",
  fontSize: 14,
  fontLigatures: true,
  layoutPreset: 'horizontal' as const,
};

describe('themePreset', () => {
  it('builds a schema-versioned preset from settings state', () => {
    const preset = buildThemePreset(BASE_INPUT);
    expect(preset.version).toBe(THEME_PRESET_VERSION);
    expect(preset.appearance).toEqual({ theme: 'dark', editorTheme: 'lingua-dark' });
    expect(preset.typography.fontLigatures).toBe(true);
    expect(preset.layout.layoutPreset).toBe('horizontal');
  });

  it('serializes with stable 2-space indentation and a trailing newline', () => {
    const serialized = serializeThemePreset(buildThemePreset(BASE_INPUT));
    expect(serialized.endsWith('\n')).toBe(true);
    expect(serialized).toContain('  "version": 1');
  });

  it('round-trips a built preset through serialize and parse', () => {
    const original = buildThemePreset(BASE_INPUT);
    const parsed = parseThemePreset(serializeThemePreset(original));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.preset).toEqual(original);
    }
  });

  it('reports invalid JSON without throwing', () => {
    const result = parseThemePreset('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-json');
    }
  });

  it('rejects presets with the wrong shape', () => {
    const result = parseThemePreset(JSON.stringify({ version: 1, appearance: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-shape');
    }
  });

  it('rejects mismatched version numbers as unsupported', () => {
    const result = parseThemePreset(
      JSON.stringify({ ...buildThemePreset(BASE_INPUT), version: 99 })
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-version');
    }
  });

  it('rejects out-of-range theme and layout enum values', () => {
    const bad = {
      ...buildThemePreset(BASE_INPUT),
      appearance: { theme: 'sepia', editorTheme: 'custom' },
    };
    expect(parseThemePreset(JSON.stringify(bad)).ok).toBe(false);

    const badLayout = {
      ...buildThemePreset(BASE_INPUT),
      layout: { layoutPreset: 'floating' },
    };
    expect(parseThemePreset(JSON.stringify(badLayout)).ok).toBe(false);
  });

  it('rejects unknown Monaco editor theme ids', () => {
    const bad = {
      ...buildThemePreset(BASE_INPUT),
      appearance: {
        ...buildThemePreset(BASE_INPUT).appearance,
        editorTheme: 'my-custom-theme',
      },
    };

    const result = parseThemePreset(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('invalid-shape');
    }
  });

  it('rejects non-integer font sizes to keep Monaco stable', () => {
    const bad = {
      ...buildThemePreset(BASE_INPUT),
      typography: { ...buildThemePreset(BASE_INPUT).typography, fontSize: 14.5 },
    };
    const result = parseThemePreset(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });
});

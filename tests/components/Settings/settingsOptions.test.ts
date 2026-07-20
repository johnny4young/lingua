import { describe, expect, it } from 'vitest';
import {
  FONT_FAMILIES,
  fontStackSupportsLigatures,
} from '@/components/Settings/settingsOptions';

describe('settingsOptions/fonts', () => {
  it('ships the curated developer font list from internal', () => {
    const labels = FONT_FAMILIES.map((entry) => entry.label);
    for (const expected of [
      'JetBrains Mono',
      'Fira Code',
      'Cascadia Code',
      'Source Code Pro',
      'IBM Plex Mono',
      'Consolas',
      'Menlo',
      'Monaco',
    ]) {
      expect(labels).toContain(expected);
    }
  });

  it('marks programmer ligature fonts as supporting ligatures', () => {
    expect(
      FONT_FAMILIES.find((entry) => entry.label === 'JetBrains Mono')?.supportsLigatures
    ).toBe(true);
    expect(
      FONT_FAMILIES.find((entry) => entry.label === 'Fira Code')?.supportsLigatures
    ).toBe(true);
    expect(
      FONT_FAMILIES.find((entry) => entry.label === 'Cascadia Code')?.supportsLigatures
    ).toBe(true);
  });

  it('reports non-ligature stacks (Consolas, Menlo, Monaco) honestly', () => {
    expect(
      FONT_FAMILIES.find((entry) => entry.label === 'Consolas')?.supportsLigatures
    ).toBe(false);
    expect(
      FONT_FAMILIES.find((entry) => entry.label === 'Menlo')?.supportsLigatures
    ).toBe(false);
    expect(
      FONT_FAMILIES.find((entry) => entry.label === 'Monaco')?.supportsLigatures
    ).toBe(false);
  });

  it('resolves ligature support for known and unknown stacks', () => {
    const jetbrains = FONT_FAMILIES.find((entry) => entry.label === 'JetBrains Mono');
    expect(jetbrains).toBeDefined();
    expect(fontStackSupportsLigatures(jetbrains!.value)).toBe(true);
    expect(fontStackSupportsLigatures('Menlo, monospace')).toBe(false);
    // Unknown custom stacks default to true so user-supplied fonts with
    // ligatures keep working without being silently disabled.
    expect(fontStackSupportsLigatures("'MyCustomFont', monospace")).toBe(true);
  });
});

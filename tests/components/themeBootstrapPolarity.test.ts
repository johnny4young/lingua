/**
 * Drift guard for the inline theme-bootstrap scripts in the two HTML
 * entries (index.html, src/web/index.html). Both scripts hardcode the
 * set of light Monaco editor themes so they can resolve shell polarity
 * pre-hydration the same way resolveEffectiveShellTheme does at
 * runtime. That set cannot import from settingsOptions.ts (inline
 * script), so this test pins the copy: adding, removing, or renaming a
 * light theme in EDITOR_THEMES without updating both bootstraps fails
 * here instead of shipping a wrong first-paint polarity.
 *
 * It also pins the canonical preset pair the setTheme action writes
 * (lingua-dark / lingua-light), so renaming either id surfaces as a
 * test failure rather than a silently broken Appearance preset.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EDITOR_THEMES } from '../../src/renderer/components/Settings/settingsOptions';

const HTML_ENTRIES = [
  resolve(__dirname, '../../index.html'),
  resolve(__dirname, '../../src/web/index.html'),
];

function extractBootstrapLightSet(html: string, filePath: string): string[] {
  const match = html.match(/const lightEditorThemes = new Set\(\[([^\]]*)\]\)/);
  if (!match || match[1] === undefined) {
    throw new Error(`No lightEditorThemes Set literal found in ${filePath}`);
  }
  return match[1]
    .split(',')
    .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ''))
    .filter((entry) => entry.length > 0)
    .sort();
}

describe('theme bootstrap polarity drift guard', () => {
  const canonicalLightThemes = EDITOR_THEMES.filter((entry) => !entry.dark)
    .map((entry) => entry.id)
    .sort();

  for (const filePath of HTML_ENTRIES) {
    it(`keeps the lightEditorThemes set in ${filePath.split('/').slice(-2).join('/')} in sync with EDITOR_THEMES`, () => {
      const html = readFileSync(filePath, 'utf8');
      expect(extractBootstrapLightSet(html, filePath)).toEqual(canonicalLightThemes);
    });
  }

  it('keeps the setTheme preset pair valid in EDITOR_THEMES', () => {
    const dark = EDITOR_THEMES.find((entry) => entry.id === 'lingua-dark');
    const light = EDITOR_THEMES.find((entry) => entry.id === 'lingua-light');
    expect(dark?.dark).toBe(true);
    expect(light?.dark).toBe(false);
  });
});

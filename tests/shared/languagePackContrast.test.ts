import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_PACKS } from '../../src/shared/languagePacks';
import {
  contrastRatio,
  over,
  parseColor,
  readCssBlock,
  resolveToken,
  withAlpha,
} from '../__fixtures__/colorContrast';

const tailwind = readFileSync(resolve(__dirname, '../../node_modules/tailwindcss/theme.css'), 'utf8');
const css = readFileSync(resolve(__dirname, '../../src/renderer/index.css'), 'utf8');
const light = readCssBlock(css, /:root,\s*\n\.light\s*\{/);
const dark = readCssBlock(css, /\.dark,\s*\n\[data-theme='dark'\]\s*\{/);
const panel = {
  light: parseColor(resolveToken('--color-bg-panel', light)),
  dark: parseColor(resolveToken('--color-bg-panel', dark, light)),
};

function palette(name: string) {
  const value = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(tailwind)?.[1];
  if (!value) throw new Error(`Tailwind colour not found: ${name}`);
  return parseColor(value.replace(/^oklch\(([\d.]+)%/, (_, l: string) => `oklch(${Number(l) / 100}`));
}

function parseRecipe(classes: string) {
  const bg = /\bbg-([a-z]+-\d+)\/(\d+)\b/.exec(classes);
  const lightText = /(?:^|\s)text-([a-z]+-\d+)\b/.exec(classes)?.[1];
  const darkText = /\bdark:text-([a-z]+-\d+)\b/.exec(classes)?.[1];
  return { bg: bg ? { name: bg[1]!, alpha: Number(bg[2]) / 100 } : null, lightText, darkText };
}

describe.each(LANGUAGE_PACKS.map((pack) => [pack.id, pack] as const))('%s language colours', (_id, pack) => {
  const badge = parseRecipe(pack.badgeClass);
  const text = parseRecipe(pack.textColorClass);

  it.each(['light', 'dark'] as const)('badge text clears 4.5:1 on its tint in %s', (theme) => {
    const shade = theme === 'light' ? badge.lightText : badge.darkText;
    expect(shade, pack.badgeClass).toBeDefined();
    const tint = over(withAlpha(palette(badge.bg!.name), badge.bg!.alpha), panel[theme]);
    expect(contrastRatio(palette(shade!), tint)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['light', 'dark'] as const)('label colour clears 4.5:1 on the panel in %s', (theme) => {
    const shade = theme === 'light' ? text.lightText : text.darkText;
    expect(shade, pack.textColorClass).toBeDefined();
    expect(contrastRatio(palette(shade!), panel[theme])).toBeGreaterThanOrEqual(4.5);
  });
});

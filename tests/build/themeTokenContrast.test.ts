import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  parseColor,
  readCssBlock,
  resolveToken,
} from '../__fixtures__/colorContrast';

const css = readFileSync(resolve(__dirname, '../../src/renderer/index.css'), 'utf8');
const light = readCssBlock(css, /:root,\s*\n\.light\s*\{/);
const dark = readCssBlock(css, /\.dark,\s*\n\[data-theme='dark'\]\s*\{/);

// [foreground token, background token, role]; every pair is text and must clear 4.5:1.
const PAIRS: ReadonlyArray<readonly [string, string, string]> = [
  ['--color-fg-base', '--color-bg-panel', 'body text'],
  ['--color-fg-muted', '--color-bg-panel', 'descriptions'],
  ['--color-fg-subtle', '--color-bg-panel', 'hints, eyebrows'],
  ['--color-fg-on-accent', '--color-accent', 'primary and Run label'],
  ['--color-fg-on-accent', '--color-accent-hover', 'primary hover'],
  ['--color-fg-on-accent', '--color-accent-pressed', 'primary pressed'],
  ['--color-fg-muted', '--color-bg-inset', 'disabled primary'],
  ['--color-accent-fg', '--color-bg-panel', 'ghost text'],
  ['--color-accent-fg', '--color-accent-tint', 'ghost hover'],
  ['--color-error-fg', '--color-bg-panel', 'danger text'],
  ['--color-error-fg', '--color-error-bg', 'danger hover'],
  ['--color-fg-on-accent', '--color-error-fg', 'danger inside a confirmation'],
  ['--color-success-fg', '--color-success-bg', 'success pill'],
  ['--color-warning-fg', '--color-warning-bg', 'warning pill'],
  ['--color-info-fg', '--color-info-bg', 'info pill'],
  ['--color-syntax-keyword', '--color-editor-bg', 'keywords'],
  ['--color-syntax-string', '--color-editor-bg', 'strings'],
  ['--color-syntax-number', '--color-editor-bg', 'numbers'],
  ['--color-syntax-function', '--color-editor-bg', 'calls'],
];

function ratio(theme: Map<string, string>, fg: string, bg: string): number {
  const base = theme === dark ? light : undefined;
  return contrastRatio(parseColor(resolveToken(fg, theme, base)), parseColor(resolveToken(bg, theme, base)));
}

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme token contrast', (_name, theme) => {
  it.each(PAIRS)('%s on %s (%s) clears 4.5:1', (fg, bg) => {
    expect(ratio(theme, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('accent as text', () => {
  it('reads on white in light, where it is used for links and selection only', () => {
    expect(ratio(light, '--color-accent', '--color-bg-panel')).toBeGreaterThanOrEqual(4.5);
  });

  it('takes dark ink in dark, since white on the bright accent fails', () => {
    const accent = parseColor(resolveToken('--color-accent', dark, light));
    expect(contrastRatio(parseColor('#ffffff'), accent)).toBeLessThan(4.5);
    expect(ratio(dark, '--color-fg-on-accent', '--color-accent')).toBeGreaterThanOrEqual(9);
  });
});

describe('contrast helper', () => {
  it.each([
    ['#0080A1', '#FFFFFF', 4.56],
    ['#040607', '#00BFDF', 9.2],
    ['#6E5100', '#FBEFC4', 6.4],
    ['#E8D14D', '#F1EEC5', 1.3],
  ])('%s on %s matches the ratio printed on the boards', (fg, bg, printed) => {
    expect(contrastRatio(parseColor(fg), parseColor(bg))).toBeCloseTo(printed, 1);
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  parseColor,
  readCssBlock,
  readCssRule,
  resolveToken,
} from '../__fixtures__/colorContrast';

const css = readFileSync(resolve(__dirname, '../../src/renderer/index.css'), 'utf8');
const root = readCssBlock(css, /^:root\s*\{/m);
const light = readCssBlock(css, /:root,\s*\n\.light\s*\{/);
const dark = readCssBlock(css, /\.dark,\s*\n\[data-theme='dark'\]\s*\{/);
/** Every token an Ink or Paper window resolves, in cascade order. */
const packShell = (set: 'ink' | 'paper') =>
  new Map([
    ...root,
    ...light,
    ...(set === 'ink' ? dark : []),
    ...readCssBlock(css, new RegExp(`^\\[data-palette='${set}'\\]\\s*\\{`, 'm')),
  ]);

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
  ['--color-fg-on-accent', '--color-error-border', 'confirmation danger hover'],
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

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s theme switch track', (_name, theme) => {
  it.each(['--color-bg-panel', '--color-bg-panel-alt'])('the off track clears 3:1 on %s', (bg) => {
    expect(ratio(theme, '--color-control-off', bg)).toBeGreaterThanOrEqual(3);
  });

  it('the white knob clears 3:1 on the off track', () => {
    const track = parseColor(resolveToken('--color-control-off', theme, theme === dark ? light : undefined));
    expect(contrastRatio(parseColor('#ffffff'), track)).toBeGreaterThanOrEqual(3);
  });
});

describe('guided tour scrim', () => {
  it('dims with dark ink in both themes, never a light wash', () => {
    for (const theme of [light, dark]) {
      const value = theme.get('--tour-overlay') ?? '';
      const base = /var\((--[\w-]+)\)/.exec(value)?.[1] ?? '';
      const ink = parseColor(resolveToken(base, theme, theme === dark ? light : undefined));
      expect(contrastRatio(ink, parseColor('#ffffff'))).toBeGreaterThan(10);
    }
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

describe('run pulse', () => {
  it('rings the Run button in its own fill, not the success hue', () => {
    const keyframes = /@keyframes run-pulse\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(keyframes).toContain('var(--color-run)');
    expect(keyframes).not.toContain('success');
  });

  it('keeps the scratchpad rim and each workflow halo while it pulses', () => {
    const keyframes = /@keyframes run-pulse\s*\{[\s\S]*?\n\}/.exec(css)?.[0] ?? '';
    expect(keyframes).toContain('var(--run-rim');
    expect(keyframes).toContain('var(--run-halo, var(--color-run))');
    expect(readCssRule(css, ".action-pill-run[data-workflow='scratchpad']")).toMatch(/--run-rim:[\s\S]*--run-halo:/);
    expect(readCssRule(css, ".action-pill-run[data-workflow='debug']")).toContain('--run-halo: var(--color-debug-fill)');
  });

  it('restores the focus ring over the workflow shadows', () => {
    const rule = readCssRule(css, ".action-pill-run[data-workflow='scratchpad']:focus-visible");
    expect(css.indexOf(rule)).toBeGreaterThan(css.indexOf(".action-pill-run[data-workflow='scratchpad'] {"));
    expect(rule).toContain('ring-2');
  });
});

describe('action pill workflow colours', () => {
  const THEMES: ReadonlyArray<readonly [string, Map<string, string>]> = [
    ['Classic light', new Map([...root, ...light])],
    ['Classic dark', new Map([...root, ...light, ...dark])],
    ['Ink', packShell('ink')],
    ['Paper', packShell('paper')],
  ];
  const RUN = ".action-pill-run:not([data-workflow='debug']):not([data-workflow='scratchpad']):not(:disabled)";
  // [workflow, rule that sets the label, rules that set each fill].
  const WORKFLOWS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
    ['run', '.action-pill-run', ['.action-pill-run', `${RUN}:hover`, `${RUN}:active`]],
    ...(['scratchpad', 'debug'] as const).map((workflow) => {
      const rule = `.action-pill-run[data-workflow='${workflow}']`;
      return [workflow, rule, [rule, `${rule}:not(:disabled):hover`]] as const;
    }),
  ];

  /** The var() a rule assigns to `property`, so a theme can resolve it. */
  function ruleToken(selector: string, property: 'background' | 'color'): string {
    const body = readCssRule(css, selector);
    const value = new RegExp(`[\\s;{]${property}:\\s*var\\((--[\\w-]+)\\)`).exec(body)?.[1];
    if (!value) throw new Error(`${selector} sets no ${property} token`);
    return value;
  }

  const hex = (token: string, theme: Map<string, string>) => parseColor(resolveToken(token, theme));

  describe.each(THEMES)('%s', (_name, theme) => {
    it.each(WORKFLOWS)('%s label clears 4.5:1 on every fill state', (_workflow, labelRule, fillRules) => {
      const label = hex(ruleToken(labelRule, 'color'), theme);
      for (const rule of fillRules) {
        expect(contrastRatio(label, hex(ruleToken(rule, 'background'), theme)), rule).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('keeps scratchpad and debug distinct from Run', () => {
      const run = resolveToken(ruleToken('.action-pill-run', 'background'), theme);
      for (const workflow of ['scratchpad', 'debug']) {
        expect(resolveToken(ruleToken(`.action-pill-run[data-workflow='${workflow}']`, 'background'), theme)).not.toBe(run);
      }
    });
  });

  it.each(['Ink', 'Paper'])('fills Run with the pulse under dark ink in %s', (name) => {
    const theme = THEMES.find(([label]) => label === name)![1];
    expect(resolveToken('--color-run', theme)).toBe(root.get('--color-pulse'));
    expect(resolveToken('--color-run-on', theme)).toBe(root.get('--color-pulse-on'));
  });

  it.each(['Classic light', 'Classic dark'])('keeps the accent Run in %s', (name) => {
    const theme = THEMES.find(([label]) => label === name)![1];
    expect(resolveToken('--color-run', theme)).toBe(resolveToken('--color-accent', theme));
    expect(resolveToken('--color-run-on', theme)).toBe(resolveToken('--color-fg-on-accent', theme));
  });
});

describe('Ink and Paper palettes', () => {
  const hex = (token: string) => parseColor(resolveToken(token, root));
  const ROLES = ['text-1', 'text-2', 'text-3', 'pulse-fg', ...['number', 'string', 'boolean', 'error', 'date', 'none'].map((v) => `value-${v}`)];

  it.each(['ink', 'paper'])('%s text and value colours clear 4.5:1 on ground and panel', (set) => {
    for (const role of ROLES) {
      for (const surface of ['ground', 'panel']) {
        const r = contrastRatio(hex(`--color-${set}-${role}`), hex(`--color-${set}-${surface}`));
        expect(r, `${set} ${role} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('labels on the pulse fill use the dark ink', () => {
    expect(contrastRatio(hex('--color-pulse-on'), hex('--color-pulse'))).toBeGreaterThanOrEqual(4.5);
  });

  it('switches the value and pulse text roles with the shell theme', () => {
    for (const role of ['pulse-fg', 'value-number', 'value-error', 'value-none']) {
      expect(light.get(`--color-${role}`)).toBe(`var(--color-paper-${role})`);
      expect(dark.get(`--color-${role}`)).toBe(`var(--color-ink-${role})`);
    }
  });
});

describe.each(['ink', 'paper'] as const)('%s pack shell', (set) => {
  const block = readCssBlock(css, new RegExp(`^\\[data-palette='${set}'\\]\\s*\\{`, 'm'));
  const shell = packShell(set);

  it.each(PAIRS)('%s on %s (%s) clears 4.5:1', (fg, bg) => {
    expect(contrastRatio(parseColor(resolveToken(fg, shell)), parseColor(resolveToken(bg, shell)))).toBeGreaterThanOrEqual(4.5);
  });

  it('repaints chrome, panels and selection from the pack tokens', () => {
    for (const token of ['--color-bg-base', '--color-bg-panel', '--color-fg-base', '--color-accent-tint', '--color-editor-selection']) {
      expect(block.get(token)).toMatch(new RegExp(`^var\\(--color-${set}-`));
    }
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

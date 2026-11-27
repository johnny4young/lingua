import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { TokenMetadata } from 'monaco-editor/esm/vs/editor/common/encodedTokenAttributes.js';
import { TokenTheme } from 'monaco-editor/esm/vs/editor/common/languages/supports/tokenization.js';
import { vs, vs_dark } from 'monaco-editor/esm/vs/editor/standalone/common/themes.js';
import { defineCustomThemes, getEditorThemeSurface } from '@/components/Editor/editorThemes';

type DefineThemeCall = [name: string, theme: MonacoThemeData];

interface MonacoThemeRule {
  token: string;
  foreground?: string;
  fontStyle?: string;
}

interface MonacoThemeData {
  base: 'vs' | 'vs-dark';
  inherit: boolean;
  rules: readonly MonacoThemeRule[];
  colors: Record<string, string>;
}

/**
 * Minimal mock of the Monaco instance surface that `defineCustomThemes`
 * touches. Only `editor.defineTheme` matters — we capture the calls and
 * assert over them.
 */
function createMonacoMock() {
  const defineTheme = vi.fn<(name: string, theme: MonacoThemeData) => void>();
  return {
    monaco: { editor: { defineTheme } } as never,
    calls: () => defineTheme.mock.calls as DefineThemeCall[],
  };
}

function findTheme(calls: DefineThemeCall[], name: string): MonacoThemeData {
  const hit = calls.find(([themeName]) => themeName === name);
  if (!hit) {
    throw new Error(`defineCustomThemes did not register '${name}'`);
  }
  return hit[1];
}

/**
 * WCAG 2.1 relative luminance + contrast ratio. Numbers come directly from
 * the spec — no approximations — so a failure here is an accessibility
 * regression, not a rounding artefact.
 */
function relativeLuminance(hex: string): number {
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6) {
    throw new Error(`Expected 6-digit hex, got '${hex}'`);
  }
  const channels = [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  const [r, g, b] = linear;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA);
  const lb = relativeLuminance(hexB);
  const [lighter, darker] = la >= lb ? [la, lb] : [lb, la];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Monaco token rules store `foreground` as a 6-digit hex WITHOUT the `#`
 * prefix; the `colors` map stores canonical `#rrggbb`. Normalize so the
 * WCAG helper can treat them uniformly.
 */
function toHex(value: string): string {
  return value.startsWith('#') ? value : `#${value}`;
}

const WCAG_AA_NORMAL_TEXT = 4.5;

/** Tokens we require every Lingua-owned theme to declare. */
const REQUIRED_TOKENS = [
  'comment',
  'keyword',
  'string',
  'number',
  'type',
  'function',
  'variable',
  'operator',
] as const;

describe('defineCustomThemes', () => {
  it('registers every Lingua-owned and redistributed Monaco theme', () => {
    const { monaco, calls } = createMonacoMock();
    defineCustomThemes(monaco);

    const names = calls().map(([name]) => name);
    expect(names).toEqual([
      'lingua-dark',
      'lingua-light',
      'lingua-ink',
      'lingua-paper',
      'dracula',
      'one-dark-pro',
      'monokai',
      'nord-night',
      'solarized-light',
    ]);
  });

  it('shares every custom viewer surface with its Monaco theme definition', () => {
    const { monaco, calls } = createMonacoMock();
    defineCustomThemes(monaco);

    for (const themeName of [
      'lingua-dark',
      'lingua-light',
      'lingua-ink',
      'lingua-paper',
      'dracula',
      'one-dark-pro',
      'monokai',
      'nord-night',
      'solarized-light',
    ]) {
      const theme = findTheme(calls(), themeName);
      expect(getEditorThemeSurface(themeName)).toEqual({
        background: theme.colors['editor.background'],
        foreground: theme.colors['editor.foreground'],
      });
    }
  });

  describe.each(['lingua-dark', 'lingua-light'] as const)('%s (Lingua-owned)', (themeName) => {
    it('declares the required syntax tokens instead of inheriting from vs/vs-dark', () => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);

      const theme = findTheme(calls(), themeName);
      const declaredTokens = theme.rules.map((rule) => rule.token);

      for (const token of REQUIRED_TOKENS) {
        expect(declaredTokens, `${themeName} is missing '${token}'`).toContain(token);
      }
    });

    it('styles comments as italic so they read as asides, not code', () => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);

      const theme = findTheme(calls(), themeName);
      const comment = theme.rules.find((rule) => rule.token === 'comment');
      expect(comment?.fontStyle).toBe('italic');
    });

    it('passes WCAG AA contrast for every syntax token against editor.background', () => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);

      const theme = findTheme(calls(), themeName);
      const bg = theme.colors['editor.background'];
      expect(bg, `${themeName} is missing editor.background`).toBeDefined();

      const failures: string[] = [];
      for (const rule of theme.rules) {
        if (!rule.foreground) continue;
        const ratio = contrastRatio(toHex(bg!), toHex(rule.foreground));
        if (ratio < WCAG_AA_NORMAL_TEXT) {
          failures.push(
            `${rule.token}=#${rule.foreground} on ${bg} → ${ratio.toFixed(2)}:1 (needs ≥ ${WCAG_AA_NORMAL_TEXT})`
          );
        }
      }

      expect(failures, failures.join('\n')).toEqual([]);
    });

    it('passes WCAG AA contrast for the editor.foreground default text color', () => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);

      const theme = findTheme(calls(), themeName);
      const bg = theme.colors['editor.background'];
      const fg = theme.colors['editor.foreground'];
      expect(bg).toBeDefined();
      expect(fg).toBeDefined();

      const ratio = contrastRatio(bg!, fg!);
      expect(ratio).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });

    it('keeps inactive line numbers readable against the editor background', () => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);

      const theme = findTheme(calls(), themeName);
      const background = theme.colors['editor.background'];
      const lineNumber = theme.colors['editorLineNumber.foreground'];
      expect(background).toBeDefined();
      expect(lineNumber).toBeDefined();
      expect(contrastRatio(background!, lineNumber!)).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });
  });

  describe('lingua-light', () => {
    it('uses the vs (light) base so Monaco falls back to light chrome when overrides are missing', () => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);

      const theme = findTheme(calls(), 'lingua-light');
      expect(theme.base).toBe('vs');
    });
  });

  describe('lingua-dark', () => {
    it('uses the vs-dark base so Monaco falls back to dark chrome when overrides are missing', () => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);

      const theme = findTheme(calls(), 'lingua-dark');
      expect(theme.base).toBe('vs-dark');
    });
  });

  describe.each([
    ['lingua-ink', 'vs-dark'],
    ['lingua-paper', 'vs'],
  ] as const)('%s (identity theme)', (themeName, base) => {
    function theme() {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);
      return findTheme(calls(), themeName);
    }

    it('declares the required syntax tokens on its own polarity base', () => {
      const data = theme();
      expect(data.base).toBe(base);
      const declared = data.rules.map((rule) => rule.token);
      for (const token of REQUIRED_TOKENS) expect(declared).toContain(token);
    });

    it('sets keywords in italic and marks comments for the casual axis', () => {
      const rules = theme().rules;
      expect(rules.find((rule) => rule.token === 'keyword')?.fontStyle).toBe('italic');
      expect(rules.find((rule) => rule.token === 'comment')?.fontStyle).toBe('italic underline');
    });

    it('keeps every ink above 4.5:1 on the background and the current-line highlight', () => {
      const data = theme();
      const failures: string[] = [];
      for (const surface of ['editor.background', 'editor.lineHighlightBackground']) {
        for (const rule of data.rules) {
          if (!rule.foreground) continue;
          const ratio = contrastRatio(data.colors[surface]!, toHex(rule.foreground));
          if (ratio < WCAG_AA_NORMAL_TEXT) failures.push(`${rule.token} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      expect(failures).toEqual([]);
      expect(
        contrastRatio(data.colors['editor.background']!, data.colors['editorLineNumber.foreground']!)
      ).toBeGreaterThanOrEqual(WCAG_AA_NORMAL_TEXT);
    });

    // Monaco merges inherited rules the same way: base rules first, the theme's after.
    function tokenTheme(data: MonacoThemeData) {
      const baseRules = (data.base === 'vs' ? vs : vs_dark).rules as readonly MonacoThemeRule[];
      const resolved = TokenTheme.createFromRawTokenTheme([...baseRules, ...data.rules], []);
      const colorOf = (token: string) =>
        resolved.getColorMap()[TokenMetadata.getForeground(resolved.match(0, token))]!.toString().toLowerCase();
      // FontStyle.Italic is bit 1.
      const italic = (token: string) => (TokenMetadata.getFontStyle(resolved.match(0, token)) & 1) === 1;
      return { baseRules, colorOf, italic };
    }

    it('reads SQL as the board does: italic keywords, functions in text, its own string and operator inks', () => {
      const data = theme();
      const { colorOf, italic } = tokenTheme(data);
      const ink = (token: string) => toHex(data.rules.find((rule) => rule.token === token)!.foreground!);
      expect(colorOf('string.sql')).toBe(ink('string'));
      expect(colorOf('predefined.sql')).toBe(data.colors['editor.foreground']);
      expect(colorOf('operator.sql')).toBe(ink('operator'));
      expect(colorOf('keyword.sql')).toBe(ink('keyword'));
      expect(italic('keyword.sql')).toBe(true);
      for (const token of ['string.sql', 'predefined.sql', 'operator.sql']) {
        expect(['#ff0000', '#ff00ff']).not.toContain(colorOf(token));
      }
    });

    it('resolves every coloured base rule to one of its own inks, keeping only the invalid red', () => {
      const data = theme();
      const { baseRules, colorOf, italic } = tokenTheme(data);
      const inks = new Set(data.rules.flatMap((rule) => (rule.foreground ? [toHex(rule.foreground).toLowerCase()] : [])));
      const coloured = baseRules.filter((rule) => rule.foreground && rule.token !== 'invalid').map((rule) => rule.token);
      expect(coloured.length).toBeGreaterThan(30);
      for (const token of coloured) {
        expect(inks, `${token} resolves to ${colorOf(token)}`).toContain(colorOf(token));
        if (token.startsWith('keyword')) expect(italic(token), `${token} italic`).toBe(true);
      }
    });

    it('keeps bracket pairs in the punctuation ink', () => {
      const data = theme();
      const punctuation = toHex(data.rules.find((rule) => rule.token === 'delimiter')!.foreground!);
      for (let level = 1; level <= 6; level += 1) {
        expect(data.colors[`editorBracketHighlight.foreground${level}`]).toBe(punctuation);
      }
    });
  });

  describe('identity theme parity with the shell', () => {
    const root = resolve(__dirname, '../../..');
    const css = readFileSync(resolve(root, 'src/renderer/index.css'), 'utf8');

    it.each([
      ['lingua-ink', 'ink'],
      ['lingua-paper', 'paper'],
    ] as const)('%s inks match the %s palette tokens and boot colours', (themeName, palette) => {
      const { monaco, calls } = createMonacoMock();
      defineCustomThemes(monaco);
      const theme = findTheme(calls(), themeName);
      const block = new RegExp(`\\[data-palette='${palette}'\\] \\{([^}]*)\\}`).exec(css)?.[1] ?? '';
      const token = (name: string) => new RegExp(`--color-syntax-${name}: (#[0-9a-f]{6});`).exec(block)?.[1];
      const ink = (name: string) => toHex(theme.rules.find((rule) => rule.token === name)!.foreground!);
      expect(token('keyword')).toBe(ink('keyword'));
      expect(token('string')).toBe(ink('string'));
      expect(token('number')).toBe(ink('number'));
      expect(token('comment')).toBe(ink('comment'));

      const background = theme.colors['editor.background'];
      expect(css).toContain(`--color-${palette}-ground: ${background};`);
      for (const entry of ['index.html', 'src/web/index.html']) {
        expect(readFileSync(resolve(root, entry), 'utf8')).toContain(`${palette}: '${background}'`);
      }
    });

    it('turns the comment marker into the casual axis instead of an underline', () => {
      expect(css).toMatch(/\[data-palette\] \.mtki\.mtku \{\s*text-decoration: none;/);
    });
  });
});

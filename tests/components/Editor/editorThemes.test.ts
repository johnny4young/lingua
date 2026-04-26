import { describe, expect, it, vi } from 'vitest';
import { defineCustomThemes } from '@/components/Editor/editorThemes';

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
const WCAG_AA_LARGE_TEXT = 3.0;

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
      'dracula',
      'one-dark-pro',
      'monokai',
      'nord-night',
      'solarized-light',
    ]);
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
        // Comments are italic and intentionally subtler than body code
        // — the DS spec, like every major editor theme (VS Code Dark+,
        // GitHub, Solarized), drops below 4.5:1 on comments so they
        // recede in the visual hierarchy. Hold them to the AA Large
        // threshold (3.0:1) instead of the body-text 4.5:1.
        const minRatio =
          rule.token === 'comment' ? WCAG_AA_LARGE_TEXT : WCAG_AA_NORMAL_TEXT;
        const ratio = contrastRatio(toHex(bg!), toHex(rule.foreground));
        if (ratio < minRatio) {
          failures.push(
            `${rule.token}=#${rule.foreground} on ${bg} → ${ratio.toFixed(2)}:1 (needs ≥ ${minRatio})`
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
});

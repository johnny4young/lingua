import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = join(__dirname, '../../src/renderer');
const RT_MEDIA = /@media\s*\(\s*prefers-reduced-transparency:\s*reduce\s*\)/u;
const BLUR = /backdrop-filter:\s*(?!none\b)|\bbackdrop-blur\b(?!-none)/u;
const TRANSLUCENT_BG = /\bbg-[\w-]+\/\d+|background(?:-color)?:[^;]*transparent/u;

type CssRule = { selectors: string[]; body: string; insideRt: boolean; layer: string | null };

const sources = readdirSync(RENDERER, { recursive: true, encoding: 'utf8' })
  .filter(path => /\.(?:css|tsx?)$/u.test(path))
  .map(path => ({
  path,
  text: readFileSync(join(RENDERER, path), 'utf8'),
}));
const css = (path: string) => sources.find(source => source.path === path)!.text;

/** Flattens style rules with their enclosing layer and whether a reduced-transparency query wraps them. */
function rules(text: string): CssRule[] {
  const out: CssRule[] = [];
  const stack: { prelude: string; start: number; insideRt: boolean; layer: string | null }[] = [];
  const clean = text.replace(/\/\*[\s\S]*?\*\//gu, match => ' '.repeat(match.length));
  let preludeStart = 0;
  for (let i = 0; i < clean.length; i += 1) {
    const char = clean[i];
    if (char === '{') {
      const prelude = clean.slice(preludeStart, i).trim();
      const parent = stack.at(-1);
      stack.push({
        prelude,
        start: i + 1,
        insideRt: (parent?.insideRt ?? false) || RT_MEDIA.test(prelude),
        layer: /^@layer\s+(\w+)/u.exec(prelude)?.[1] ?? parent?.layer ?? null,
      });
      preludeStart = i + 1;
    } else if (char === '}') {
      const open = stack.pop();
      if (open && !open.prelude.startsWith('@')) {
        out.push({
          selectors: open.prelude.split(',').map(selector => selector.trim().replace(/\s+/gu, ' ')),
          body: clean.slice(open.start, i),
          insideRt: open.insideRt,
          layer: open.layer,
        });
      }
      preludeStart = i + 1;
    } else if (char === ';') {
      preludeStart = i + 1;
    }
  }
  return out;
}

const cssRules = sources.filter(source => source.path.endsWith('.css')).flatMap(source => rules(source.text));

describe('reduced transparency', () => {
  it('resets every backdrop-filter from the base layer', () => {
    const reset = cssRules.find(rule => rule.insideRt && rule.selectors.includes('*'));
    expect(reset?.layer).toBe('base');
    expect(reset?.selectors).toEqual(['*', '::before', '::after']);
    expect(reset?.body).toMatch(/backdrop-filter:\s*none\s*!important/u);
  });

  it('gives every blurred translucent surface a solid fill under the preference', () => {
    const refilled = new Set(
      cssRules
        .filter(rule => rule.insideRt && /@apply[^;]*\bbg-|background(?:-color)?:/u.test(rule.body))
        .flatMap(rule => rule.selectors)
    );
    const translucent = cssRules.filter(rule => !rule.insideRt && BLUR.test(rule.body) && TRANSLUCENT_BG.test(rule.body));
    expect(translucent.length).toBeGreaterThan(0);
    expect(translucent.flatMap(rule => rule.selectors).filter(selector => !refilled.has(selector))).toEqual([]);

    const literals = sources
      .filter(source => /\.tsx?$/u.test(source.path) && source.text.includes('backdrop-blur'))
      .flatMap(source => [...source.text.matchAll(/(['"`])(?:(?!\1)[^\\\n]|\\.)*\1/gu)].map(([literal]) => literal))
      .filter(literal => BLUR.test(literal) && TRANSLUCENT_BG.test(literal));
    expect(literals.filter(literal => !literal.includes('reduce-transparency:bg-'))).toEqual([]);
  });

  it('makes the shared panel token opaque, also inside nested palette scopes', () => {
    const panel = cssRules.find(rule => rule.insideRt && rule.selectors.includes('[data-palette]'));
    expect(panel?.selectors).toContain(':root');
    expect(panel?.body).toMatch(/--app-panel:\s*var\(--color-bg-panel\)/u);
  });

  it('declares the Tailwind variant component fills rely on', () => {
    expect(css('index.css')).toContain(
      '@custom-variant reduce-transparency (@media (prefers-reduced-transparency: reduce));'
    );
  });
});

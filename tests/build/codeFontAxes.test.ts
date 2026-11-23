import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { readCssBlock, resolveToken } from '../__fixtures__/colorContrast';

const rendererDir = path.join(process.cwd(), 'src/renderer');
const read = (file: string) => readFileSync(path.join(rendererDir, file), 'utf8');
const cssFiles = readdirSync(rendererDir, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.css'));
const indexCss = read('index.css');

/** Every `selector { … }` block without nested braces, with its selector text. */
function ruleBlocks(css: string): Array<{ selector: string; body: string }> {
  const source = css.replace(/\/\*[\s\S]*?\*\//gu, '');
  return [...source.matchAll(/([^{};]*)\{([^{}]*)\}/gu)].map((m) => ({
    selector: (m[1] ?? '').trim(),
    body: m[2] ?? '',
  }));
}

const rootTokens = new Map([...readCssBlock(indexCss, /^:root\s*\{/m), ...readCssBlock(indexCss, /:root,\s*\n\.light\s*\{/)]);
const recursiveTokens = readCssBlock(indexCss, /^\[data-palette\]\[data-code-font='recursive'\]\s*\{/m);

describe('code face for values and the console', () => {
  it('resolves to Recursive with MONO 1 under Ink/Paper and to JetBrains Mono under Classic', () => {
    expect(resolveToken('--font-code', recursiveTokens, rootTokens)).toMatch(/^'Recursive', 'JetBrains Mono'/u);
    expect(resolveToken('--font-code-axes', recursiveTokens, rootTokens)).toBe("'MONO' 1");
    expect(resolveToken('--font-code', rootTokens)).toMatch(/^'JetBrains Mono'/u);
    expect(resolveToken('--font-code-axes', rootTokens)).toBe('normal');
  });

  it('routes the Tailwind mono and sans utilities through the same axes', () => {
    expect(indexCss).toMatch(/--font-mono: var\(--font-code\);/u);
    expect(indexCss).toMatch(/@utility font-mono \{\s*font-variation-settings: var\(--font-code-axes\);/u);
    expect(indexCss).toMatch(/@utility font-sans \{\s*font-variation-settings: normal;/u);
  });

  it('pairs every code-face CSS consumer with the MONO axes and every UI-face consumer with a reset', () => {
    const offenders: string[] = [];
    for (const file of cssFiles) {
      for (const { selector, body } of ruleBlocks(read(file))) {
        const family = /font-family:\s*var\(--font-(code|mono|ui)\)/u.exec(body)?.[1];
        // Nothing above body sets the axes, so the root UI face needs no reset.
        if (!family || selector === 'body') continue;
        const axes = /font-variation-settings:\s*([^;]+);/u.exec(body)?.[1]?.trim();
        // The axes inherit, so a UI label inside a value must turn MONO back off.
        const expected = family === 'ui' ? 'normal' : 'var(--font-code-axes)';
        if (axes !== expected) offenders.push(`${file} ${selector}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

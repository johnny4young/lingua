import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(tsx?|jsx?)$/.test(name) ? [path] : [];
  });
}

describe('syntax colour utilities', () => {
  // A colour Tailwind does not know produces no class, so the text silently keeps its parent's colour.
  it('uses a syntax hue as a class only when the Tailwind theme generates it', () => {
    const css = readFileSync(join(root, 'src/renderer/index.css'), 'utf8');
    const start = css.search(/^@theme inline \{/m);
    const theme = css.slice(start, css.indexOf('\n}', start));
    const missing: string[] = [];
    for (const file of sourceFiles(join(root, 'src/renderer'))) {
      for (const match of readFileSync(file, 'utf8').matchAll(/\b(?:text|bg|border|fill|stroke)-syntax-([a-z]+)\b/g)) {
        if (!theme.includes(`--color-syntax-${match[1]}:`)) missing.push(`${file.slice(root.length + 1)}: ${match[0]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

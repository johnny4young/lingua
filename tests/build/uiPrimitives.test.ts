import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const RENDERER = join(ROOT, 'src/renderer');
const INDEX = readFileSync(join(RENDERER, 'index.css'), 'utf8');

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(tsx?|css)$/u.test(entry.name)) yield full;
  }
}

const SOURCES = [...sourceFiles(RENDERER)].map(path => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));

function themeBlock(): string {
  const start = INDEX.indexOf('@theme inline {');
  let depth = 0;
  for (let index = INDEX.indexOf('{', start); index < INDEX.length; index += 1) {
    if (INDEX[index] === '{') depth += 1;
    if (INDEX[index] === '}' && --depth === 0) return INDEX.slice(start, index);
  }
  throw new Error('unterminated @theme block');
}

describe('UI primitives', () => {
  it('builds every surface, text and border colour class from a token Tailwind knows', () => {
    const tokens = new Set([...themeBlock().matchAll(/--color-([a-z0-9-]+)\s*:/gu)].map(match => match[1]));
    const utility =
      /(?<![\w-])(?:[a-z-]+:)*(?:bg|text|border|ring|outline|divide|fill|stroke|placeholder|caret|decoration|from|to|via|shadow|accent)-((?:bg|fg|border)(?:-[a-z0-9-]*[a-z0-9])?)(?:\/\d+)?(?![\w-])/gu;
    const missing = SOURCES.flatMap(({ path, text }) =>
      [...text.matchAll(utility)].filter(match => !tokens.has(match[1]!)).map(match => `${path}: ${match[0]}`)
    );
    // Without a token the class is never generated, so the surface renders transparent.
    expect(missing).toEqual([]);
  });

  it('ships one keycap, styled once', () => {
    expect(SOURCES.filter(({ text }) => /export function Kbd\b/u.test(text)).map(({ path }) => path)).toEqual([
      'src/renderer/components/ui/chrome.tsx',
    ]);
    expect(SOURCES.filter(({ text }) => text.includes('kbd-shell')).map(({ path }) => path)).toEqual([]);
  });

  it('keeps fixed full-window scrims in the shared shells, which end above the notice row', () => {
    const scrims = SOURCES.filter(({ path, text }) => path.endsWith('.tsx') && !path.includes('/testing/') && /\bfixed inset-0\b/u.test(text.replace(/\/\/.*$/gmu, '')));
    expect(scrims.map(({ path }) => path)).toEqual(['src/renderer/components/ui/ModalShell.tsx']);
    expect(INDEX.slice(INDEX.indexOf('.overlay-backdrop {'))).toMatch(/^[^}]*bottom: var\(--notice-row-offset, 0px\)/u);
  });

  it('gives every run verb the Run control focus ring', () => {
    expect(INDEX).toMatch(/\.action-pill-run:focus-visible \{\s*--tw-ring-color: var\(--color-run-ring\);/u);
    const verbs = SOURCES.filter(({ text }) => /\bfocus-ring\b[^'"`]*\baction-pill-run\b/u.test(text));
    expect(verbs.map(({ path }) => path)).toEqual([]);
  });
});

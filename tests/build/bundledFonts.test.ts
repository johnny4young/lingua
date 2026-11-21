import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = process.cwd();
const fontsDir = path.join(root, 'public/fonts');
const woff2Files = readdirSync(fontsDir).filter((name) => name.endsWith('.woff2')).sort();
const readEntry = (file: string) => readFileSync(path.join(root, file), 'utf8');
const desktopHtml = readEntry('index.html');
const webHtml = readEntry('src/web/index.html');
const desktopFaces = fontFaceBlocks(desktopHtml);
// Owner-approved ceiling for every bundled face, stricter than the derived perf budget.
const FONT_PAYLOAD_BUDGET_BYTES = 450_000;

function bundledFontsSection(): string {
  const notices = readFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const match = notices.match(/## Bundled Fonts\n([\s\S]*?)\n## /u);
  if (!match?.[1]) throw new Error('THIRD_PARTY_NOTICES.md has no Bundled Fonts section');
  return match[1];
}

function fontFaceBlocks(html: string): string[] {
  return html.match(/@font-face \{[\s\S]*?\n {6}\}/gu) ?? [];
}

describe('bundled fonts', () => {
  it('ships the Fraunces and Recursive variable faces beside Inter and JetBrains Mono', () => {
    expect(woff2Files).toEqual(
      expect.arrayContaining([
        'fraunces-latin-variable.woff2',
        'fraunces-latin-variable-italic.woff2',
        'recursive-latin-variable.woff2',
        'inter-latin-400-normal.woff2',
        'jetbrains-mono-latin-400-normal.woff2',
      ]),
    );
  });

  it('keeps the total font payload under budget', () => {
    const total = woff2Files.reduce((sum, name) => sum + statSync(path.join(fontsDir, name)).size, 0);
    expect(total).toBeLessThan(FONT_PAYLOAD_BUDGET_BYTES);
  });

  it('lists every font file and its licence text in the notices', () => {
    const section = bundledFontsSection();
    for (const name of woff2Files) {
      const family = name.replace(/-latin-.*$/u, '');
      expect(section, name).toMatch(new RegExp(`public/fonts/${family}-latin-`, 'u'));
    }
    const licenceFiles = [...section.matchAll(/public\/fonts\/([\w-]+\.txt)/gu)].map((m) => m[1] ?? '');
    expect(licenceFiles).toEqual(
      expect.arrayContaining(['Fraunces-OFL.txt', 'Recursive-OFL.txt', 'Inter-OFL.txt', 'OFL.txt']),
    );
    for (const file of licenceFiles) {
      const text = readFileSync(path.join(fontsDir, file), 'utf8');
      expect(text, file).toContain('SIL Open Font License, Version 1.1');
    }
  });

  it('declares one local @font-face per file, identical in both HTML entries', () => {
    expect(desktopFaces).toEqual(fontFaceBlocks(webHtml));
    for (const name of woff2Files) {
      const blocks = desktopFaces.filter((block) => block.includes(`url('./fonts/${name}')`));
      expect(blocks, name).toHaveLength(1);
      expect(blocks[0]).toContain('font-display: swap;');
    }
  });

  it('declares the variable axes the faces were instanced to', () => {
    const face = (file: string) => desktopFaces.find((block) => block.includes(file)) ?? '';
    expect(face('recursive-latin-variable.woff2')).toContain('font-weight: 420 720;');
    expect(face('recursive-latin-variable.woff2')).toContain('font-style: oblique 0deg 15deg;');
    expect(face('fraunces-latin-variable.woff2')).toContain('font-weight: 340 520;');
    expect(face('fraunces-latin-variable-italic.woff2')).toContain('font-style: italic;');
  });

  it('keeps the font build script pinned and subset to the declared unicode-range', () => {
    const script = readFileSync(path.join(root, 'scripts/fonts/build-variable-fonts.sh'), 'utf8');
    expect(script).toMatch(/FONTS_COMMIT=[0-9a-f]{40}/u);
    const subset = /UNICODES="([^"]+)"/u.exec(script)?.[1];
    const normalize = (range: string) => range.replace(/\s+/gu, '');
    for (const block of desktopFaces) {
      const declared = /unicode-range:([^;]+);/u.exec(block)?.[1] ?? '';
      expect(normalize(declared)).toBe(subset);
    }
  });
});

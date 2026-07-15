import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER_ROOT = resolve(process.cwd(), 'src/renderer');

function rendererSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return rendererSourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

describe('renderer command bus structure', () => {
  it('keeps app commands off the global window event target', () => {
    const offenders = rendererSourceFiles(RENDERER_ROOT).flatMap(file => {
      const source = readFileSync(file, 'utf8');
      const match = /window\s*\.\s*dispatchEvent\s*\(/u.exec(source);
      if (!match) return [];
      const line = source.slice(0, match.index).split('\n').length;
      return [`${file.slice(RENDERER_ROOT.length + 1)}:${line}`];
    });

    expect(offenders).toEqual([]);
  });
});

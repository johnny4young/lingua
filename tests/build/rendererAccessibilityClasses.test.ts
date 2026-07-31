import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '../..');
const RENDERER_ROOT = resolve(REPO_ROOT, 'src/renderer');
const UNDEFINED_HIDING_CLASS = /\bclassName\s*=\s*["']internal["']/u;

function rendererComponents(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const absolute = join(dir, entry);
    if (statSync(absolute).isDirectory()) {
      files.push(...rendererComponents(absolute));
    } else if (entry.endsWith('.tsx')) {
      files.push(absolute);
    }
  }
  return files;
}

describe('renderer accessibility class contracts', () => {
  it('uses the real sr-only utility instead of the undefined internal class', () => {
    const offenders = rendererComponents(RENDERER_ROOT)
      .filter(file => UNDEFINED_HIDING_CLASS.test(readFileSync(file, 'utf8')))
      .map(file => relative(REPO_ROOT, file));

    expect(
      offenders,
      'Screen-reader-only content must use Tailwind sr-only so it does not leak into the visual UI.'
    ).toEqual([]);
  });
});

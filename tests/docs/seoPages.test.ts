/**
 * implementation SEO scaffold guard — ensures every landing page the plan
 * enumerates exists, carries the required front-matter keys, links to
 * the canonical download, and includes an honest-limitations section.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGES_DIR = resolve(__dirname, '../../docs/seo-pages');

const EXPECTED_PAGES = [
  'go-playground-desktop.md',
  'rust-code-runner-desktop.md',
  'python-repl-desktop.md',
  'typescript-playground-offline.md',
  'multi-language-code-runner.md',
  'lua-offline-playground.md',
];

const REQUIRED_FRONT_MATTER_KEYS = ['title', 'description', 'canonical', 'ogImage', 'language'];

function readFrontMatter(file: string): Record<string, string> {
  const raw = readFileSync(file, 'utf-8');
  const match = raw.match(/^---\n([\s\S]+?)\n---/u);
  if (!match) return {};
  const body = match[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const kv = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/u);
    if (!kv) continue;
    const [, key, rawValue] = kv;
    if (!key) continue;
    out[key] = (rawValue ?? '').trim().replace(/^"|"$/g, '');
  }
  return out;
}

describe('docs/seo-pages', () => {
  it('ships every enumerated landing-page scaffold', () => {
    for (const filename of EXPECTED_PAGES) {
      expect(existsSync(resolve(PAGES_DIR, filename))).toBe(true);
    }
  });

  it('does not ship stray files without explicit review', () => {
    const actual = readdirSync(PAGES_DIR).filter((name) => name.endsWith('.md') && name !== 'README.md');
    for (const filename of actual) {
      expect(EXPECTED_PAGES).toContain(filename);
    }
  });

  it('every page carries the required front-matter keys', () => {
    for (const filename of EXPECTED_PAGES) {
      const fm = readFrontMatter(resolve(PAGES_DIR, filename));
      for (const key of REQUIRED_FRONT_MATTER_KEYS) {
        expect(fm[key], `missing ${key} in ${filename}`).toBeTruthy();
      }
      const description = fm.description ?? '';
      expect(description.length, `description too long in ${filename}`).toBeLessThanOrEqual(160);
    }
  });

  it('every page links back to the canonical download', () => {
    for (const filename of EXPECTED_PAGES) {
      const raw = readFileSync(resolve(PAGES_DIR, filename), 'utf-8');
      expect(raw).toContain('https://linguacode.dev');
    }
  });

  it('every page includes an honest-limitations section', () => {
    for (const filename of EXPECTED_PAGES) {
      const raw = readFileSync(resolve(PAGES_DIR, filename), 'utf-8');
      expect(raw, `${filename} missing limits section`).toMatch(
        /doesn'?t work today|limitations today|what's not/i
      );
    }
  });

  it('never reintroduces an MIT or open-source claim', () => {
    for (const filename of EXPECTED_PAGES) {
      const raw = readFileSync(resolve(PAGES_DIR, filename), 'utf-8');
      expect(raw).not.toMatch(/MIT.?licens/i);
      expect(raw).not.toMatch(/Lingua is open[-\s]?source/i);
    }
  });

  it('keeps the Lua page honest about the current plugin-gated product path', () => {
    const raw = readFileSync(resolve(PAGES_DIR, 'lua-offline-playground.md'), 'utf-8');
    expect(raw).toMatch(/local-plugin path/i);
    expect(raw).toMatch(/not .*default language/i);
    expect(raw).toMatch(/web build does .* expose the Lua plugin path today/i);
  });
});

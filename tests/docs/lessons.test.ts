/**
 * RL-039 first slice — guard the lesson scaffolds. Every lesson must
 * carry the schema fields the future runner depends on, ship en + es
 * sections, and never claim a feature that hasn't shipped.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const LESSONS_DIR = resolve(__dirname, '../../docs/lessons');

const REQUIRED_FRONT_MATTER = ['id', 'language', 'title', 'estimatedMinutes', 'prerequisites'];
const REQUIRED_EN_SECTIONS = [
  '## English',
  '### What you will build',
  '### Starter code',
  '### Walkthrough',
  '### Try it yourself',
  '### What you learned',
];
const REQUIRED_ES_SECTIONS = [
  '## Español',
  '### Lo que vas a construir',
  '### Código inicial',
  '### Paso a paso',
  '### Inténtalo tú',
  '### Lo que aprendiste',
];

function listLessons(): string[] {
  return readdirSync(LESSONS_DIR)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();
}

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

describe('docs/lessons (RL-039)', () => {
  it('ships the README + at least the two seed lessons', () => {
    expect(existsSync(resolve(LESSONS_DIR, 'README.md'))).toBe(true);
    const lessons = listLessons();
    expect(lessons).toContain('01-javascript-loops-and-arrays.md');
    expect(lessons).toContain('02-typescript-generic-functions.md');
    expect(lessons).toContain('03-python-fundamentals.md');
  });

  it('covers at least one second language beyond JS/TS (acceptance)', () => {
    const secondLanguageIds = new Set<string>();
    for (const filename of listLessons()) {
      const fm = readFrontMatter(resolve(LESSONS_DIR, filename));
      if (fm.language && fm.language !== 'javascript' && fm.language !== 'typescript') {
        secondLanguageIds.add(fm.language);
      }
    }
    expect(secondLanguageIds.size).toBeGreaterThan(0);
  });

  it('every lesson carries the required front-matter fields', () => {
    for (const filename of listLessons()) {
      const fm = readFrontMatter(resolve(LESSONS_DIR, filename));
      for (const key of REQUIRED_FRONT_MATTER) {
        expect(fm[key], `missing ${key} in ${filename}`).toBeDefined();
        expect(fm[key], `empty ${key} in ${filename}`).not.toBe('');
      }
      // estimatedMinutes is a number — front-matter values come back as
      // strings; assert it parses cleanly to a positive integer.
      const minutes = Number(fm.estimatedMinutes);
      expect(Number.isFinite(minutes) && minutes > 0, `invalid estimatedMinutes in ${filename}`).toBe(true);
    }
  });

  it('every lesson ships both en and es sections with the canonical sub-headers', () => {
    for (const filename of listLessons()) {
      const raw = readFileSync(resolve(LESSONS_DIR, filename), 'utf-8');
      for (const section of REQUIRED_EN_SECTIONS) {
        expect(raw, `${filename} missing en section "${section}"`).toContain(section);
      }
      for (const section of REQUIRED_ES_SECTIONS) {
        expect(raw, `${filename} missing es section "${section}"`).toContain(section);
      }
    }
  });

  it('lesson language ids match a built-in LanguagePack id', async () => {
    const { LANGUAGE_PACKS } = await import('../../src/shared/languagePacks');
    const knownIds = new Set(LANGUAGE_PACKS.map((pack) => pack.id));
    for (const filename of listLessons()) {
      const fm = readFrontMatter(resolve(LESSONS_DIR, filename));
      expect(knownIds.has(fm.language ?? ''), `unknown language ${fm.language} in ${filename}`).toBe(true);
    }
  });

  it('never claims the product is MIT or open source in lesson copy', () => {
    for (const filename of listLessons()) {
      const raw = readFileSync(resolve(LESSONS_DIR, filename), 'utf-8');
      expect(raw).not.toMatch(/MIT.?licens/i);
      expect(raw).not.toMatch(/Lingua is open[-\s]?source/i);
    }
  });
});

// The origin migration copies localStorage and the origin private file system
// only. Storage of another kind on the desktop renderer must extend
// src/main/rendererStorageMigration.ts first, or upgraded users lose it.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const rendererRoot = path.resolve(__dirname, '../../src/renderer');
const UNMIGRATED_STORAGE =
  /\bindexedDB\b|\bcaches\s*\.\s*(?:open|match|keys|has)\b|\bdocument\s*\.\s*cookie\b|\bcookieStore\b/;

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(?:ts|tsx|mts|js|mjs)$/.test(entry.name) ? [full] : [];
  });
}

describe('renderer origin storage', () => {
  it('uses only storage the origin migration copies', () => {
    const offenders = sourceFiles(rendererRoot)
      .filter(file => UNMIGRATED_STORAGE.test(withoutComments(readFileSync(file, 'utf8'))))
      .map(file => path.relative(rendererRoot, file));
    expect(offenders).toEqual([]);
  });
});

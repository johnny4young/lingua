import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SKIP_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'output',
  '.vite',
  '.playwright-cli',
  '.playwright-mcp',
]);

function collectMarkdownFiles(dir: string, files: string[] = []): string[] {
  if (!existsSync(dir)) {
    return files;
  }

  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) {
      continue;
    }

    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      collectMarkdownFiles(fullPath, files);
      continue;
    }

    if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

describe('public documentation hygiene', () => {
  const markdownFiles = collectMarkdownFiles(ROOT);

  it('does not contain machine-local absolute links', () => {
    const offenders = markdownFiles.filter((file) => {
      const text = readFileSync(file, 'utf-8');
      return /\/Users\/[^)\s]+|file:\/\/\/Users\/[^)\s]+/u.test(text);
    });

    expect(offenders.map((file) => file.replace(`${ROOT}/`, ''))).toEqual([]);
  });

  it('keeps public release docs discoverable', () => {
    for (const file of [
      'SECURITY.md',
      'PRIVACY.md',
      'CONTRIBUTING.md',
      'THIRD_PARTY_NOTICES.md',
      'docs/PUBLIC_RELEASE_CHECKLIST.md',
      'docs/RELEASE_SECURITY.md',
    ]) {
      expect(existsSync(resolve(ROOT, file)), file).toBe(true);
    }
  });

  it('keeps public docs on the current web deploy and release-note paths', () => {
    const publicDocs = ['README.md', 'RELEASE.md', 'docs/README.md']
      .map((file) => readFileSync(resolve(ROOT, file), 'utf-8'))
      .join('\n');

    expect(publicDocs).not.toContain('docs/CHANGELOG.md');
    expect(publicDocs).not.toContain('Deploy web version to GitHub Pages');
    expect(publicDocs).not.toContain('VITE_BASE_PATH=/lingua/');
    expect(publicDocs).toContain('Cloudflare Pages');
    expect(publicDocs).toContain('app.linguacode.dev');
  });

  it('keeps the guided tour free of external AGPL/commercial tour dependencies', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lockfile = readFileSync(resolve(ROOT, 'package-lock.json'), 'utf-8');

    expect(packageJson.dependencies?.['shepherd.js']).toBeUndefined();
    expect(packageJson.devDependencies?.['shepherd.js']).toBeUndefined();
    expect(lockfile).not.toContain('"node_modules/shepherd.js"');
  });
});

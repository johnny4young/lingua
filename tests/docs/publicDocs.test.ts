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
    // Forbidden machine-local absolute prefixes:
    //   - macOS: /Users/<name>, file:///Users/<name>, /private/var/<...>
    //   - Linux: /home/<name>/<...>, /root/<...>, /opt/<name>/<...>
    //   - Windows: C:\<name>\<...> (drive-letter + backslash form).
    //
    // The character class `[^)\\s]+` lets the match consume the rest
    // of the absolute path so a hit names the actual offending segment.
    //
    // Windows guard: a bare `\b` is unsafe — it would still match
    // inside URLs like https://example.com/C:\artifact (the `/` before
    // `C` is a non-word character so `\b` fires there). The negative
    // lookbehind `(?<![:/\w])` blocks URL-embedded matches and also
    // anything appended to a word (e.g. mid-identifier).
    const machineLocalPattern =
      /\/Users\/[^)\s]+|file:\/\/\/Users\/[^)\s]+|\/home\/[A-Za-z0-9_.-]+\/[^)\s]*|\/root\/[^)\s]+|\/private\/var\/[^)\s]+|\/opt\/[A-Za-z0-9_.-]+\/[^)\s]*|(?<![:/\w])[A-Z]:\\[A-Za-z0-9_.\\-]+/u;

    const offenders = markdownFiles.filter((file) => {
      const text = readFileSync(file, 'utf-8');
      return machineLocalPattern.test(text);
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
      'docs/PUBLIC_READINESS_AUDIT.md',
      'docs/RELEASE_SECURITY.md',
      'docs/MACOS_SIGNING.md',
      'docs/WINDOWS_SIGNING.md',
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

  it('README preserves the strings other doc guards depend on (RL-082 spotter)', () => {
    // README ownership is split across `scriptCommands.test.ts`,
    // `marketingSite.test.ts`, and the `keeps public docs on the
    // current web deploy` assertion above. After the RL-082 slim-down
    // the README dropped from 537 to ~130 lines; this spotter pins the
    // union of required strings in one place so a future README rewrite
    // owner doesn't need to grep three test files to find them.
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');

    // scriptCommands guard — README must mention the canonical dev
    // entrypoints. Mirrors `tests/docs/scriptCommands.test.ts`.
    for (const command of [
      'npm run dev:web',
      'npm run dev:web:pro',
      'npm run dev:desktop',
      'npm run dev:desktop:pro',
      'npm run smoke:desktop',
    ]) {
      expect(readme, `README must mention \`${command}\``).toContain(command);
    }

    // marketingSite guard — README must cross-reference the marketing
    // site, the web app, and the marketing-site ADR.
    for (const ref of [
      'https://linguacode.dev',
      'https://app.linguacode.dev',
      'docs/MARKETING_SITE_ADR.md',
    ]) {
      expect(readme, `README must reference \`${ref}\``).toContain(ref);
    }

    // publicDocs current-deploy guard — README must keep the
    // Cloudflare Pages + app.linguacode.dev wording so the deploy
    // posture stays self-documenting.
    expect(readme).toContain('Cloudflare Pages');
    expect(readme).toContain('app.linguacode.dev');
  });

  it('keeps the guided tour free of external AGPL/commercial tour dependencies', () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
    ) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lockfile = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8');

    expect(packageJson.dependencies?.['shepherd.js']).toBeUndefined();
    expect(packageJson.devDependencies?.['shepherd.js']).toBeUndefined();
    expect(lockfile).not.toContain('shepherd.js');
  });
});

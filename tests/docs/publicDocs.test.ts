import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

function collectPublishedMarkdownFiles(): string[] {
  const output = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '*.md'],
    { cwd: ROOT, encoding: 'utf8' }
  );

  return output
    .split('\n')
    .filter(Boolean)
    .map(file => resolve(ROOT, file));
}

function collectPublishedTextFiles(): string[] {
  const output = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' });

  return output
    .split('\n')
    .filter(Boolean)
    .filter(file => file !== '.gitignore')
    .map(file => resolve(ROOT, file))
    .filter(file => existsSync(file))
    .filter(file => {
      const content = readFileSync(file);
      return !content.includes(0);
    });
}

describe('public documentation hygiene', () => {
  const markdownFiles = collectPublishedMarkdownFiles();

  it('keeps private planning identifiers out of published text', () => {
    const privateReferencePattern = new RegExp(
      [
        `R${'L'}-\\d+`,
        `S${'R'}-\\d+`,
        `I${'T'}\\d+-[A-Za-z0-9]`,
        `A${'UDIT'}-\\d`,
        `M${'OV'}-\\d`,
        `W${'C'}-\\d`,
        `S${'EC'}-\\d`,
        `P${'ERF'}-\\d`,
        `internal ${'plan'}`,
        `internal ${'backlog'}`,
        `UX ${'Sweep'}`,
      ].join('|'),
      'i'
    );
    const offenders = collectPublishedTextFiles().filter(file =>
      privateReferencePattern.test(readFileSync(file, 'utf8'))
    );

    expect(offenders.map(file => file.replace(`${ROOT}/`, ''))).toEqual([]);
  });

  it('does not contain machine-local absolute links', () => {
    // Forbidden machine-local absolute prefixes:
    // - macOS: /Users/<name>, file:///Users/<name>, /private/var/<...>
    // - Linux: /home/<name>/<...>, /root/<...>, /opt/<name>/<...>
    // - Windows: C:\<name>\<...> (drive-letter + backslash form).
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

    const offenders = markdownFiles.filter(file => {
      const text = readFileSync(file, 'utf-8');
      return machineLocalPattern.test(text);
    });

    expect(offenders.map(file => file.replace(`${ROOT}/`, ''))).toEqual([]);
  });

  it('keeps public release docs discoverable', () => {
    for (const file of [
      'SECURITY.md',
      'PRIVACY.md',
      'CONTRIBUTING.md',
      'THIRD_PARTY_NOTICES.md',
      'docs/PUBLIC_RELEASE_CHECKLIST.md',
      'docs/RELEASE_SECURITY.md',
      'docs/MACOS_SIGNING.md',
      'docs/WINDOWS_SIGNING.md',
    ]) {
      expect(existsSync(resolve(ROOT, file)), file).toBe(true);
    }
  });

  it('keeps public docs on the current web deploy and release-note paths', () => {
    const publicDocs = ['README.md', 'RELEASE.md', 'docs/README.md']
      .map(file => readFileSync(resolve(ROOT, file), 'utf-8'))
      .join('\n');

    expect(publicDocs).not.toContain('docs/CHANGELOG.md');
    expect(publicDocs).not.toContain('Deploy web version to GitHub Pages');
    expect(publicDocs).not.toContain('VITE_BASE_PATH=/lingua/');
    expect(publicDocs).toContain('Cloudflare Pages');
    expect(publicDocs).toContain('app.linguacode.dev');
  });

  it('documents the current web runtime asset delivery path', () => {
    const development = readFileSync(resolve(ROOT, 'docs/DEVELOPMENT.md'), 'utf-8');
    const docsReadme = readFileSync(resolve(ROOT, 'docs/README.md'), 'utf-8');
    const envExample = readFileSync(resolve(ROOT, '.env.example'), 'utf-8');

    for (const text of [development, docsReadme]) {
      expect(text).toContain('VITE_LINGUA_WEB_RUNTIME_BASE');
      expect(text).toContain('DuckDB');
      expect(text).toContain('Ruby');
      expect(text).toContain('R2');
    }
    expect(development).toContain('25 MiB');
    expect(development).toContain('web-runtime/');
    expect(envExample).toContain('VITE_LINGUA_WEB_RUNTIME_BASE=');
    expect(envExample).toContain('VITE_LINGUA_APP_VERSION=');
    expect(envExample).toContain('LINGUA_WEBSITE_URL=');
  });

  it('documents desktop launcher and smoke environment toggles', () => {
    const development = readFileSync(resolve(ROOT, 'docs/DEVELOPMENT.md'), 'utf-8');

    for (const envName of [
      'LINGUA_RENDERER_URL',
      'LINGUA_ELECTRON_LAUNCHER',
      'LINGUA_DEV_SESSION_SKIP_LAUNCH',
      'LINGUA_SMOKE_TIMEOUT_MS',
      'LINGUA_SMOKE_ARTIFACT_DIR',
      'LINGUA_SMOKE_USER_DATA_DIR',
      'LINGUA_DESKTOP_SMOKE_OFFLINE',
      'LINGUA_DESKTOP_SMOKE_PACKAGED_SUBSET',
    ]) {
      expect(development, `docs/DEVELOPMENT.md must document ${envName}`).toContain(envName);
    }
  });

  it('keeps the docs index linked to root planning and compliance references', () => {
    const docsReadme = readFileSync(resolve(ROOT, 'docs/README.md'), 'utf-8');

    for (const file of ['THIRD_PARTY_LICENSE_REPORT.md']) {
      expect(docsReadme, `docs/README.md must reference ${file}`).toContain(file);
    }
  });

  it('keeps the docs index linked to every top-level docs markdown file', () => {
    const docsReadme = readFileSync(resolve(ROOT, 'docs/README.md'), 'utf-8');
    const topLevelDocs = markdownFiles
      .filter(file => dirname(file) === resolve(ROOT, 'docs'))
      .map(file => basename(file))
      .filter(name => name !== 'README.md')
      .sort();

    for (const doc of topLevelDocs) {
      expect(docsReadme, `docs/README.md must reference ${doc}`).toContain(doc);
    }
  });

  it('keeps singleton docs subdirectories discoverable from the docs index', () => {
    const docsReadme = readFileSync(resolve(ROOT, 'docs/README.md'), 'utf-8');
    const singletonSubdirDocs = readdirSync(resolve(ROOT, 'docs'), { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .flatMap(entry => {
        const dir = resolve(ROOT, 'docs', entry.name);
        const markdownFiles = readdirSync(dir)
          .filter(name => name.endsWith('.md'))
          .sort();
        return markdownFiles.length === 1 ? [`${entry.name}/${markdownFiles[0]}`] : [];
      })
      .sort();

    for (const doc of singletonSubdirDocs) {
      expect(docsReadme, `docs/README.md must reference ${doc}`).toContain(doc);
    }
  });

  it('keeps the docs index linked to every ADR and operator runbook', () => {
    const docsReadme = readFileSync(resolve(ROOT, 'docs/README.md'), 'utf-8');
    const adrFiles = readdirSync(resolve(ROOT, 'docs'))
      .filter(name => name.endsWith('_ADR.md'))
      .sort();
    const runbookFiles = readdirSync(resolve(ROOT, 'docs/runbooks'))
      .filter(name => name.endsWith('.md'))
      .sort();

    for (const adr of adrFiles) {
      expect(docsReadme, `docs/README.md must reference ADR ${adr}`).toContain(adr);
    }

    for (const runbook of runbookFiles) {
      expect(docsReadme, `docs/README.md must reference runbook ${runbook}`).toContain(runbook);
    }
  });

  it('keeps the renderer reference aligned with current major folders and stores', () => {
    const rendererReadme = readFileSync(resolve(ROOT, 'src/renderer/README.md'), 'utf-8');

    const rendererFolders = readdirSync(resolve(ROOT, 'src/renderer'), {
      withFileTypes: true,
    })
      .filter(entry => entry.isDirectory())
      .map(entry => `${entry.name}/`)
      .sort();

    for (const folder of rendererFolders) {
      expect(rendererReadme, `renderer README must document ${folder}`).toContain(folder);
    }

    const componentFolders = readdirSync(resolve(ROOT, 'src/renderer/components'), {
      withFileTypes: true,
    })
      .filter(entry => entry.isDirectory())
      .map(entry => `components/${entry.name}/`)
      .sort();

    for (const componentFolder of componentFolders) {
      expect(rendererReadme, `renderer README must document ${componentFolder}`).toContain(
        componentFolder
      );
    }

    const storeFiles = readdirSync(resolve(ROOT, 'src/renderer/stores'), {
      withFileTypes: true,
    })
      .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
      .map(entry => entry.name)
      .sort();

    for (const store of storeFiles) {
      expect(rendererReadme, `renderer README must document ${store}`).toContain(store);
    }
  });

  it('README preserves the strings other documentation guards depend on', () => {
    // README ownership is split across `scriptCommands.test.ts` and
    // the `keeps public docs on the current web deploy` assertion
    // above. After the README slim-down
    // the README dropped from 537 to ~130 lines; this spotter pins the
    // union of required strings in one place so a future README rewrite
    // owner doesn't need to grep three test files to find them.
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf-8');

    // scriptCommands guard — README must mention the canonical dev
    // entrypoints. Mirrors `tests/docs/scriptCommands.test.ts`.
    for (const command of [
      'pnpm run dev:web',
      'pnpm run dev:web:pro',
      'pnpm run dev:desktop',
      'pnpm run dev:desktop:pro',
      'pnpm run smoke:desktop',
    ]) {
      expect(readme, `README must mention \`${command}\``).toContain(command);
    }

    // marketingSite guard — README must cross-reference the marketing
    // site and the web app.
    for (const ref of ['https://linguacode.dev', 'https://app.linguacode.dev']) {
      expect(readme, `README must reference \`${ref}\``).toContain(ref);
    }

    // publicDocs current-deploy guard — README must keep the
    // Cloudflare Pages + app.linguacode.dev wording so the deploy
    // posture stays self-documenting.
    expect(readme).toContain('Cloudflare Pages');
    expect(readme).toContain('app.linguacode.dev');
  });

  it('keeps the guided tour free of external AGPL/commercial tour dependencies', () => {
    const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf-8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const lockfile = readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8');

    expect(packageJson.dependencies?.['shepherd.js']).toBeUndefined();
    expect(packageJson.devDependencies?.['shepherd.js']).toBeUndefined();
    expect(lockfile).not.toContain('shepherd.js');
  });
});

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const README_PATH = resolve(__dirname, '../../README.md');
const AGENTS_PATH = resolve(__dirname, '../../AGENTS.md');
const RELEASE_PATH = resolve(__dirname, '../../RELEASE.md');
const PACKAGE_PATH = resolve(__dirname, '../../package.json');

describe('Script naming docs guard', () => {
  const readme = existsSync(README_PATH) ? readFileSync(README_PATH, 'utf-8') : '';
  const agents = existsSync(AGENTS_PATH) ? readFileSync(AGENTS_PATH, 'utf-8') : '';
  const release = existsSync(RELEASE_PATH) ? readFileSync(RELEASE_PATH, 'utf-8') : '';
  const packageJson = existsSync(PACKAGE_PATH)
    ? (JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8')) as {
        scripts?: Record<string, string>;
      })
    : {};

  it('README documents the canonical web and desktop dev entrypoints', () => {
    expect(readme).toContain('npm run dev:web');
    expect(readme).toContain('npm run dev:web:pro');
    expect(readme).toContain('npm run dev:desktop');
    expect(readme).toContain('npm run dev:desktop:pro');
    expect(readme).toContain('npm run smoke:desktop');
  });

  it('AGENTS documents the canonical desktop and paid-tier commands', () => {
    expect(agents).toContain('npm run dev:desktop');
    expect(agents).toContain('npm run dev:desktop:pro');
    expect(agents).toContain('npm run smoke:desktop');
    expect(agents).toContain('npm run dev:web:pro');
  });

  it('release docs refer only to the new desktop packaging/smoke commands', () => {
    expect(release).toContain('npm run smoke:desktop');
    expect(release).not.toContain('npm run desktop:smoke');
  });

  it('key docs do not mention the old desktop command family anymore', () => {
    const combined = `${readme}\n${agents}\n${release}`;
    expect(combined).not.toContain('npm run desktop:dev');
    expect(combined).not.toContain('npm run desktop:dev:sync');
    expect(combined).not.toContain('npm run desktop:smoke');
    expect(combined).not.toContain('npm start');
  });

  it('package.json exposes only the canonical script family and keeps the documented order', () => {
    const scripts = packageJson.scripts ?? {};
    expect(Object.keys(scripts)).toEqual([
      'dev:web',
      'dev:web:pro',
      'dev:desktop',
      'dev:desktop:sync',
      'dev:desktop:pro',
      'dev:desktop:prod',
      'dev:desktop:forge',
      'build:web',
      'preview:web',
      'smoke:desktop',
      // RL-083 Slice 1 — runtime-asset lock + offline desktop smoke
      'smoke:desktop:offline',
      // RL-080 Slice 3 — packaged desktop smoke (release-blocking)
      'smoke:desktop:packaged',
      'build:runtime-assets',
      'check:runtime-assets',
      // RL-085 — public-release SBOM + third-party license compliance
      'sbom:release',
      'check:licenses',
      'license:report',
      'compliance:release',
      // Desktop auto-update feed validation — stable production feed
      // or draft-channel staging feed evidence before release promotion.
      'check:update-feed',
      // RL-086 — bundle/runtime performance budgets and reports
      'performance:report',
      'performance:baseline',
      'check:performance',
      // Public-release changelog helpers — draft notes from
      // conventional commits and block version/changelog drift.
      'changelog:draft',
      'changelog:check',
      'test',
      'test:e2e:web',
      'test:smoke:web:license',
      'test:watch',
      'lint',
      'check:i18n',
      'check:i18n:copy',
      'format',
      'package:desktop',
      'make:desktop',
      'make:desktop:mac',
      'make:desktop:linux',
      'make:desktop:win',
      'publish:desktop',
    ]);
    expect(scripts).not.toHaveProperty('start');
    expect(scripts).not.toHaveProperty('package');
    expect(scripts).not.toHaveProperty('make');
    expect(scripts).not.toHaveProperty('make:mac');
    expect(scripts).not.toHaveProperty('make:linux');
    expect(scripts).not.toHaveProperty('make:win');
    expect(scripts).not.toHaveProperty('publish');
    expect(scripts).not.toHaveProperty('desktop:dev');
    expect(scripts).not.toHaveProperty('desktop:dev:sync');
    expect(scripts).not.toHaveProperty('desktop:smoke');
    expect(scripts).not.toHaveProperty('test:smoke:license-web');
    expect(scripts).not.toHaveProperty('test:smoke:license-web:unit');
    expect(scripts['smoke:desktop:packaged']).toContain('--offline');
    expect(scripts['smoke:desktop:packaged']).toContain('--against-packaged out/make');
    expect(scripts['check:update-feed']).toContain('validate-update-feed.mjs');
  });
});

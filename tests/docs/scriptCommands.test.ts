import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const README_PATH = resolve(__dirname, '../../README.md');
const AGENTS_PATH = resolve(__dirname, '../../AGENTS.md');
const RELEASE_PATH = resolve(__dirname, '../../RELEASE.md');
const PACKAGE_PATH = resolve(__dirname, '../../package.json');
const FIRST_PARTY_PACKAGE_PATHS = [
  'package.json',
  'license-server/package.json',
  'update-server/package.json',
];
const CHANGELOG_PATH = resolve(__dirname, '../../CHANGELOG.md');
const GITIGNORE_PATH = resolve(__dirname, '../../.gitignore');
const DEVELOPMENT_PATH = resolve(__dirname, '../../docs/DEVELOPMENT.md');
const CURRENT_OPERATOR_DOC_PATHS = [
  'README.md',
  'RELEASE.md',
  'docs/DEVELOPMENT.md',
  'docs/README.md',
  'docs/PUBLIC_READINESS_AUDIT.md',
  'docs/PUBLIC_RELEASE_CHECKLIST.md',
  'docs/TEST_PLAN.md',
  'license-server/README.md',
  'license-server/migrations/0001_initial.sql',
  'license-server/migrations/0002_add_surface_column.sql',
  'license-server/migrations/0003_relax_devices_os_check.sql',
  'license-server/migrations/0004_add_educations_and_pending_tables.sql',
  'license-server/scripts/diagnose-keypair.mjs',
  'license-server/test/emails/templates.test.ts',
  'update-server/wrangler.toml',
];
const WORKFLOW_PATHS = [
  resolve(__dirname, '../../.github/workflows/ci.yml'),
  resolve(__dirname, '../../.github/workflows/deploy-update-server.yml'),
  resolve(__dirname, '../../.github/workflows/deploy-web.yml'),
  resolve(__dirname, '../../.github/workflows/release.yml'),
];

describe('Script naming docs guard', () => {
  const readme = existsSync(README_PATH) ? readFileSync(README_PATH, 'utf-8') : '';
  const agents = existsSync(AGENTS_PATH) ? readFileSync(AGENTS_PATH, 'utf-8') : '';
  const release = existsSync(RELEASE_PATH) ? readFileSync(RELEASE_PATH, 'utf-8') : '';
  const changelog = existsSync(CHANGELOG_PATH) ? readFileSync(CHANGELOG_PATH, 'utf-8') : '';
  const gitignore = existsSync(GITIGNORE_PATH) ? readFileSync(GITIGNORE_PATH, 'utf-8') : '';
  const development = existsSync(DEVELOPMENT_PATH)
    ? readFileSync(DEVELOPMENT_PATH, 'utf-8')
    : '';
  const workflows = WORKFLOW_PATHS.map((path) =>
    existsSync(path) ? readFileSync(path, 'utf-8') : ''
  );
  const packageJson = existsSync(PACKAGE_PATH)
    ? (JSON.parse(readFileSync(PACKAGE_PATH, 'utf-8')) as {
        engines?: Record<string, string>;
        packageManager?: string;
        scripts?: Record<string, string>;
      })
    : {};

  it('README documents the canonical web and desktop dev entrypoints', () => {
    expect(readme).toContain('pnpm run dev:web');
    expect(readme).toContain('pnpm run dev:web:pro');
    expect(readme).toContain('pnpm run dev:desktop');
    expect(readme).toContain('pnpm run dev:desktop:pro');
    expect(readme).toContain('pnpm run smoke:desktop');
  });

  it('AGENTS documents the canonical desktop and paid-tier commands', () => {
    expect(agents).toContain('pnpm run dev:desktop');
    expect(agents).toContain('pnpm run dev:desktop:pro');
    expect(agents).toContain('pnpm run smoke:desktop');
    expect(agents).toContain('pnpm run dev:web:pro');
  });

  it('release docs refer only to the new desktop packaging/smoke commands', () => {
    expect(release).toContain('pnpm run smoke:desktop');
    expect(release).not.toContain('pnpm run desktop:smoke');
  });

  it('key docs do not mention the old desktop command family anymore', () => {
    const combined = `${readme}\n${agents}\n${release}`;
    expect(combined).not.toContain('pnpm run desktop:dev');
    expect(combined).not.toContain('pnpm run desktop:dev:sync');
    expect(combined).not.toContain('pnpm run desktop:smoke');
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
      'build:web',
      // RL-098 Slice 1 — CLI bundle (lingua utility, lingua capsule validate)
      'build:cli',
      'preview:web',
      'smoke:desktop',
      'smoke:desktop:stagewright',
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
      // RL-061 follow-up — R2 release mirror parity check (private
      // repo means GitHub Releases assets are not public-downloadable,
      // mirror-r2 keeps `downloads.linguacode.dev` in sync for
      // marketing-site CTAs). See `docs/runbooks/r2-release-mirror-setup.md`.
      'check:r2-mirror',
      // Release hardening — probe the public R2 web-runtime mirror
      // (public access + CORS) and the local release preflight that
      // runs the release-blocking gates CI-faithfully before dispatch.
      'check:release-infra',
      'release:preflight',
      // RL-143 — license-signing-key rotation gate (registry +
      // SLA + env-drift assertions); also wired into release.yml,
      // deploy-web.yml, and ci.yml. See docs/RELEASE_SECURITY.md
      // § Licensing for the rotation runbook.
      'check:license-rotation',
      // RL-145 — blocking production-graph audit gate (pnpm audit --prod
      // wrapper); wired into ci.yml (PR) and release.yml. See
      // docs/RELEASE_SECURITY.md for the prod-vs-full split rationale.
      'check:prod-audit',
      // RL-086 — bundle/runtime performance budgets and reports
      'performance:report',
      'performance:baseline',
      'check:performance',
      // Public-release changelog helpers — draft notes from
      // conventional commits and block version/changelog drift.
      'changelog:draft',
      'changelog:check',
      'test',
      // Dead-code gate (knip.jsonc): unreferenced files, unused/unlisted
      // dependencies. Unused exports stay advisory via `pnpm exec knip`.
      'check:deadcode',
      // RL-132 / AUDIT-12 — scoped tsc gate that type-checks the branded-id
      // swap-attack compile guard under tests/ (tsconfig.test.json).
      'typecheck:tests',
      'test:e2e:web',
      'test:smoke:web:license',
      'test:watch',
      'lint',
      // RL-149 / AUDIT-29 — ratcheting AST guard for direct telemetry callers.
      'check:telemetry-call-sites',
      'check:i18n',
      'check:i18n:copy',
      'format',
      // Desktop bundle build (main + preload + renderer via Vite) that
      // electron-builder then packages — the Forge-free build step.
      'build:desktop-bundles',
      'package:desktop',
      'make:desktop',
      'make:desktop:mac',
      'make:desktop:linux',
      'make:desktop:win',
      'publish:desktop',
      // RL-098 Slice 1 fold G — rebuild CLI bundle on `pnpm install`
      // so a `git pull` doesn't require remembering `pnpm run build:cli`.
      'prepare',
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
    expect(scripts['smoke:desktop:packaged']).toContain('--against-packaged out-builder');
    expect(scripts['check:update-feed']).toContain('validate-update-feed.mjs');
    expect(scripts['check:r2-mirror']).toContain('check-r2-mirror.mjs');
  });

  it('keeps the first-party Node policy on the 24.x family, not a fixed patch', () => {
    expect(packageJson.engines?.node).toBe('24.x');
    expect(readme).toContain('Node 24.x');
    expect(readme).not.toContain('Node 24+');
    expect(readme).not.toContain('| Node.js        | >= 24');

    for (const workflow of workflows) {
      expect(workflow).toMatch(/node-version:\s*['"]24\.x['"]/u);
      expect(workflow).not.toMatch(/node-version:\s*['"]24(?:\.\d+\.\d+)?['"]/u);
    }

    const policyDocs = `${readme}\n${changelog}`;
    expect(policyDocs).toContain('24.x');
    expect(policyDocs).toContain('24.X.Y');
    expect(policyDocs).not.toMatch(/\b24\.\d+\.\d+\b/u);
    expect(policyDocs).not.toMatch(/(?:^|[\s`])>=\s*24\.\d+\.\d+\b/u);
  });

  it('keeps every first-party package manager policy pnpm-only', () => {
    for (const path of FIRST_PARTY_PACKAGE_PATHS) {
      const json = JSON.parse(
        readFileSync(resolve(__dirname, '../..', path), 'utf-8')
      ) as { packageManager?: string };
      expect(json, path).toMatchObject({ packageManager: 'pnpm@11.3.0' });
    }
    expect(development).toMatch(/pnpm-only across all first-party\s+Node packages/u);
    expect(development).toContain('license-server/package.json');
    expect(development).toContain('update-server/package.json');
    expect(gitignore).toContain('package-lock.json');
    expect(gitignore).toContain('npm-shrinkwrap.json');
    expect(gitignore).toContain('yarn.lock');
  });

  it('documents every package script in the development workflow reference', () => {
    const scripts = Object.keys(packageJson.scripts ?? {});

    expect(development).toContain('## Package script reference');
    for (const script of scripts) {
      expect(development, `docs/DEVELOPMENT.md must document ${script}`).toContain(
        `\`${script}\``
      );
    }
  });

  it('keeps current operator docs on pnpm commands', () => {
    const forbiddenCommand = /\b(?:npm run|npx\s|npm install|npm ci|npm --prefix)\b/u;
    const offenders = CURRENT_OPERATOR_DOC_PATHS.filter((path) => {
      const text = readFileSync(resolve(__dirname, '../..', path), 'utf-8');
      return forbiddenCommand.test(text);
    });

    expect(offenders).toEqual([]);
  });
});

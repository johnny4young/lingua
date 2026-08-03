import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessCliPublishPrerequisites,
  CLI_BOOTSTRAP_SECRET,
  main,
  parseReportSnapshot,
  renderHtmlReport,
  renderMarkdownReport,
} from '../../scripts/cli-publish-prerequisites.mjs';

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    immutableReleases: { enabled: false, enforced_by_owner: false },
    environment: null,
    environmentSecrets: [],
    npmPackage: null,
    generatedAt: '2026-08-02T03:00:00.000Z',
    ...overrides,
  };
}

function protectedEnvironment() {
  return {
    name: 'npm-production',
    protection_rules: [
      {
        type: 'required_reviewers',
        prevent_self_review: false,
        reviewers: [{ type: 'User', reviewer: { login: 'maintainer' } }],
      },
    ],
  };
}

describe('CLI publication prerequisites', () => {
  it('reports the current bootstrap blockers without requesting secret values', () => {
    const report = assessCliPublishPrerequisites(fixture());

    expect(report).toMatchObject({
      mode: 'bootstrap',
      automatedStatus: 'blocked',
      status: 'blocked',
      checks: {
        immutableReleases: { status: 'blocked', enabled: false },
        environment: { status: 'blocked', exists: false, reviewers: 0 },
        bootstrapCredential: {
          status: 'blocked',
          required: true,
          present: false,
          name: CLI_BOOTSTRAP_SECRET,
        },
        npmPackage: { status: 'bootstrap-required', exists: false, version: null },
      },
    });
    expect(report.actions).toHaveLength(4);
    expect(JSON.stringify(report)).not.toContain('secretValue');
  });

  it('recognizes an automated bootstrap path that is ready for human approval', () => {
    const report = assessCliPublishPrerequisites(
      fixture({
        immutableReleases: { enabled: true, enforced_by_owner: false },
        environment: protectedEnvironment(),
        environmentSecrets: [{ name: CLI_BOOTSTRAP_SECRET }],
      })
    );

    expect(report.automatedStatus).toBe('ready');
    expect(report.status).toBe('review-required');
    expect(report.checks.environment).toMatchObject({ status: 'ready', reviewers: 1 });
    expect(report.checks.bootstrapCredential.status).toBe('ready');
    expect(report.actions).toEqual([
      'Confirm the @linguacode npm scope, publisher access, and account 2FA before approving the bootstrap job.',
    ]);
  });

  it('fails closed when a public package still has the bootstrap token configured', () => {
    const report = assessCliPublishPrerequisites(
      fixture({
        immutableReleases: { enabled: true, enforced_by_owner: true },
        environment: protectedEnvironment(),
        environmentSecrets: [{ name: CLI_BOOTSTRAP_SECRET }],
        npmPackage: { name: '@linguacode/cli', version: '0.16.0' },
      })
    );

    expect(report.mode).toBe('trusted-stage');
    expect(report.status).toBe('blocked');
    expect(report.automatedStatus).toBe('blocked');
    expect(report.checks.bootstrapCredential).toMatchObject({
      status: 'blocked',
      required: false,
      present: true,
    });
    expect(report.actions[0]).toContain(`Remove ${CLI_BOOTSTRAP_SECRET}`);
  });

  it('keeps trusted-publisher verification as an explicit manual review', () => {
    const report = assessCliPublishPrerequisites(
      fixture({
        immutableReleases: { enabled: true, enforced_by_owner: true },
        environment: protectedEnvironment(),
        npmPackage: { name: '@linguacode/cli', 'dist-tags': { latest: '0.16.0' } },
      })
    );

    expect(report.status).toBe('review-required');
    expect(report.automatedStatus).toBe('ready');
    expect(report.checks.npmPackage).toMatchObject({
      status: 'published',
      version: '0.16.0',
    });
    expect(report.actions).toEqual([
      'Confirm npm trusted publishing allows only publish-cli.yml, npm-production, and npm stage publish before the next version.',
    ]);
  });

  it('renders bilingual, secret-value-free operational evidence', () => {
    const report = assessCliPublishPrerequisites(fixture());
    const english = renderMarkdownReport(report, 'en');
    const spanish = renderMarkdownReport(report, 'es');
    const html = renderHtmlReport(report, 'es');

    expect(english).toContain('# CLI publication prerequisites');
    expect(english).toContain('Automated checks: Blocked');
    expect(english).toContain('| Immutable releases | Blocked | disabled |');
    expect(spanish).toContain('# Prerrequisitos de publicación del CLI');
    expect(spanish).toContain('| Releases inmutables | Bloqueado | desactivadas |');
    expect(spanish).toContain('| Entorno protegido | Bloqueado | ausente |');
    expect(spanish).toContain('Activa releases inmutables');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('<title>Prerrequisitos de publicación del CLI de Lingua</title>');
    expect(html).toContain('Inspección autenticada y de solo lectura');
    expect(html).toContain(CLI_BOOTSTRAP_SECRET);
    expect(html).not.toContain('_authToken');
  });

  it('validates and re-renders a saved report without using gh or the network', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-cli-prerequisites-'));
    const input = path.join(root, 'report.json');
    const output = path.join(root, 'report.md');
    const report = assessCliPublishPrerequisites(fixture());
    try {
      await writeFile(input, JSON.stringify(report));
      expect(parseReportSnapshot(await readFile(input, 'utf8'))).toEqual(report);
      await expect(
        main(['--input', input, '--format', 'markdown', '--locale', 'es', '--output', output])
      ).resolves.toBe(0);
      expect(await readFile(output, 'utf8')).toContain('Prerrequisitos de publicación del CLI');
      expect(() => parseReportSnapshot('{"schemaVersion":1}')).toThrow(
        'not a Lingua CLI publication prerequisite schema v1 report'
      );
      expect(() =>
        parseReportSnapshot(
          JSON.stringify({
            ...report,
            checks: {
              ...report.checks,
              environment: { ...report.checks.environment, reviewers: 'one' },
            },
          })
        )
      ).toThrow('not a Lingua CLI publication prerequisite schema v1 report');
      expect(() =>
        parseReportSnapshot(
          JSON.stringify({
            ...report,
            status: 'review-required',
          })
        )
      ).toThrow('inconsistent Lingua CLI publication prerequisite evidence');
      expect(() =>
        parseReportSnapshot(
          JSON.stringify({
            ...report,
            secretValue: 'must-not-survive',
          })
        )
      ).toThrow('not a Lingua CLI publication prerequisite schema v1 report');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

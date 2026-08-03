import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessDistributionReadiness,
  main,
  parseReportSnapshot,
  readLocalDistributionState,
  renderHtmlReport,
  renderMarkdownReport,
} from '../../scripts/distribution-readiness.mjs';

const assets = [
  'Lingua-0.15.0-mac-arm64.dmg',
  'Lingua-0.15.0-mac-x64.dmg',
  'Lingua-0.15.0-win-x64.exe',
  'Lingua-0.15.0-linux-x86_64.AppImage',
];

const checksums = new Map([
  ['Lingua-0.15.0-mac-arm64.dmg', 'a'.repeat(64)],
  ['Lingua-0.15.0-mac-x64.dmg', 'b'.repeat(64)],
  ['Lingua-0.15.0-win-x64.exe', 'c'.repeat(64)],
  ['Lingua-0.15.0-linux-x86_64.AppImage', 'd'.repeat(64)],
]);

function fixture(overrides: Record<string, unknown> = {}) {
  return {
    latestRelease: {
      tag_name: 'v0.15.0',
      draft: false,
      prerelease: false,
      published_at: '2026-07-28T21:26:52Z',
      html_url: 'https://github.com/johnny4young/lingua/releases/tag/v0.15.0',
      assets: assets.map(name => ({ name })),
    },
    npmPackage: null,
    tapRepository: { private: false },
    remoteCask: null,
    releaseChecksums: checksums,
    localVersions: {
      homebrew: '0.15.0',
      homebrewArmSha256: 'a'.repeat(64),
      homebrewIntelSha256: 'b'.repeat(64),
      winget: '0.15.0',
      wingetInstaller: '0.15.0',
      wingetSha256: 'c'.repeat(64),
    },
    generatedAt: '2026-08-01T20:00:00.000Z',
    ...overrides,
  };
}

describe('distribution readiness', () => {
  it('parses generated Homebrew and winget versions', () => {
    expect(
      readLocalDistributionState({
        cask: `  version "0.15.0"\n  sha256 arm:   "${'a'.repeat(64)}",\n         intel: "${'b'.repeat(64)}"\n`,
        wingetVersion: 'PackageVersion: 0.15.0\n',
        wingetInstaller: `PackageVersion: 0.15.0\nInstallerSha256: ${'c'.repeat(64).toUpperCase()}\n`,
      })
    ).toEqual({
      homebrew: '0.15.0',
      homebrewArmSha256: 'a'.repeat(64),
      homebrewIntelSha256: 'b'.repeat(64),
      winget: '0.15.0',
      wingetInstaller: '0.15.0',
      wingetSha256: 'c'.repeat(64),
    });
  });

  it('reports the current public blockers without treating prepared manifests as promoted', () => {
    const report = assessDistributionReadiness(fixture());

    expect(report.release.desktopAssets).toEqual({
      status: 'ready',
      missing: [],
      missingChecksums: [],
    });
    expect(report.release.cliAssets.status).toBe('next-release');
    expect(report.release.cliAssets.missing).toEqual([
      'linguacode-cli-0.15.0.tgz',
      'lingua-cli-v0.15.0-linux-x64.tar.gz',
      'lingua-cli-v0.15.0-windows-x64.tar.gz',
    ]);
    expect(report.release.cliAssets.missingChecksums).toEqual(report.release.cliAssets.missing);
    expect(report.npm.status).toBe('not-published');
    expect(report.npm.publication).toEqual({
      status: 'guarded',
      workflow: 'publish-cli.yml',
      mode: 'bootstrap-token',
    });
    expect(report.actions[0]).toContain('read/write access to the @linguacode scope');
    expect(report.actions[0]).toContain('Bypass 2FA enabled');
    expect(report.homebrew).toMatchObject({
      repositoryPublic: true,
      status: 'ready-to-promote',
      localVersion: '0.15.0',
      remoteVersion: null,
    });
    expect(report.winget.status).toBe('signing-required');
    expect(report.actions).toHaveLength(4);
  });

  it('recognizes fully promoted npm, Homebrew, and CLI artifacts', () => {
    const cliAssets = [
      'linguacode-cli-0.15.0.tgz',
      'lingua-cli-v0.15.0-linux-x64.tar.gz',
      'lingua-cli-v0.15.0-windows-x64.tar.gz',
    ];
    const report = assessDistributionReadiness(
      fixture({
        latestRelease: {
          ...fixture().latestRelease,
          assets: [...assets, ...cliAssets].map(name => ({ name })),
        },
        releaseChecksums: new Map([...checksums, ...cliAssets.map(name => [name, 'e'.repeat(64)])]),
        npmPackage: { name: '@linguacode/cli', 'dist-tags': { latest: '0.15.0' } },
        remoteCask: `cask "lingua" do\n  version "0.15.0"\n  sha256 arm: "${'a'.repeat(64)}",\n         intel: "${'b'.repeat(64)}"\nend\n`,
      })
    );

    expect(report.release.cliAssets.status).toBe('ready');
    expect(report.npm.status).toBe('ready');
    expect(report.homebrew.status).toBe('ready');
    expect(report.actions).toEqual([
      'Configure public-trust Authenticode credentials before winget submission.',
    ]);
  });

  it('allows a first npm publish from the stable release once its CLI artifacts exist', () => {
    const cliAssets = [
      'linguacode-cli-0.15.0.tgz',
      'lingua-cli-v0.15.0-linux-x64.tar.gz',
      'lingua-cli-v0.15.0-windows-x64.tar.gz',
    ];
    const report = assessDistributionReadiness(
      fixture({
        latestRelease: {
          ...fixture().latestRelease,
          assets: [...assets, ...cliAssets].map(name => ({ name })),
        },
        releaseChecksums: new Map([...checksums, ...cliAssets.map(name => [name, 'e'.repeat(64)])]),
      })
    );

    expect(report.actions[0]).toContain('dispatch publish-cli.yml for @linguacode/cli@0.15.0');
    expect(
      report.actions.some(action =>
        action.startsWith('Cut the next release with release_cli enabled')
      )
    ).toBe(false);
  });

  it('fails closed when a same-version manifest has a stale checksum', () => {
    const report = assessDistributionReadiness(
      fixture({
        localVersions: {
          ...fixture().localVersions,
          homebrewIntelSha256: 'd'.repeat(64),
          wingetSha256: 'e'.repeat(64),
        },
      })
    );

    expect(report.homebrew.status).toBe('blocked');
    expect(report.winget.status).toBe('blocked');
    expect(report.actions).toContain('Regenerate the Homebrew cask from v0.15.0 checksums.');
    expect(report.actions).toContain('Regenerate the winget manifests from v0.15.0 checksums.');
  });

  it('renders redacted bilingual Markdown and standalone HTML evidence', () => {
    const report = assessDistributionReadiness(fixture());
    const english = renderMarkdownReport(report, 'en');
    const spanish = renderMarkdownReport(report, 'es');
    const html = renderHtmlReport(report, 'es');

    expect(english).toContain('# Lingua distribution readiness');
    expect(english).toContain('| Homebrew | Ready to promote | 0.15.0 local |');
    expect(english).toContain('| npm workflow | Guarded | publish-cli.yml · bootstrap-token |');
    expect(spanish).toContain('# Estado de distribución de Lingua');
    expect(spanish).toContain('Requiere firma');
    expect(spanish).toContain('| Flujo npm | Protegido | publish-cli.yml · bootstrap-token |');
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('Evidencia pública y local');
    expect(html).toContain('Crea o confirma la organización @linguacode');
    expect(html).toContain('Bypass 2FA activado');
    expect(html).toContain('publish-cli.yml · bootstrap-token');
    expect(html).not.toContain('NPM_TOKEN');
  });

  it('fails closed for an unstable latest release', () => {
    expect(() =>
      assessDistributionReadiness(
        fixture({ latestRelease: { tag_name: 'nightly', draft: false, prerelease: false } })
      )
    ).toThrow('not a stable vX.Y.Z release');
  });

  it('accepts only reusable schema-v1 report snapshots', () => {
    const report = assessDistributionReadiness(fixture());
    const legacyReport = structuredClone(report);
    delete (legacyReport.npm as typeof report.npm & { publication?: unknown }).publication;

    expect(parseReportSnapshot(JSON.stringify(report))).toEqual(report);
    expect(parseReportSnapshot(JSON.stringify(legacyReport))).toEqual(report);
    expect(() =>
      parseReportSnapshot(
        JSON.stringify({
          ...report,
          npm: { ...report.npm, publication: { ...report.npm.publication, mode: 'unsafe' } },
        })
      )
    ).toThrow('not a Lingua distribution readiness schema v1 report');
    expect(() => parseReportSnapshot('{"schemaVersion":2}')).toThrow(
      'not a Lingua distribution readiness schema v1 report'
    );
    expect(() =>
      parseReportSnapshot('{"schemaVersion":1,"release":{"tag":"v0.15.0"},"actions":[]}')
    ).toThrow('not a Lingua distribution readiness schema v1 report');
  });

  it('renders a saved snapshot into a newly created output directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-distribution-readiness-'));
    const input = path.join(root, 'status.json');
    const output = path.join(root, 'nested', 'status-es.html');
    try {
      await writeFile(input, JSON.stringify(assessDistributionReadiness(fixture())), 'utf8');

      await expect(
        main(['--input', input, '--format', 'html', '--locale', 'es', '--output', output])
      ).resolves.toBe(0);
      expect(await readFile(output, 'utf8')).toContain('Estado operativo');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

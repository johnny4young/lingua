import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  collectPackagedExternalRuntimeEntries,
  expandPlatformBinaries,
  PACKAGED_EXTERNAL_RUNTIME_COMPONENTS,
  renderMarkdownReport,
  reviewLicenseEntry,
} from '../../scripts/check-third-party-licenses.mjs';

const baseEntry = {
  name: 'fixture',
  version: '1.0.0',
  path: 'node_modules/fixture',
  missingPackageJson: false,
};

describe('check-third-party-licenses', () => {
  it('accepts reviewed permissive runtime licenses', () => {
    expect(reviewLicenseEntry({ ...baseEntry, license: 'MIT' })).toEqual({ ok: true });
    expect(reviewLicenseEntry({ ...baseEntry, license: '(MPL-2.0 OR Apache-2.0)' })).toEqual({
      ok: true,
    });
    expect(reviewLicenseEntry({ ...baseEntry, license: 'MPL-2.0' })).toEqual({ ok: true });
    expect(reviewLicenseEntry({ ...baseEntry, license: 'BlueOak-1.0.0' })).toEqual({
      ok: true,
    });
  });

  it('rejects missing, unreviewed, and blocked license expressions', () => {
    expect(reviewLicenseEntry({ ...baseEntry, license: 'UNKNOWN' })).toMatchObject({
      ok: false,
      reason: 'missing license metadata',
    });
    expect(
      reviewLicenseEntry({ ...baseEntry, license: 'LicenseRef-Reviewed-Later' })
    ).toMatchObject({
      ok: false,
      reason: 'unreviewed license expression: LicenseRef-Reviewed-Later',
    });
    expect(reviewLicenseEntry({ ...baseEntry, license: 'GPL-3.0-only' })).toMatchObject({
      ok: false,
      reason: 'blocked license expression: GPL-3.0-only',
    });
  });

  it('renders a deterministic Markdown report with policy failures', () => {
    const report = renderMarkdownReport([
      { ...baseEntry, name: 'ok-fixture', license: 'MIT' },
      { ...baseEntry, name: 'bad-fixture', license: 'LicenseRef-Commercial' },
    ]);

    expect(report).toContain('Packages reviewed: 2.');
    expect(report).toContain('Policy result: fail.');
    expect(report).toContain('`bad-fixture@1.0.0`: blocked license expression');
  });

  it('includes metadata for native artifacts copied from build-only packages', async () => {
    const root = await mkdtemp(path.join(process.cwd(), '.tmp-packaged-external-license-'));
    try {
      const packageDirectory = path.join(root, 'node_modules', '@vscode', 'ripgrep');
      await mkdir(packageDirectory, { recursive: true });
      await writeFile(
        path.join(packageDirectory, 'package.json'),
        JSON.stringify({
          name: '@vscode/ripgrep',
          version: '1.18.0',
          license: 'MIT',
        }),
        'utf8'
      );

      expect(collectPackagedExternalRuntimeEntries({ root })).toContainEqual({
        name: '@vscode/ripgrep',
        version: '1.18.0',
        license: 'MIT',
        path: 'extraResources/ripgrep',
        missingPackageJson: false,
        packageJsonPath: 'node_modules/@vscode/ripgrep/package.json',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports the devDependencies Vite inlines into the main bundle', async () => {
    const root = await mkdtemp(path.join(process.cwd(), '.tmp-packaged-inlined-license-'));
    try {
      for (const [name, version, license] of [
        ['undici', '7.29.0', 'MIT'],
        ['ws', '8.21.0', 'MIT'],
      ]) {
        const packageDirectory = path.join(root, 'node_modules', name);
        await mkdir(packageDirectory, { recursive: true });
        await writeFile(
          path.join(packageDirectory, 'package.json'),
          JSON.stringify({ name, version, license }),
          'utf8'
        );
      }

      const entries = collectPackagedExternalRuntimeEntries({ root });
      expect(entries).toContainEqual({
        packageJsonPath: 'node_modules/undici/package.json',
        name: 'undici',
        version: '7.29.0',
        license: 'MIT',
        path: '.vite/build/main.js',
        missingPackageJson: false,
      });
      expect(entries).toContainEqual({
        packageJsonPath: 'node_modules/ws/package.json',
        name: 'ws',
        version: '8.21.0',
        license: 'MIT',
        path: '.vite/build/main.js',
        missingPackageJson: false,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(['missing', 'malformed'])(
    'reports the metadata path for %s packaged manifests',
    async state => {
      const root = await mkdtemp(path.join(process.cwd(), '.tmp-packaged-metadata-'));
      try {
        if (state === 'malformed') {
          for (const component of PACKAGED_EXTERNAL_RUNTIME_COMPONENTS) {
            const metadataPath = path.join(root, component.packageJsonPath);
            await mkdir(path.dirname(metadataPath), { recursive: true });
            await writeFile(metadataPath, '{not json', 'utf8');
          }
        }
        const entries = collectPackagedExternalRuntimeEntries({ root });
        for (const component of PACKAGED_EXTERNAL_RUNTIME_COMPONENTS) {
          const entry = entries.find(item => item.name === component.name);
          expect(entry).toMatchObject({
            path: component.artifactPath,
            packageJsonPath: component.packageJsonPath,
            missingPackageJson: true,
          });
          expect(reviewLicenseEntry(entry)).toEqual({
            ok: false,
            reason: `missing package metadata at ${component.packageJsonPath}`,
          });
          expect(renderMarkdownReport([entry])).toContain(component.packageJsonPath);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  );

  it('lists every platform binary a binding family declares, whichever ones this OS installed', async () => {
    const root = await mkdtemp(path.join(process.cwd(), '.tmp-license-platforms-'));
    try {
      const write = async (name: string, manifest: Record<string, unknown>) => {
        await mkdir(path.join(root, 'node_modules', name), { recursive: true });
        await writeFile(path.join(root, 'node_modules', name, 'package.json'), JSON.stringify(manifest));
      };
      await write('@scope/bindings', { version: '2.0.0', optionalDependencies: { '@scope/bindings-darwin-arm64': '2.0.0', '@scope/bindings-linux-x64': '2.0.0' } });
      // An optional dependency on another release line is not a binary family.
      await write('pg', { version: '8.0.0', optionalDependencies: { 'pg-cloudflare': '^1.4.1' } });
      const installed = [
        { ...baseEntry, name: '@scope/bindings', version: '2.0.0', license: 'MIT', path: 'node_modules/@scope/bindings' },
        { ...baseEntry, name: '@scope/bindings-darwin-arm64', version: '2.0.0', license: 'MIT', path: 'node_modules/@scope/bindings-darwin-arm64' },
        { ...baseEntry, name: 'pg', version: '8.0.0', license: 'MIT', path: 'node_modules/pg' },
        { ...baseEntry, name: 'pg-cloudflare', version: '1.4.1', license: 'MIT', path: 'node_modules/pg-cloudflare' },
      ];
      expect(expandPlatformBinaries(installed, { root }).map(entry => `${entry.name}@${entry.version}`).sort()).toEqual([
        '@scope/bindings-darwin-arm64@2.0.0',
        '@scope/bindings-linux-x64@2.0.0',
        '@scope/bindings@2.0.0',
        'pg-cloudflare@1.4.1',
        'pg@8.0.0',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

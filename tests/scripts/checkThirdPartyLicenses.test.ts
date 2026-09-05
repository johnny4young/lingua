import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  collectPackagedExternalRuntimeEntries,
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
    expect(reviewLicenseEntry({ ...baseEntry, license: 'LicenseRef-Reviewed-Later' })).toMatchObject({
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
        'utf8',
      );

      expect(collectPackagedExternalRuntimeEntries({ root })).toContainEqual({
        name: '@vscode/ripgrep',
        version: '1.18.0',
        license: 'MIT',
        path: 'extraResources/ripgrep',
        missingPackageJson: false,
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
          'utf8',
        );
      }

      const entries = collectPackagedExternalRuntimeEntries({ root });
      expect(entries).toContainEqual({
        name: 'undici',
        version: '7.29.0',
        license: 'MIT',
        path: '.vite/build/main.js',
        missingPackageJson: false,
      });
      expect(entries).toContainEqual({
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

  it('lists every devDependency the desktop bundles actually inline', async () => {
    // Same scanner the bundled audit gate uses: anything declared under
    // devDependencies that reaches src/main or src/preload ships inside
    // .vite/build/main.js. If this fails, add the package to
    // PACKAGED_EXTERNAL_RUNTIME_COMPONENTS so the SBOM and the license
    // report keep describing the binary that ships.
    // The scanner resolves each bundle's externals by loading the Vite
    // configs, which rolldown cannot parse under the vitest transform, so
    // run it in a plain Node process the way tests/scripts/bundledAudit.test.ts
    // exercises the gate.
    const scan = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '-e',
        "import('./scripts/assert-bundled-audit.mjs').then(async (m) => { process.stdout.write(JSON.stringify(await m.scanBundledClosure())); })",
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
    expect(scan.status, scan.stderr).toBe(0);
    const closure = JSON.parse(scan.stdout) as string[];
    const manifest = JSON.parse(await readFile(path.join(process.cwd(), 'package.json'), 'utf8')) as {
      devDependencies?: Record<string, string>;
    };
    const declaredDev = new Set(Object.keys(manifest.devDependencies ?? {}));
    const inlinedDev = closure.filter((name) => declaredDev.has(name));
    const listed = new Set(PACKAGED_EXTERNAL_RUNTIME_COMPONENTS.map((component) => component.name));

    expect(inlinedDev.length).toBeGreaterThan(0);
    expect(inlinedDev.filter((name) => !listed.has(name))).toEqual([]);
  }, 60_000);
});

import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { collectLicenseEntries } from '../../scripts/check-third-party-licenses.mjs';
import { expandRuntimeClosure } from '../../scripts/lib/bundledAudit.mjs';

function missingBundledPackages(closure: string[], entries: Array<{ name: string }>) {
  const listed = new Set(entries.map(entry => entry.name));
  return closure.filter(name => !listed.has(name));
}

function runNode(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: 20_000,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

describe('release compliance coverage', () => {
  it('requires transitive packages even when their bundled parent is explicitly listed', () => {
    const graph: Record<string, string[]> = {
      'bundled-parent': ['transitive-child'],
      'transitive-child': ['transitive-leaf'],
    };
    const closure = expandRuntimeClosure(['bundled-parent'], (name: string) => graph[name] ?? []);
    const packagedEntries = [{ name: 'bundled-parent' }];
    const productionEntries = [{ name: 'transitive-child' }];

    expect(missingBundledPackages(closure, [...productionEntries, ...packagedEntries])).toEqual([
      'transitive-leaf',
    ]);
    expect(
      missingBundledPackages(closure, [
        ...productionEntries,
        ...packagedEntries,
        { name: 'transitive-leaf' },
      ])
    ).toEqual([]);
  });

  it('covers the complete desktop closure in the inventory and generated artifacts', async () => {
    // Resolve the real Vite configs in plain Node: rolldown cannot load them
    // through Vitest's transform. Reuse the audit scanner, without filtering
    // out transitives absent from the root package.json devDependencies.
    const closure = JSON.parse(
      runNode([
        '--experimental-strip-types',
        '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
        '-e',
        "import('./scripts/assert-bundled-audit.mjs').then(async (m) => { process.stdout.write(JSON.stringify(await m.scanBundledClosure())); })",
      ])
    ) as string[];
    // This is the same union of production and packaged entries both CLIs use,
    // rather than just the manually maintained component registry.
    const entries = collectLicenseEntries();
    expect(closure.length).toBeGreaterThan(0);
    expect(
      missingBundledPackages(closure, entries),
      'Add every missing bundled package (including transitives) to PACKAGED_EXTERNAL_RUNTIME_COMPONENTS'
    ).toEqual([]);

    const outputDir = await mkdtemp(path.join(process.cwd(), '.tmp-release-compliance-'));
    try {
      runNode(['scripts/write-release-compliance-artifacts.mjs', outputDir]);
      const sbomText = await readFile(path.join(outputDir, 'lingua-sbom.cyclonedx.json'), 'utf8');
      const report = await readFile(path.join(outputDir, 'THIRD_PARTY_LICENSE_REPORT.md'), 'utf8');
      const sbom = JSON.parse(sbomText) as {
        components: Array<{
          name: string;
          version: string;
          licenses: Array<{ expression: string }>;
        }>;
      };
      expect(missingBundledPackages(closure, sbom.components)).toEqual([]);
      const expectedIds = [
        ...new Set(entries.map(entry => `${entry.name}@${entry.version}`)),
      ].sort();
      expect(sbom.components.map(entry => `${entry.name}@${entry.version}`).sort()).toEqual(
        expectedIds
      );
      for (const entry of entries) {
        expect(sbom.components).toContainEqual(
          expect.objectContaining({
            name: entry.name,
            version: entry.version,
            licenses: [{ expression: entry.license }],
          })
        );
        expect(report).toContain(
          `| \`${entry.name}\` | \`${entry.version}\` | \`${entry.license}\` | \`${entry.path}\` |`
        );
      }
      expect(report).toContain('Policy result: pass.');
      expect(report).toBe(await readFile('docs/THIRD_PARTY_LICENSE_REPORT.md', 'utf8'));

      runNode(['scripts/write-release-compliance-artifacts.mjs', outputDir]);
      expect(await readFile(path.join(outputDir, 'lingua-sbom.cyclonedx.json'), 'utf8')).toBe(
        sbomText
      );
      expect(await readFile(path.join(outputDir, 'THIRD_PARTY_LICENSE_REPORT.md'), 'utf8')).toBe(
        report
      );
    } finally {
      await rm(outputDir, { recursive: true, force: true });
    }
  }, 60_000);
});

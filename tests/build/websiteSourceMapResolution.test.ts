/**
 * Lockfile ratchet for source-map-js across every independently locked graph:
 * the standalone npm website plus the root and both Worker pnpm lockfiles,
 * none of which inherits another's overrides.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';
import { evaluateWebsiteAudit } from '../../scripts/lib/websiteAudit.mjs';
import { atLeast } from '../__fixtures__/lockfileVersion';

// GHSA-68fv-2mgg-jv7q affects >=1.0.0,<1.2.2; 1.2.2 is the supported fix.
const PATCHED = [1, 2, 2] as const;

const root = path.resolve(__dirname, '../..');
const lock = JSON.parse(readFileSync(path.join(root, 'website/package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string }>;
};
const configuration = JSON.parse(
  readFileSync(path.join(root, 'scripts/website-audit-exceptions.json'), 'utf8')
) as {
  exceptions: Array<{ id: string; package: string; reviewed: string; expires: string; reason: string }>;
};

describe('website source-map resolution', () => {
  it('keeps every locked source-map-js instance at the reviewed patched minimum', () => {
    const instances = Object.entries(lock.packages).filter(([entry]) =>
      entry.endsWith('/node_modules/source-map-js') || entry === 'node_modules/source-map-js'
    );
    expect(instances.length).toBeGreaterThan(0);
    for (const [entry, packageInfo] of instances) {
      expect(atLeast(packageInfo.version ?? '', PATCHED), entry).toBe(true);
    }
  });

  it('does not excuse this advisory or relax the independent audit', () => {
    expect(configuration.exceptions.some(entry => entry.package === 'source-map-js')).toBe(false);
    // Real clock: a pinned date would turn a routine re-review of the shipped
    // exception list (a later reviewed date) into a malformed-config failure.
    const result = evaluateWebsiteAudit({
      vulnerabilities: {
        'source-map-js': {
          severity: 'high',
          via: [{
            name: 'source-map-js',
            severity: 'high',
            url: 'https://github.com/advisories/GHSA-68fv-2mgg-jv7q',
          }],
        },
      },
    }, { exceptions: configuration.exceptions });
    expect(result.ok).toBe(false);
    expect(result.offending.map(entry => entry.name)).toContain('source-map-js');
  });
});

describe('pnpm source-map resolution', () => {
  it.each(['', 'license-server', 'update-server'])(
    'keeps every %s source-map-js resolution at the patched minimum',
    project => {
      const pnpmLock = load(readFileSync(path.join(root, project, 'pnpm-lock.yaml'), 'utf8')) as {
        packages: Record<string, unknown>;
      };
      const versions = Object.keys(pnpmLock.packages)
        .map(key => /^source-map-js@(.+)$/u.exec(key)?.[1])
        .filter((version): version is string => version !== undefined);
      expect(versions.length).toBeGreaterThan(0);
      for (const version of versions) {
        expect(atLeast(version, PATCHED), `${project || 'root'} source-map-js@${version}`).toBe(true);
      }
    }
  );
});

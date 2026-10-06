/** Lockfile ratchet for the independently installed website source-map package. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateWebsiteAudit } from '../../scripts/lib/websiteAudit.mjs';

const root = path.resolve(__dirname, '../..');
const lock = JSON.parse(readFileSync(path.join(root, 'website/package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string }>;
};
const configuration = JSON.parse(
  readFileSync(path.join(root, 'scripts/website-audit-exceptions.json'), 'utf8')
) as { exceptions: Array<{ id: string; package: string; expires: string }> };

function meetsPatchedMinimum(version: string): boolean {
  const match = /^(\d+)\.(\d+)\.(\d+)$/u.exec(version);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  return major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 2)));
}

describe('website source-map resolution', () => {
  it('keeps every locked source-map-js instance at the reviewed patched minimum', () => {
    // GHSA-68fv-2mgg-jv7q affects >=1.0.0,<1.2.2; 1.2.2 is the supported fix.
    const instances = Object.entries(lock.packages).filter(([entry]) =>
      entry.endsWith('/node_modules/source-map-js') || entry === 'node_modules/source-map-js'
    );
    expect(instances.length).toBeGreaterThan(0);
    for (const [entry, packageInfo] of instances) {
      expect(meetsPatchedMinimum(packageInfo.version ?? ''), entry).toBe(true);
    }
  });

  it('does not excuse this advisory or relax the independent audit', () => {
    expect(configuration.exceptions.some(entry => entry.package === 'source-map-js')).toBe(false);
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
    }, { exceptions: configuration.exceptions, now: new Date('2026-10-06T00:00:00Z') });
    expect(result.ok).toBe(false);
    expect(result.offending.map(entry => entry.name)).toContain('source-map-js');
  });
});

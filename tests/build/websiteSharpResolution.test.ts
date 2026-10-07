/** Lockfile ratchet for the independently installed website image pipeline. */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { atLeast } from '../__fixtures__/lockfileVersion';

const root = path.resolve(__dirname, '../..');
const lock = JSON.parse(readFileSync(path.join(root, 'website/package-lock.json'), 'utf8')) as {
  packages: Record<string, { version?: string; libc?: string[] }>;
};
const configuration = JSON.parse(
  readFileSync(path.join(root, 'scripts/website-audit-exceptions.json'), 'utf8')
) as { exceptions: Array<{ package: string }> };

describe('website sharp resolution', () => {
  it('keeps every locked sharp instance at the patched minimum', () => {
    // GHSA-wq5f-xc86-pv6w affects sharp <0.35.5; 0.35.5 is the supported fix.
    const instances = Object.entries(lock.packages).filter(
      ([entry]) => entry === 'node_modules/sharp' || entry.endsWith('/node_modules/sharp')
    );
    expect(instances.length).toBeGreaterThan(0);
    for (const [entry, info] of instances) {
      expect(atLeast(info.version ?? '', [0, 35, 5]), entry).toBe(true);
    }
    expect(configuration.exceptions.some(entry => entry.package === 'sharp')).toBe(false);
  });

  it('preserves the libc selectors on native Linux image packages', () => {
    // npm 10 silently drops these when it rewrites the lock; npm 11 keeps them.
    const linux = Object.entries(lock.packages).filter(([entry]) =>
      /node_modules\/@img\/sharp-(?:libvips-)?linux(?:musl)?-/u.test(entry)
    );
    expect(linux.length).toBeGreaterThan(0);
    for (const [entry, info] of linux) {
      expect(info.libc, entry).toEqual([entry.includes('linuxmusl') ? 'musl' : 'glibc']);
    }
  });
});

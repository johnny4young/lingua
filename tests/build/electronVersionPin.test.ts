import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

interface BuilderConfig {
  electronVersion?: string;
}

interface PnpmLock {
  importers: Record<string, { devDependencies?: Record<string, { version: string }> }>;
}

describe('packaged Electron version', () => {
  // electron-builder downloads the pinned release, so a bump that only touches
  // package.json ships an Electron the repo no longer tests.
  it('pins electron-builder to the Electron the lockfile resolves', () => {
    const builder = load(readFileSync(resolve(ROOT, 'electron-builder.yml'), 'utf-8')) as BuilderConfig;
    const lock = load(readFileSync(resolve(ROOT, 'pnpm-lock.yaml'), 'utf-8')) as PnpmLock;
    const resolved = lock.importers['.']?.devDependencies?.electron?.version;

    expect(resolved, 'pnpm-lock.yaml has no root electron devDependency').toBeDefined();
    expect(
      builder.electronVersion,
      `set electronVersion in electron-builder.yml to ${resolved}`
    ).toBe(resolved);
  });
});

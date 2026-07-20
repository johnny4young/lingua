/**
 * internal — guard: every macOS release must carry BOTH arches.
 *
 * Through 0.12.0 the release only published `mac-arm64` artifacts, so an
 * Intel Mac had literally nothing to download — a silent sales blocker, not
 * a bug anyone would file. These assertions pin the two halves of the fix:
 *
 *   1. `electron-builder.yml` asks for arm64 + x64 on both mac targets
 *      (dmg for the manual download, zip for the electron-updater feed).
 *   2. `.github/workflows/release.yml` FAILS when either arch is missing,
 *      so a half-packaged release can never reach the draft.
 *
 * Deliberately NOT a universal build: Lingua bundles ~96 MB of WASM runtimes,
 * so a universal binary would double every user's download to serve one arch.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { load } from 'js-yaml';
import { describe, expect, it } from 'vitest';

const BUILDER_CONFIG_PATH = resolve(__dirname, '../../electron-builder.yml');
const WORKFLOW_PATH = resolve(__dirname, '../../.github/workflows/release.yml');

interface MacTargetEntry {
  target: string;
  arch?: string[];
}

interface BuilderConfig {
  mac?: {
    target?: (string | MacTargetEntry)[];
  };
  artifactName?: string;
}

const config = load(readFileSync(BUILDER_CONFIG_PATH, 'utf-8')) as BuilderConfig;
const workflow = readFileSync(WORKFLOW_PATH, 'utf-8');

describe('macOS architecture coverage', () => {
  const macTargets = config.mac?.target ?? [];

  it('declares both dmg and zip mac targets', () => {
    const names = macTargets.map(entry =>
      typeof entry === 'string' ? entry : entry.target
    );
    expect(names).toContain('dmg');
    expect(names).toContain('zip');
  });

  it.each(['dmg', 'zip'])('builds %s for arm64 AND x64', targetName => {
    const entry = macTargets.find(
      candidate => typeof candidate !== 'string' && candidate.target === targetName
    ) as MacTargetEntry | undefined;

    // A bare string target ("dmg") means "host arch only" — that is exactly
    // the arm64-only regression this guard exists to catch.
    expect(entry, `mac target ${targetName} must declare an explicit arch list`).toBeDefined();
    expect(entry?.arch).toEqual(expect.arrayContaining(['arm64', 'x64']));
  });

  it('keeps ${arch} in artifactName so per-arch files do not collide', () => {
    expect(config.artifactName).toContain('${arch}');
  });

  it('fails the release job when either mac arch is missing', () => {
    // The verify step loops over both arches and exits non-zero on a miss.
    expect(workflow).toMatch(/for arch in arm64 x64; do/u);
    expect(workflow).toMatch(/\*-mac-\$\{arch\}\.dmg/u);
    expect(workflow).toMatch(/\*-mac-\$\{arch\}\.zip/u);
  });
});

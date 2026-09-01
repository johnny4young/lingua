import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  buildCliPackageManifest,
  cliNpmArtifactName,
} from '../../scripts/cli-package-contract.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

const rootPackage = readJson<{ version: string }>('package.json');
const designSyncPackage = readJson<{ version: string }>('.design-sync/pkgroot/package.json');
const changelog = read('CHANGELOG.md');
const generatedChangelog = readJson<{ entries: Array<{ version: string }> }>(
  'website/src/data/changelog.json'
);
const releaseSnapshot = readJson<{ release: { tag: string } }>(
  'website/src/data/latest-release.json'
);

function firstReleaseVersion(): string | null {
  return changelog.match(/^## \[v?(\d+\.\d+\.\d+)\] [—-] \d{4}-\d{2}-\d{2}$/mu)?.[1] ?? null;
}

function publicVersion(): string {
  return releaseSnapshot.release.tag.replace(/^v/u, '');
}

function compareStableVersions(left: string, right: string): number {
  const parse = (version: string): readonly bigint[] => {
    const match = version.match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
    if (!match) throw new Error(`Expected a stable X.Y.Z version: ${version}`);
    return match.slice(1).map(part => BigInt(part));
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < leftParts.length; index += 1) {
    const comparison = leftParts[index]! < rightParts[index]! ? -1 : 1;
    if (leftParts[index] !== rightParts[index]) return comparison;
  }
  return 0;
}

describe('release candidate version contract', () => {
  it('keeps package, changelog, and generated website candidate data aligned', () => {
    expect(rootPackage.version).toMatch(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u);
    expect(designSyncPackage.version).toBe(rootPackage.version);
    expect(firstReleaseVersion()).toBe(rootPackage.version);
    expect(generatedChangelog.entries[0]?.version).toBe(rootPackage.version);
    expect(changelog).toMatch(
      /^## \[Unreleased\]\n\n## \[v?\d+\.\d+\.\d+\] [—-] \d{4}-\d{2}-\d{2}$/mu
    );
  });

  it('keeps public snapshots and channel manifests at or behind the candidate', () => {
    const publishedVersion = publicVersion();
    expect(compareStableVersions(publishedVersion, rootPackage.version)).toBeLessThanOrEqual(0);

    const homebrewVersion = read('packaging/homebrew/Casks/lingua.rb').match(
      /^\s*version "(\d+\.\d+\.\d+)"$/mu
    )?.[1];
    expect(homebrewVersion).toBeDefined();
    expect(compareStableVersions(homebrewVersion!, publishedVersion)).toBeLessThanOrEqual(0);

    for (const manifest of [
      'packaging/winget/Johnny4young.Lingua.yaml',
      'packaging/winget/Johnny4young.Lingua.installer.yaml',
      'packaging/winget/Johnny4young.Lingua.locale.en-US.yaml',
    ]) {
      const channelVersion = read(manifest).match(/^PackageVersion: (\d+\.\d+\.\d+)$/mu)?.[1];
      expect(channelVersion).toBeDefined();
      expect(compareStableVersions(channelVersion!, publishedVersion)).toBeLessThanOrEqual(0);
    }
  });

  it('derives the CLI package identity from the canonical candidate version', () => {
    const manifest = buildCliPackageManifest(rootPackage);
    expect(manifest.version).toBe(rootPackage.version);
    expect(cliNpmArtifactName(rootPackage.version)).toBe(
      `linguacode-cli-${rootPackage.version}.tgz`
    );
  });
});

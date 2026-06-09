import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

// Release-tooling twin (JS).
import {
  DARWIN_ZIP_ARCH_PATTERN as JS_ARCH,
  darwinZipAssetPattern as jsPattern,
  isLinguaDarwinZipAsset,
  normalizeReleaseVersion,
} from '../../scripts/lib/darwinAsset.mjs';
// Worker twin (TS) — the single source of truth for the runtime feed contract.
import {
  DARWIN_ZIP_ARCH_PATTERN as TS_ARCH,
  darwinZipAssetPattern as tsPattern,
  isDarwinZipAssetName,
  normalizeVersion,
  releaseVersion,
} from '../../update-server/src/darwinAsset';
import {
  assertDarwinUpdateAsset,
  findDarwinZipCandidates,
} from '../../scripts/assert-darwin-update-asset.mjs';

const tempDirs: string[] = [];

afterEach(async () => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) await rm(dir, { recursive: true, force: true });
  }
});

async function makeArtifacts(files: string[]): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-darwin-asset-'));
  tempDirs.push(root);
  for (const file of files) {
    // Nest a few directories deep (make/zip/darwin/<file>) to prove the walker
    // recurses and is not depth-sensitive, mirroring Forge's nested output tree.
    const full = path.join(root, 'make', 'zip', 'darwin', file);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, 'stub');
  }
  return path.join(root, 'make');
}

/**
 * Truth table the BOTH twins must agree on. `version` is the normalized
 * (no leading `v`) release version each name is checked against.
 */
const FIXTURES: ReadonlyArray<{ name: string; version: string; expected: boolean }> = [
  // Forge ordering, per-arch + universal.
  { name: 'Lingua-darwin-arm64-0.6.0.zip', version: '0.6.0', expected: true },
  { name: 'Lingua-darwin-x64-0.6.0.zip', version: '0.6.0', expected: true },
  { name: 'Lingua-darwin-universal-0.6.0.zip', version: '0.6.0', expected: true },
  // Case-insensitive (product name is `Lingua`; even a shouty extension).
  { name: 'lingua-darwin-arm64-0.6.0.zip', version: '0.6.0', expected: true },
  { name: 'LINGUA-DARWIN-ARM64-0.6.0.ZIP', version: '0.6.0', expected: true },
  // Legacy version-first ordering stays accepted.
  { name: 'lingua-0.6.0-darwin-x64.zip', version: '0.6.0', expected: true },
  { name: 'lingua-0.2.0-darwin-x64.zip', version: '0.2.0', expected: true },
  // Sibling artifacts must NOT match.
  { name: 'Lingua-darwin-arm64-0.6.0.zip.sha256', version: '0.6.0', expected: false },
  { name: 'Lingua-darwin-arm64-0.6.0.zip.blockmap', version: '0.6.0', expected: false },
  { name: 'Lingua-darwin-arm64-0.6.0.tar.gz', version: '0.6.0', expected: false },
  // Version mismatch.
  { name: 'Lingua-darwin-arm64-0.5.0.zip', version: '0.6.0', expected: false },
  // Unknown arch token / missing arch.
  { name: 'Lingua-darwin-ppc-0.6.0.zip', version: '0.6.0', expected: false },
  { name: 'Lingua-darwin-0.6.0.zip', version: '0.6.0', expected: false },
  // Wrong platform / junk.
  { name: 'Lingua-win32-x64-0.6.0.zip', version: '0.6.0', expected: false },
  { name: 'foo.zip', version: '0.6.0', expected: false },
];

describe('darwin asset contract — parity between worker and release-tooling twins', () => {
  it('exposes the same arch token set', () => {
    expect(JS_ARCH).toBe(TS_ARCH);
  });

  it('generates byte-identical regex source + flags for every version', () => {
    // Both builders are strip-free, so even a raw `v`-prefixed input yields the
    // same source on both sides (normalization is the caller's job). This is
    // what makes the parity lock complete rather than normalized-input-only.
    for (const version of ['0.6.0', '1.2.3', '0.10.0', '0.0.0', '12.34.56', 'v0.6.0']) {
      const js = jsPattern(version);
      const ts = tsPattern(version);
      expect(js.source).toBe(ts.source);
      expect(js.flags).toBe(ts.flags);
    }
  });

  it('agrees with itself and the expected truth on every fixture', () => {
    for (const { name, version, expected } of FIXTURES) {
      const js = isLinguaDarwinZipAsset(name, version);
      const ts = isDarwinZipAssetName(name, version);
      expect(js, `JS twin on ${name}@${version}`).toBe(expected);
      expect(ts, `TS twin on ${name}@${version}`).toBe(expected);
      expect(js, `twins disagree on ${name}@${version}`).toBe(ts);
    }
  });

  it('strips a leading v identically on both twins', () => {
    expect(normalizeReleaseVersion('v0.6.0')).toBe('0.6.0');
    expect(normalizeVersion('v0.6.0')).toBe('0.6.0');
    expect(releaseVersion({ tag_name: 'v0.6.0' })).toBe('0.6.0');
    // Both matchers accept a raw tag and normalize internally — symmetric, so a
    // caller that passes vX.Y.Z to either twin behaves the same (no footgun
    // where one side silently fails to match a tagged version).
    expect(isLinguaDarwinZipAsset('Lingua-darwin-arm64-0.6.0.zip', 'v0.6.0')).toBe(true);
    expect(isDarwinZipAssetName('Lingua-darwin-arm64-0.6.0.zip', 'v0.6.0')).toBe(true);
    // And they agree on a non-match for a raw tag too.
    expect(isLinguaDarwinZipAsset('Lingua-darwin-arm64-0.5.0.zip', 'v0.6.0')).toBe(false);
    expect(isDarwinZipAssetName('Lingua-darwin-arm64-0.5.0.zip', 'v0.6.0')).toBe(false);
  });

  it('escapes version dots so they cannot widen the pattern', () => {
    // `0x6x0` must NOT match a pattern built for `0.6.0`.
    expect(isLinguaDarwinZipAsset('Lingua-darwin-arm64-0x6x0.zip', '0.6.0')).toBe(false);
    expect(isDarwinZipAssetName('Lingua-darwin-arm64-0x6x0.zip', '0.6.0')).toBe(false);
  });
});

describe('assert-darwin-update-asset release guard', () => {
  it('collects only darwin .zip candidates, ignoring siblings and other platforms', async () => {
    const root = await makeArtifacts([
      'Lingua-darwin-arm64-0.6.0.zip',
      'Lingua-darwin-arm64-0.6.0.zip.sha256',
      'Lingua-darwin-arm64-0.6.0.zip.blockmap',
      'Lingua-win32-x64-0.6.0.zip',
      'SHA256SUMS.txt',
    ]);
    const candidates = await findDarwinZipCandidates(root);
    expect(candidates.map(file => path.basename(file)).sort()).toEqual([
      'Lingua-darwin-arm64-0.6.0.zip',
    ]);
  });

  it('passes when every darwin zip matches the contract', async () => {
    const root = await makeArtifacts([
      'Lingua-darwin-arm64-0.6.0.zip',
      'Lingua-darwin-x64-0.6.0.zip',
      'Lingua-darwin-arm64-0.6.0.zip.sha256',
    ]);
    const result = await assertDarwinUpdateAsset({
      artifactsRoot: root,
      version: 'v0.6.0',
      writeArtifacts: false,
    });
    expect(result.matched.sort()).toEqual([
      'Lingua-darwin-arm64-0.6.0.zip',
      'Lingua-darwin-x64-0.6.0.zip',
    ]);
    expect(result.violations).toEqual([]);
  });

  it('fails closed when a darwin zip does not match the release version', async () => {
    const root = await makeArtifacts([
      'Lingua-darwin-arm64-0.6.0.zip',
      'Lingua-darwin-arm64-0.5.0.zip',
    ]);
    await expect(
      assertDarwinUpdateAsset({ artifactsRoot: root, version: '0.6.0', writeArtifacts: false })
    ).rejects.toThrow(/do not match the update-feed contract for 0\.6\.0/u);
  });

  it('fails closed when no darwin zip is present at all', async () => {
    const root = await makeArtifacts(['Lingua-win32-x64-0.6.0.zip', 'SHA256SUMS.txt']);
    await expect(
      assertDarwinUpdateAsset({ artifactsRoot: root, version: '0.6.0', writeArtifacts: false })
    ).rejects.toThrow(/No macOS update .zip matching the feed contract/u);
  });

  it('rejects a non-semver version before scanning', async () => {
    const root = await makeArtifacts(['Lingua-darwin-arm64-0.6.0.zip']);
    await expect(
      assertDarwinUpdateAsset({ artifactsRoot: root, version: 'latest', writeArtifacts: false })
    ).rejects.toThrow(/--version must be a stable semver/u);
  });

  it('surfaces a friendly error when the artifacts root is missing', async () => {
    await expect(
      assertDarwinUpdateAsset({
        artifactsRoot: path.join(os.tmpdir(), 'lingua-does-not-exist-xyz'),
        version: '0.6.0',
        writeArtifacts: false,
      })
    ).rejects.toThrow(/Artifacts root does not exist/u);
  });
});

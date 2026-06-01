import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  collectReleasePayload,
  RELEASE_CHECKSUMS_FILENAME,
  renderReleaseAssetSummary,
  verifyReleaseChecksums,
  writeReleaseChecksums,
} from '../../scripts/prepare-release-payload.mjs';

async function withTempRoot<T>(fn: (root: string) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lingua-release-payload-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe('prepare-release-payload', () => {
  it('writes public-name checksums only for release assets', async () => {
    await withTempRoot(async (root) => {
      await mkdir(path.join(root, 'zip', 'darwin', 'arm64'), { recursive: true });
      await mkdir(path.join(root, 'desktop-smoke'), { recursive: true });
      await writeFile(path.join(root, 'zip', 'darwin', 'arm64', 'Lingua-darwin-arm64-0.5.0.zip'), 'zip');
      await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
      await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');
      await writeFile(path.join(root, 'desktop-smoke', 'desktop-smoke-progress.json'), '{}');

      const result = await writeReleaseChecksums(root);
      await expect(verifyReleaseChecksums(root)).resolves.toMatchObject({
        checksumPath: path.join(root, RELEASE_CHECKSUMS_FILENAME),
      });

      const checksumText = await readFile(result.checksumPath, 'utf8');
      expect(checksumText).toContain('Lingua-darwin-arm64-0.5.0.zip');
      expect(checksumText).toContain('THIRD_PARTY_LICENSE_REPORT.md');
      expect(checksumText).toContain('lingua-sbom.cyclonedx.json');
      expect(checksumText).not.toContain('zip/darwin/arm64');
      expect(checksumText).not.toContain('desktop-smoke-progress.json');

      const payload = await collectReleasePayload(root);
      expect(payload.map((asset) => asset.name)).toEqual([
        'Lingua-darwin-arm64-0.5.0.zip',
        RELEASE_CHECKSUMS_FILENAME,
        'THIRD_PARTY_LICENSE_REPORT.md',
        'lingua-sbom.cyclonedx.json',
      ]);
      expect(renderReleaseAssetSummary(payload)).toContain('-> `Lingua-darwin-arm64-0.5.0.zip`');
    });
  });

  it('rejects basename collisions because release uploads flatten paths', async () => {
    await withTempRoot(async (root) => {
      await mkdir(path.join(root, 'mac'), { recursive: true });
      await mkdir(path.join(root, 'copy'), { recursive: true });
      await writeFile(path.join(root, 'mac', 'Lingua.zip'), 'first');
      await writeFile(path.join(root, 'copy', 'Lingua.zip'), 'second');

      await expect(writeReleaseChecksums(root)).rejects.toThrow(/basename collision/u);
    });
  });

  it('fails verification when the checksum manifest uses nested artifact paths', async () => {
    await withTempRoot(async (root) => {
      await mkdir(path.join(root, 'zip', 'darwin', 'arm64'), { recursive: true });
      await writeFile(path.join(root, 'zip', 'darwin', 'arm64', 'Lingua.zip'), 'zip');
      await writeFile(
        path.join(root, RELEASE_CHECKSUMS_FILENAME),
        'b6c12703a1692e7bdb1d43f5b9c5037b3d7b819614fdf3b097c556292408167c  ./zip/darwin/arm64/Lingua.zip\n'
      );

      await expect(verifyReleaseChecksums(root)).rejects.toThrow(/flatten assets by basename/u);
    });
  });
});

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
    await withTempRoot(async root => {
      await mkdir(path.join(root, 'zip', 'darwin', 'arm64'), { recursive: true });
      await mkdir(path.join(root, 'desktop-smoke'), { recursive: true });
      await writeFile(
        path.join(root, 'zip', 'darwin', 'arm64', 'Lingua-darwin-arm64-0.5.0.zip'),
        'zip'
      );
      await writeFile(path.join(root, 'Lingua-darwin-arm64-0.5.0.zip.blockmap'), 'blockmap');
      await writeFile(path.join(root, 'latest-mac.yml'), 'version: 0.5.0');
      await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
      await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');
      await writeFile(path.join(root, 'desktop-smoke', 'desktop-smoke-progress.json'), '{}');
      await writeFile(path.join(root, 'desktop-smoke', 'latest-debug.yml'), 'internal');

      const result = await writeReleaseChecksums(root);
      await expect(verifyReleaseChecksums(root)).resolves.toMatchObject({
        checksumPath: path.join(root, RELEASE_CHECKSUMS_FILENAME),
      });

      const checksumText = await readFile(result.checksumPath, 'utf8');
      expect(checksumText).toContain('Lingua-darwin-arm64-0.5.0.zip');
      expect(checksumText).toContain('Lingua-darwin-arm64-0.5.0.zip.blockmap');
      expect(checksumText).toContain('latest-mac.yml');
      expect(checksumText).toContain('THIRD_PARTY_LICENSE_REPORT.md');
      expect(checksumText).toContain('lingua-sbom.cyclonedx.json');
      expect(checksumText).not.toContain('zip/darwin/arm64');
      expect(checksumText).not.toContain('desktop-smoke-progress.json');
      expect(checksumText).not.toContain('latest-debug.yml');

      const payload = await collectReleasePayload(root);
      expect(payload.map(asset => asset.name)).toEqual([
        'latest-mac.yml',
        'Lingua-darwin-arm64-0.5.0.zip',
        'Lingua-darwin-arm64-0.5.0.zip.blockmap',
        RELEASE_CHECKSUMS_FILENAME,
        'THIRD_PARTY_LICENSE_REPORT.md',
        'lingua-sbom.cyclonedx.json',
      ]);
      expect(renderReleaseAssetSummary(payload)).toContain('-> `Lingua-darwin-arm64-0.5.0.zip`');
    });
  });

  it('rejects basename collisions because release uploads flatten paths', async () => {
    await withTempRoot(async root => {
      await mkdir(path.join(root, 'mac'), { recursive: true });
      await mkdir(path.join(root, 'copy'), { recursive: true });
      await writeFile(path.join(root, 'mac', 'Lingua.zip'), 'first');
      await writeFile(path.join(root, 'copy', 'Lingua.zip'), 'second');
      await writeFile(path.join(root, 'latest-mac.yml'), 'version: 0.5.0');
      await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
      await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');

      await expect(writeReleaseChecksums(root)).rejects.toThrow(/basename collision/u);
    });
  });

  it('fails verification when the checksum manifest uses nested artifact paths', async () => {
    await withTempRoot(async root => {
      await mkdir(path.join(root, 'zip', 'darwin', 'arm64'), { recursive: true });
      await writeFile(path.join(root, 'zip', 'darwin', 'arm64', 'Lingua.zip'), 'zip');
      await writeFile(path.join(root, 'latest-mac.yml'), 'version: 0.5.0');
      await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
      await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');
      await writeFile(
        path.join(root, RELEASE_CHECKSUMS_FILENAME),
        'b6c12703a1692e7bdb1d43f5b9c5037b3d7b819614fdf3b097c556292408167c  ./zip/darwin/arm64/Lingua.zip\n'
      );

      await expect(verifyReleaseChecksums(root)).rejects.toThrow(/flatten assets by basename/u);
    });
  });

  it('fails verification when the checksum manifest repeats an asset', async () => {
    await withTempRoot(async root => {
      await writeFile(path.join(root, 'Lingua.zip'), 'zip');
      await writeFile(path.join(root, 'latest-mac.yml'), 'version: 0.5.0');
      await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
      await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');

      const { checksumPath } = await writeReleaseChecksums(root);
      const checksumText = await readFile(checksumPath, 'utf8');
      const firstLine = checksumText.split('\n')[0];
      await writeFile(checksumPath, `${checksumText}${firstLine}\n`, 'utf8');

      await expect(verifyReleaseChecksums(root)).rejects.toThrow(
        /checksum manifest contains duplicate entry/iu
      );
    });
  });

  it.each(['THIRD_PARTY_LICENSE_REPORT.md', 'lingua-sbom.cyclonedx.json'])(
    'fails closed when %s is missing',
    async missingName => {
      await withTempRoot(async root => {
        await writeFile(path.join(root, 'Lingua.zip'), 'zip');
        await writeFile(path.join(root, 'latest-mac.yml'), 'version: 0.5.0');
        if (missingName !== 'THIRD_PARTY_LICENSE_REPORT.md') {
          await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
        }
        if (missingName !== 'lingua-sbom.cyclonedx.json') {
          await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');
        }

        await expect(writeReleaseChecksums(root)).rejects.toThrow(
          `Release payload is missing required compliance asset: ${missingName}`
        );
      });
    }
  );

  it('fails closed without an updater manifest or installable archive', async () => {
    await withTempRoot(async root => {
      await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
      await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');

      await expect(writeReleaseChecksums(root)).rejects.toThrow(
        'Release payload is missing an electron-updater latest*.yml manifest. Accepted public manifests: latest.yml, latest-mac.yml, latest-linux.yml'
      );

      await writeFile(path.join(root, 'latest.yml'), 'version: 0.5.0');
      await expect(writeReleaseChecksums(root)).rejects.toThrow(
        /desktop installer or update archive/u
      );
    });
  });

  it('requires the updater manifest for every enabled platform', async () => {
    await withTempRoot(async root => {
      await writeFile(path.join(root, 'Lingua.zip'), 'zip');
      await writeFile(path.join(root, 'latest-mac.yml'), 'version: 0.5.0');
      await writeFile(path.join(root, 'THIRD_PARTY_LICENSE_REPORT.md'), 'licenses');
      await writeFile(path.join(root, 'lingua-sbom.cyclonedx.json'), '{"sbom":true}');

      const requirements = {
        requiredManifestNames: ['latest-mac.yml', 'latest.yml'],
      };
      await expect(writeReleaseChecksums(root, requirements)).rejects.toThrow(
        'Release payload is missing required electron-updater manifest: latest.yml'
      );

      await writeFile(path.join(root, 'latest.yml'), 'version: 0.5.0');
      await expect(writeReleaseChecksums(root, requirements)).resolves.toMatchObject({
        checksumPath: path.join(root, RELEASE_CHECKSUMS_FILENAME),
      });
    });
  });
});

import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  assertCliPackageManifest,
  buildCliPackageManifest,
  cliNpmArtifactName,
  stableVersionFromReleaseTag,
} from '../../scripts/cli-package-contract.mjs';
import {
  normalizeNpmArchiveEntries,
  parseChecksumManifest,
  regularNpmArchiveEntriesFromVerboseList,
  verifyCliPublicationArtifact,
} from '../../scripts/verify-cli-publication.mjs';

function runTar(args: string[]) {
  const result = spawnSync('tar', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

describe('CLI npm publication verification', () => {
  it('derives only stable release-owned npm artifact names', () => {
    expect(stableVersionFromReleaseTag('v1.2.3')).toBe('1.2.3');
    expect(cliNpmArtifactName('1.2.3')).toBe('linguacode-cli-1.2.3.tgz');
    expect(() => stableVersionFromReleaseTag('1.2.3')).toThrow(/vX\.Y\.Z/u);
    expect(() => stableVersionFromReleaseTag('v1.2.3-beta.1')).toThrow(/stable release/u);
    expect(() => stableVersionFromReleaseTag('v01.2.3')).toThrow(/stable release/u);
    expect(() => cliNpmArtifactName('1.02.3')).toThrow(/stable CLI version/u);
    expect(() => cliNpmArtifactName('../1.2.3')).toThrow(/stable CLI version/u);
  });

  it('parses strict unique SHA-256 entries', () => {
    const digest = 'a'.repeat(64);
    expect(parseChecksumManifest(`${digest}  artifact.tgz\n`)).toEqual(
      new Map([['artifact.tgz', digest]])
    );
    expect(() =>
      parseChecksumManifest(`${digest}  artifact.tgz\n${digest}  artifact.tgz\n`)
    ).toThrow(/Duplicate checksum/u);
    expect(() => parseChecksumManifest('not-a-checksum')).toThrow(/Invalid SHA256SUMS/u);
  });

  it('rejects archive roots and traversal outside npm package/', () => {
    expect(() => normalizeNpmArchiveEntries('other/package.json\n')).toThrow(
      /Unexpected npm archive root/u
    );
    expect(() => normalizeNpmArchiveEntries('package/../private-key.pem\n')).toThrow(
      /Unsafe npm archive entry/u
    );
    expect(() =>
      regularNpmArchiveEntriesFromVerboseList(
        'lrwxr-xr-x  0 0  0  0 Jan 1 00:00 package/bin/lingua.cjs -> /tmp/payload\n'
      )
    ).toThrow(/must be regular files/u);
  });

  it('rejects every additional manifest field, including install scripts', () => {
    const manifest = buildCliPackageManifest({ version: '1.2.3' });
    expect(() => assertCliPackageManifest(manifest, '1.2.3')).not.toThrow();
    expect(() =>
      assertCliPackageManifest(
        { ...manifest, scripts: { postinstall: 'node surprise.cjs' } },
        '1.2.3'
      )
    ).toThrow(/exact dependency-free public manifest/u);
  });

  it('verifies checksum, exact contents, and public manifest from one tarball', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'lingua-cli-publication-'));
    const packageRoot = path.join(root, 'package');
    const artifact = path.join(root, 'linguacode-cli-1.2.3.tgz');
    const checksums = path.join(root, 'SHA256SUMS.txt');
    const githubOutput = path.join(root, 'github-output.txt');
    try {
      await mkdir(path.join(packageRoot, 'bin'), { recursive: true });
      await Promise.all([
        writeFile(path.join(packageRoot, 'LICENSE'), 'test license\n'),
        writeFile(path.join(packageRoot, 'README.md'), '# test\n'),
        writeFile(path.join(packageRoot, 'bin', 'lingua.cjs'), '#!/usr/bin/env node\n'),
        writeFile(
          path.join(packageRoot, 'package.json'),
          `${JSON.stringify(buildCliPackageManifest({ version: '1.2.3' }))}\n`
        ),
      ]);
      runTar([
        '-czf',
        artifact,
        '-C',
        root,
        'package/LICENSE',
        'package/README.md',
        'package/bin/lingua.cjs',
        'package/package.json',
      ]);
      const sha256 = createHash('sha256')
        .update(await readFile(artifact))
        .digest('hex');
      await writeFile(checksums, `${sha256}  ${path.basename(artifact)}\n`);

      await expect(
        verifyCliPublicationArtifact({
          releaseTag: 'v1.2.3',
          artifactPath: artifact,
          checksumsSource: `${sha256}  ${path.basename(artifact)}\n`,
        })
      ).resolves.toMatchObject({
        package: '@linguacode/cli',
        version: '1.2.3',
        artifact: path.basename(artifact),
        sha256,
        contents: ['LICENSE', 'README.md', 'bin/lingua.cjs', 'package.json'],
      });
      await expect(
        verifyCliPublicationArtifact({
          releaseTag: 'v1.2.3',
          artifactPath: artifact,
          checksumsSource: `${'0'.repeat(64)}  ${path.basename(artifact)}\n`,
        })
      ).rejects.toThrow(/checksum mismatch/u);

      const cli = spawnSync(
        process.execPath,
        [
          path.resolve(__dirname, '../../scripts/verify-cli-publication.mjs'),
          '--release-tag',
          'v1.2.3',
          '--artifact',
          artifact,
          '--checksums',
          checksums,
          '--github-output',
          githubOutput,
        ],
        { encoding: 'utf8' }
      );
      expect(cli.status, cli.stderr).toBe(0);
      expect(JSON.parse(cli.stdout)).toMatchObject({
        package: '@linguacode/cli',
        version: '1.2.3',
        artifact: path.basename(artifact),
        sha256,
      });
      expect(await readFile(githubOutput, 'utf8')).toBe(
        [
          'package=@linguacode/cli',
          'version=1.2.3',
          `artifact=${path.basename(artifact)}`,
          `sha256=${sha256}`,
          '',
        ].join('\n')
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

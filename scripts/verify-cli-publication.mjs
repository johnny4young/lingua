#!/usr/bin/env node

/**
 * Fail-closed verification for the immutable npm tarball attached to a stable
 * GitHub Release. This script never authenticates or publishes; the dedicated
 * workflow owns that narrow mutation only after this evidence passes.
 */

import { createHash } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import {
  assertCliPackageManifest,
  assertNpmPackContents,
  cliNpmArtifactName,
  CLI_PACKAGE_NAME,
  stableVersionFromReleaseTag,
} from './cli-package-contract.mjs';

const SHA256_PATTERN = /^(?<digest>[0-9a-f]{64})\s+\*?(?<name>[^\r\n]+)$/u;

export function parseChecksumManifest(source) {
  const checksums = new Map();
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    const match = line.match(SHA256_PATTERN);
    if (!match?.groups) {
      throw new Error(`Invalid SHA256SUMS.txt line: ${line}`);
    }
    const { digest, name } = match.groups;
    if (checksums.has(name)) {
      throw new Error(`Duplicate checksum entry for ${name}.`);
    }
    checksums.set(name, digest);
  }
  return checksums;
}

function runTar(args) {
  const result = spawnSync('tar', args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`tar ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
}

export function normalizeNpmArchiveEntries(source) {
  const entries = [];
  for (const rawEntry of source.split(/\r?\n/u)) {
    if (!rawEntry || rawEntry.endsWith('/')) continue;
    if (!rawEntry.startsWith('package/')) {
      throw new Error(`Unexpected npm archive root: ${rawEntry}`);
    }
    const entry = rawEntry.slice('package/'.length);
    if (!entry || path.posix.isAbsolute(entry) || entry.split('/').includes('..')) {
      throw new Error(`Unsafe npm archive entry: ${rawEntry}`);
    }
    entries.push({ path: entry });
  }
  return entries;
}

export function regularNpmArchiveEntriesFromVerboseList(source) {
  const entries = [];
  for (const line of source.split(/\r?\n/u)) {
    if (!line.trim()) continue;
    if (!line.startsWith('-')) {
      throw new Error(`CLI npm archive members must be regular files; rejected tar entry: ${line}`);
    }
    const rawEntry = line.trim().split(/\s+/u).at(-1);
    if (!rawEntry) throw new Error(`Unable to parse npm archive entry: ${line}`);
    entries.push(...normalizeNpmArchiveEntries(`${rawEntry}\n`));
  }
  return entries;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), async source => {
    for await (const chunk of source) hash.update(chunk);
  });
  return hash.digest('hex');
}

function readManifestFromArchive(artifactPath) {
  const source = runTar(['-xOzf', artifactPath, 'package/package.json']);
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(
      `CLI npm artifact contains an invalid package.json: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error }
    );
  }
}

export async function verifyCliPublicationArtifact({ releaseTag, artifactPath, checksumsSource }) {
  const version = stableVersionFromReleaseTag(releaseTag);
  const expectedArtifact = cliNpmArtifactName(version);
  if (path.basename(artifactPath) !== expectedArtifact) {
    throw new Error(
      `CLI npm artifact name mismatch: expected ${expectedArtifact}, found ${path.basename(artifactPath)}.`
    );
  }
  if (!existsSync(artifactPath)) {
    throw new Error(`CLI npm artifact does not exist: ${artifactPath}`);
  }

  const checksums = parseChecksumManifest(checksumsSource);
  const expectedSha256 = checksums.get(expectedArtifact);
  if (!expectedSha256) {
    throw new Error(`SHA256SUMS.txt does not include ${expectedArtifact}.`);
  }
  const sha256 = await sha256File(artifactPath);
  if (sha256 !== expectedSha256) {
    throw new Error(
      `CLI npm artifact checksum mismatch: expected ${expectedSha256}, found ${sha256}.`
    );
  }

  const entries = regularNpmArchiveEntriesFromVerboseList(runTar(['-tvzf', artifactPath]));
  assertNpmPackContents(entries);
  const manifest = readManifestFromArchive(artifactPath);
  assertCliPackageManifest(manifest, version);

  return {
    package: CLI_PACKAGE_NAME,
    version,
    releaseTag,
    artifact: expectedArtifact,
    sha256,
    contents: entries.map(entry => entry.path).sort(),
  };
}

function printHelp() {
  console.log(`Usage: node scripts/verify-cli-publication.mjs [options]

Validate the exact npm tarball and checksum manifest from a stable release.

Options:
  --release-tag <vX.Y.Z>  Stable GitHub Release tag
  --artifact <path>       Downloaded linguacode-cli-X.Y.Z.tgz
  --checksums <path>      Downloaded SHA256SUMS.txt
  --github-output <path>  Append package/version/artifact outputs for Actions
  -h, --help              Show this help
`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const { values } = parseArgs({
    args,
    options: {
      'release-tag': { type: 'string' },
      artifact: { type: 'string' },
      checksums: { type: 'string' },
      'github-output': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: false,
  });
  if (values.help) {
    printHelp();
    return 0;
  }
  if (!values['release-tag'] || !values.artifact || !values.checksums) {
    throw new Error('--release-tag, --artifact, and --checksums are required.');
  }

  const checksumsSource = await readFile(path.resolve(values.checksums), 'utf8');
  const report = await verifyCliPublicationArtifact({
    releaseTag: values['release-tag'],
    artifactPath: path.resolve(values.artifact),
    checksumsSource,
  });
  if (values['github-output']) {
    const output = [
      `package=${report.package}`,
      `version=${report.version}`,
      `artifact=${report.artifact}`,
      `sha256=${report.sha256}`,
      '',
    ].join('\n');
    await appendFile(path.resolve(values['github-output']), output, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(
        `[verify-cli-publication] ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    }
  );
}

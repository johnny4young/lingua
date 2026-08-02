#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  createReleaseSnapshot,
  parseReleaseSnapshot,
  type ReleaseSnapshotFile,
} from '../src/lib/releaseSnapshot.ts';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const websiteRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(websiteRoot, '..');
const snapshotPath = resolve(websiteRoot, 'src/data/latest-release.json');
const apiUrl = 'https://api.github.com/repos/johnny4young/lingua/releases/latest';

function parseOptions() {
  return parseArgs({
    args: process.argv.slice(2),
    options: {
      check: { type: 'boolean', default: false },
      input: { type: 'string' },
      'require-current': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  }).values;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, 'utf8')) as unknown;
}

function getVersion(value: unknown, label: string): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('version' in value) ||
    typeof value.version !== 'string'
  ) {
    throw new Error(`${label} has no string version`);
  }
  return value.version;
}

function getLatestChangelogVersion(value: unknown): string {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('entries' in value) ||
    !Array.isArray(value.entries) ||
    typeof value.entries[0] !== 'object' ||
    value.entries[0] === null ||
    !('version' in value.entries[0]) ||
    typeof value.entries[0].version !== 'string'
  ) {
    throw new Error('Committed changelog data has no latest version');
  }
  return value.entries[0].version;
}

async function expectedVersion(): Promise<string> {
  const packageVersion = getVersion(
    await readJson(resolve(repositoryRoot, 'package.json')),
    'Repository package.json'
  );
  const changelogVersion = getLatestChangelogVersion(
    await readJson(resolve(websiteRoot, 'src/data/changelog.json'))
  );
  if (packageVersion !== changelogVersion) {
    throw new Error(
      `Repository version ${packageVersion} does not match changelog version ${changelogVersion}`
    );
  }
  return packageVersion;
}

async function fetchLatestRelease(): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) {
    throw new Error(`GitHub release request failed with HTTP ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function readExistingSnapshot(): Promise<ReleaseSnapshotFile | null> {
  try {
    return (await readJson(snapshotPath)) as ReleaseSnapshotFile;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function main(): Promise<void> {
  const options = parseOptions();
  const version = await expectedVersion();
  const existing = await readExistingSnapshot();
  const versionPolicy = { requireCurrentVersion: options['require-current'] };

  if (options.check) {
    if (!existing) throw new Error(`Release snapshot is missing: ${snapshotPath}`);
    const release = parseReleaseSnapshot(existing, version, versionPolicy);
    console.log(
      `[release-snapshot] valid public ${release.tag}: ${release.assets.length} trusted assets, repository candidate v${version}`
    );
    return;
  }

  const inputPath = options.input;
  const apiPayload = inputPath ? await readJson(resolve(inputPath)) : await fetchLatestRelease();
  const candidate = createReleaseSnapshot(apiPayload);

  if (existing && JSON.stringify(existing.release) === JSON.stringify(candidate.release)) {
    candidate.capturedAt = existing.capturedAt;
  }
  parseReleaseSnapshot(candidate, version, versionPolicy);
  const serialized = `${JSON.stringify(candidate, null, 2)}\n`;
  if (existing && serialized === `${JSON.stringify(existing, null, 2)}\n`) {
    console.log(`[release-snapshot] unchanged ${candidate.release.tag}`);
    return;
  }
  await writeFile(snapshotPath, serialized, 'utf8');
  console.log(
    `[release-snapshot] updated ${candidate.release.tag}: ${candidate.release.assets.length} trusted assets`
  );
}

main().catch(error => {
  console.error(`[release-snapshot] FAILED: ${(error as Error).message}`);
  process.exitCode = 1;
});

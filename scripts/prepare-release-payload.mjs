#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_RELEASE_ROOT = path.join(repoRoot, 'out', 'make');
export const RELEASE_CHECKSUMS_FILENAME = 'SHA256SUMS.txt';

const RELEASE_ASSET_EXTENSIONS = new Set([
  '.AppImage',
  '.deb',
  '.dmg',
  '.exe',
  '.nupkg',
  '.rpm',
  '.zip',
]);

const RELEASE_ASSET_NAMES = new Set([
  'RELEASES',
  'THIRD_PARTY_LICENSE_REPORT.md',
  'lingua-sbom.cyclonedx.json',
]);

/**
 * Keep human-facing release artifacts grouped predictably in workflow
 * summaries: platform installers first, then checksums, then compliance
 * reports. GitHub Releases and R2 both flatten upload paths, so all ordering
 * decisions must use the public basename instead of the nested artifact path.
 */
function releaseAssetSortRank(name) {
  if (name === RELEASE_CHECKSUMS_FILENAME) return 1;
  if (name === 'THIRD_PARTY_LICENSE_REPORT.md') return 2;
  if (name === 'lingua-sbom.cyclonedx.json') return 3;
  return 0;
}

function normalizePathForOutput(filePath) {
  return filePath.split(path.sep).join('/');
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(root) {
  const files = [];

  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(root);
  return files;
}

function isReleaseAssetName(name, { includeChecksums = false } = {}) {
  if (name === RELEASE_CHECKSUMS_FILENAME) return includeChecksums;
  return RELEASE_ASSET_NAMES.has(name) || RELEASE_ASSET_EXTENSIONS.has(path.extname(name));
}

/**
 * Release upload targets use basenames only. A nested path collision would
 * overwrite one asset in GitHub Release uploads or in the R2 mirror, so fail
 * before writing the checksum manifest.
 */
function assertUniqueAssetNames(assets) {
  const seen = new Map();
  for (const asset of assets) {
    const previous = seen.get(asset.name);
    if (previous) {
      throw new Error(
        `Release asset basename collision: ${asset.name} appears at ${previous.relativePath} and ${asset.relativePath}. GitHub Release and R2 uploads flatten paths, so basenames must be unique.`
      );
    }
    seen.set(asset.name, asset);
  }
}

/**
 * Collect the release-public payload from the artifact tree. Build outputs are
 * intentionally nested by maker/platform, but the release surface is flat:
 * `asset.name` is the public upload name and `relativePath` is only diagnostic
 * context for summaries and collision errors.
 */
export async function collectReleaseAssets(root = DEFAULT_RELEASE_ROOT, options = {}) {
  const resolvedRoot = path.resolve(root);
  if (!(await pathExists(resolvedRoot))) {
    throw new Error(`Release payload root does not exist: ${resolvedRoot}`);
  }

  const files = await listFiles(resolvedRoot);
  const assets = files
    .map((filePath) => {
      const name = path.basename(filePath);
      return {
        path: filePath,
        name,
        relativePath: normalizePathForOutput(path.relative(resolvedRoot, filePath)),
      };
    })
    .filter((asset) => isReleaseAssetName(asset.name, options))
    .sort(
      (left, right) =>
        releaseAssetSortRank(left.name) - releaseAssetSortRank(right.name) ||
        left.name.localeCompare(right.name) ||
        left.relativePath.localeCompare(right.relativePath)
    );

  assertUniqueAssetNames(assets);
  return assets;
}

async function hashFile(filePath) {
  return createHash('sha256').update(await readFile(filePath)).digest('hex');
}

/**
 * Write checksums against public asset names, not nested artifact paths. The
 * same manifest is consumed by GitHub Release verification and by the R2 mirror
 * parity check, both of which expose assets by basename.
 */
export async function writeReleaseChecksums(root = DEFAULT_RELEASE_ROOT) {
  const resolvedRoot = path.resolve(root);
  const assets = await collectReleaseAssets(resolvedRoot, { includeChecksums: false });
  if (assets.length === 0) {
    throw new Error(`No release assets found under ${resolvedRoot}`);
  }

  const lines = [];
  for (const asset of assets) {
    lines.push(`${await hashFile(asset.path)}  ${asset.name}`);
  }

  const checksumPath = path.join(resolvedRoot, RELEASE_CHECKSUMS_FILENAME);
  await mkdir(resolvedRoot, { recursive: true });
  await writeFile(checksumPath, `${lines.join('\n')}\n`, 'utf8');
  return { checksumPath, assets, lines };
}

/**
 * Verify that the checksum manifest describes exactly the current release
 * assets and that every manifest entry uses the flattened public name. This
 * catches stale manifests, nested-path manifests, and payload tampering before
 * the draft release or R2 mirror is published.
 */
export async function verifyReleaseChecksums(root = DEFAULT_RELEASE_ROOT) {
  const resolvedRoot = path.resolve(root);
  const checksumPath = path.join(resolvedRoot, RELEASE_CHECKSUMS_FILENAME);
  const checksumText = await readFile(checksumPath, 'utf8');
  const assets = await collectReleaseAssets(resolvedRoot, { includeChecksums: false });
  const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
  const manifestNames = new Set();

  for (const line of checksumText.split('\n')) {
    if (!line.trim()) continue;
    const match = line.match(/^([a-fA-F0-9]{64})\s+(?:\.\/)?(.+?)\s*$/u);
    if (!match) {
      throw new Error(`Malformed checksum line: ${line}`);
    }

    const expected = match[1].toLowerCase();
    const name = match[2];
    const asset = assetByName.get(name);
    if (!asset) {
      throw new Error(
        `Checksum manifest references ${name}, but release uploads flatten assets by basename. Regenerate ${RELEASE_CHECKSUMS_FILENAME} from the collected release assets.`
      );
    }
    manifestNames.add(name);

    const actual = await hashFile(asset.path);
    if (actual !== expected) {
      throw new Error(`Checksum mismatch for ${name}: expected ${expected}, got ${actual}`);
    }
  }

  for (const asset of assets) {
    if (!manifestNames.has(asset.name)) {
      throw new Error(`Checksum manifest is missing ${asset.name}`);
    }
  }

  return { checksumPath, assets };
}

export async function collectReleasePayload(root = DEFAULT_RELEASE_ROOT) {
  const assets = await collectReleaseAssets(root, { includeChecksums: true });
  if (assets.length === 0) {
    throw new Error(`No release assets found under ${path.resolve(root)}`);
  }
  return assets;
}

export function renderReleaseAssetSummary(assets) {
  return [
    '### Release assets',
    '',
    ...assets.map((asset) => `- \`${asset.relativePath}\` -> \`${asset.name}\``),
    '',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    root: DEFAULT_RELEASE_ROOT,
    writeChecksums: false,
    verifyChecksums: false,
    printAssets: false,
    json: false,
    githubOutput: null,
    summary: null,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];
    if (flag === '--root' && next) {
      args.root = next;
      index += 1;
    } else if (flag === '--write-checksums') {
      args.writeChecksums = true;
    } else if (flag === '--verify-checksums') {
      args.verifyChecksums = true;
    } else if (flag === '--print-assets') {
      args.printAssets = true;
    } else if (flag === '--json') {
      args.json = true;
    } else if (flag === '--github-output' && next) {
      args.githubOutput = next;
      index += 1;
    } else if (flag === '--summary' && next) {
      args.summary = next;
      index += 1;
    } else if (flag === '--help' || flag === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown or incomplete argument: ${flag}`);
    }
  }

  return args;
}

function printUsage() {
  console.log(`Usage: node scripts/prepare-release-payload.mjs [options]

Options:
  --root <path>          Release payload root. Default: out/make
  --write-checksums     Write SHA256SUMS.txt for public release assets
  --verify-checksums    Verify SHA256SUMS.txt against public release assets
  --print-assets        Print release asset paths, one per line
  --github-output <p>   Write a multiline "assets" output for GitHub Actions
  --summary <p>         Append a release asset summary to a markdown file
  --json                Print release payload metadata as JSON
`);
}

async function writeGithubOutput(outputPath, assets) {
  const lines = [
    'assets<<__LINGUA_RELEASE_ASSETS__',
    ...assets.map((asset) => asset.path),
    '__LINGUA_RELEASE_ASSETS__',
  ];
  await writeFile(outputPath, `${lines.join('\n')}\n`, { flag: 'a' });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const quiet = args.printAssets || args.json;
  if (args.writeChecksums) {
    const result = await writeReleaseChecksums(args.root);
    if (!quiet) {
      console.log(
        `Wrote ${path.relative(process.cwd(), result.checksumPath)} for ${result.assets.length} release asset(s).`
      );
    }
  }

  if (args.verifyChecksums) {
    const result = await verifyReleaseChecksums(args.root);
    if (!quiet) {
      console.log(
        `Verified ${path.relative(process.cwd(), result.checksumPath)} against ${result.assets.length} release asset(s).`
      );
    }
  }

  const assets = await collectReleasePayload(args.root);

  if (args.githubOutput) {
    await writeGithubOutput(args.githubOutput, assets);
  }
  if (args.summary) {
    await writeFile(args.summary, renderReleaseAssetSummary(assets), { flag: 'a' });
  }
  if (args.printAssets) {
    console.log(assets.map((asset) => asset.path).join('\n'));
  }
  if (args.json) {
    console.log(JSON.stringify({ assets }, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}

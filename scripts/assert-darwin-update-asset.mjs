#!/usr/bin/env node

/**
 * Release-time guard: assert the built macOS ZIP artifact name satisfies the
 * update-feed contract BEFORE the draft release is published.
 *
 * Root cause this closes: across v0.4.0/v0.5.0 the update server's matcher and
 * the published asset name disagreed, so `GET /update/darwin/*` returned 204
 * ("no update") and Squirrel.Mac silently stranded every macOS user on the
 * installed version. A unit/regression test now locks the worker matcher; this
 * script locks the other side of the contract — the actual file Forge writes
 * into `out/make` — so a maker/name change fails the release loudly instead of
 * shipping an asset the feed cannot serve.
 *
 * Fails closed when: no darwin `.zip` is found at all (an empty/blocked macOS
 * build), or any darwin `.zip` present does not match the contract for the
 * release version.
 */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { stripArgSeparator } from './lib/cli-args.mjs';
import {
  darwinZipAssetPattern,
  isLinguaDarwinZipAsset,
  normalizeReleaseVersion,
} from './lib/darwinAsset.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export const DEFAULT_ARTIFACTS_ROOT = path.join(repoRoot, 'out', 'make');
export const DEFAULT_OUTPUT_DIR = path.join(repoRoot, 'output', 'darwin-asset-validation');

/**
 * Recursively collect files below Forge's output tree. The shape changes by
 * maker/arch, so callers must not assume a fixed depth. A missing root is
 * surfaced as a friendly error rather than a raw ENOENT.
 *
 * @param {string} root
 * @param {string[]} files
 * @returns {Promise<string[]>}
 */
async function walkFiles(root, files = []) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new Error(`Artifacts root does not exist: ${root}`, { cause: error });
    }
    throw error;
  }
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * A `.zip` whose basename contains `darwin` is a candidate macOS update asset.
 * Every valid asset name (both the Forge `Lingua-darwin-<arch>-<v>.zip` and the
 * legacy `lingua-<v>-darwin-<arch>.zip` orderings) contains `darwin`, so this
 * filter never hides a valid asset; it only widens the net to catch
 * near-miss/mis-named darwin zips that must then satisfy the strict contract.
 *
 * @param {string} artifactsRoot
 * @returns {Promise<string[]>} absolute paths to candidate darwin `.zip` files
 */
export async function findDarwinZipCandidates(artifactsRoot) {
  const files = await walkFiles(artifactsRoot);
  return files.filter(file => {
    const base = path.basename(file).toLowerCase();
    return base.endsWith('.zip') && base.includes('darwin');
  });
}

/**
 * @typedef {Object} DarwinAssetAssertion
 * @property {string} version normalized release version the names were checked against
 * @property {string[]} matched basenames that satisfy the feed contract
 * @property {string[]} violations basenames present but not matching the contract
 */

/**
 * Assert every darwin `.zip` under `artifactsRoot` matches the feed contract
 * for `version`, and that at least one matching asset exists. Throws on any
 * violation or on an empty match set. Returns the evidence on success.
 *
 * @param {{ artifactsRoot?: string, version: string, outputDir?: string, writeArtifacts?: boolean }} options
 * @returns {Promise<DarwinAssetAssertion>}
 */
export async function assertDarwinUpdateAsset({
  artifactsRoot = DEFAULT_ARTIFACTS_ROOT,
  version,
  outputDir = DEFAULT_OUTPUT_DIR,
  writeArtifacts = true,
} = {}) {
  const normalized = normalizeReleaseVersion(version);
  if (!/^\d+\.\d+\.\d+$/u.test(normalized)) {
    throw new Error(`--version must be a stable semver value like 0.6.0 (got "${version}").`);
  }

  const candidates = await findDarwinZipCandidates(artifactsRoot);
  const matched = [];
  const violations = [];
  for (const file of candidates) {
    const base = path.basename(file);
    if (isLinguaDarwinZipAsset(base, normalized)) {
      matched.push(base);
    } else {
      violations.push(base);
    }
  }

  const pattern = darwinZipAssetPattern(normalized).source;
  const assertion = { version: normalized, matched, violations };

  if (writeArtifacts) {
    await mkdir(outputDir, { recursive: true });
    await writeFile(
      path.join(outputDir, 'darwin-asset-validation.json'),
      `${JSON.stringify({ artifactsRoot, pattern, ...assertion }, null, 2)}\n`
    );
  }

  if (violations.length > 0) {
    throw new Error(
      `Found darwin .zip artifact(s) that do not match the update-feed contract for ${normalized}: ` +
        `${violations.join(', ')}. Expected names matching /${pattern}/i ` +
        `(e.g. Lingua-darwin-arm64-${normalized}.zip). An unmatched asset makes the ` +
        `update feed return 204, silently stranding macOS auto-update.`
    );
  }

  if (matched.length === 0) {
    throw new Error(
      `No macOS update .zip matching the feed contract for ${normalized} was found under ${artifactsRoot}. ` +
        `Expected at least one asset matching /${pattern}/i (e.g. Lingua-darwin-arm64-${normalized}.zip).`
    );
  }

  return assertion;
}

/**
 * Resolve the default release version from package.json so callers may omit
 * `--version` outside CI. CI passes the exact release tag.
 *
 * @returns {Promise<string>}
 */
async function readPackageVersion() {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  return pkg.version;
}

function printHelp() {
  console.log(`Usage: node scripts/assert-darwin-update-asset.mjs [options]

Asserts every macOS .zip in the artifacts root matches the update-feed asset
contract (see update-server/src/darwinAsset.ts). Fails closed before publish.

Options:
  --root <path>       Directory containing Forge macOS artifacts. Default: out/make
  --version <x.y.z>   Release version to check against. Default: package.json version
  --output-dir <path> Evidence directory. Default: output/darwin-asset-validation
`);
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: stripArgSeparator(argv),
    options: {
      root: { type: 'string' },
      version: { type: 'string' },
      'output-dir': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const version = values.version ?? (await readPackageVersion());
  const assertion = await assertDarwinUpdateAsset({
    artifactsRoot: values.root ? path.resolve(values.root) : DEFAULT_ARTIFACTS_ROOT,
    version,
    outputDir: values['output-dir'] ? path.resolve(values['output-dir']) : DEFAULT_OUTPUT_DIR,
  });

  console.log(
    `darwin-asset: ok (version ${assertion.version}, matched ${assertion.matched.join(', ')})`
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then(
    code => {
      process.exitCode = code;
    },
    error => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  );
}

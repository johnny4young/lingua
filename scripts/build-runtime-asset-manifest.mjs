#!/usr/bin/env node

/**
 * RL-083 Slice 1 — runtime-asset lock builder + checker.
 *
 * Modes:
 *   --write  Compute sha256 over the critical files in
 *            node_modules/<asset> and write runtime-assets.lock.json.
 *   --check  Compute sha256 over the same files and exit non-zero if
 *            the values disagree with the existing lock. Used in CI
 *            and by tests/shared/runtimeAssets.test.ts.
 *
 * Default is --check.
 *
 * The asset list is expressed in src/shared/runtimeAssets.ts. We
 * import it with --experimental-strip-types so a single source of
 * truth feeds the worker, the lock, and the integrity test.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { RUNTIME_ASSETS } from '../src/shared/runtimeAssets.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const lockPath = path.join(repoRoot, 'runtime-assets.lock.json');

async function sha256OfFile(absolutePath) {
  const buf = await readFile(absolutePath);
  const hash = createHash('sha256').update(buf).digest('hex');
  return `sha256-${hash}`;
}

async function computeManifest() {
  const manifest = {};
  for (const [id, entry] of Object.entries(RUNTIME_ASSETS)) {
    const baseDir = path.join(repoRoot, entry.nodeModulesPath);
    const integrity = {};
    for (const relative of entry.criticalFiles) {
      integrity[relative] = await sha256OfFile(path.join(baseDir, relative));
    }
    manifest[id] = {
      version: entry.version,
      sourceUrl: entry.sourceUrl,
      integrity,
    };
  }
  return manifest;
}

async function readExistingLock() {
  try {
    const raw = await readFile(lockPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

function diffManifests(actual, expected) {
  const issues = [];
  for (const id of Object.keys(actual)) {
    if (!expected[id]) {
      issues.push(`Missing asset in lock: ${id}`);
      continue;
    }
    if (expected[id].version !== actual[id].version) {
      issues.push(
        `Version drift for ${id}: lock=${expected[id].version} actual=${actual[id].version}`
      );
    }
    for (const [file, hash] of Object.entries(actual[id].integrity)) {
      if (expected[id].integrity?.[file] !== hash) {
        issues.push(
          `Integrity drift for ${id}/${file}: lock=${expected[id].integrity?.[file] ?? '<missing>'} actual=${hash}`
        );
      }
    }
    for (const file of Object.keys(expected[id].integrity ?? {})) {
      if (!(file in actual[id].integrity)) {
        issues.push(`Lock has stale entry ${id}/${file} not in critical files`);
      }
    }
  }
  for (const id of Object.keys(expected)) {
    if (!actual[id]) {
      issues.push(`Lock has stale asset ${id}`);
    }
  }
  return issues;
}

async function main() {
  const mode = process.argv.includes('--write') ? 'write' : 'check';
  const actual = await computeManifest();

  if (mode === 'write') {
    const serialized = `${JSON.stringify(actual, null, 2)}\n`;
    await writeFile(lockPath, serialized, 'utf8');
    console.log(`[runtime-assets] wrote ${path.relative(repoRoot, lockPath)}`);
    return;
  }

  const expected = await readExistingLock();
  if (!expected) {
    console.error(
      `[runtime-assets] ${path.relative(repoRoot, lockPath)} is missing — run "pnpm run build:runtime-assets" first.`
    );
    process.exitCode = 1;
    return;
  }

  const issues = diffManifests(actual, expected);
  if (issues.length > 0) {
    console.error('[runtime-assets] lock drift detected:');
    for (const issue of issues) {
      console.error(`  - ${issue}`);
    }
    console.error(
      '[runtime-assets] run "pnpm run build:runtime-assets" after intentional upgrades.'
    );
    process.exitCode = 1;
    return;
  }

  console.log('[runtime-assets] lock OK');
}

await main();

#!/usr/bin/env node

import { chmod, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const EXECUTE_BITS = 0o111;

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureNodePtyHelperModes({ nodePtyRoot, platform = process.platform } = {}) {
  if (platform === 'win32') return [];
  if (!nodePtyRoot) {
    throw new Error('nodePtyRoot is required');
  }

  const candidates = [path.join(nodePtyRoot, 'build', 'Release', 'spawn-helper')];
  const prebuildsRoot = path.join(nodePtyRoot, 'prebuilds');
  try {
    const platformDirectories = await readdir(prebuildsRoot, { withFileTypes: true });
    for (const entry of platformDirectories) {
      if (entry.isDirectory() && !entry.name.startsWith('win32-')) {
        candidates.push(path.join(prebuildsRoot, entry.name, 'spawn-helper'));
      }
    }
  } catch {
    // Source builds do not necessarily ship a prebuilds directory.
  }

  const helpers = [];
  for (const candidate of candidates) {
    if (!(await exists(candidate))) continue;
    const metadata = await stat(candidate);
    const currentMode = metadata.mode & 0o777;
    const executableMode = currentMode | EXECUTE_BITS;
    if (executableMode !== currentMode) {
      await chmod(candidate, executableMode);
    }
    helpers.push(candidate);
  }

  if (helpers.length === 0) {
    throw new Error(
      `node-pty spawn-helper is missing under ${nodePtyRoot}; reinstall dependencies before building the desktop app`
    );
  }

  return helpers;
}

async function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const nodePtyRoot = path.join(repoRoot, 'node_modules', 'node-pty');
  const helpers = await ensureNodePtyHelperModes({ nodePtyRoot });
  if (helpers.length > 0) {
    console.log(
      `[node-pty] verified executable spawn-helper (${helpers
        .map(helper => path.relative(repoRoot, helper))
        .join(', ')})`
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

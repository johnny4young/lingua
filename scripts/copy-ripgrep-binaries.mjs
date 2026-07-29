#!/usr/bin/env node

import { chmod, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(here, '..');

function defaultTargets() {
  if (process.platform === 'darwin') {
    // The macOS release job cross-packages both app architectures on one
    // runner, so both optional binary packages must be copied up front.
    return [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
    ];
  }
  return [{ platform: process.platform, arch: process.arch }];
}

function binaryName(platform) {
  return platform === 'win32' ? 'rg.exe' : 'rg';
}

function packageBinaryPath(repoRoot, target) {
  return path.join(
    repoRoot,
    'node_modules',
    '@vscode',
    `ripgrep-${target.platform}-${target.arch}`,
    'bin',
    binaryName(target.platform)
  );
}

/**
 * Copy every desktop release target's ripgrep executable into an
 * architecture-specific build path. electron-builder selects the matching
 * directory with its ${platform}/${arch} macros and copies only that binary
 * outside app.asar.
 */
export async function copyRipgrepBinaries({
  repoRoot = defaultRepoRoot,
  targets = defaultTargets(),
  sourcePathForTarget = (target) => packageBinaryPath(repoRoot, target),
} = {}) {
  const destinationPaths = [];

  for (const target of targets) {
    const destinationDirectory = path.join(
      repoRoot,
      '.vite',
      'native',
      'ripgrep',
      `${target.platform}-${target.arch}`
    );
    const destinationPath = path.join(
      destinationDirectory,
      binaryName(target.platform)
    );

    await mkdir(destinationDirectory, { recursive: true });
    await copyFile(sourcePathForTarget(target), destinationPath);
    if (target.platform !== 'win32') {
      await chmod(destinationPath, 0o755);
    }
    destinationPaths.push(destinationPath);
  }

  return destinationPaths;
}

const invokedPath = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : '';

if (import.meta.url === invokedPath) {
  const destinationPaths = await copyRipgrepBinaries();
  for (const destinationPath of destinationPaths) {
    process.stdout.write(
      `[copy-ripgrep-binaries] ${path.relative(defaultRepoRoot, destinationPath)}\n`
    );
  }
}

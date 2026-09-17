#!/usr/bin/env node
/**
 * Builds the Electron main + preload + renderer Vite artefacts WITHOUT
 * launching Electron or packaging the app — the standalone build step that
 * electron-builder packages.
 *
 * The native Vite config resolver preserves the established CommonJS entries,
 * renderer directory and packaged-window defines. electron-builder packages
 * the resulting .vite tree; no Forge packaging graph is required.
 *
 * @module scripts/build-desktop-bundles
 */

import { getDesktopBuildConfigs } from './lib/desktopViteConfig.mjs';
import { build } from 'vite';
import { rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyRipgrepBinaries } from './copy-ripgrep-binaries.mjs';
import {
  assertProductionReactBundle,
  forceProductionNodeEnv,
} from './lib/productionBuild.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

forceProductionNodeEnv();

const RENDERER_NAME = 'main_window';

function describeTarget(config) {
  const buildConfig = config.build ?? {};
  return relative(
    repoRoot,
    String(
      buildConfig.lib?.entry ??
        buildConfig.rollupOptions?.input ??
        buildConfig.outDir ??
        'unknown'
    )
  );
}

// Start from a clean tree so stale chunks never ship inside the asar.
await rm(resolve(repoRoot, '.vite'), { recursive: true, force: true });

for (const config of await getDesktopBuildConfigs(repoRoot)) {
  process.stdout.write(`[build-desktop-bundles] target: ${describeTarget(config)}\n`);
  await build({ configFile: false, logLevel: 'warn', ...config, clearScreen: false });
}
await assertProductionReactBundle(
  resolve(repoRoot, '.vite', 'renderer', RENDERER_NAME, 'assets')
);

const ripgrepPaths = await copyRipgrepBinaries({ repoRoot });
for (const ripgrepPath of ripgrepPaths) {
  process.stdout.write(
    `[build-desktop-bundles] native -> ${relative(repoRoot, ripgrepPath)}\n`
  );
}

process.stdout.write('[build-desktop-bundles] done\n');

#!/usr/bin/env node
/**
 * Builds the Electron main + preload + renderer Vite artefacts WITHOUT
 * launching Electron or packaging the app — the standalone build step that
 * electron-builder packages.
 *
 * Electron Forge owns the exact Vite config shape through
 * `@electron-forge/plugin-vite`. Calling `vite build --config ...` directly
 * misses the Forge-injected entry points, output paths, and the renderer-name
 * defines. This reuses Forge's `ViteConfigGenerator` so the output in
 * `.vite/build` + `.vite/renderer/main_window` is identical to what
 * `electron-forge package` would have produced — then electron-builder takes
 * over packaging. (Pattern ported from puntovivo's `build-electron-main.mjs`,
 * extended here to also build the renderer since Lingua's renderer IS the
 * Electron renderer, not a separate web bundle.)
 *
 * The Forge Vite plugin normally injects `MAIN_WINDOW_VITE_NAME` and
 * `MAIN_WINDOW_VITE_DEV_SERVER_URL` into the main bundle. Outside Forge's
 * `make` we inject them here: the packaged app has no dev server, so the
 * dev-server global is `undefined` and the window loads
 * `../renderer/main_window/index.html` (see src/main/index.ts).
 *
 * @module scripts/build-desktop-bundles
 */

import ViteConfigGeneratorModule from '@electron-forge/plugin-vite/dist/ViteConfig.js';
import { build } from 'vite';
import { rm } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ViteConfigGenerator =
  ViteConfigGeneratorModule.default ?? ViteConfigGeneratorModule;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const RENDERER_NAME = 'main_window';

const pluginConfig = {
  build: [
    { entry: 'src/main/index.ts', config: 'vite.main.config.mts', target: 'main' },
    {
      entry: 'src/preload/index.ts',
      config: 'vite.preload.config.mts',
      target: 'preload',
    },
  ],
  renderer: [{ name: RENDERER_NAME, config: 'vite.renderer.config.mts' }],
};

// Forge-injected renderer constants the main bundle reads. In a packaged build
// there is no dev server, so the URL is `undefined` (falls back to loadFile).
const forgeRendererDefines = {
  MAIN_WINDOW_VITE_NAME: JSON.stringify(RENDERER_NAME),
  MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
};

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

const generator = new ViteConfigGenerator(pluginConfig, repoRoot, true);

const buildConfigs = await generator.getBuildConfigs();
for (const config of buildConfigs) {
  config.define = { ...(config.define ?? {}), ...forgeRendererDefines };
  process.stdout.write(`[build-desktop-bundles] main/preload: ${describeTarget(config)}\n`);
  await build({ configFile: false, logLevel: 'warn', ...config, clearScreen: false });
}

const rendererConfigs = await generator.getRendererConfig();
for (const config of rendererConfigs) {
  process.stdout.write(
    `[build-desktop-bundles] renderer -> ${relative(repoRoot, config.build?.outDir ?? 'unknown')}\n`
  );
  await build({ configFile: false, logLevel: 'warn', ...config, clearScreen: false });
}

process.stdout.write('[build-desktop-bundles] done\n');

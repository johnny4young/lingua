import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDesktopBuildConfigs } from '../../scripts/lib/desktopViteConfig.mjs';

const root = resolve(__dirname, '../..');
type DesktopConfig = Awaited<ReturnType<typeof getDesktopBuildConfigs>>[number];
let main: DesktopConfig;
let preload: DesktopConfig;
let renderer: DesktopConfig;

beforeAll(async () => {
  const configs = await getDesktopBuildConfigs(root);
  const [mainConfig, preloadConfig, rendererConfig] = configs;
  if (!mainConfig || !preloadConfig || !rendererConfig) {
    throw new Error(`expected main, preload and renderer configs, got ${configs.length}`);
  }
  main = mainConfig;
  preload = preloadConfig;
  renderer = rendererConfig;
});

describe('production desktop bundle contract', () => {
  it('types app-owned window defines through the desktop ambient declarations', () => {
    const ambientName = 'desktop.env.d.ts';
    const declarations = readFileSync(resolve(root, ambientName), 'utf8');
    const declaredNames = [...declarations.matchAll(/^declare const (\w+):/gmu)]
      .map((match) => match[1]!)
      .sort();
    expect(declaredNames).toEqual([
      'MAIN_WINDOW_VITE_DEV_SERVER_URL',
      'MAIN_WINDOW_VITE_NAME',
    ]);

    for (const configName of ['tsconfig.json', 'tsconfig.test.json']) {
      const configPath = resolve(root, configName);
      const config = readFileSync(configPath, 'utf8');
      expect(config, configName).toContain(`"${ambientName}"`);
      expect(config, configName).not.toContain('"forge.env.d.ts"');
    }

    for (const name of declaredNames) {
      expect(main.define, `${name} must be injected into the main bundle`).toHaveProperty(name);
    }
  });

  it('preserves main/preload entries, native externals and shared output', () => {
    for (const config of [main, preload]) {
      expect(config).toMatchObject({
        root,
        mode: 'production',
        define: {
          MAIN_WINDOW_VITE_NAME: '"main_window"',
          MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
        },
        build: {
          outDir: '.vite/build', emptyOutDir: false, copyPublicDir: false,
          sourcemap: false, minify: 'esbuild', watch: null,
        },
      });
      expect(config.build.rollupOptions.external).toEqual(
        expect.arrayContaining(['electron', 'fs', 'node:fs', 'node:path'])
      );
    }
    expect(main.build.lib).toMatchObject({ entry: 'src/main/index.ts', formats: ['cjs'] });
    expect(main.build.rollupOptions.output).toMatchObject({ format: 'cjs', entryFileNames: 'main.js' });
    expect(main.build.rollupOptions.external).toEqual(
      expect.arrayContaining(['electron-updater', 'node-pty', 'electron/main'])
    );
    expect(main.resolve).toMatchObject({ conditions: ['node'], mainFields: ['module', 'jsnext:main', 'jsnext'] });
    expect(preload.build.rollupOptions).toMatchObject({
      input: 'src/preload/index.ts',
      output: { format: 'cjs', inlineDynamicImports: true, entryFileNames: 'preload.js' },
    });
    expect(preload.build.lib).toBeUndefined();
  });

  it('preserves file-protocol renderer assets and repository environment defines', () => {
    expect(renderer).toMatchObject({
      root, mode: 'production', base: './', envDir: root,
      build: { outDir: '.vite/renderer/main_window', copyPublicDir: true },
      resolve: { preserveSymlinks: true },
    });
    expect(main.define).toHaveProperty('__LINGUA_LICENSE_PUBLIC_KEY_JWK__');
    expect(main.define).toHaveProperty('__LINGUA_LICENSE_SERVER_URL__');
    expect(renderer.define.__LINGUA_PYODIDE_INDEX_URL__).toBe('null');
    expect(renderer.plugins.length).toBeGreaterThan(0);
  });
});

import { builtinModules } from 'node:module';
import { resolve } from 'node:path';
import { loadConfigFromFile, mergeConfig } from 'vite';

const RENDERER_NAME = 'main_window';
const external = [
  'electron',
  'electron/common',
  ...builtinModules.flatMap(name => [name, `node:${name}`]),
];

/** Resolve the production configs without pulling in Forge's unused packager. */
export async function getDesktopBuildConfigs(root) {
  const shared = {
    root,
    mode: 'production',
    clearScreen: false,
    define: {
      MAIN_WINDOW_VITE_NAME: JSON.stringify(RENDERER_NAME),
      MAIN_WINDOW_VITE_DEV_SERVER_URL: 'undefined',
    },
    build: {
      // Main, preload and the SQL host share an output directory; none may erase the others.
      emptyOutDir: false,
      outDir: '.vite/build',
      copyPublicDir: false,
      watch: null,
    },
  };
  const targets = [
    ['vite.main.config.mts', mergeConfig(shared, {
      build: {
        lib: { entry: 'src/main/index.ts', fileName: () => '[name].js', formats: ['cjs'] },
        rollupOptions: { external: [...external, 'electron/main'] },
      },
      // Keep Node entrypoint selection, not Vite's browser defaults.
      resolve: { conditions: ['node'], mainFields: ['module', 'jsnext:main', 'jsnext'] },
    })],
    ['vite.preload.config.mts', mergeConfig(shared, {
      build: {
        rollupOptions: {
          external: [...external, 'electron/renderer'],
          input: 'src/preload/index.ts',
          output: {
            format: 'cjs',
            inlineDynamicImports: true,
            entryFileNames: '[name].js',
            chunkFileNames: '[name].js',
            assetFileNames: '[name].[ext]',
          },
        },
      },
    })],
    ['vite.renderer.config.mts', {
      root,
      mode: 'production',
      base: './',
      build: { copyPublicDir: true, outDir: `.vite/renderer/${RENDERER_NAME}` },
      resolve: { preserveSymlinks: true },
      clearScreen: false,
    }],
    ['vite.sqlhost.config.mts', mergeConfig(shared, {
      build: {
        lib: { entry: 'src/main/sqlHost/hostEntry.ts', fileName: () => 'sqlHost.js', formats: ['cjs'] },
        rollupOptions: { external },
      },
      resolve: { conditions: ['node'], mainFields: ['module', 'jsnext:main', 'jsnext'] },
    })],
  ];

  return Promise.all(targets.map(async ([file, defaults]) => {
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' }, resolve(root, file), root
    );
    if (!loaded) throw new Error(`Unable to load desktop Vite config: ${file}`);
    return mergeConfig(defaults, loaded.config);
  }));
}

import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
  const isProductionBuild = mode === 'production';

  return {
    build: {
      // Match the main-process posture: dev builds remain debuggable, while
      // packaged desktop builds do not publish preload source maps or
      // unminified bridge code.
      sourcemap: !isProductionBuild,
      minify: isProductionBuild ? 'esbuild' : false,
      rollupOptions: {
        external: ['electron'],
        output: {
          format: 'cjs',
          entryFileNames: 'preload.js',
        },
      },
    },
  };
});

import { defineConfig } from 'vite';

// The SQL host utilityProcess. Its drivers stay production dependencies loaded
// from node_modules at runtime, like node-pty, so the bundle carries only Lingua's code.
export const SQL_HOST_EXTERNALS = ['electron', 'pg', 'pg-cursor', 'pg-native', 'mysql2', 'ssh2', 'tedious', '@clickhouse/client'];

export default defineConfig(({ mode }) => {
  const isProductionBuild = mode === 'production';

  return {
    build: {
      sourcemap: !isProductionBuild,
      minify: isProductionBuild ? 'esbuild' : false,
      rollupOptions: {
        external: SQL_HOST_EXTERNALS,
        output: {
          format: 'cjs',
          entryFileNames: 'sqlHost.js',
        },
      },
    },
  };
});

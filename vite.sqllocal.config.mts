import { defineConfig } from 'vite';

// The native Local SQL utilityProcess. DuckDB's binding stays a production
// dependency loaded from node_modules at runtime, like the SQL host's drivers.
export const SQL_LOCAL_EXTERNALS = ['electron', '@duckdb/node-api'];

export default defineConfig(({ mode }) => {
  const isProductionBuild = mode === 'production';

  return {
    build: {
      sourcemap: !isProductionBuild,
      minify: isProductionBuild ? 'esbuild' : false,
      rollupOptions: {
        external: SQL_LOCAL_EXTERNALS,
        output: {
          format: 'cjs',
          entryFileNames: 'sqlLocal.js',
        },
      },
    },
  };
});

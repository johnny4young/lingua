import { defineConfig } from 'vite';

export default defineConfig({
  define: {
    __LINGUA_UPDATE_URL__: JSON.stringify(
      process.env.LINGUA_UPDATE_URL || 'https://lingua-update-server.johnny4young.workers.dev',
    ),
  },
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ['electron', 'electron-squirrel-startup'],
      output: {
        format: 'cjs',
        entryFileNames: 'main.js',
      },
    },
  },
});

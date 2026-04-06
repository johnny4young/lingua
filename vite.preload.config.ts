import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    sourcemap: true,
    minify: false,
    rollupOptions: {
      external: ['electron'],
      output: {
        format: 'cjs',
        entryFileNames: 'preload.js',
      },
    },
  },
});

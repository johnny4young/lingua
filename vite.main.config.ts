import { defineConfig } from 'vite';

export default defineConfig({
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

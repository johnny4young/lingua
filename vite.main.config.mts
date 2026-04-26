import { defineConfig } from 'vite';
import { getSharedBuildDefines } from './build/appBuildMetadata.mts';

export default defineConfig({
  define: {
    __LINGUA_UPDATE_URL__: JSON.stringify(
      process.env.LINGUA_UPDATE_URL || 'https://lingua-update-server.johnny4young.workers.dev',
    ),
    // RL-059 main-side bridge — embed the same Ed25519 public key the
    // renderer uses, so packaged builds can verify license tokens in main
    // without crossing the renderer boundary. Empty string means "no key
    // configured", which the main verifier surfaces as a `no-public-key`
    // failure (never silently "verifies" against nothing).
    __LINGUA_LICENSE_PUBLIC_KEY_JWK__: JSON.stringify(
      process.env.LINGUA_LICENSE_PUBLIC_KEY_JWK ||
        process.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK ||
        '',
    ),
    ...getSharedBuildDefines(),
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

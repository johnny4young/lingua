import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';
import { loadRepoRootEnv, resolveBuildTimeEnvVar } from './build/resolveEnv.mts';

// Seed VITE_LINGUA_APP_VERSION from package.json before Vite reads
// process.env. implementation
applySharedEnvDefaults();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Use the function form of defineConfig so we can call `loadEnv` and pick
// up repo-root `.env` / `.env.production` BEFORE building the `define`
// block. Vite's automatic env loading only feeds `import.meta.env.VITE_*`
// substitutions in renderer source code; the main bundle reads the
// public key from `process.env` at config-load time, which means
// `.env.production` is invisible unless we load it explicitly here.
//
// `dev:desktop:pro` and `dev:desktop:prod` injected the var via
// process.env so this gap was hidden during dev. Packaged builds run
// `scripts/build-desktop-bundles.mjs` and then electron-builder without that
// wrapper, so `process.env.LINGUA_LICENSE_PUBLIC_KEY_JWK` was empty and the
// main bundle baked an empty string — every paste in production failed with
// `no-public-key` from the main verifier.
export default defineConfig(({ mode }) => {
  const isProductionBuild = mode === 'production';
  // Four-source cascade (process.env NAME / VITE_NAME, then repo-root
  // .env files NAME / VITE_NAME) via the shared helper — a variable
  // resolved here behaves identically to any future one, instead of
  // each define hand-copying the cascade. See build/resolveEnv.mts.
  const env = loadRepoRootEnv(mode, __dirname);
  const publicKeyJwk = resolveBuildTimeEnvVar(env, 'LINGUA_LICENSE_PUBLIC_KEY_JWK');

  // implementation — license-server base URL for the main-side
  // wrappers in `src/main/licenseServer.ts`. Same sources as the
  // public key so packaged `make:desktop` builds pick up
  // `licenses.linguacode.dev` from `.env.production` without any
  // wrapper script. Runtime `process.env.LINGUA_LICENSE_SERVER_URL`
  // overrides the baked value for dev launchers
  // (`scripts/dev-desktop-prod.mjs`) that need to point at a
  // localhost mock without rebuilding main.
  const licenseServerUrl = resolveBuildTimeEnvVar(env, 'LINGUA_LICENSE_SERVER_URL');

  return {
    define: {
      // internal main-side bridge — embed the same Ed25519 public key the
      // renderer uses, so packaged builds can verify license tokens in
      // main without crossing the renderer boundary. Empty string means
      // "no key configured", which the main verifier surfaces as a
      // `no-public-key` failure (never silently "verifies" against
      // nothing).
      __LINGUA_LICENSE_PUBLIC_KEY_JWK__: JSON.stringify(publicKeyJwk),
      // implementation — license-server base URL baked at build time
      // for the main-side wrappers.
      __LINGUA_LICENSE_SERVER_URL__: JSON.stringify(licenseServerUrl),
      ...getSharedBuildDefines(),
    },
    build: {
      // Keep desktop release bundles smaller and avoid shipping main-process
      // source maps with packaged apps. Development builds keep sourcemaps and
      // readable output for stack traces while `make:desktop` / package builds
      // run through Vite's production mode before electron-builder packages
      // `.vite/`.
      sourcemap: !isProductionBuild,
      minify: isProductionBuild ? 'esbuild' : false,
      rollupOptions: {
        external: ['electron', 'electron-updater'],
        output: {
          format: 'cjs',
          entryFileNames: 'main.js',
        },
      },
    },
  };
});

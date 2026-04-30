import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { applySharedEnvDefaults, getSharedBuildDefines } from './build/appBuildMetadata.mts';

// Seed VITE_LINGUA_APP_VERSION from package.json before Vite reads
// process.env. RL-061 Slice 5.
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
// process.env so this gap was hidden during dev. Packaged
// `make:desktop` builds invoke Forge directly without that wrapper, so
// `process.env.LINGUA_LICENSE_PUBLIC_KEY_JWK` was empty and the main
// bundle baked an empty string — every paste in production failed with
// `no-public-key` from the main verifier.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const publicKeyJwk =
    process.env.LINGUA_LICENSE_PUBLIC_KEY_JWK ||
    process.env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK ||
    env.LINGUA_LICENSE_PUBLIC_KEY_JWK ||
    env.VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK ||
    '';

  // RL-061 Slice 3.5 — license-server base URL for the main-side
  // wrappers in `src/main/licenseServer.ts`. Same loadEnv source as
  // the public key so packaged `make:desktop` builds pick up
  // `licenses.linguacode.dev` from `.env.production` without any
  // wrapper script. Runtime `process.env.LINGUA_LICENSE_SERVER_URL`
  // overrides the baked value for dev launchers
  // (`scripts/dev-desktop-prod.mjs`) that need to point at a
  // localhost mock without rebuilding main.
  const licenseServerUrl =
    process.env.LINGUA_LICENSE_SERVER_URL ||
    process.env.VITE_LINGUA_LICENSE_SERVER_URL ||
    env.LINGUA_LICENSE_SERVER_URL ||
    env.VITE_LINGUA_LICENSE_SERVER_URL ||
    '';

  return {
    define: {
      __LINGUA_UPDATE_URL__: JSON.stringify(
        process.env.LINGUA_UPDATE_URL ||
          env.LINGUA_UPDATE_URL ||
          // RL-061 Slice 5 — point at the custom domain wired in
          // `update-server/wrangler.toml`. The previous workers.dev
          // URL leaked the account subdomain `lingua-license-server`
          // and (post Slice 5) is disabled because `workers_dev` is
          // not declared in wrangler.toml. The renderer service
          // (`src/renderer/services/webUpdateServer.ts`) defaults to
          // the same custom domain, keeping desktop autoupdater
          // and web update banner pointed at one canonical origin.
          'https://updates.linguacode.dev',
      ),
      // RL-059 main-side bridge — embed the same Ed25519 public key the
      // renderer uses, so packaged builds can verify license tokens in
      // main without crossing the renderer boundary. Empty string means
      // "no key configured", which the main verifier surfaces as a
      // `no-public-key` failure (never silently "verifies" against
      // nothing).
      __LINGUA_LICENSE_PUBLIC_KEY_JWK__: JSON.stringify(publicKeyJwk),
      // RL-061 Slice 3.5 — license-server base URL baked at build time
      // for the main-side wrappers.
      __LINGUA_LICENSE_SERVER_URL__: JSON.stringify(licenseServerUrl),
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
  };
});

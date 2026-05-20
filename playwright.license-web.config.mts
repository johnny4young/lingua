import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = __dirname;
const port = 4175;
const host = 'localhost';
const publicKeyJwk = process.env.LINGUA_DEV_LICENSE_PUBLIC_KEY_JWK;
const token = process.env.LINGUA_DEV_LICENSE_TOKEN;

if (!publicKeyJwk || !token) {
  throw new Error(
    'Missing LINGUA_DEV_LICENSE_PUBLIC_KEY_JWK / LINGUA_DEV_LICENSE_TOKEN. Run this config through scripts/run-playwright-web-validation.mjs.'
  );
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  reporter: 'list',
  outputDir: 'output/playwright/license-web-e2e',
  use: {
    baseURL: `http://${host}:${port}`,
    browserName: 'chromium',
    channel: 'chromium',
    viewport: { width: 1440, height: 960 },
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // Build once then serve the production artifacts. Dev mode is much
    // slower for Playwright because Vite compiles the Web Worker bundles
    // on demand, which pushes the first manual run past the 10s assertion
    // timeout in CI. Production preview is deterministic and fast.
    command: `npx vite build --config vite.web.config.mts && npx vite preview --config vite.web.config.mts --host ${host} --port ${port} --strictPort`,
    url: `http://${host}:${port}`,
    cwd: repoRoot,
    reuseExistingServer: false,
    timeout: 180_000,
    env: {
      ...process.env,
      VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: publicKeyJwk,
      // RL-065 Slice 5 fold G — the telemetry endpoint must be set
      // at build time so the bundle has a non-null endpoint. We use
      // the real production URL because the renderer CSP only
      // allow-lists `updates.linguacode.dev` for `connect-src`, and a
      // synthetic test host would be blocked by CSP. Tests intercept
      // every POST against this URL via `page.route('**/telemetry',
      // …)` so nothing actually leaves the test runner.
      VITE_LINGUA_TELEMETRY_URL: 'https://updates.linguacode.dev/telemetry',
      LINGUA_E2E_HOOKS: '1',
    },
  },
});

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
  // 60s preserves headroom against the slowest legitimate assertions
  // (Pyodide boot, Monaco mount) while still surfacing genuine hangs
  // ~30s faster than the original 90s. The original timeout was a
  // global cap that compounded with worker contention — every hung
  // test pinned a worker for 90s. 60s halves that compounding cost
  // without false-positive timeouts on healthy tests.
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  // 50% of host CPUs (= 7 workers on a 14-core host) matches the
  // previous Playwright default. Raising this past 50% caused CPU
  // contention severe enough that legitimate tests hit timeouts —
  // the runtime savings from more workers were undone by spurious
  // failures. The big speedup actually comes from:
  //   (a) caching dist/web between invocations
  //   (b) caching the minted keypair so cached dist stays valid
  //   (c) `reuseExistingServer: true` skipping server boot on warm runs
  // CI sets `CI=1` and stays on 50% so GitHub runners (typically
  // 2-4 cores) don't oversubscribe.
  workers: '50%',
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
    // Serve the production artifacts. Build is now a separate
    // prerequisite owned by `scripts/run-playwright-web-validation.mjs`
    // so we don't pay the ~2s build cost on every Playwright
    // invocation — and so iterative runs (re-run after a code edit)
    // can `--no-rebuild` to reuse the artifacts.
    command: `npx vite preview --config vite.web.config.mts --host ${host} --port ${port} --strictPort`,
    url: `http://${host}:${port}`,
    cwd: repoRoot,
    // Reuse a running preview between invocations when the operator
    // is iterating. CI sets `CI=1` and skips reuse so each release
    // matrix entry has a pristine server.
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      ...process.env,
      VITE_LINGUA_LICENSE_PUBLIC_KEY_JWK: publicKeyJwk,
      // implementation note — the telemetry endpoint must be set
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

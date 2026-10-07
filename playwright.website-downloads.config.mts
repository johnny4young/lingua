import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import { assertHostedWebsiteSmoke } from './scripts/run-website-download-smoke.mjs';

assertHostedWebsiteSmoke();
const root = fileURLToPath(new URL('.', import.meta.url));
const builtRelease = readFileSync(
  new URL('./website/dist/releases/index.html', import.meta.url),
  'utf8'
);
if (!builtRelease.includes('lingua-cli-v0.0.0-darwin-arm64.zip')) {
  throw new Error(
    'Run scripts/run-website-download-smoke.mjs to build the synthetic website first'
  );
}

export default defineConfig({
  testDir: './tests/website',
  testMatch: 'downloadMatrix.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  globalTimeout: 150_000,
  expect: { timeout: 5_000 },
  reporter: 'list',
  outputDir: 'output/playwright/website-downloads/results',
  use: {
    baseURL: 'http://127.0.0.1:4186',
    browserName: 'chromium',
    launchOptions: { chromiumSandbox: true },
    acceptDownloads: false,
    serviceWorkers: 'block',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: 'npm --prefix website run preview -- --host 127.0.0.1 --port 4186',
    cwd: root,
    url: 'http://127.0.0.1:4186/releases',
    reuseExistingServer: false,
    timeout: 30_000,
    env: { ASTRO_TELEMETRY_DISABLED: '1' },
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    {
      name: 'mobile',
      use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
    },
  ],
});

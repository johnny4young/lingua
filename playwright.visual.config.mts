import { defineConfig } from '@playwright/test';
import baseConfig from './playwright.license-web.config.mts';

// Pixel baselines depend on the OS font stack, so this suite stays out of the
// CI e2e run; run it with `pnpm run test:visual:web` and review the diffs.
export default defineConfig({
  ...baseConfig,
  testDir: './tests/visual',
  outputDir: 'output/playwright/visual',
  workers: 2,
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  expect: {
    ...baseConfig.expect,
    toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: 'disabled', caret: 'hide' },
  },
});

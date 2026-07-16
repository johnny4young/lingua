import { mkdirSync } from 'node:fs';
import {
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

const evidenceDir = 'output/review/it2-g6-g7-product-hardening';

function captureEnabled(): boolean {
  return process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1';
}

async function selectedMaxIterations(page: import('@playwright/test').Page) {
  const select = page.getByLabel(/max iterations|iteraciones máximas/i);
  await expect(select).toBeVisible();
  return select.locator('option:checked');
}

test.describe('IT2-G7 locale-aware numeric formatting', () => {
  test('uses English grouping in Settings', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'editor');

    await expect(await selectedMaxIterations(page)).toHaveText('10,000');
  });

  test('uses Spanish grouping in Settings instead of the browser locale', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSettings(page);
    await openSettingsTab(page, 'editor');

    await expect(await selectedMaxIterations(page)).toHaveText('10.000');

    if (captureEnabled()) {
      mkdirSync(evidenceDir, { recursive: true });
      await page.screenshot({
        path: `${evidenceDir}/g7-web-es-number-formatting.png`,
      });
    }
  });
});

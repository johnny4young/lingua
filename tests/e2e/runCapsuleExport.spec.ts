/**
 * Run Capsule export activation boundary.
 *
 * A fresh workspace has no capsule to export, so neither the result-header
 * control nor the shared clipboard pipeline belongs in its initial resources.
 */

import type { Page } from '@playwright/test';
import {
  clickRun,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function countExportResources(page: Page): Promise<{
  button: number;
  pipeline: number;
}> {
  return page.evaluate(() => {
    const resources = performance.getEntriesByType('resource');
    return {
      button: resources.filter(entry =>
        /\/assets\/RunCapsuleExportButton-[^/]+\.js$/u.test(entry.name)
      ).length,
      pipeline: resources.filter(entry => /\/assets\/exportCapsule-[^/]+\.js$/u.test(entry.name))
        .length,
    };
  });
}

test('loads export only after a capsule exists and reuses it for button and shortcut', async ({
  context,
  page,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await dismissWhatsNew(page);

  await expect(page.getByTestId('result-panel-export-capsule')).toHaveCount(0);
  expect(await countExportResources(page)).toEqual({ button: 0, pipeline: 0 });

  await clickRun(page);
  const button = page.getByTestId('result-panel-export-capsule');
  await expect(button).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => countExportResources(page)).toEqual({ button: 1, pipeline: 1 });

  await button.click();
  await expect(button).toHaveAttribute('data-just-copied', 'true');
  await expect(page.getByTestId('status-notice-banner')).toContainText(
    'Capsule copied to clipboard'
  );
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('"version": 1');

  const combo = process.platform === 'darwin' ? 'Meta+Shift+X' : 'Control+Shift+X';
  await page.keyboard.press(combo);
  await expect.poll(() => countExportResources(page)).toEqual({ button: 1, pipeline: 1 });
});

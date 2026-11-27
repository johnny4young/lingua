import type { Locator } from '@playwright/test';
import { expect, seedSession, test, trackConsoleErrors } from './licenseWeb.helpers';

// Headless Chromium hides scrollbars by default, which would hide the width they take inside the tree.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

async function rightEdge(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error('target is not rendered');
  return Math.round(box.x + box.width);
}

test('a tree that scrolls keeps its marks on the edge of the Tests row', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 640 });
  const consoleErrors = trackConsoleErrors(page);
  await seedSession(page, { language: 'en', primeProLicense: true });
  await page.goto('/?e2e=project-tests-editor&locale=en');
  await page.waitForSelector('.monaco-editor .view-lines');
  await page.evaluate(() => window.dispatchEvent(new Event('e2e-open-test-file')));
  const tree = page.getByRole('tree', { name: 'checkout-api file tree' });
  await expect(page.getByTestId('file-tree-marks-src/shipping.ts')).toBeVisible();
  // A classic scrollbar takes its width inside the tree, as with the app's styled scrollbars in Electron.
  expect(await tree.evaluate(element => element.scrollHeight > element.clientHeight && element.offsetWidth > element.clientWidth)).toBe(true);
  const footerEdge = await rightEdge(page.getByTestId('file-tree-footer-tests-tally'));
  expect(Math.abs((await rightEdge(page.getByTestId('file-tree-marks-src/shipping.ts'))) - footerEdge)).toBeLessThanOrEqual(1);
  expect(consoleErrors).toEqual([]);
});

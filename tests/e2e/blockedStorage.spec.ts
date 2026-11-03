import type { Page } from '@playwright/test';
import { expect, gotoApp, openConsole, replaceEditorText, test } from './licenseWeb.helpers';

// Block-all-cookies makes reading either property throw.
async function blockStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    for (const name of ['localStorage', 'sessionStorage']) {
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException('Access is denied for this document.', 'SecurityError');
        },
      });
    }
  });
}

for (const locale of ['en-US', 'es-ES']) {
  test.describe(`with storage blocked (${locale})`, () => {
    test.use({ locale });

    test('boots, runs code and keeps state in memory', async ({ page }) => {
      await blockStorage(page);
      await gotoApp(page);
      await expect(page.locator('html')).toHaveAttribute('data-recovery-state', 'normal');

      await expect(page.locator('.guided-tour-step')).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.locator('.guided-tour-layer')).toHaveCount(0);

      await replaceEditorText(page, 'console.log("ran-with-memory-storage");');
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter');
      await openConsole(page);
      await expect(
        page.getByTestId('console-entry-row').filter({ hasText: 'ran-with-memory-storage' })
      ).toBeVisible();

      const storedSettings = () =>
        page.evaluate(() => window.localStorage.getItem('lingua-settings'));
      await expect.poll(storedSettings).not.toBeNull();

      await page.evaluate(() => window.localStorage.setItem('blocked-storage-probe', '1'));
      await page.reload();
      await expect(page.getByTestId('license-badge')).toBeVisible();
      expect(
        await page.evaluate(() => window.localStorage.getItem('blocked-storage-probe'))
      ).toBeNull();
    });
  });
}

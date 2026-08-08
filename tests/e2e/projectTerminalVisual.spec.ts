import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/project-terminal');

test.describe.configure({ mode: 'serial' });

test.describe('project terminal bilingual evidence', () => {
  test.beforeAll(() => {
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  for (const [locale, title, startLabel, activeLabel] of [
    ['en', 'Terminal for polyglot-checkout', 'Start terminal', 'zsh · active'],
    ['es', 'Terminal para polyglot-checkout', 'Inicia la terminal', 'zsh · activo'],
  ] as const) {
    test(`${locale} trust boundary and active shell`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1000 });
      const consoleErrors: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => consoleErrors.push(error.message));

      await page.goto(`/?e2e=project-terminal&locale=${locale}`);
      await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible();
      await expect(page.getByText(/not a sandbox|no es una caja de arena/i)).toBeVisible();

      const trustPath = path.join(screenshotDir, `project-terminal-trust-${locale}.png`);
      await page.screenshot({ path: trustPath, fullPage: false, animations: 'disabled' });
      await testInfo.attach(`project-terminal-trust-${locale}.png`, {
        path: trustPath,
        contentType: 'image/png',
      });

      await page.getByRole('button', { name: startLabel }).click();
      await expect(page.getByText(activeLabel, { exact: true })).toBeVisible();
      await expect(page.locator('.xterm-screen')).toContainText('Project terminal ready');
      await expect(page.getByRole('button', { name: locale === 'es' ? 'Detén' : 'Stop' })).toBeVisible();
      await page.waitForTimeout(250);
      expect(
        await page.evaluate(() => ({
          scrollX: window.scrollX,
          scrollY: window.scrollY,
          innerWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }))
      ).toEqual({ scrollX: 0, scrollY: 0, innerWidth: 1440, scrollWidth: 1440 });

      const activePath = path.join(screenshotDir, `project-terminal-${locale}.png`);
      await page.screenshot({ path: activePath, fullPage: false, animations: 'disabled' });
      await testInfo.attach(`project-terminal-${locale}.png`, {
        path: activePath,
        contentType: 'image/png',
      });
      expect(consoleErrors).toEqual([]);
    });
  }
});

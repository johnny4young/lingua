import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/project-tests');

test.describe.configure({ mode: 'serial' });

test.describe('project tests bilingual evidence', () => {
  test.beforeAll(() => {
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  for (const [locale, title, result] of [
    ['en', 'Project tests', 'Passed'],
    ['es', 'Pruebas del proyecto', 'Aprobadas'],
  ] as const) {
    test(`${locale} detected-runner result`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1440, height: 1100 });
      const consoleErrors: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => consoleErrors.push(error.message));

      await page.goto(`/?e2e=project-tests&locale=${locale}`);
      await expect(page.getByTestId('project-tests-overlay')).toBeVisible();
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
      await expect(page.getByText(result, { exact: true })).toBeVisible();
      await expect(page.getByRole('radio')).toHaveCount(5);
      await expect(page.getByTestId('project-tests-stdout')).toContainText('7 tests passed');
      // Preserve the existing legacy-buffer fixture, then exercise actual store/UI
      // streaming, failed completion and recovery through the gated bridge fixture.
      for (const outcome of [locale === 'es' ? 'Fallaron' : 'Failed', result]) {
        await page.getByTestId('project-tests-run').click();
        await expect(page.getByTestId('project-tests-live-ordered')).toContainText(
          'first\nwarning\nlast'
        );
        await page.evaluate(() => window.dispatchEvent(new Event('e2e-project-tests-complete')));
        await expect(page.getByText(outcome, { exact: true })).toBeVisible();
        await expect(page.getByTestId('project-tests-ordered')).toContainText(
          'first\nwarning\nlast'
        );
        await expect(page.getByTestId('project-tests-stdout')).toHaveCount(0);
        await expect(page.getByTestId('project-tests-stderr')).toHaveCount(0);
      }
      await expect(
        page.getByText(locale === 'es' ? 'Salida (orden de captura)' : 'Output (capture order)', {
          exact: true,
        })
      ).toBeVisible();

      const filePath = path.join(screenshotDir, `project-tests-${locale}.png`);
      await page.screenshot({ path: filePath, fullPage: false, animations: 'disabled' });
      await testInfo.attach(`project-tests-${locale}.png`, {
        path: filePath,
        contentType: 'image/png',
      });

      expect(consoleErrors).toEqual([]);
    });
  }
});

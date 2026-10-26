import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const screenshotDir = path.resolve(process.cwd(), 'output/playwright/project-tests');

test.describe.configure({ mode: 'serial' });

test.describe('Tests dock tab bilingual evidence', () => {
  test.beforeAll(() => {
    fs.rmSync(screenshotDir, { recursive: true, force: true });
    fs.mkdirSync(screenshotDir, { recursive: true });
  });

  for (const [locale, copy] of [
    ['en', { summary: '6 tests in 4 files · found with', failedAt: 'Failed at line 10', counts: '4 passed1 failed1 skipped', fixed: '5 passed0 failed1 skipped', show: 'Show output', noProject: 'Open a project to see its tests' }],
    ['es', { summary: '6 pruebas en 4 archivos · encontradas con', failedAt: 'Falló en la línea 10', counts: '4 aprobadas1 fallidas1 omitidas', fixed: '5 aprobadas0 fallidas1 omitidas', show: 'Mostrar salida', noProject: 'Abre un proyecto para ver sus pruebas' }],
  ] as const) {
    test(`${locale} results by file, a single-test run and the raw output`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 520 });
      const consoleErrors: string[] = [];
      page.on('console', message => {
        if (message.type() === 'error') consoleErrors.push(message.text());
      });
      page.on('pageerror', error => consoleErrors.push(error.message));

      await page.goto(`/?e2e=project-tests&locale=${locale}`);
      const panel = page.getByTestId('tests-panel');
      await expect(panel.getByTestId('tests-summary')).toContainText(copy.summary);
      await expect(panel.getByTestId('tests-counts')).toHaveText(copy.counts);
      await expect(panel.getByText(copy.failedAt)).toBeVisible();
      await expect(panel.getByTestId('tests-file')).toHaveCount(4);
      const shot = path.join(screenshotDir, `tests-${locale}.png`);
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach(`tests-${locale}.png`, { path: shot, contentType: 'image/png' });

      await panel.getByTestId('tests-filter-failed').click();
      await expect(panel.getByTestId('tests-file')).toHaveCount(1);
      await panel.getByTestId('tests-filter-all').click();

      const failed = panel.locator('[data-testid="tests-case"][data-status="failed"]');
      await failed.hover();
      await failed.getByTestId('tests-run-test').click();
      await expect(panel.getByTestId('tests-stop')).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-project-tests-complete')));
      await expect(panel.getByTestId('tests-counts')).toHaveText(copy.fixed);

      await panel.getByRole('button', { name: copy.show }).click();
      await expect(panel.getByTestId('tests-output')).toContainText('first\nwarning\nlast');
      expect(consoleErrors).toEqual([]);
    });

    test(`${locale} empty state with recent projects`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: 1280, height: 520 });
      await page.goto(`/?e2e=project-tests&locale=${locale}&state=no-project`);
      const panel = page.getByTestId('tests-panel');
      await expect(panel.getByText(copy.noProject)).toBeVisible();
      await expect(panel.getByTestId('tests-recent-project')).toHaveCount(3);
      await expect(panel.getByTestId('tests-recent-project').first()).toContainText('Vitest');
      const shot = path.join(screenshotDir, `tests-empty-${locale}.png`);
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach(`tests-empty-${locale}.png`, { path: shot, contentType: 'image/png' });
    });
  }
});

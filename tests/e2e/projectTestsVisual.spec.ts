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
    ['en', { numeral: '4of 5 passed', fixedNumeral: '5of 5 passed', failedAt: 'Failed at line 10', counts: '1 failed· 1 skipped · Vitest · 4 files · 842 ms', fixed: 'Passed· 1 skipped · Vitest · 4 files · 12 ms', show: 'Show output', noProject: 'Open a project to see its tests' }],
    ['es', { numeral: '4de 5 aprobadas', fixedNumeral: '5de 5 aprobadas', failedAt: 'Falló en la línea 10', counts: '1 fallida· 1 omitida · Vitest · 4 archivos · 842 ms', fixed: 'Aprobadas· 1 omitida · Vitest · 4 archivos · 12 ms', show: 'Mostrar salida', noProject: 'Abre un proyecto para ver sus pruebas' }],
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
      await expect(page.getByTestId('tests-meter-numeral')).toHaveText(copy.numeral);
      await expect(page.getByTestId('tests-counts')).toHaveText(copy.counts);
      await expect(panel.getByText(copy.failedAt)).toBeVisible();
      await expect(panel.getByTestId('tests-file')).toHaveCount(4);
      const shot = path.join(screenshotDir, `tests-${locale}.png`);
      await page.screenshot({ path: shot, animations: 'disabled' });
      await testInfo.attach(`tests-${locale}.png`, { path: shot, contentType: 'image/png' });

      await page.getByTestId('tests-filter-failed').click();
      await expect(panel.getByTestId('tests-file')).toHaveCount(1);
      await page.getByTestId('tests-filter-all').click();

      const failed = panel.locator('[data-testid="tests-case"][data-status="failed"]');
      await failed.hover();
      await failed.getByTestId('tests-run-test').click();
      await expect(page.getByTestId('tests-stop')).toBeVisible();
      await page.evaluate(() => window.dispatchEvent(new Event('e2e-project-tests-complete')));
      await expect(page.getByTestId('tests-counts')).toHaveText(copy.fixed);
      await expect(page.getByTestId('tests-meter-numeral')).toHaveText(copy.fixedNumeral);

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

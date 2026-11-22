/**
 * Run trace and changes since the previous run: a paid Record run draws the
 * line at each step beside the Console tape, and a second run marks the
 * answers that moved.
 */
import type { Page } from '@playwright/test';
import { expect, gotoApp, replaceEditorText, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

const code = (last: number) =>
  ['let total = 0;', `const values = [1, 2, ${last}];`, 'for (const v of values) {', 'total += v;', 'console.log(total);', '}', 'console.log(values);'].join('\n');

async function record(page: Page, last: number): Promise<void> {
  await replaceEditorText(page, code(last));
  await page.getByTestId('action-pill-run-menu').click();
  await page.getByTestId('action-pill-record').click();
  await waitForRunCompleted(page);
}

async function showConsole(page: Page, name: RegExp): Promise<void> {
  await page.getByRole('tab', { name }).first().click();
}

test.describe('Run trace and changes since the last run', () => {
  for (const language of ['en', 'es'] as const) {
    test(`draws the trace, opens the Timeline and marks changed answers (${language})`, async ({ page }) => {
      await page.setViewportSize({ width: 1600, height: 1000 });
      await seedSession(page, { language, primeProLicense: true, workflowModeDefaultsByLanguage: { javascript: 'run' } });
      await gotoApp(page);
      await record(page, 3);
      await record(page, 4);
      await showConsole(page, language === 'en' ? /^Console/ : /^Consola/);

      const trace = page.getByTestId('run-trace');
      await expect(trace).toBeVisible();
      await expect(trace).toContainText(language === 'en' ? 'Where the run has been' : 'Por dónde pasó la ejecución');
      await expect(page.getByTestId('run-trace-loop')).toHaveCount(3);
      await expect(page.getByTestId('run-trace-slowest')).toContainText(/^L\d+ /);

      const delta = page.getByTestId('answer-delta').filter({ hasText: '[2]' });
      await expect(delta).toBeVisible();
      await expect(delta.locator('s')).toContainText('3');
      await expect(delta).toContainText('→ 4');
      const toggle = page.getByTestId('answer-column-header-changes');
      await expect(toggle).toContainText(language === 'en' ? 'Changes since run 1' : 'Cambios desde la ejecución 1');
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await expect(page.getByTestId('answer-delta')).toHaveCount(0);

      await page.getByTestId('run-trace-chart').click({ position: { x: 40, y: 60 } });
      await expect(page.getByTestId('timeline-panel')).toBeVisible();
      await expect(page.getByTestId('timeline-current')).toContainText(language === 'en' ? 'current step 1 ·' : 'paso actual 1 ·');
    });
  }

  test('Free shows the tape without the trace', async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await seedSession(page, { language: 'en', primeProLicense: false, workflowModeDefaultsByLanguage: { javascript: 'run' } });
    await gotoApp(page);
    await record(page, 3);
    await showConsole(page, /^Console/);
    await expect(page.getByTestId('console-entry-row').first()).toBeVisible();
    await expect(page.getByTestId('run-trace')).toHaveCount(0);
  });
});

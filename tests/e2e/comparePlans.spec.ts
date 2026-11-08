/**
 * Pro in context: the license pill and PRO chips open one Compare plans
 * table, and the trial moves up in Settings › Account.
 */
import type { Page } from '@playwright/test';
import { expect, gotoApp, replaceEditorText, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

async function seed(page: Page, language: 'en' | 'es'): Promise<void> {
  await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run' } });
  await gotoApp(page);
}

for (const language of ['en', 'es'] as const) {
  test(`Free opens Compare plans from the license pill and starts a trial from Account (${language})`, async ({ page }) => {
    await seed(page, language);
    await page.getByTestId('license-badge').click();

    const plans = page.getByTestId('compare-plans');
    await expect(plans).toBeVisible();
    await expect(page.getByTestId('compare-plans-row-tabs')).toContainText('3');
    await expect(page.getByTestId('compare-plans-row-timeline')).toContainText(language === 'en' ? '5,000 steps' : '5000 pasos');
    await expect(page.getByTestId('compare-plans-trial')).toContainText(language === 'en' ? 'Try Pro for 14 days' : 'Prueba Pro durante 14 días');

    await page.getByTestId('compare-plans-start-trial').click();
    await expect(plans).toHaveCount(0);
    await expect(page.getByTestId('trial-email-input')).toBeVisible();
  });
}

test('the timeline PRO chip opens Compare plans', async ({ page }) => {
  await seed(page, 'en');
  await replaceEditorText(page, 'let total = 0;\nfor (let i = 0; i < 30; i++) { total += i; }\nconsole.log(total);');
  await page.getByTestId('action-pill-run-menu').click();
  await page.getByTestId('action-pill-record').click();
  await waitForRunCompleted(page);
  await page.getByTestId('timeline-limited').getByTestId('pro-chip').click();
  await expect(page.getByTestId('compare-plans')).toBeVisible();
});


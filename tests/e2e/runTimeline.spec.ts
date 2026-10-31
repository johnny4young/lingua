/**
 * Execution timeline: Record run keeps every step, the Timeline tab replays
 * it, and the editor follows the selected step.
 */
import type { Page } from '@playwright/test';
import { expect, gotoApp, replaceEditorText, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

const CODE = [
  'function double(n) { const twice = n * 2; return twice; }',
  'let total = 0;',
  'for (const v of [1, 2, 3]) { total += double(v); }',
  'console.log("total", total);',
].join('\n');

async function seedTimeline(page: Page, language: 'en' | 'es', pro: boolean): Promise<void> {
  await seedSession(page, { language, primeProLicense: pro, workflowModeDefaultsByLanguage: { javascript: 'run' } });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { runTimeline: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
}

async function recordRun(page: Page): Promise<void> {
  await replaceEditorText(page, CODE);
  await page.getByTestId('action-pill-run-menu').click();
  await page.getByTestId('action-pill-record').click();
  await waitForRunCompleted(page);
}

test.describe('Execution timeline', () => {
  for (const language of ['en', 'es'] as const) {
    test(`records a run and replays it step by step (${language})`, async ({ page }) => {
      await seedTimeline(page, language, true);
      await gotoApp(page);
      await recordRun(page);

      const panel = page.getByTestId('timeline-panel');
      await expect(panel).toBeVisible();
      await expect(page.getByTestId('timeline-summary')).toHaveText(language === 'en' ? '12 steps · recorded' : '12 pasos · grabados');
      await expect(page.getByTestId('timeline-current')).toContainText(language === 'en' ? 'current step 12 · line 4' : 'paso actual 12 · línea 4');
      await expect(page.locator('.lingua-timeline-line')).toHaveCount(1);

      await page.getByTestId('timeline-strip').press('Home');
      await expect(page.getByTestId('timeline-current')).toContainText(language === 'en' ? 'current step 1 · line 2' : 'paso actual 1 · línea 2');
      await page.getByTestId('timeline-strip').press('ArrowRight');
      await page.getByTestId('timeline-strip').press('ArrowRight');
      await page.getByTestId('timeline-strip').press('ArrowRight');
      await expect(page.getByTestId('timeline-stack')).toContainText('double :1');
      await expect(page.getByTestId('timeline-watches')).toContainText('n1');
    });
  }

  test('Free keeps the last 20 steps', async ({ page }) => {
    await seedTimeline(page, 'en', false);
    await gotoApp(page);
    await replaceEditorText(page, 'let total = 0;\nfor (let i = 0; i < 30; i++) { total += i; }\nconsole.log(total);');
    await page.getByTestId('action-pill-run-menu').click();
    await page.getByTestId('action-pill-record').click();
    await waitForRunCompleted(page);
    await expect(page.getByTestId('timeline-limited')).toContainText('Free keeps the last 20 of');
  });
});

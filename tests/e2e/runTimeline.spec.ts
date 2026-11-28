/**
 * Execution timeline: Record run keeps every step, the Timeline tab replays
 * it, and the editor follows the selected step.
 */
import type { Page } from '@playwright/test';
import { dismissWhatsNew, expect, gotoApp, replaceEditorText, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

const CODE = [
  'function double(n) { const twice = n * 2; return twice; }',
  'let total = 0;',
  'for (const v of [1, 2, 3]) { total += double(v); }',
  'console.log("total", total);',
].join('\n');

async function seedTimeline(page: Page, language: 'en' | 'es', pro: boolean): Promise<void> {
  await seedSession(page, { language, primeProLicense: pro, workflowModeDefaultsByLanguage: { javascript: 'run' } });
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

      await expect(page.getByTestId('timeline-echoes')).toBeVisible();
      await expect(page.locator('.lingua-timeline-value')).toHaveCount(1);
      await page.getByTestId('timeline-out').click();
      await expect(page.getByTestId('timeline-stack')).not.toContainText('double');
      await page.getByTestId('timeline-backOut').click();
      await expect(page.getByTestId('timeline-current')).toContainText(language === 'en' ? 'line 3' : 'línea 3');
    });
  }

  test('lights every line of a recorded statement that spans several, and dots a branch that never ran', async ({ page }) => {
    const code = [
      'const sum = [3, 6, 8]',
      '  .map(n => n * 2)',
      '  .reduce((a, b) => a + b, 0);',
      'if (sum > 100) {',
      '  console.log("big");',
      '}',
      'console.log(',
      '  sum,',
      ');',
    ].join('\n');
    await seedSession(page, {
      language: 'en',
      primeProLicense: true,
      restoreSessionMode: 'always',
      workflowModeDefaultsByLanguage: { javascript: 'run' },
      savedTabs: [{ name: 'spans.js', language: 'javascript', content: code }],
    });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await expect(page.getByRole('button', { name: /spans\.js/ }).first()).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('action-pill-run-menu').click();
    await page.getByTestId('action-pill-record').click();
    await waitForRunCompleted(page);
    await expect(page.getByTestId('timeline-summary')).toHaveText('3 steps · recorded');
    const rail = page.locator('.lingua-rail');
    await expect(rail).toHaveCount(9);
    const states = await rail.evaluateAll(nodes => nodes.map(node => /lingua-rail--([a-z-]+)/.exec(node.className)?.[1]));
    expect(states).toEqual(['answered', 'reached', 'reached', 'answered', 'not-run', 'not-run', 'running', 'reached', 'reached']);
  });

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

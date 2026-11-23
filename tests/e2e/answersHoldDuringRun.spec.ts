/**
 * The answer column keeps the previous run's answers, dimmed and named once,
 * while the next run has not reached their lines; a line edited since that run
 * drops its answer, and the run settling replaces them all.
 */

import type { Page } from '@playwright/test';
import {
  clickRun,
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  replaceEditorText,
  seedSession,
  test,
} from './licenseWeb.helpers';

// Line 7 holds every run for a moment, so the answers below it wait.
const SLOW_CODE = [
  'const api = [38, 41, 35, 44, 39, 52, 37];',
  'const worker = [12, 14, 11, 13, 19, 12, 11];',
  'const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;',
  'const apiAvg = avg(api);',
  'const workerAvg = avg(worker);',
  'const start = Date.now();',
  'while (Date.now() - start < 2500);',
  "const slowest = apiAvg > workerAvg ? 'api' : 'worker';",
  'console.log(`slowest path: ${slowest}`);',
].join('\n');

const KEPT_TAG = { en: 'from run 1 · not reached yet', es: 'de la ejecución 1 · aún sin alcanzar' };

async function enableAutoLog(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const raw = window.localStorage.getItem('lingua-settings');
    const parsed = raw ? JSON.parse(raw) : { state: {}, version: 0 };
    parsed.state = parsed.state ?? {};
    parsed.state.scratchpadAutoLogByLanguage = { javascript: true, typescript: true, python: true };
    window.localStorage.setItem('lingua-settings', JSON.stringify(parsed));
  });
}

const autoRunSettled = (page: Page) => page.evaluate(() => window.__linguaE2e?.autoRunSettled?.() ?? true);

async function openSlowScratchpad(page: Page, language: 'en' | 'es') {
  await seedSession(page, { language });
  await enableAutoLog(page);
  await gotoApp(page);
  await dismissWhatsNew(page);
  await createJavaScriptTab(page);
  await replaceEditorText(page, SLOW_CODE);
  const line = (n: number) => page.locator(`[data-testid="lingua-inline-result"][data-line="${n}"]`);
  await expect(line(9)).toBeAttached({ timeout: 30_000 });
  await expect.poll(() => autoRunSettled(page), { timeout: 30_000 }).toBe(true);
  return line;
}

for (const language of ['en', 'es'] as const) {
  test(`a Scratchpad edit keeps the other answers until the run reaches them (${language})`, async ({ page }) => {
    const line = await openSlowScratchpad(page, language);
    await expect(page.getByTestId('answer-column-header-run')).toBeVisible();

    // Edit the worker list: its answer goes, the rest wait for the run.
    await page.locator('.monaco-editor .view-line').nth(1).click();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.insertText(', 90');
    await expect.poll(() => autoRunSettled(page), { timeout: 10_000, intervals: [50] }).toBe(false);

    await expect(line(1)).toHaveAttribute('data-kept', '');
    await expect(line(9)).toHaveAttribute('data-kept', '');
    await expect(line(2)).toHaveCount(0);
    const tags = page.getByTestId('lingua-inline-result-kept');
    await expect(tags).toHaveCount(1);
    await expect(line(1).getByTestId('lingua-inline-result-kept')).toHaveText(KEPT_TAG[language]);
    await expect(page.getByTestId('answer-column-header-run')).toBeVisible();

    await expect.poll(() => autoRunSettled(page), { timeout: 30_000 }).toBe(true);
    await expect(page.locator('[data-testid="lingua-inline-result"][data-kept]')).toHaveCount(0);
    await expect(line(2)).toContainText('array·8');
  });
}

test('a manual run keeps the previous answers dimmed until it publishes', async ({ page }) => {
  const line = await openSlowScratchpad(page, 'en');
  await clickRun(page);
  await expect(page.getByTestId('action-pill-run')).toHaveAttribute('data-running', 'true');
  await expect(line(4)).toHaveAttribute('data-kept', '');
  await expect(line(1).getByTestId('lingua-inline-result-kept')).toHaveText(KEPT_TAG.en);
  await expect(page.getByTestId('action-pill-run')).toHaveAttribute('data-running', 'false', { timeout: 30_000 });
  await expect(page.locator('[data-testid="lingua-inline-result"][data-kept]')).toHaveCount(0);
  await expect(line(9)).toContainText('slowest path: api');
});

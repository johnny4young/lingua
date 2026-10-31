/**
 * Run state: results from older code are marked stale until the next run,
 * and Cmd/Ctrl+. stops a run from inside the editor.
 */
import type { Page } from '@playwright/test';
import { clickRun, expect, gotoApp, replaceEditorText, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

async function seedRunState(page: Page, language: 'en' | 'es'): Promise<void> {
  await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run' } });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { runState: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
}

test.describe('Run state', () => {
  for (const language of ['en', 'es'] as const) {
    test(`marks results stale after an edit and clears on the next run (${language})`, async ({ page }) => {
      await seedRunState(page, language);
      await gotoApp(page);
      await replaceEditorText(page, 'const total = [42, 87, 120].reduce((a, b) => a + b, 0);\ntotal //=>');
      await clickRun(page);
      await waitForRunCompleted(page);
      const editor = page.getByTestId('editor-run-state');
      await expect(editor).not.toHaveAttribute('data-stale', 'true');

      await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
      await page.keyboard.press('End');
      await page.keyboard.insertText(' ');
      await expect(editor).toHaveAttribute('data-stale', 'true');
      await expect(page.getByTestId('run-stale-pill')).toContainText(language === 'en' ? 'Stale' : 'Desactualizado');
      await expect(page.getByTestId('action-pill-run')).toHaveAttribute('data-stale', 'true');

      await clickRun(page);
      await waitForRunCompleted(page);
      await expect(editor).not.toHaveAttribute('data-stale', 'true');
      await expect(page.getByTestId('run-stale-pill')).toHaveCount(0);
    });
  }

  test('Cmd/Ctrl+. stops a run from inside the editor', async ({ page }) => {
    await seedRunState(page, 'en');
    await gotoApp(page);
    await replaceEditorText(page, 'for (;;) ;');
    await clickRun(page);
    const run = page.getByTestId('action-pill-run');
    await expect(run).toHaveAttribute('data-running', 'true');
    await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
    await page.keyboard.press('ControlOrMeta+Period');
    await expect(run).toHaveAttribute('data-running', 'false', { timeout: 10_000 });
  });
});

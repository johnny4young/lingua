/**
 * Compare runs in the Compare tab: runs listed by day, the two newest of the
 * active tab compared on open, and Restore as new tab never overwriting.
 */
import type { Page } from '@playwright/test';
import { clickRun, expect, gotoApp, replaceEditorText, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

async function seedRunCompare(page: Page, language: 'en' | 'es', pro: boolean): Promise<void> {
  await seedSession(page, { language, primeProLicense: pro, workflowModeDefaultsByLanguage: { javascript: 'run' } });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { runCompare: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
}

async function run(page: Page, source: string): Promise<void> {
  await replaceEditorText(page, source);
  await clickRun(page);
  await waitForRunCompleted(page);
}

test.describe('Compare runs', () => {
  for (const language of ['en', 'es'] as const) {
    test(`compares the last two runs and restores the earlier one (${language})`, async ({ page }) => {
      await seedRunCompare(page, language, true);
      await gotoApp(page);
      await run(page, "console.log('runCompare-one')");
      await run(page, "console.log('runCompare-two')");

      await page.keyboard.press('ControlOrMeta+Shift+D');
      const runCompare = page.getByTestId('run-compare');
      await expect(runCompare).toBeVisible();
      await expect(page.getByTestId('run-compare-row')).toHaveCount(2);
      await expect(page.getByTestId('run-compare-selected')).toHaveText(language === 'en' ? '2 selected' : '2 seleccionadas');
      await expect(page.getByTestId('run-compare-code')).toContainText("+ console.log('runCompare-two')");
      await expect(page.getByTestId('run-compare-stdout')).toContainText('- runCompare-one');
      await expect(page.getByTestId('run-compare-exit')).toContainText('ok → ok');

      const tabs = page.getByTestId('editor-tab-filename');
      const before = await tabs.count();
      await page.getByTestId('run-compare-restore').click();
      await expect(tabs).toHaveCount(before + 1);
      await expect(tabs.last()).toContainText(' · ');
    });
  }

  test('keeps the snapshot Compare on the Free tier', async ({ page }) => {
    await seedRunCompare(page, 'en', false);
    await gotoApp(page);
    await run(page, "console.log('free-one')");
    await run(page, "console.log('free-two')");
    await page.keyboard.press('ControlOrMeta+Shift+D');
    await expect(page.getByTestId('compare-results-panel')).toBeVisible();
    await expect(page.getByTestId('run-compare')).toHaveCount(0);
  });
});

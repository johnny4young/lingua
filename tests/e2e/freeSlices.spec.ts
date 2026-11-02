/**
 * Labs › Pro in context on Free: recent runs, utility pipelines and the capsule
 * gate show a real, limited slice with a PRO chip instead of a lock.
 */
import type { Page } from '@playwright/test';
import { clickRun, expect, gotoApp, replaceEditorText, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

async function seed(page: Page, language: 'en' | 'es', flag: boolean): Promise<void> {
  await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run' } });
  await page.addInitScript(on => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = on ? { teachingPaywall: true } : {};
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  }, flag);
  await gotoApp(page);
}

for (const language of ['en', 'es'] as const) {
  test(`recent runs show the last three on Free (${language})`, async ({ page }) => {
    await seed(page, language, true);
    for (let run = 0; run < 4; run += 1) {
      await replaceEditorText(page, `console.log(${run});`);
      await clickRun(page);
      await waitForRunCompleted(page);
    }
    await page.getByTestId('recent-runs-pill').click();
    const popover = page.getByTestId('recent-runs-popover');
    await expect(popover).toBeInViewport({ ratio: 1 });
    await expect(popover.locator('li')).toHaveCount(3);
    await expect(page.getByTestId('recent-runs-free-slice')).toContainText(
      language === 'en' ? 'Free shows the last 3 of 4' : 'Gratis muestra las últimas 3 de 4'
    );
    await page.getByTestId('recent-runs-free-slice').getByTestId('pro-chip').click();
    await expect(page.getByTestId('compare-plans')).toBeVisible();
  });
}

test('utility pipelines run the first three steps on Free', async ({ page }) => {
  await seed(page, 'en', true);
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(page.getByTestId('utility-pipeline-locked')).toHaveCount(0);
  await page.locator('[data-testid="pipeline-template-use"][data-template-id="decode-jwt"]').click();
  const rows = page.getByTestId('utility-pipeline-step-row');
  await expect(rows).toHaveCount(1);
  for (const count of [2, 3, 4]) {
    await page.getByTestId('utility-pipeline-editor-add-step').click();
    await expect(rows).toHaveCount(count);
  }
  await expect(page.getByTestId('utility-pipeline-step-beyond')).toHaveCount(1);
  await expect(page.getByTestId('utility-pipeline-free-slice')).toContainText('Free runs the first 3 steps');
  await page.getByTestId('utility-pipeline-editor-run').click();
  await expect(page.getByTestId('utility-pipeline-result-row')).toHaveCount(3);
});

test('the capsule gate shows a PRO chip instead of the upgrade button', async ({ page }) => {
  await seed(page, 'en', true);
  await page.keyboard.press('ControlOrMeta+Alt+C');
  await expect(page.getByTestId('capsule-list-free-slice')).toBeVisible();
  await expect(page.getByTestId('capsule-list-upsell-cta')).toHaveCount(0);
});

test('without the flag Free keeps the locks', async ({ page }) => {
  await seed(page, 'en', false);
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(page.getByTestId('utility-pipeline-panel')).toHaveCount(0);
  await expect(page.getByTestId('recent-runs-pill')).toHaveCount(0);
});

/**
 * Compare-with-last-stable end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - Clean JS run captures the snapshot; editing produces a
 *     different output; the dock's Compare tab appears and renders
 *     the diff.
 *   - The tab is absent before the first successful run.
 */

import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  replaceEditorAndWaitForAutoRun,
  test,
} from './licenseWeb.helpers';

test.describe('compare with last stable run ', () => {
  test('the Compare tab is absent until the first clean run captures a snapshot', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await expect(page.getByTestId('bottom-panel-console-tab')).toBeVisible();
    await expect(page.getByTestId('bottom-panel-compare-tab')).toHaveCount(0);
  });

  test('clean run + diverging edit lights up Compare and renders the diff', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorAndWaitForAutoRun(page, 'console.log("compare-result-2", 2)', 'compare-result-2');

    const tab = page.getByTestId('bottom-panel-compare-tab');
    await expect(tab).toBeVisible();
    await expect(tab).toHaveAttribute('aria-selected', 'false');

    await replaceEditorAndWaitForAutoRun(page, 'console.log("compare-result-4", 4)', 'compare-result-4');

    await tab.click();
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(
      page.locator('[data-testid="compare-results-panel"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="compare-row-changed"]').first()
    ).toBeVisible();
  });

  test('Cmd/Ctrl+Shift+D opens Compare in the dock and returns to Console', async ({ page }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await replaceEditorAndWaitForAutoRun(page, 'console.log("compare-a", 1)', 'compare-a');
    await replaceEditorAndWaitForAutoRun(page, 'console.log("compare-b", 2)', 'compare-b');

    await page.keyboard.press('ControlOrMeta+Shift+D');
    await expect(page.getByTestId('bottom-panel-compare-tab')).toHaveAttribute('aria-selected', 'true');
    // One line at full width; a wrapped header measured over 70 px in the old column.
    const header = page.locator('[data-testid="compare-results-panel"] > *').first();
    expect((await header.boundingBox())?.height ?? 99).toBeLessThan(56);

    await page.keyboard.press('ControlOrMeta+Shift+D');
    await expect(page.getByTestId('bottom-panel-console-tab')).toHaveAttribute('aria-selected', 'true');
  });
});

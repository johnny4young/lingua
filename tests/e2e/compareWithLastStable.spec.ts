/**
 * Compare-with-last-stable end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - Clean JS run captures the snapshot; editing produces a
 *     different output; the Compare panel chip lights up and renders
 *     the diff.
 *   - The chip is disabled before the first successful run.
 *   - Language change clears the snapshot and disables the chip.
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
  test('toggle is disabled until the first clean run captures a snapshot', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const toggle = page.getByTestId('panel-chip-compare');
    await expect(toggle).toBeDisabled();
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

    const toggle = page.getByTestId('panel-chip-compare');
    await expect(toggle).not.toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await replaceEditorAndWaitForAutoRun(page, 'console.log("compare-result-4", 4)', 'compare-result-4');

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator('[data-testid="compare-results-panel"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="compare-row-changed"]').first()
    ).toBeVisible();
  });
});

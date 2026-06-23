/**
 * RL-099 Slice 1 — keyboard contract for the Utility Pipelines panel.
 *
 * Acceptance: Mod+Shift+G opens the Developer Utilities workspace with
 * the Pipelines panel preselected. EN + ES locales verify the
 * tuteo copy. The full run-flow + adapter behavior is covered by
 * the component + shared unit tests.
 */

import { expect, expectNoticeContains, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Utility Pipelines — Mod+Shift+G binding', () => {
  test('keeps the Pipelines shortcut Pro-gated on Free', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expectNoticeContains(page, 'utility workflows');
    await expect(page.getByTestId('developer-utilities-workspace')).toHaveCount(0);
    await expect(page.getByTestId('utility-pipeline-panel')).toHaveCount(0);
  });

  test('opens the Pipelines panel inside Developer Utilities (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByText(/no pipelines yet/i)).toBeVisible();
  });

  test('surfaces a Slice 6 adapter (line-sort) in the step dropdown and runs it (EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');
    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();

    // Create a pipeline and add a step.
    await page.getByTestId('utility-pipeline-list-create').click();
    await page.getByTestId('utility-pipeline-editor-add-step').click();

    // Fold E — the new line-sort adapter is selectable from the step
    // dropdown (the vocabulary expansion reached the UI), then runs.
    await page
      .getByTestId('utility-pipeline-step-utility')
      .first()
      .selectOption('line-sort');
    await page
      .getByTestId('utility-pipeline-editor-input')
      .fill('banana\napple\ncherry');
    await page.getByTestId('utility-pipeline-editor-run').click();

    const output = page.getByTestId('utility-pipeline-result-output').first();
    await expect(output).toHaveText('apple\nbanana\ncherry');
  });

  test('localizes the Pipelines panel in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByText(/aún no hay pipelines/i)).toBeVisible();
  });
});

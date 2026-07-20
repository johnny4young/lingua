/**
 * implementation — keyboard contract for the Utility Pipelines panel.
 *
 * Acceptance: Mod+Shift+G opens the Developer Utilities workspace with
 * the Pipelines panel preselected. EN + ES locales verify the
 * tuteo copy. The full run-flow + adapter behavior is covered by
 * the component + shared unit tests.
 */

import { mkdirSync } from 'node:fs';
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

  test('surfaces a implementation adapter (line-sort) in the step dropdown and runs it (EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');
    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();

    // Create a pipeline and add a step.
    await page.getByTestId('utility-pipeline-list-create').click();
    await page.getByTestId('utility-pipeline-editor-add-step').click();

    // implementation note — the new line-sort adapter is selectable from the step
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
    await expect
      .poll(() =>
        page.evaluate(() =>
          performance
            .getEntriesByType('resource')
            .some((entry) => entry.name.includes('utility-compute-worker'))
        )
      )
      .toBe(true);
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/project-sequence/t07-performance', { recursive: true });
      await page.screenshot({
        path: 'output/review/project-sequence/t07-performance/web-en-pipeline-worker.png',
      });
    }
  });

  test('runs a generator (lorem-ipsum) feeding a transform (text-stats) (EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');
    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();

    await page.getByTestId('utility-pipeline-list-create').click();

    // Step 1 — a implementation generator: it ignores the chained input and
    // emits placeholder text (source-step semantics).
    await page.getByTestId('utility-pipeline-editor-add-step').click();
    await page
      .getByTestId('utility-pipeline-step-utility')
      .first()
      .selectOption('lorem-ipsum');

    // Step 2 — a transform that consumes the generator's output.
    await page.getByTestId('utility-pipeline-editor-add-step').click();
    await page
      .getByTestId('utility-pipeline-step-utility')
      .nth(1)
      .selectOption('text-stats');

    // Input is intentionally left blank: the generator is the source, so
    // the downstream text-stats still reports a non-empty word count.
    await page.getByTestId('utility-pipeline-editor-run').click();

    const output = page.getByTestId('utility-pipeline-result-output').last();
    await expect(output).toContainText('Words:');
  });

  test('localizes the Pipelines panel in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByText(/aún no hay pipelines/i)).toBeVisible();
  });
});

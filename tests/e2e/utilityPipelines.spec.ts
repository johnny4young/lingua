/**
 * Keyboard contract for the Utility Pipelines panel.
 *
 * Acceptance: Mod+Shift+G opens the Developer Utilities workspace with
 * the Pipelines panel preselected. EN + ES locales verify the
 * tuteo copy. The full run-flow + adapter behavior is covered by
 * the component + shared unit tests.
 */

import { mkdirSync } from 'node:fs';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Utility Pipelines — Mod+Shift+G binding', () => {
  test('opens the Pipelines panel on Free, with no upgrade notice', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByTestId('status-notice-banner')).toHaveCount(0);
  });

  test('opens the Pipelines panel inside Developer Utilities (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByText(/no pipelines yet/i)).toBeVisible();
  });

  test('surfaces a newer adapter (line-sort) in the step dropdown and runs it (EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Shift+G');
    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();

    // Create a pipeline and add a step.
    await page.getByTestId('utility-pipeline-list-create').click();
    await page.getByTestId('utility-pipeline-editor-add-step').click();

    // The new line-sort adapter is selectable from the step
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

    // Step 1 — a generator: it ignores the chained input and
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

  for (const width of [1100, 1440]) {
    test(`keeps a held run's results and footer on screen at ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedSession(page, { language: 'en', primeProLicense: true });
      await page.addInitScript(() => {
        if (window.localStorage.getItem('lingua-utility-pipeline-state')) return;
        const now = new Date().toISOString();
        const pipeline = {
          version: 1,
          id: 'p-fit',
          name: 'fit',
          createdAt: now,
          updatedAt: now,
          steps: [
            { id: 's1', utilityId: 'base64-decode', options: {} },
            { id: 's2', utilityId: 'json-format', options: {}, breakpoint: true },
            { id: 's3', utilityId: 'hash', options: {} },
            { id: 's4', utilityId: 'base64-encode', options: {}, disabled: true },
          ],
        };
        window.localStorage.setItem(
          'lingua-utility-pipeline-state',
          JSON.stringify({ state: { pipelines: [pipeline], activePipelineId: 'p-fit' }, version: 1 })
        );
      });
      await gotoApp(page);
      await page.keyboard.press('ControlOrMeta+Shift+G');
      await page.getByTestId('utility-pipeline-editor-input').fill('eyJhIjoxfQ==');
      await page.getByTestId('utility-pipeline-editor-run').click();
      await expect(page.getByTestId('utility-pipeline-continue')).toBeVisible();

      const rows = page.getByTestId('utility-pipeline-result-row');
      await expect(rows).toHaveCount(4);
      for (const row of await rows.all()) await expect(row).toBeInViewport({ ratio: 1 });
      await expect(page.getByTestId('utility-pipeline-continue')).toBeInViewport({ ratio: 1 });
      // The run footer sits at the bottom of Results, below the last row.
      const summary = page.getByTestId('utility-pipeline-run-summary');
      await expect(summary).toBeInViewport({ ratio: 1 });
      const results = await page.getByTestId('utility-pipeline-result').boundingBox();
      const summaryBox = await summary.boundingBox();
      expect(results && summaryBox && results.y + results.height - (summaryBox.y + summaryBox.height)).toBeLessThan(2);
      // Steps and Results share a row; the library sits above them below the widest tier.
      const steps = await page.getByTestId('utility-pipeline-editor').boundingBox();
      expect(steps && results && steps.x + steps.width <= results.x).toBe(true);
      // Every step card keeps its controls on the header row, beside the utility select.
      for (const card of await page.getByTestId('utility-pipeline-step-row').all()) {
        const select = await card.getByTestId('utility-pipeline-step-utility').boundingBox();
        const remove = await card.getByTestId('utility-pipeline-step-delete').boundingBox();
        expect(select && remove && Math.abs(select.y + select.height / 2 - (remove.y + remove.height / 2))).toBeLessThan(2);
      }
    });
  }

  test('keeps step controls on the header row and the utility readable at 375 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await seedSession(page, { language: 'es', primeProLicense: true });
    await page.addInitScript(() => {
      if (window.localStorage.getItem('lingua-utility-pipeline-state')) return;
      const now = new Date().toISOString();
      const pipeline = {
        version: 1,
        id: 'p-narrow',
        name: 'narrow',
        createdAt: now,
        updatedAt: now,
        steps: [{ id: 's1', utilityId: 'base64-decode', options: {} }],
      };
      window.localStorage.setItem(
        'lingua-utility-pipeline-state',
        JSON.stringify({ state: { pipelines: [pipeline], activePipelineId: 'p-narrow' }, version: 1 })
      );
    });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Shift+G');
    const card = page.getByTestId('utility-pipeline-step-row');
    const grip = await card.getByRole('button', { name: 'Reordenar paso 1' }).boundingBox();
    const remove = await card.getByTestId('utility-pipeline-step-delete').boundingBox();
    const select = await card.getByTestId('utility-pipeline-step-utility').boundingBox();
    expect(grip && remove && Math.abs(grip.y + grip.height / 2 - (remove.y + remove.height / 2))).toBeLessThan(3);
    expect(select && select.width).toBeGreaterThan(180);
  });

  test('holds at a breakpoint with Continue as the verb and readable rows (ES)', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedSession(page, { language: 'es', primeProLicense: true });
    await page.addInitScript(() => {
      if (window.localStorage.getItem('lingua-utility-pipeline-state')) return;
      const now = new Date().toISOString();
      const pipeline = {
        version: 1,
        id: 'p-held',
        name: 'held',
        createdAt: now,
        updatedAt: now,
        steps: [
          { id: 's1', utilityId: 'base64-decode', options: {}, breakpoint: true },
          { id: 's2', utilityId: 'hash', options: {} },
          { id: 's3', utilityId: 'base64-encode', options: {}, disabled: true },
        ],
      };
      window.localStorage.setItem(
        'lingua-utility-pipeline-state',
        JSON.stringify({ state: { pipelines: [pipeline], activePipelineId: 'p-held' }, version: 1 })
      );
    });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Shift+G');
    await page.getByTestId('utility-pipeline-editor-input').fill('eyJhIjoxfQ==');
    await page.getByTestId('utility-pipeline-editor-run').click();
    await expect(page.getByTestId('utility-pipeline-continue')).toBeVisible();
    await expect(page.getByTestId('utility-pipeline-editor-run')).toHaveAttribute('data-verb', 'continue');
    await expect(page.getByTestId('utility-pipeline-editor-run')).toContainText('Continuar');

    for (const status of ['paused', 'disabled']) {
      const row = page.locator(`[data-testid="utility-pipeline-result-row"][data-status="${status}"]`).first();
      const tag = await row.locator('.utility-step-tag').boundingBox();
      const hint = row.locator('.utility-step-hint');
      const hintBox = await hint.boundingBox();
      expect(tag && hintBox && tag.x + tag.width <= hintBox.x).toBe(true);
      // The hint wraps rather than being cut.
      expect(await hint.evaluate((node) => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    }
  });
});

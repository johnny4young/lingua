/**
 * RL-100 Slice 1 — e2e for the global Import overlay.
 *
 * Acceptance: Mod+Alt+I opens the Import overlay from anywhere. EN
 * + ES locales render with tuteo copy. The full preview + confirm
 * flow is covered by the component test; the e2e pin focuses on
 * the keyboard binding + the locale-correct title.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Import overlay — Mod+Alt+I binding (RL-100 Slice 1)', () => {
  test('opens via Mod+Alt+I (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();
    await expect(page.getByText(/import data/i)).toBeVisible();
  });

  test('localizes the overlay in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await expect(page.getByTestId('import-preview-overlay')).toBeVisible();
    await expect(page.getByText(/importa datos/i)).toBeVisible();
  });

  test('pasting a Jupyter `.ipynb` payload previews the notebook (RL-100 Slice 2, EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    const overlay = page.getByTestId('import-preview-overlay');
    await expect(overlay).toBeVisible();

    const ipynbPayload = JSON.stringify({
      nbformat: 4,
      nbformat_minor: 5,
      metadata: { kernelspec: { language: 'python' } },
      cells: [
        { cell_type: 'markdown', source: ['# E2E hello'] },
        { cell_type: 'code', source: ["print('hi')"], outputs: [] },
      ],
    });

    await page.getByTestId('import-preview-paste').fill(ipynbPayload);

    // Notebook preview band lights up with the summary chip + cell snippets.
    await expect(
      page.locator('[data-preview-kind="ipynb-notebook"]')
    ).toBeVisible();
    await expect(
      page.getByTestId('import-preview-notebook-summary')
    ).toContainText(/2 cells/);
    // Confirm button label flips to the notebook variant (fold C).
    await expect(page.getByTestId('import-preview-confirm')).toContainText(
      /Import as notebook/i
    );
  });

  test('rejects an .ipynb with nbformat 3 with a localized hint (ES tuteo, RL-100 Slice 2)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+I');

    await page
      .getByTestId('import-preview-paste')
      .fill(JSON.stringify({ nbformat: 3, cells: [] }));

    await expect(page.getByTestId('import-preview-reject')).toBeVisible();
    await expect(
      page.getByTestId('import-preview-reject-ipynb-detail')
    ).toContainText(/formato v4/i);
  });
});

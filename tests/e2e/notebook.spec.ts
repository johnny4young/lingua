/**
 * RL-043 Slice A — Mod+Alt+N opens a new notebook tab + notebook UI
 * responds to the toolbar. Cross-locale (EN + ES tuteo) regression.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

test.describe('Notebook foundation — Mod+Alt+N binding', () => {
  test('opens a fresh notebook tab with seeded cells (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');

    const notebook = page.getByTestId('notebook-view');
    await expect(notebook).toBeVisible();
    // The blank notebook starts with one markdown + one code cell.
    await expect(page.getByTestId('notebook-markdown-cell-row')).toHaveCount(1);
    await expect(page.getByTestId('notebook-code-cell-row')).toHaveCount(1);
    // Toolbar reachable.
    await expect(page.getByTestId('notebook-toolbar-add-code')).toBeVisible();
    await expect(page.getByTestId('notebook-toolbar-add-markdown')).toBeVisible();
  });

  test('localizes the toolbar in Spanish (tuteo)', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');

    await expect(page.getByTestId('notebook-view')).toBeVisible();
    await expect(page.getByTestId('notebook-toolbar-add-code')).toContainText(
      'Agregar código'
    );
    await expect(page.getByTestId('notebook-toolbar-add-markdown')).toContainText(
      'Agregar markdown'
    );
  });

  test('Add code button appends a JS code cell', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    await page.getByTestId('notebook-toolbar-add-code').click();
    await expect(page.getByTestId('notebook-code-cell-row')).toHaveCount(2);
  });
});

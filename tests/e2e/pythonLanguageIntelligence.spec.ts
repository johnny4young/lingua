/**
 * RL-026 Slice 1 — browser smoke for Python language intelligence.
 *
 * The unit tests own parser precision. This spec verifies the Monaco surface
 * mounts the adapter, renders a marker in the real editor, exposes local
 * symbols through the suggest widget, and stays console-clean in EN + ES.
 */

import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

async function createPythonTab(page: import('@playwright/test').Page): Promise<void> {
  await page
    .getByRole('button', { name: /new file language menu|menú de lenguaje para nuevo archivo/i })
    .click();
  await page.getByRole('menuitem', { name: /^Python$/i }).click();
  await expect(page.getByRole('tab', { name: /Py .*\.py/i })).toBeVisible();
}

async function replaceEditorContent(
  page: import('@playwright/test').Page,
  content: string
): Promise<void> {
  await page.locator('.monaco-editor').click({ position: { x: 160, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(content);
}

test.describe('Python language intelligence (RL-026)', () => {
  test('renders diagnostics and symbol-aware completions in English', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await createPythonTab(page);

    await replaceEditorContent(
      page,
      [
        'import pathlib',
        '',
        'class InvoiceBuilder:',
        '    pass',
        '',
        'def compute_total(amount):',
        '    subtotal = amount',
        '    return subtotal',
        '',
        'def broken()',
        '    pass',
        '',
        'comp',
      ].join('\n')
    );

    await expect(page.locator('.monaco-editor .squiggly-error')).toHaveCount(1);

    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget')).toBeVisible();
    await expect(page.locator('.suggest-widget')).toContainText('compute_total');
  });

  test('keeps the Spanish surface console-clean while diagnostics render', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await createPythonTab(page);

    await replaceEditorContent(page, 'if listo()\n    pass');

    await expect(page.locator('.monaco-editor .squiggly-error')).toHaveCount(1);
  });
});

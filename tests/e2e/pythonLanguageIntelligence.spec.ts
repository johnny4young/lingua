/**
 * RL-026 Slice 1 — browser smoke for Python language intelligence.
 *
 * The unit tests own parser precision. This spec verifies the Monaco surface
 * mounts the adapter, renders a marker in the real editor, exposes local
 * symbols through the suggest widget, and stays console-clean in EN + ES.
 */

import {
  createLanguageTab,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

async function createPythonTab(page: import('@playwright/test').Page): Promise<void> {
  await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
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
    await seedSession(page, { language: 'en', primeProLicense: true });
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

    // This is an adapter smoke, not a parser-precision assertion: recovery
    // diagnostics can legitimately expand from the missing colon into the
    // following indented block as analysis settles. Unit tests own the exact
    // diagnostic set; here we only require Monaco to render a real marker.
    await expect(
      page.locator('.monaco-editor .squiggly-error').first()
    ).toBeVisible();

    await page.keyboard.press('Control+Space');
    await expect(page.locator('.suggest-widget')).toBeVisible();
    await expect(page.locator('.suggest-widget')).toContainText('compute_total');
  });

  test('keeps the Spanish surface console-clean while diagnostics render', async ({ page }) => {
    await seedSession(page, { language: 'es', primeProLicense: true });
    await gotoApp(page);
    await createPythonTab(page);

    await replaceEditorContent(page, 'if listo()\n    pass');

    await expect(
      page.locator('.monaco-editor .squiggly-error').first()
    ).toBeVisible();
  });

  test('surfaces hover info for a locally-defined function', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await createPythonTab(page);

    await replaceEditorContent(
      page,
      [
        'def compute_total(amount, tax):',
        '    return amount + tax',
        '',
        'result = compute_total(1, 2)',
      ].join('\n')
    );

    // Park the cursor inside the `compute_total` call on line 4, then ask
    // Monaco to render the hover widget via its `Ctrl+K Ctrl+I` (or
    // `Cmd+K Cmd+I` on macOS) keybinding — the same path the editor's
    // built-in command surfaces. The mouse-dwell trigger is too flaky
    // under Playwright to assert on directly.
    await page.locator('.monaco-editor .view-line').nth(3).click();
    await page.keyboard.press('Home');
    for (let i = 0; i < 12; i += 1) {
      // Walk past "result = " into "compute_total".
      await page.keyboard.press('ArrowRight');
    }

    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    await page.keyboard.press(`${modifier}+K`);
    await page.keyboard.press(`${modifier}+I`);

    const hover = page.locator('.monaco-editor .monaco-hover:not(.hidden)').first();
    await expect(hover).toBeVisible();
    await expect(hover).toContainText('compute_total');
    await expect(hover).toContainText('Function');
    await expect(hover).toContainText('line 1');
  });

  test('surfaces signature help when the cursor sits inside a call', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await createPythonTab(page);

    await replaceEditorContent(
      page,
      [
        'def compute_total(amount, tax):',
        '    return amount + tax',
        '',
        '',
      ].join('\n')
    );

    // Click into the empty line 4 then type a partial call.
    await page.locator('.monaco-editor .view-line').nth(3).click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+End' : 'Control+End');
    await page.keyboard.type('compute_total(', { delay: 20 });

    const signature = page.locator('.parameter-hints-widget');
    await expect(signature).toBeVisible();
    await expect(signature).toContainText('compute_total');
    await expect(signature).toContainText('amount');
    await expect(signature).toContainText('tax');
  });
});

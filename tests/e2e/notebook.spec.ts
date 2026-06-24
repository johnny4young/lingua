/**
 * RL-043 Slice A — Mod+Alt+N opens a new notebook tab + notebook UI
 * responds to the toolbar. Cross-locale (EN + ES tuteo) regression.
 *
 * RL-043 Slice B — real cross-cell variable sharing through the actual
 * JS worker round-trip (no mocked runner). This is the coverage gap
 * that hid the pre-existing bug where the worker serialized the cell's
 * return value to a truncatable display string and the renderer never
 * read the structured `sessionDelta`; the structured-result channel
 * fix is what makes the assertion below pass.
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

test.describe('Notebook — cross-cell variable sharing (Slice B)', () => {
  test('a later cell reads a destructured binding declared by an earlier cell', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    // Cell 1 — a destructuring declaration (the case the column-zero
    // regex could not capture and the AST rewriter now handles).
    const firstRow = page.getByTestId('notebook-code-cell-row').first();
    await firstRow
      .getByTestId('notebook-code-cell-source')
      .fill('const { shared } = { shared: 42 };');
    await firstRow.getByTestId('notebook-code-cell-run').click();
    await expect(firstRow.getByTestId('notebook-code-cell-status')).toContainText(
      'Ok'
    );
    // The variable-flow chip proves the binding was captured into the
    // session sandbox — empty before the structured-result fix.
    await expect(
      firstRow.getByTestId('notebook-code-cell-produces')
    ).toContainText('shared');

    // Cell 2 — read the cross-cell binding through the real worker.
    await page.getByTestId('notebook-toolbar-add-code').click();
    await expect(page.getByTestId('notebook-code-cell-row')).toHaveCount(2);
    const secondRow = page.getByTestId('notebook-code-cell-row').nth(1);
    await secondRow
      .getByTestId('notebook-code-cell-source')
      .fill("console.log('shared is', shared * 2);");
    await secondRow.getByTestId('notebook-code-cell-run').click();
    await expect(
      secondRow.getByTestId('notebook-code-cell-status')
    ).toContainText('Ok');
    // 42 crossed from cell 1; 42 * 2 = 84 proves the value (not just the
    // name) round-tripped losslessly.
    await expect(
      secondRow.getByTestId('notebook-code-cell-outputs')
    ).toContainText('shared is 84');
  });

  test('a serializable binding still crosses when a function is declared beside it', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    // Cell 1 declares serializable data AND a non-cloneable function.
    // The rewriter captures BOTH into `_sessionDelta`; a bare
    // `structuredClone` of the result would throw on the function and drop
    // the WHOLE delta — the JSON cascade keeps `data`, drops `helper`.
    const firstRow = page.getByTestId('notebook-code-cell-row').first();
    await firstRow
      .getByTestId('notebook-code-cell-source')
      .fill('const data = [4, 5, 6];\nfunction helper(n) { return n; }');
    await firstRow.getByTestId('notebook-code-cell-run').click();
    await expect(firstRow.getByTestId('notebook-code-cell-status')).toContainText(
      'Ok'
    );
    await expect(
      firstRow.getByTestId('notebook-code-cell-produces')
    ).toContainText('data');

    await page.getByTestId('notebook-toolbar-add-code').click();
    await expect(page.getByTestId('notebook-code-cell-row')).toHaveCount(2);
    const secondRow = page.getByTestId('notebook-code-cell-row').nth(1);
    await secondRow
      .getByTestId('notebook-code-cell-source')
      .fill("console.log('first is', data[0]);");
    await secondRow.getByTestId('notebook-code-cell-run').click();
    await expect(
      secondRow.getByTestId('notebook-code-cell-status')
    ).toContainText('Ok');
    // `data` survived the cascade even though `helper` (a function) sat in
    // the same delta — proving the snapshot is not all-or-nothing.
    await expect(
      secondRow.getByTestId('notebook-code-cell-outputs')
    ).toContainText('first is 4');
  });
});

test.describe('Notebook — TypeScript cells (Slice C)', () => {
  test('a TypeScript cell type-strips, runs, and shares a binding with a JS cell', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    // Switch the seeded cell to TypeScript via the header selector, then
    // run a typed declaration — it type-strips through `ts.transpileModule`
    // and executes on the JS worker.
    const firstRow = page.getByTestId('notebook-code-cell-row').first();
    await firstRow
      .getByTestId('notebook-code-cell-language')
      .selectOption('typescript');
    await firstRow
      .getByTestId('notebook-code-cell-source')
      .fill('const doubled: number = 21 * 2;\nconsole.log(doubled);');
    await firstRow.getByTestId('notebook-code-cell-run').click();
    await expect(
      firstRow.getByTestId('notebook-code-cell-status')
    ).toContainText('Ok');
    await expect(
      firstRow.getByTestId('notebook-code-cell-outputs')
    ).toContainText('42');
    await expect(
      firstRow.getByTestId('notebook-code-cell-produces')
    ).toContainText('doubled');

    // A JS cell reads the binding the TS cell declared — cross-cell sharing
    // is language-agnostic (the sandbox round-trips plain JSON values).
    await page.getByTestId('notebook-toolbar-add-code').click();
    await expect(page.getByTestId('notebook-code-cell-row')).toHaveCount(2);
    const secondRow = page.getByTestId('notebook-code-cell-row').nth(1);
    await secondRow
      .getByTestId('notebook-code-cell-source')
      .fill("console.log('doubled is', doubled + 1);");
    await secondRow.getByTestId('notebook-code-cell-run').click();
    await expect(
      secondRow.getByTestId('notebook-code-cell-status')
    ).toContainText('Ok');
    await expect(
      secondRow.getByTestId('notebook-code-cell-outputs')
    ).toContainText('doubled is 43');
  });

  test('a TypeScript syntax error surfaces a precise compiler message', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    const firstRow = page.getByTestId('notebook-code-cell-row').first();
    await firstRow
      .getByTestId('notebook-code-cell-language')
      .selectOption('typescript');
    await firstRow
      .getByTestId('notebook-code-cell-source')
      .fill('const broken: number = ;');
    await firstRow.getByTestId('notebook-code-cell-run').click();
    await expect(
      firstRow.getByTestId('notebook-code-cell-status')
    ).toContainText('Error');
    await expect(
      firstRow.getByTestId('notebook-code-cell-outputs')
    ).toContainText('TypeScript:');
  });
});

test.describe('Notebook — Python cells (Slice F)', () => {
  test('a Python cell runs through Pyodide and shows its stdout', async ({
    page,
  }) => {
    // Pyodide boots on the first Python run; give the whole flow room.
    test.setTimeout(120_000);
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    const firstRow = page.getByTestId('notebook-code-cell-row').first();
    await firstRow
      .getByTestId('notebook-code-cell-language')
      .selectOption('python');
    // Fold A — the independent-run hint is visible on Python cells.
    await expect(
      firstRow.getByTestId('notebook-code-cell-python-hint')
    ).toBeVisible();

    await firstRow
      .getByTestId('notebook-code-cell-source')
      .fill('print("hello from python")');
    await firstRow.getByTestId('notebook-code-cell-run').click();

    // First run boots Pyodide — allow generous headroom over the default
    // 10s expect timeout.
    await expect(
      firstRow.getByTestId('notebook-code-cell-status')
    ).toContainText('Ok', { timeout: 90_000 });
    await expect(
      firstRow.getByTestId('notebook-code-cell-outputs')
    ).toContainText('hello from python', { timeout: 90_000 });
  });
});

test.describe('Notebook — export (Slice D)', () => {
  test('the export menu downloads a Jupyter .ipynb file', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    // The seeded notebook has a code cell, so export is enabled.
    await page.getByTestId('notebook-toolbar-export').click();
    await expect(page.getByTestId('notebook-export-menu')).toBeVisible();
    await expect(page.getByTestId('notebook-export-script')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('notebook-export-ipynb').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.ipynb$/);
  });
});

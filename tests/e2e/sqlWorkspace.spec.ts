/**
 * Keyboard + tab contract for the
 * SQL workspace.
 *
 * The SQL workspace left the bottom dock to become a full-screen
 * `FileTab`. Acceptance now: Mod+Alt+S opens (or focuses) a SQL
 * workspace tab in the editor tab strip; the full-screen panel
 * renders in the editor area; the tab carries the SQL kind glyph and
 * the workspace-level "SQL" label. Query CRUD/run/result flow is
 * covered by the component test suite with a mocked DuckDB engine.
 * This spec locks the cross-locale (EN + ES) observable e2e contract:
 * shortcut → editor tab + full-screen panel.
 */

import type { Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

async function replaceSqlEditorText(page: Page, source: string): Promise<void> {
  const editor = page
    .getByTestId('sql-query-editor-monaco')
    .locator('.monaco-editor');
  await editor.click({ position: { x: 120, y: 36 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

test.describe.configure({ mode: 'parallel' });

test.describe('SQL workspace — Mod+Alt+S binding', () => {
  test('opens the SQL workspace as a full-screen tab (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+S');

    // A SQL workspace tab appears in the editor tab strip (kind glyph)
    // and the full-screen panel renders in the editor area.
    await expect(
      page.locator('[data-testid="editor-tab-kind-glyph"][data-tab-kind="sql"]')
    ).toBeVisible();
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();

    // Opening the workspace does not create a query implicitly; the tab
    // names the stable workspace and the panel offers the create CTA.
    await expect(
      page.getByTestId('editor-tab-filename').filter({ hasText: 'SQL' })
    ).toBeVisible();
    await expect(page.getByTestId('sql-workspace-empty')).toBeVisible();
  });

  test('opens the SQL workspace as a full-screen tab (ES)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+S');

    await expect(
      page.locator('[data-testid="editor-tab-kind-glyph"][data-tab-kind="sql"]')
    ).toBeVisible();
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();
  });

  // Import a small CSV via the keyboard-accessible
  // picker and assert the new table shows in the Explorer. Drives
  // the REAL bundled DuckDB-WASM engine end-to-end (read_csv_auto).
  test('imports a CSV via the picker and lists the new table (EN)', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);

    await page.keyboard.press('ControlOrMeta+Alt+S');
    await expect(page.getByTestId('sql-workspace-panel')).toBeVisible();

    // Set a file on the hidden import input the toolbar Import button
    // opens. The native dialog is keyboard-accessible, so this mirrors the
    // keyboard-only path without a mouse click on the picker.
    await page.getByTestId('sql-workspace-import-input').setInputFiles({
      name: 'people.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('id,name\n1,Ada\n2,Linus\n'),
    });

    // The preview modal opens — role=dialog with a pre-filled table name.
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('sql-import-modal-name')).toHaveValue('people');
    await expect(page.getByTestId('sql-import-modal-columns')).toContainText(
      'name'
    );

    // Confirm the import, then the modal closes.
    await page.getByTestId('sql-import-modal-confirm').click();
    await expect(dialog).toBeHidden();

    // The new table appears in the Explorer with its row count and source file.
    const people = page.locator('[data-testid="sql-explorer-table"][data-table-name="people"]');
    await expect(people).toBeVisible();
    const row = people.locator('..');
    await expect(row.getByTestId('sql-explorer-row-count')).toHaveText('2');
    await expect(row.getByTestId('sql-explorer-source')).toHaveText('csv');
  });

  test('a sample table opens in the Explorer, runs, and exports (EN)', async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-explorer-try-sample').click();
    await expect(
      page.locator('[data-testid="sql-explorer-table"][data-table-name="cities"]')
    ).toBeVisible();

    // The sample query is ready, not run.
    await expect(page.getByTestId('sql-result-preview')).toHaveAttribute('data-state', 'empty');
    await page.getByTestId('sql-query-editor-run').click();
    await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(6);
    await expect(page.getByTestId('sql-result-strip')).toContainText('ran from the editor');
    const revenue = page.getByTestId('sql-result-preview-row').first().locator('td').nth(2);
    await expect(revenue).toHaveText('28770.90');
    await expect(revenue).toHaveClass(/text-right/);

    // Opening the table from the Explorer shows its rows under a generated strip.
    await page.locator('[data-testid="sql-explorer-table"][data-table-name="cities"]').click();
    await expect(page.getByTestId('sql-result-strip')).toHaveAttribute('data-origin', 'table');
    await expect(page.getByTestId('sql-result-strip-sql')).toHaveText(
      'SELECT * FROM "cities" LIMIT 100;'
    );

    await page.getByTestId('sql-result-preview-export').click();
    await expect(page.getByTestId('sql-export-count')).toHaveText('6 rows from this result');
    await page.getByTestId('sql-export-format-tsv').click();
    const download = page.waitForEvent('download');
    await page.getByTestId('sql-export-download').click();
    expect((await download).suggestedFilename()).toMatch(/^lingua-sql-\d{8}-\d{6}\.tsv$/);
    expect(consoleErrors).toEqual([]);
  });

  test('folds the Explorer to its rail with Cmd/Ctrl+B', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await expect(page.getByTestId('sql-explorer')).toBeVisible();
    await page.getByTestId('sql-explorer-refresh').focus();
    await page.keyboard.press('ControlOrMeta+B');
    await expect(page.getByTestId('sql-explorer-rail')).toBeVisible();
    await expect(page.getByTestId('sql-explorer')).toHaveCount(0);
    await page.getByTestId('sql-explorer-unfold').click();
    await expect(page.getByTestId('sql-explorer')).toBeVisible();
  });

  test('profiles a successful read query only after an explicit click (EN)', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });

    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-query-list-create').click();
    await expect(page.getByTestId('sql-query-editor').last()).toBeVisible();

    await replaceSqlEditorText(
      page,
      "SELECT * FROM (VALUES (1, 'Ada'), (2, NULL)) AS people(id, name);"
    );
    await page.getByTestId('sql-query-editor-run').click();

    await expect(page.getByRole('button', { name: 'Profile' })).toBeVisible();
    await page.getByRole('button', { name: 'Profile' }).click();
    await expect(page.getByTestId('sql-column-profile-panel')).toBeVisible();
    await expect(page.getByTestId('sql-column-profile-panel')).toContainText('id');
    await expect(page.getByTestId('sql-column-profile-panel')).toContainText('name');
    // Null percentages must render as real numbers (name is NULL in 1 of 2
    // rows). Locks the DECIMAL→DOUBLE cast in buildColumnProfileQuery: the
    // raw SUMMARIZE decimal arrives as an Arrow value object and every Nulls
    // metric silently degraded to the not-available dash.
    await expect(page.getByTestId('sql-column-profile-panel')).toContainText('50%');
    await expect(page.getByTestId('sql-column-profile-panel')).toContainText('0%');
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      // Review evidence lives under output/review/<change>/ (repo convention).
      mkdirSync('output/review/internal', { recursive: true });
      await page.screenshot({
        path: 'output/review/internal/e2e-en-column-profile.png',
      });
    }
    expect(consoleErrors).toEqual([]);
  });

  test('localizes the SQL tab and the Profile tab in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-query-list-create').click();
    await replaceSqlEditorText(page, 'SELECT 1 AS valor');
    await page.getByTestId('sql-query-editor-run').click();

    await expect(page.getByRole('button', { name: 'Perfil' })).toBeVisible();
    await expect(page.getByTestId('sql-connection-pill')).toHaveAttribute(
      'aria-label',
      'Conexión: Local DuckDB'
    );
    await expect(page.getByTestId('sql-explorer-filter')).toHaveAttribute(
      'placeholder',
      'Filtrar objetos'
    );
    await page.getByRole('button', { name: 'Perfil' }).click();
    await expect(page.getByTestId('sql-column-profile-panel')).toHaveAttribute(
      'aria-label',
      'Perfil de columnas'
    );
    await expect(page.getByTestId('sql-column-profile-item').first()).toBeVisible();
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/internal', { recursive: true });
      await page.screenshot({
        path: 'output/review/internal/e2e-es-column-profile.png',
      });
    }
  });
});

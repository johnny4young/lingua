/**
 * implementation → MOV.02 (FASE 3) — keyboard + tab contract for the
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

  // internal (SQL import) — import a small CSV via the keyboard-accessible
  // picker and assert the new table shows in the schema browser. Drives
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

    // The new table appears in the schema browser.
    await expect(
      page.locator('[data-testid="sql-schema-browser-table"][data-table-name="people"]')
    ).toBeVisible();
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

    await expect(page.getByTestId('sql-result-preview-profile')).toBeVisible();
    await page.getByTestId('sql-result-preview-profile').click();
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

  test('localizes the Column Explorer labels in Spanish', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-query-list-create').click();
    await replaceSqlEditorText(page, 'SELECT 1 AS valor');
    await page.getByTestId('sql-query-editor-run').click();

    await expect(page.getByTestId('sql-result-preview-profile')).toHaveAttribute(
      'aria-label',
      'Analizar columnas'
    );
    await page.getByTestId('sql-result-preview-profile').click();
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

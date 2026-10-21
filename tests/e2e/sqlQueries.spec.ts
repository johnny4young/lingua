/**
 * SQL queries on the real DuckDB-WASM engine: split Run, the row window,
 * Cancel, Explain, query tabs on the Free budget, save and history.
 */

import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

async function openSqlScratch(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-query-list-create').click();
  await expect(page.getByTestId('sql-query-editor')).toBeVisible();
}

async function typeSql(page: Page, source: string): Promise<void> {
  const editor = page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor');
  await editor.click({ position: { x: 120, y: 20 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

test.describe('SQL queries', () => {
  test('runs the statement under the cursor, then every statement with Messages (EN)', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSqlScratch(page);
    await typeSql(page, 'SELECT 1 AS a;\nSELECT 2 AS b;\nSELECT 3 AS c;');
    await page.keyboard.press('ArrowUp');
    await expect(page.getByTestId('sql-query-editor-statements')).toHaveText('3 statements · cursor in 2');

    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
    await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('2');
    await expect(page.getByTestId('sql-result-tabs')).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(page.getByTestId('sql-result-tab-result-2')).toHaveText('Result 3 · 1 row');
    await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('3');
    await page.getByTestId('sql-result-tab-result-0').click();
    await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('1');
    await page.getByTestId('sql-result-tab-messages').click();
    await expect(page.getByTestId('sql-run-message')).toHaveCount(3);

    await page.getByTestId('sql-explorer-rail-history').or(page.getByTestId('sql-history-toggle')).first().click();
    await expect(page.getByTestId('sql-history-row')).toHaveCount(4);
    expect(errors).toEqual([]);
  });

  test('windows a huge result, cancels a long query and keeps the engine usable', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSqlScratch(page);

    await typeSql(page, 'SELECT * FROM range(100000000)');
    await page.getByTestId('sql-query-editor-run').click();
    await expect(page.getByTestId('sql-status-pill')).toHaveAttribute('data-status', 'too-large', {
      timeout: 30_000,
    });
    await expect(page.getByTestId('sql-result-preview-too-large')).toContainText(/of ≥ \d{5,} rows/);

    await typeSql(page, 'SELECT count(*) FROM range(1000000000) a, range(1000) b WHERE a.range % 7 = b.range');
    await page.getByTestId('sql-query-editor-run').click();
    await page.getByTestId('sql-query-editor-cancel').click();
    await expect(page.getByTestId('sql-result-preview-cancelled')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('sql-stuck-band')).toHaveCount(0);

    await typeSql(page, 'SELECT 42 AS answer');
    await page.getByTestId('sql-query-editor-run').click();
    await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('42');
    expect(errors).toEqual([]);
  });

  test('counts query tabs toward the Free budget', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    const codeTabs = await page.locator('[data-testid="editor-tab-kind-glyph"]').count();
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await expect(page.getByTestId('sql-query-tabs')).toHaveCount(0);
    for (let opened = 0; opened < 3 - codeTabs; opened += 1) {
      await page.getByTestId('sql-query-list-create').click();
    }
    await expect(page.getByTestId('sql-query-tab')).toHaveCount(3 - codeTabs);
    await expect(page.getByTestId('sql-query-tabs-free-hint')).toHaveText('Free: 3 open tabs, SQL included');
    await page.getByTestId('sql-query-tabs-create').click();
    await expect(page.getByTestId('sql-query-tab')).toHaveCount(3 - codeTabs);
    await expect(page.getByTestId('status-notice-banner')).toBeVisible();
  });

  test('explains, saves into a folder and reopens a run from History (ES)', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-explorer-try-sample').click();
    await expect(page.getByTestId('sql-query-tab')).toHaveCount(1);
    await typeSql(page, 'SELECT city, sum(revenue) FROM cities GROUP BY city ORDER BY 2 DESC');

    await page.getByTestId('sql-query-editor-run-menu').click();
    await expect(page.getByTestId('sql-run-menu-selection')).toBeDisabled();
    await expect(page.getByTestId('sql-run-menu-statement')).toContainText('Ejecutar sentencia');
    await page.getByTestId('sql-run-menu-explain').click();
    await expect(page.getByTestId('sql-plan-view')).toBeVisible();
    await expect(page.getByTestId('sql-plan-view')).toContainText('Analizado');
    await expect(page.locator('[data-testid="sql-plan-node"][data-slowest="true"]')).toHaveCount(1);
    await expect(page.getByTestId('sql-plan-node').filter({ hasText: 'TABLE_SCAN' }).or(
      page.getByTestId('sql-plan-node').filter({ hasText: 'SEQ_SCAN' })
    ).first()).toBeVisible();

    await page.getByTestId('sql-query-editor-run').click();
    await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(6);

    await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click();
    await page.keyboard.press('ControlOrMeta+S');
    await expect(page.getByTestId('sql-save-popover')).toContainText('Guardar consulta');
    await page.getByTestId('sql-save-name').fill('Ingresos por ciudad');
    await page.getByTestId('sql-save-folder').selectOption({ label: 'Carpeta nueva…' });
    await page.getByTestId('sql-save-new-folder').fill('Reportes');
    await page.getByTestId('sql-save-confirm').click();
    await expect(page.locator('[data-testid="sql-query-folder"][data-folder="Reportes"]')).toBeVisible();
    await expect(page.getByTestId('sql-query-tab-unsaved')).toHaveCount(0);

    await page.getByTestId('sql-history-toggle').click();
    await page.getByTestId('sql-history-search').fill('sum(revenue)');
    await expect(page.getByTestId('sql-history-row')).toHaveCount(1);
    await page.getByTestId('sql-history-row').click();
    await expect(page.getByTestId('sql-query-tab')).toHaveCount(2);
    await expect(page.locator('[data-testid="sql-query-tab"][data-active="true"]')).toContainText('Borrador 1');
    await expect(page.getByTestId('sql-result-preview')).toHaveAttribute('data-state', 'empty');
    expect(errors).toEqual([]);
  });
});

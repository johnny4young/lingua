/**
 * Instant SQL on the real DuckDB-WASM engine: the sampled preview follows the
 * cursor through a WITH chain, Run replaces it, and writes never auto-run.
 */
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const QUERY = [
  "WITH cities AS (SELECT * FROM (VALUES ('Bogota', 120, 5021.75), ('Medellin', 87, 3410.0), ('Envigado', 0, 1250.5)) t(city, orders, revenue)),",
  'totals AS (SELECT city, sum(orders) AS orders, sum(revenue) AS revenue FROM cities GROUP BY city)',
  'SELECT *, revenue / orders AS ticket FROM totals ORDER BY revenue DESC',
].join('\n');

async function openQuery(page: Page, language: 'en' | 'es'): Promise<void> {
  await seedSession(page, { language });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { instantSql: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
  await gotoApp(page);
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-query-list-create').click();
}

async function replaceQuery(page: Page, text: string): Promise<void> {
  const editor = page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor');
  await editor.click({ position: { x: 120, y: 20 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(text);
}

test.describe('Instant SQL', () => {
  for (const language of ['en', 'es'] as const) {
    test(`follows the cursor through the WITH chain (${language})`, async ({ page }) => {
      await openQuery(page, language);
      await replaceQuery(page, QUERY);
      const preview = page.getByTestId('sql-instant-preview');
      const target = page.getByTestId('sql-instant-target');
      await expect(target).toHaveText(language === 'en' ? 'Result' : 'Resultado');
      await expect(preview.locator('tbody tr')).toHaveCount(3);
      await expect(preview.locator('tbody tr').first()).toContainText('Bogota');

      const crumbs = page.getByTestId('sql-instant-crumb');
      await crumbs.nth(1).click();
      await expect(target).toHaveText('CTE · totals');
      await expect(crumbs.nth(1)).toHaveAttribute('aria-pressed', 'true');
      await expect(crumbs.nth(2)).toHaveAttribute('data-dependent', 'true');
      await expect(page.locator('.lingua-sql-instant-range')).toHaveCount(1);
      await expect(page.getByTestId('sql-instant-meta')).toContainText(language === 'en' ? '3 rows' : '3 filas');

      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(3);
      await expect(preview).toHaveCount(0);
    });
  }

  test('never runs a write as you type', async ({ page }) => {
    await openQuery(page, 'en');
    await replaceQuery(page, 'CREATE TABLE instant_probe AS SELECT 1 AS x');
    await expect(page.getByTestId('sql-instant-preview')).toContainText('DML / DDL never auto-run');
    await replaceQuery(page, 'SELECT * FROM instant_probe');
    // The table was never created, so the preview of a read on it fails.
    await expect(page.getByTestId('sql-instant-error')).toBeVisible();
    await expect(page.getByTestId('sql-instant-table')).toHaveCount(0);
  });
});

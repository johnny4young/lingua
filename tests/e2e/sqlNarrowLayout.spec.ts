/**
 * The SQL tab on narrow windows with the real DuckDB-WASM engine: the command bar
 * fits at 375 px, the Explorer opens as a drawer, the QUERY row keeps named
 * glyph buttons, and the result header keeps one row at 768 px.
 */

import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

test.describe.configure({ mode: 'parallel' });

const SETUP =
  "CREATE TABLE orders AS SELECT i AS id, ['Cali','Bogotá','Medellín'][1 + i % 3] AS city, i * 1.5 AS total FROM range(1, 301) t(i);";
// The cursor ends in the second statement, the one Run statement runs.
const QUERY = 'SELECT 1;\n\nSELECT city, count(*) AS orders, sum(total) AS revenue FROM orders GROUP BY city ORDER BY revenue DESC;';

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));
  return errors;
}

async function runFirstStatement(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-workspace-empty-create').click();
  const editor = page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor');
  const type = async (source: string) => {
    await editor.click({ position: { x: 60, y: 20 } });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.press('Backspace');
    await page.keyboard.insertText(source);
  };
  await type(SETUP);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('sql-status-pill')).toBeVisible({ timeout: 60_000 });
  await type(QUERY);
  await page.keyboard.press('ControlOrMeta+Enter');
  await expect(page.getByTestId('sql-result-preview-statement-count')).toBeVisible();
}

const COPY = {
  en: { explorer: 'Explorer', format: 'Format', ask: 'Ask AI for a SQL query', table: 'Table', json: 'JSON' },
  es: { explorer: 'Explorador', format: 'Formatear', ask: 'Pídele a la IA una consulta SQL', table: 'Tabla', json: 'JSON' },
} as const;

for (const language of ['en', 'es'] as const) {
  const copy = COPY[language];

  test(`fits the SQL tab into 375 px (${language})`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await seedSession(page, { language, primeProLicense: true });
    await gotoApp(page);
    await runFirstStatement(page);

    // The bar keeps the plan badge on screen; nothing scrolls sideways.
    const bar = await page.getByTestId('app-chrome').evaluate((node) => ({ scroll: node.scrollWidth, client: node.clientWidth }));
    expect(bar.scroll).toBeLessThanOrEqual(bar.client);
    const badge = await page.getByTestId('license-badge').boundingBox();
    expect(badge!.x + badge!.width).toBeLessThanOrEqual(375);

    // The QUERY row: named glyph buttons, nothing split over two lines.
    await expect(page.getByTestId('sql-query-editor-format')).toHaveAccessibleName(copy.format);
    await expect(page.getByTestId('ask-sql-trigger')).toHaveAccessibleName(copy.ask);
    const headerHeight = await page.locator('[data-testid="sql-query-editor"] header').evaluate((node) => node.getBoundingClientRect().height);
    expect(headerHeight).toBeLessThan(50);

    // The views fold into one menu.
    await page.getByTestId('result-header-views').click();
    await page.getByRole('menuitemradio', { name: copy.json }).click();
    await expect(page.getByTestId('result-header-views')).toHaveText(copy.json);

    // The Explorer is a rail that opens a drawer, and the editor keeps the width.
    await expect(page.getByTestId('sql-explorer')).toHaveCount(0);
    await page.getByTestId('sql-explorer-unfold').click();
    const drawer = page.getByRole('dialog', { name: copy.explorer });
    await expect(drawer.locator('[data-testid="sql-explorer-table"][data-table-name="orders"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+B');
    await expect(drawer).toBeVisible();
    await page.keyboard.press('Escape');
    expect(errors).toEqual([]);
  });

  test(`keeps the result header on one row at 768 px (${language})`, async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.setViewportSize({ width: 768, height: 900 });
    await seedSession(page, { language, primeProLicense: true });
    await gotoApp(page);
    await runFirstStatement(page);

    const header = page.getByTestId('result-header');
    await expect(header).toHaveAttribute('data-folded', 'true');
    // One row: every item spans the header's vertical middle.
    const oneRow = await header.evaluate((node) => {
      const boxes = [...node.children].map((child) => child.getBoundingClientRect()).filter((box) => box.height > 0);
      return Math.max(...boxes.map((box) => box.top)) < Math.min(...boxes.map((box) => box.bottom));
    });
    expect(oneRow).toBe(true);
    await expect(page.getByTestId('result-header-views')).toHaveText(copy.table);
    await expect(page.getByTestId('sql-column-rail-toggle')).toBeVisible();
    await expect(page.getByTestId('sql-explorer')).toBeVisible();
    expect(errors).toEqual([]);
  });
}

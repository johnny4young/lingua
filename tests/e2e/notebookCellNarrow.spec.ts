/**
 * A code cell reads at any width: the header names the language and the
 * status as text, a narrow cell keeps Refresh cell inside its card, a query
 * table moves under the code without clipping a column, and a long error
 * wraps instead of being cut.
 */

import type { Locator, Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test, waitForSeededWorkspaceSettled } from './licenseWeb.helpers';
import { isKnownBenignConsoleError } from './consoleErrorFilter';

test.describe.configure({ mode: 'serial' });

async function editCell(page: Page, row: Locator, code: string): Promise<void> {
  const staticView = row.getByTestId('notebook-code-cell-static');
  if ((await staticView.count()) > 0) await staticView.click();
  const editor = row.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(code);
}

async function addSqlCell(page: Page, code: string): Promise<Locator> {
  const rows = page.getByTestId('notebook-code-cell-row');
  const before = await rows.count();
  await page.getByTestId('notebook-cells-append-code').click();
  await expect(rows).toHaveCount(before + 1);
  const row = rows.nth(before);
  await row.getByTestId('notebook-code-cell-language').selectOption('sql');
  await editCell(page, row, code);
  return row;
}

const CREATE_SQL = [
  'CREATE TABLE by_city AS',
  'SELECT city, sum(total) AS revenue',
  "FROM (VALUES ('Medellín', 818294.40), ('Bogotá', 731121.30), ('Barranquilla', 231060.60)) AS o(city, total)",
  'GROUP BY city;',
].join('\n');
const SHARE_SQL = 'SELECT city, revenue,\n  round(100 * revenue / sum(revenue) OVER (), 1) AS share\nFROM by_city\nORDER BY revenue DESC;';
const BROKEN_SQL = 'SELECT city FROM revenue_by_region_and_quarter_for_the_whole_year;';

async function box(locator: Locator) {
  const rect = await locator.boundingBox();
  if (!rect) throw new Error('element has no box');
  return rect;
}

test('a cell header and its answers fit at 768 and 375 px', async ({ page }) => {
  // DuckDB boots on the first SQL run.
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', error => {
    if (!isKnownBenignConsoleError(error.message)) errors.push(error.message);
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await seedSession(page, { language: 'en', primeProLicense: true });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await page.keyboard.press('ControlOrMeta+Alt+N');
  await expect(page.getByTestId('notebook-view')).toBeVisible();

  const rows = page.getByTestId('notebook-code-cell-row');
  const create = rows.first();
  await create.getByTestId('notebook-code-cell-language').selectOption('sql');
  await editCell(page, create, CREATE_SQL);
  const share = await addSqlCell(page, SHARE_SQL);
  const broken = await addSqlCell(page, BROKEN_SQL);
  await page.getByTestId('notebook-toolbar-run-all').click();
  await expect(share.getByTestId('notebook-code-cell-status')).toHaveAttribute('data-status', 'ok', { timeout: 90_000 });
  if ((await broken.getByTestId('notebook-code-cell-status').getAttribute('data-status')) !== 'error') {
    await broken.getByTestId('notebook-code-cell-run').click();
  }
  await expect(broken.getByTestId('notebook-code-cell-status')).toHaveAttribute('data-status', 'error');

  await expect(share.getByTestId('notebook-code-cell-language-name')).toHaveText('SQL');
  await expect(share).toHaveAttribute('aria-label', 'Cell 3');
  await expect(share.getByTestId('notebook-code-cell-status')).toHaveText(/^Ok · \d+(\.\d+)? m?s$/u);
  await expect(share.getByTestId('notebook-code-cell-uses')).toHaveText('uses by_city');
  await expect(share.getByTestId('notebook-cell-answer-table')).toContainText('818,294.40');

  // Editing the first cell stales the query below it.
  await editCell(page, create, CREATE_SQL.replace('GROUP BY city;', 'GROUP BY ALL;'));
  await create.getByTestId('notebook-code-cell-run').click();
  await expect(share.getByTestId('notebook-code-cell-run')).toHaveAttribute('data-action', 'refresh', { timeout: 30_000 });

  for (const width of [768, 375]) {
    await page.setViewportSize({ width, height: 1400 });
    const card = await box(share);
    const refresh = await box(share.getByTestId('notebook-code-cell-run'));
    expect(refresh.x + refresh.width).toBeLessThanOrEqual(card.x + card.width);
    await expect(share.getByRole('button', { name: 'Refresh cell' })).toBeVisible();

    // The table sits under the code at full width, every column inside its frame.
    const table = share.getByTestId('notebook-cell-answer-table');
    const frame = await box(table);
    const code = await box(share.getByTestId('notebook-code-cell-static'));
    expect(frame.y).toBeGreaterThan(code.y + code.height - 1);
    expect(frame.x + frame.width).toBeLessThanOrEqual(card.x + card.width);
    expect(await table.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);

    // The error and its dated note wrap instead of being cut.
    const error = broken.locator('[data-testid="notebook-cell-answer"][data-kind="error"] .notebook-answer-pill[data-tone="error"]');
    await expect(error).toBeVisible();
    expect(await error.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
    expect((await box(error)).height).toBeGreaterThan(30);
    const dated = broken.getByTestId('notebook-cell-answer-dated');
    await expect(dated).toBeVisible();
    expect(await dated.evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0);
  }
  expect(errors).toEqual([]);
});

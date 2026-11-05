/**
 * Staged row edits on the real DuckDB engine: leaving a table asks first,
 * what the engine hands the grid finds the row again, and binaries stay intact.
 */
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const STAGED = { en: '1 staged change', es: '1 cambio pendiente' };

async function open(page: Page, language: 'en' | 'es') {
  await seedSession(page, { language });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { editRows: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
  await gotoApp(page);
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-query-list-create').click();
}

async function runAll(page: Page, sql: string) {
  await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(sql);
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
}

async function openTable(page: Page, name: string) {
  const table = page.locator(`[data-testid="sql-explorer-table"][data-table-name="${name}"]`);
  await expect(table).toBeVisible();
  await table.click();
  await expect(page.getByTestId('sql-edit-bar')).toContainText(name);
}

async function edit(page: Page, column: string, value: string) {
  await page.getByTestId('sql-result-preview-row').first().locator(`td[data-column="${column}"]`).dblclick();
  await page.getByTestId('sql-cell-editor').fill(value);
  await page.keyboard.press('Enter');
}

const rows = (page: Page) => page.getByTestId('sql-result-preview-row').evaluateAll((els) => els.map((el) => (el as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

test.describe('Staged row edits', () => {
  for (const language of ['en', 'es'] as const) {
    test(`asks before a Run, another table or a new query drops them (${language})`, async ({ page }) => {
      await open(page, language);
      await runAll(page, "CREATE TABLE t1 (id INT PRIMARY KEY, v VARCHAR); INSERT INTO t1 VALUES (1, 'a'); CREATE TABLE t2 (id INT PRIMARY KEY, v VARCHAR);");
      await openTable(page, 't1');
      await edit(page, 'v', 'mine');
      const count = page.getByTestId('sql-edit-count');
      await expect(count).toHaveText(STAGED[language]);

      const asked: string[] = [];
      let answer = false;
      page.on('dialog', async (dialog) => {
        asked.push(dialog.message());
        await (answer ? dialog.accept() : dialog.dismiss());
      });
      await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect.poll(() => asked.length).toBe(1);
      await page.locator('[data-testid="sql-explorer-table"][data-table-name="t2"]').click();
      await expect.poll(() => asked.length).toBe(2);
      await page.getByTestId('sql-query-list-create').click();
      await expect.poll(() => asked.length).toBe(3);
      await expect(count).toHaveText(STAGED[language]);
      expect(asked[0]).toContain(language === 'en' ? 'Discard 1 staged change?' : '¿Descartar 1 cambio pendiente?');

      answer = true;
      await page.locator('[data-testid="sql-explorer-table"][data-table-name="t2"]').click();
      await expect.poll(() => asked.length).toBe(4);
      await expect(count).toHaveCount(0);
      await expect(page.getByTestId('sql-result-strip-sql')).toContainText('t2');
    });
  }

  test('finds rows of every comparable type again, and a NULL', async ({ page }) => {
    await open(page, 'en');
    await runAll(
      page,
      "CREATE TABLE typed (id INT PRIMARY KEY, s VARCHAR, d DECIMAL(20,4), h HUGEINT, u UUID, b BOOLEAN, n INT, v VARCHAR); INSERT INTO typed VALUES (1, 'O''Brien', 12345678901234.1234, 170141183460469231731687303715884105727, '6f1c1b32-3c1a-4a55-9f6e-2c1b5f3f8a10', true, NULL, 'x'); INSERT INTO typed VALUES (2, 'gone', 1, 1, '6f1c1b32-3c1a-4a55-9f6e-2c1b5f3f8a11', false, 1, 'y');"
    );
    await openTable(page, 'typed');
    for (const [column, value] of [['s', 'mine'], ['d', '1.5000'], ['h', '7'], ['b', 'false'], ['n', '3']] as const) await edit(page, column, value);
    await page.getByTestId('sql-edit-review').click();
    await expect(page.getByTestId('sql-edit-review-panel')).toContainText('"s" = \'O\'\'Brien\'');
    await expect(page.getByTestId('sql-edit-review-panel')).toContainText('"n" IS NULL');
    await page.getByTestId('sql-edit-commit').click();
    await expect(page.getByTestId('sql-edit-notice')).toContainText('Committed 1 change');
    await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('mine');
  });

  test('duplicates a row without its binary, and a keyless table finds its row by rowid and values', async ({ page }) => {
    await open(page, 'en');
    await runAll(page, "CREATE TABLE files (id INT PRIMARY KEY, body BLOB, v VARCHAR); INSERT INTO files VALUES (1, 'abc'::BLOB, 'orig'); CREATE TABLE timed (ts TIMESTAMP PRIMARY KEY, v VARCHAR); INSERT INTO timed VALUES (TIMESTAMP '2026-01-02 03:04:05.123456', 'a');");
    await openTable(page, 'files');
    const body = page.getByTestId('sql-result-preview-row').first().locator('td[data-column="body"]');
    await body.dblclick();
    await expect(page.getByTestId('sql-cell-editor')).toHaveCount(0);
    await page.getByTestId('sql-result-preview-row').first().locator('td[data-column="v"]').click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Duplicate row' }).click();
    await page.getByTestId('sql-edit-review').click();
    await expect(page.getByTestId('sql-edit-review-panel')).toContainText('INSERT INTO "files" ("v") VALUES (\'orig\')');

    await page.getByTestId('sql-edit-discard').click();
    await openTable(page, 'timed');
    await expect(page.getByTestId('sql-edit-bar')).toContainText('rows by rowid');
    await edit(page, 'v', 'mine');
    await page.getByTestId('sql-edit-commit').click();
    await expect(page.getByTestId('sql-edit-notice')).toContainText('Committed 1 change');
    await runAll(page, 'SELECT ts::VARCHAR AS ts, v FROM timed');
    await expect.poll(() => rows(page)).toEqual(['2026-01-02 03:04:05.123456 mine']);
  });
});

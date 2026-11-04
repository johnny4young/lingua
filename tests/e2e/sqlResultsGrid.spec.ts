/**
 * The SQL result grid on the real DuckDB-WASM engine: Load more past the
 * window, cell filters with Apply to query, the value viewer, foreign-key
 * links, the column rail, full-result export and import into an existing
 * table.
 */

import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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

async function runAll(page: Page, source: string): Promise<void> {
  await typeSql(page, source);
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
}

// Monaco renders spaces as no-break spaces.
const editorText = async (page: Page) =>
  (await page.getByTestId('sql-query-editor-monaco').locator('.view-lines').innerText()).replace(/\u00a0/g, ' ');

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

const ORDERS = [
  'CREATE TABLE customers (id INTEGER PRIMARY KEY, name VARCHAR, city VARCHAR);',
  "INSERT INTO customers VALUES (7781, 'Ana Restrepo', 'Envigado'), (912, 'Luis Mora', 'Cali');",
  'CREATE TABLE orders (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customers(id), total DECIMAL(10,2), meta JSON, receipt BLOB);',
  "INSERT INTO orders SELECT 10400 + i, CASE WHEN i % 2 = 0 THEN 7781 ELSE 912 END, i * 137.25, '{\"channel\":\"web\",\"qty\":2}', '\\x89PNG\\x0D\\x0A\\x1A\\x0A'::BLOB FROM range(40) t(i);",
].join('\n');

test.describe('SQL result grid', () => {
  test('reads past the window with Load more, filters from a cell and applies the grid as SQL (EN)', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSqlScratch(page);
    await runAll(page, "CREATE TABLE big AS SELECT i AS id, CASE WHEN i % 3 = 0 THEN 'Cali' ELSE 'Medellin' END AS city FROM range(30000) t(i);");
    await expect(page.locator('[data-testid="sql-explorer-table"][data-table-name="big"]')).toBeVisible();
    await typeSql(page, 'SELECT * FROM big ORDER BY id');
    await page.keyboard.press('ControlOrMeta+Enter');

    const table = page.getByTestId('sql-result-preview-table');
    await expect(page.getByTestId('sql-result-load-more')).toBeVisible();
    const before = Number(await table.getAttribute('aria-rowcount'));
    await page.getByTestId('sql-result-load-more').click();
    await expect.poll(async () => Number(await table.getAttribute('aria-rowcount'))).toBeGreaterThan(before);

    await page.getByTestId('sql-result-preview-row').first().locator('td[data-column="city"]').click({ button: 'right' });
    await page.getByTestId('sql-cell-menu-filter').click();
    await expect(page.getByTestId('sql-condition-chip')).toContainText('city = Cali');
    await expect(page.getByTestId('sql-grid-sql')).toContainText(`WHERE "city" = 'Cali'`);
    await page.getByTestId('sql-grid-sql-apply').click();
    await expect.poll(() => editorText(page)).toContain(') AS result');
    expect(errors).toEqual([]);
  });

  test('follows a foreign key and back, opens JSON and BLOB values, and counts the rows that point at a row (EN)', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSqlScratch(page);
    await runAll(page, ORDERS);
    const orders = page.locator('[data-testid="sql-explorer-table"][data-table-name="orders"]');
    await expect(orders).toBeVisible();
    await orders.click();

    await expect(page.getByTestId('sql-result-fk-link').first()).toBeVisible();
    await page.locator('td[data-column="meta"]').first().dblclick();
    await expect(page.getByTestId('sql-value-json')).toContainText('"channel": "web"');
    await page.locator('td[data-column="receipt"]').first().click();
    await expect(page.getByTestId('sql-value-blob')).toContainText('PNG');

    await page.getByTestId('sql-result-fk-link').first().click();
    await expect(page.getByTestId('sql-result-strip-sql')).toHaveText(
      'SELECT * FROM "customers" WHERE "id" = 7781 LIMIT 100;'
    );
    await page.locator('td[data-column="name"]').first().dblclick();
    await expect(page.getByTestId('sql-value-referenced-by-chip')).toHaveText('Referenced by: orders (20)');
    await page.getByTestId('sql-result-strip-back').click();
    await expect(page.getByTestId('sql-result-strip-sql')).toHaveText('SELECT * FROM "orders" LIMIT 100;');
    expect(errors).toEqual([]);
  });

  for (const language of ['en', 'es'] as const) {
    test(`windows a wide result: scroll, sticky header, arrow keys and the editor (${language})`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await seedSession(page, { language });
      await page.addInitScript(() => {
        const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
        raw.state.featureFlags = { editRows: true };
        localStorage.setItem('lingua-settings', JSON.stringify(raw));
      });
      await gotoApp(page);
      await openSqlScratch(page);
      const names = Array.from({ length: 99 }, (_, c) => `c${c + 1}`);
      await runAll(
        page,
        [
          `CREATE TABLE wide (id INTEGER PRIMARY KEY, ${names.map((name) => `${name} VARCHAR`).join(', ')});`,
          `INSERT INTO wide SELECT i, ${names.map((name) => `'${name}-' || i`).join(', ')} FROM range(300) t(i);`,
        ].join('\n')
      );
      const wide = page.locator('[data-testid="sql-explorer-table"][data-table-name="wide"]');
      await expect(wide).toBeVisible();
      await wide.click();

      const grid = page.getByTestId('sql-result-preview-table-container');
      const firstRow = page.getByTestId('sql-result-preview-row').first();
      const header = (name: string) => page.locator(`th:has([data-testid="sql-result-preview-sort"][data-column="${name}"])`);
      await expect(firstRow.locator('td[data-column="id"]')).toBeVisible();
      await expect(page.locator('thead th')).toHaveCount(100);
      await expect(header('c1').getByTestId('sql-result-preview-sort')).toHaveAttribute('title', language === 'es' ? 'Ordenar por c1' : 'Sort by c1');
      const mountedCells = await firstRow.locator('td[role="gridcell"]').count();
      expect(mountedCells).toBeLessThan(30);
      await expect(firstRow.locator('td[data-column="c50"]')).toHaveCount(0);

      // Sideways the window follows, with header and cells on one column grid.
      await grid.evaluate((node) => {
        node.scrollLeft = node.scrollWidth / 2;
      });
      await expect(firstRow.locator('td[data-column="c50"]')).toBeVisible();
      await expect(firstRow.locator('td[data-column="id"]')).toHaveCount(0);
      await expect(firstRow.locator('td[data-column="c50"]')).toHaveAttribute('aria-colindex', '51');
      const cellBox = await firstRow.locator('td[data-column="c50"]').boundingBox();
      const headerBox = await header('c50').boundingBox();
      expect(cellBox!.x).toBeCloseTo(headerBox!.x, 0);
      expect(cellBox!.width).toBeCloseTo(headerBox!.width, 0);

      // Down, the header stays at the top of the grid and the columns keep their widths.
      await grid.evaluate((node) => {
        node.scrollTop = 26 * 60;
      });
      await expect(page.getByTestId('sql-result-preview-row').first()).toHaveAttribute('aria-rowindex', /^[4-9]\d$/);
      const gridBox = await grid.boundingBox();
      expect((await header('c50').boundingBox())!.y).toBeCloseTo(gridBox!.y, 0);
      expect((await header('c50').boundingBox())!.width).toBeCloseTo(headerBox!.width, 0);

      // The arrow keys walk off the mounted window and bring each cell into view.
      await grid.evaluate((node) => {
        node.scrollLeft = 0;
        node.scrollTop = 0;
      });
      await firstRow.locator('td[data-column="c1"]').click();
      await grid.focus();
      for (let press = 0; press < 25; press++) await page.keyboard.press('ArrowRight');
      const selected = firstRow.locator('td[data-column="c26"]');
      await expect(selected).toHaveAttribute('aria-selected', 'true');
      await expect(selected).toBeInViewport({ ratio: 1 });
      await page.keyboard.press('Escape');

      // An editor scrolled away stays mounted, keeps its draft and still saves.
      await grid.evaluate((node) => {
        node.scrollLeft = 0;
      });
      await firstRow.locator('td[data-column="c1"]').dblclick();
      const editor = page.getByTestId('sql-cell-editor');
      await expect(editor).toBeFocused();
      await editor.fill('edited');
      await grid.evaluate((node) => {
        node.scrollLeft = node.scrollWidth / 2;
      });
      await expect(firstRow.locator('td[data-column="c50"]')).toBeVisible();
      await expect(editor).toBeFocused();
      await expect(editor).toHaveValue('edited');
      await page.keyboard.press('Enter');
      await expect(editor).toHaveCount(0);
      await expect(page.getByTestId('sql-edit-count')).toBeVisible();
      await grid.evaluate((node) => {
        node.scrollLeft = 0;
      });
      await expect(firstRow.locator('td[data-column="c1"]')).toHaveText('edited');
      expect(errors).toEqual([]);
    });

    test(`shows Infinity and NaN as numbers and only a real NULL as null (${language})`, async ({ page }) => {
      const errors = collectConsoleErrors(page);
      await seedSession(page, { language });
      await gotoApp(page);
      await openSqlScratch(page);
      await typeSql(page, 'SELECT 1.0::DOUBLE / 0 AS pos, -1.0::DOUBLE / 0 AS neg, 0.0::DOUBLE / 0 AS nan, NULL::DOUBLE AS missing');
      await page.keyboard.press('ControlOrMeta+Enter');
      const row = page.getByTestId('sql-result-preview-row').first();
      for (const [column, text] of [['pos', 'Infinity'], ['neg', '-Infinity'], ['nan', 'NaN'], ['missing', 'null']] as const) {
        const cell = row.locator(`td[data-column="${column}"]`);
        await expect(cell).toHaveText(text);
        await expect(cell).toHaveCSS('text-align', 'right');
      }
      await expect(row.locator('td[data-column="pos"]')).toHaveCSS('font-style', 'normal');
      await expect(row.locator('td[data-column="missing"]')).toHaveCSS('font-style', 'italic');

      await typeSql(page, "SELECT x FROM (VALUES (1.5::DOUBLE), ('NaN'::DOUBLE), (NULL), ('-Infinity'::DOUBLE), ('Infinity'::DOUBLE), (-5.0::DOUBLE)) t(x)");
      await page.keyboard.press('ControlOrMeta+Enter');
      const cells = page.getByTestId('sql-result-preview-row').locator('td[data-column="x"]');
      await expect(cells).toHaveCount(6);
      await page.locator('[data-testid="sql-result-preview-sort"][data-column="x"]').click();
      await expect(cells).toHaveText(['-Infinity', '-5', '1.5', 'Infinity', 'NaN', 'null']);

      if (!(await page.getByTestId('sql-column-rail').isVisible())) await page.getByTestId('sql-column-rail-toggle').click();
      const rail = page.locator('[data-testid="sql-rail-column"][data-column="x"]');
      await expect(rail).toContainText('-Infinity–NaN');
      await expect(rail).toContainText('17%');
      await expect(rail.getByTestId('sql-rail-bin').first()).toBeVisible();

      const exportJson = async () => {
        await page.getByTestId('sql-result-preview-export').click();
        await page.getByTestId('sql-export-format-json').click();
        const download = page.waitForEvent('download');
        await page.getByTestId('sql-export-download').click();
        const text = await readFile((await (await download).path())!, 'utf8');
        return (JSON.parse(text) as Array<{ x: unknown }>).map((entry) => entry.x);
      };
      expect(await exportJson()).toEqual(['-Infinity', -5, 1.5, 'Infinity', 'NaN', null]);

      // Past the loaded window the export is DuckDB's own COPY, with the grid's sort still on.
      await typeSql(page, "SELECT CASE i WHEN 0 THEN 'Infinity'::DOUBLE WHEN 1 THEN '-Infinity'::DOUBLE WHEN 2 THEN 'NaN'::DOUBLE WHEN 3 THEN NULL ELSE i END AS x FROM range(25000) t(i) ORDER BY i");
      await page.keyboard.press('ControlOrMeta+Enter');
      await expect(page.getByTestId('sql-result-load-more')).toBeVisible();
      const full = await exportJson();
      expect(full).toHaveLength(25_000);
      expect(full.slice(0, 2)).toEqual(['-Infinity', 4]);
      expect(full.slice(-3)).toEqual(['Infinity', 'NaN', null]);
      expect(errors).toEqual([]);
    });
  }

  test('inserts a predicate from the column rail at the editor cursor (EN)', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSqlScratch(page);
    await typeSql(page, "SELECT * FROM (VALUES ('Cali', 1), ('Cali', 2), ('Pasto', 3)) t(city, n)");
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('sql-column-rail-sample')).toHaveText('of the 3 rows loaded');
    const city = page.locator('[data-testid="sql-rail-column"][data-column="city"]');
    await city.getByTestId('sql-rail-value').first().click();
    await expect.poll(() => editorText(page)).toContain("WHERE city = 'Cali'");
  });

  test('exports every row of a windowed result in the grid order, as CSV and XLSX (EN)', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await openSqlScratch(page);
    await typeSql(page, 'SELECT i AS id, i * 2 AS twice FROM range(25000) t(i) -- every row\n;');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('sql-result-load-more')).toBeVisible();
    const sort = page.locator('[data-testid="sql-result-preview-sort"][data-column="id"]');
    await sort.click();
    await sort.click();

    await page.getByTestId('sql-result-preview-export').click();
    await expect(page.getByTestId('sql-export-scope-full')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('sql-export-blocked')).toHaveText('Copy takes the loaded rows. Choose Loaded rows to copy.');
    const csvDownload = page.waitForEvent('download');
    await page.getByTestId('sql-export-download').click();
    const csv = await readFile((await (await csvDownload).path())!, 'utf8');
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(25_001);
    expect(lines.slice(0, 3)).toEqual(['id,twice', '24999,49998', '24998,49996']);
    await expect(page.getByTestId('status-notice-banner')).toContainText('Exported 25,000 rows as CSV');

    await page.getByTestId('sql-result-preview-export').click();
    await page.getByTestId('sql-export-format-xlsx').click();
    const xlsxDownload = page.waitForEvent('download');
    await page.getByTestId('sql-export-download').click();
    const download = await xlsxDownload;
    expect(download.suggestedFilename()).toMatch(/\.xlsx$/);
    const bytes = await readFile((await download.path())!);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(errors).toEqual([]);
  });

  test('imports a CSV into an existing table through the column mapping, and rolls back a bad row (ES)', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await openSqlScratch(page);
    await runAll(page, 'CREATE TABLE ventas (id INTEGER, ciudad VARCHAR, total DECIMAL(12,2));');
    await expect(page.locator('[data-testid="sql-explorer-table"][data-table-name="ventas"]')).toBeVisible();

    await page.getByTestId('sql-workspace-import-input').setInputFiles({
      name: 'ventas.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('id;Ciudad;valor\n1;Medellin;125000.50\n2;Cali;98000\n'),
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByTestId('sql-import-csv-delimiter').selectOption(';');
    await expect(page.getByTestId('sql-import-map-row')).toHaveCount(3);
    await page.getByTestId('sql-import-target-existing').click();
    await page.getByTestId('sql-import-map-target').nth(2).selectOption('total');
    await expect(page.getByTestId('sql-import-modal-summary')).toHaveText('Agregar 2 filas a ventas · 3 de 3 columnas');
    await page.getByTestId('sql-import-modal-confirm').click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByTestId('status-notice-banner')).toContainText('Se agregaron 2 filas a ventas.');

    await page.getByTestId('sql-workspace-import-input').setInputFiles({
      name: 'malo.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('id,ciudad\nabc,Pasto\n'),
    });
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByTestId('sql-import-target-existing').click();
    await page.getByTestId('sql-import-modal-confirm').click();
    await expect(page.getByTestId('status-notice-banner')).toContainText('No se pudieron agregar las filas a ventas. No se cambió nada.');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByTestId('sql-import-modal-cancel').click();

    await page.locator('[data-testid="sql-explorer-table"][data-table-name="ventas"]').click();
    await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(2);
    await expect(page.getByTestId('sql-result-preview-row').first()).toContainText('125000.50');
  });
});

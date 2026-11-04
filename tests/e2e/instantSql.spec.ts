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
  await expect(page.getByTestId('sql-query-editor-size')).toHaveText(/^0 B/);
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

  test('previews on the first edit when the engine starts slowly', async ({ page }) => {
    await page.context().route(/duckdb-mvp.*\.wasm/, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      await route.continue();
    });
    await openQuery(page, 'en');
    await replaceQuery(page, QUERY);
    await expect(page.getByTestId('sql-instant-target')).toHaveText('Result');
    await expect(page.getByTestId('sql-instant-preview').locator('tbody tr')).toHaveCount(3);
  });

  test('previews offline from its own copy of the JSON extension', async ({ page, context }) => {
    const extensionRequests: string[] = [];
    context.on('request', (request) => {
      if (request.url().includes('.duckdb_extension')) extensionRequests.push(request.url());
    });
    await openQuery(page, 'en');
    await replaceQuery(page, QUERY);
    await expect(page.getByTestId('sql-instant-preview').locator('tbody tr')).toHaveCount(3);
    expect(extensionRequests).toHaveLength(1);
    expect(new URL(extensionRequests[0] ?? '').origin).toBe(new URL(page.url()).origin);

    await context.setOffline(true);
    await replaceQuery(page, "SELECT '{\"a\":1}'::JSON->>'a' AS a");
    await expect(page.getByTestId('sql-instant-preview').locator('tbody tr')).toHaveCount(1);
    expect(extensionRequests).toHaveLength(1);
  });

  test('a Run reads JSON from the same copy with the preview off', async ({ page, context }) => {
    const extensionRequests: string[] = [];
    context.on('request', (request) => {
      if (request.url().includes('.duckdb_extension')) extensionRequests.push(request.url());
    });
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-query-list-create').click();
    await replaceQuery(page, "SELECT '{\"a\":1}'::JSON->>'a' AS a");
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
    expect(extensionRequests).toHaveLength(1);
    expect(new URL(extensionRequests[0] ?? '').origin).toBe(new URL(page.url()).origin);
  });

  test.describe('with the service worker', () => {
    test.use({ serviceWorkers: 'allow' });

    test('previews after an offline reload', async ({ page, context }) => {
      await openQuery(page, 'en');
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.reload();
      await page.evaluate(() => navigator.serviceWorker.controller !== null);
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await page.getByTestId('sql-query-list-create').click();
      await replaceQuery(page, 'SELECT 1 AS x');
      await expect(page.getByTestId('sql-instant-preview').locator('tbody tr')).toHaveCount(1);

      await context.setOffline(true);
      await page.reload();
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await page.getByTestId('sql-query-list-create').click();
      await replaceQuery(page, 'SELECT 2 AS x');
      await expect(page.getByTestId('sql-instant-preview').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByTestId('sql-instant-error')).toHaveCount(0);
    });
  });

  for (const language of ['en', 'es'] as const) {
    test(`says so when its JSON extension cannot load, and recovers (${language})`, async ({ page, context }) => {
      const upstream: string[] = [];
      context.on('request', (request) => {
        if (request.url().includes('extensions.duckdb.org')) upstream.push(request.url());
      });
      let broken = true;
      await context.route(/\/json\.duckdb_extension\.wasm$/, (route) => (broken ? route.fulfill({ status: 404 }) : route.continue()));
      await openQuery(page, language);
      await replaceQuery(page, 'SELECT 1 AS x');
      await expect(page.getByTestId('sql-instant-error')).toHaveText(
        language === 'en'
          ? 'Previews need a file that did not load. The next edit tries again.'
          : 'Las vistas previas necesitan un archivo que no cargó. El siguiente cambio lo intenta de nuevo.'
      );
      expect(upstream).toEqual([]);

      broken = false;
      await replaceQuery(page, 'SELECT 2 AS x');
      await expect(page.getByTestId('sql-instant-preview').locator('tbody tr')).toHaveCount(1);
      await expect(page.getByTestId('sql-instant-error')).toHaveCount(0);
    });
  }

  test('never runs a write as you type', async ({ page }) => {
    await openQuery(page, 'en');
    await replaceQuery(page, 'CREATE TABLE instant_probe AS SELECT 1 AS x');
    await expect(page.getByTestId('sql-instant-preview')).toContainText('DML / DDL never auto-run');
    // Only DuckDB's parse catches these spellings.
    await replaceQuery(page, `SELECT "nextval"('instant_seq')`);
    await expect(page.getByTestId('sql-instant-preview')).toContainText('Side-effect functions never auto-run');
    await replaceQuery(page, "SELECT * FROM read_csv('ht' || 'tps://example.com/a.csv')");
    await expect(page.getByTestId('sql-instant-preview')).toContainText('Computed file paths never auto-run');
    await replaceQuery(page, "SELECT * FROM 'https://example.com/a.csv'");
    await expect(page.getByTestId('sql-instant-preview')).toContainText('Remote reads never auto-run');
    // The table was never created, so the preview of a read on it fails.
    await replaceQuery(page, 'SELECT * FROM instant_probe');
    await expect(page.getByTestId('sql-instant-error')).toBeVisible();
    await expect(page.getByTestId('sql-instant-table')).toHaveCount(0);
  });

  const BREAKDOWN = [
    "WITH cities AS (SELECT * FROM (VALUES ('Bogota', 120, 5021.75), ('Medellin', 87, 3410.0), ('Envigado', 0, 1250.5), ('Cali', NULL, 900.0)) t(city, orders, revenue))",
    'SELECT city, coalesce(revenue, 0) / orders AS ticket FROM cities ORDER BY city',
  ].join('\n');

  for (const language of ['en', 'es'] as const) {
    test(`breaks a computed column down and narrows to the rows behind it (${language})`, async ({ page }) => {
      await openQuery(page, language);
      await replaceQuery(page, BREAKDOWN);
      const table = page.getByTestId('sql-instant-table');
      await expect(table.locator('tbody tr')).toHaveCount(4);

      await page.getByTestId('sql-instant-column-breakdown').click();
      const nodes = page.getByTestId('sql-instant-breakdown-node');
      await expect(nodes).toHaveCount(4);
      await expect(nodes.nth(0)).toContainText('COALESCE(revenue, 0) / orders');
      await expect(nodes.nth(0)).toContainText(language === 'en' ? '25% null' : '25% nulos');
      await expect(nodes.nth(2)).toContainText('revenue');
      await expect(nodes.nth(2)).toBeDisabled();
      await expect(nodes.nth(3)).toContainText(language === 'en' ? '1 row = 0 → ticket ±∞ / NaN' : '1 fila = 0 → ticket ±∞ / NaN');

      await nodes.nth(3).click();
      await expect(table.locator('tbody tr')).toHaveCount(2);
      await expect(table.locator('tbody')).toContainText('Cali');
      await expect(table.locator('tbody')).toContainText('Envigado');
      await expect(page.getByTestId('sql-instant-narrowed')).toContainText(language === 'en' ? 'Rows where orders is NULL or 0' : 'Filas donde orders es NULL o 0');
      await page.getByTestId('sql-instant-narrowed-clear').click();
      await expect(table.locator('tbody tr')).toHaveCount(4);
    });
  }

  test('never regroups GROUP BY ALL, and falls back to the column when a part cannot run', async ({ page }) => {
    await openQuery(page, 'en');
    await replaceQuery(page, "SELECT city, a / b AS r, sum(a) AS s FROM (VALUES ('x', 1, 2), ('x', 2, 2), ('y', 1, NULL)) t(city, a, b) GROUP BY ALL ORDER BY city");
    await expect(page.getByTestId('sql-instant-table').locator('tbody tr')).toHaveCount(3);
    await page.getByTestId('sql-instant-column-breakdown').first().click();
    const nodes = page.getByTestId('sql-instant-breakdown-node');
    await expect(nodes).toHaveCount(1);
    await expect(nodes.first()).toContainText('33% null');

    await replaceQuery(page, 'SELECT (a + b) / 2 AS m FROM (VALUES (1, 2), (1, 2), (3, NULL)) t(a, b) GROUP BY a + b');
    await expect(page.getByTestId('sql-instant-table').locator('tbody tr')).toHaveCount(2);
    await page.getByTestId('sql-instant-column-breakdown').click();
    await expect(nodes).toHaveCount(1);
    await expect(nodes.first()).toContainText('50% null');
    await expect(page.getByTestId('sql-instant-breakdown-error')).toHaveCount(0);
  });

  test('never previews a macro, and stays quick on a long chain or a huge constant', async ({ page }) => {
    await openQuery(page, 'en');
    await replaceQuery(page, 'CREATE MACRO instant_macro() AS 1');
    await page.keyboard.press('ControlOrMeta+Enter');
    await expect(page.getByTestId('sql-instant-preview')).toHaveCount(0);
    await replaceQuery(page, 'SELECT instant_macro() AS x');
    await expect(page.getByTestId('sql-instant-preview')).toContainText('Only built-in functions and formats preview');

    const terms = Array.from({ length: 60 }, () => 'a').join(' + ');
    await replaceQuery(page, `SELECT ${terms} AS total FROM (VALUES (1), (NULL)) t(a)`);
    await page.getByTestId('sql-instant-column-breakdown').click();
    const nodes = page.getByTestId('sql-instant-breakdown-node');
    await expect(nodes.first()).toContainText('50% null', { timeout: 3_000 });
    expect(await nodes.count()).toBeLessThan(32);

    await replaceQuery(page, 'SELECT a + 9007199254740993 AS big FROM (VALUES (1)) t(a)');
    await expect(page.getByTestId('sql-instant-target')).toBeVisible();
    await expect(page.getByTestId('sql-instant-table').locator('th')).toContainText('big');
    await expect(page.getByTestId('sql-instant-column-breakdown')).toHaveCount(0);
  });

  test('keeps an aggregate whole under GROUP BY, and a UNION has nothing to break down', async ({ page }) => {
    await openQuery(page, 'en');
    await replaceQuery(page, "SELECT city, sum(n) / count(n) AS r FROM (VALUES ('a', 2), ('a', NULL)) t(city, n) GROUP BY city");
    await page.getByTestId('sql-instant-column-breakdown').click();
    const nodes = page.getByTestId('sql-instant-breakdown-node');
    await expect(nodes).toHaveCount(3);
    await expect(nodes.nth(1)).toContainText('sum(n)');
    await expect(nodes.nth(2)).toContainText('count(n)');
    await replaceQuery(page, 'SELECT 1 + 1 AS a UNION ALL SELECT 2');
    await expect(page.getByTestId('sql-instant-table').locator('tbody tr')).toHaveCount(2);
    await expect(page.getByTestId('sql-instant-column-breakdown')).toHaveCount(0);
  });
});

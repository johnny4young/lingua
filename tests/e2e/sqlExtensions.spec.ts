/**
 * DuckDB's extensions on the real engine: Lingua's copies serve what it ships,
 * nothing reaches DuckDB's host, and anything else fails by name.
 */
import { readFile } from 'node:fs/promises';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const NOT_INCLUDED = {
  en: (name: string) => `This query needs DuckDB's ${name} extension, which Lingua doesn't include.`,
  es: (name: string) => `Esta consulta necesita la extensión ${name} de DuckDB, que Lingua no incluye.`,
};
const NOT_LOADED = {
  en: (name: string) => `This query needs DuckDB's ${name} extension, and Lingua's copy did not load. Try again.`,
  es: (name: string) => `Esta consulta necesita la extensión ${name} de DuckDB y la copia de Lingua no cargó. Inténtalo de nuevo.`,
};

function watchExtensions(context: BrowserContext) {
  const host: string[] = [];
  const files = new Set<string>();
  context.on('request', (request) => {
    const url = request.url();
    if (url.includes('extensions.duckdb.org')) host.push(url);
    const file = /([a-z_]+)\.duckdb_extension/.exec(url)?.[1];
    if (file) files.add(file);
  });
  return { host, files };
}

async function openQuery(page: Page, language: 'en' | 'es', instant = false): Promise<void> {
  await seedSession(page, { language });
  if (instant) {
    await page.addInitScript(() => {
      const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
      raw.state.featureFlags = { instantSql: true };
      localStorage.setItem('lingua-settings', JSON.stringify(raw));
    });
  }
  await gotoApp(page);
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-query-list-create').click();
}

async function typeQuery(page: Page, text: string): Promise<void> {
  await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.press('Backspace');
  await expect(page.getByTestId('sql-query-editor-size')).toHaveText(/^0 B/);
  await page.keyboard.insertText(text);
}

async function run(page: Page, text: string): Promise<void> {
  await typeQuery(page, text);
  await page.getByTestId('sql-query-editor-run').click();
}

test.describe('DuckDB extensions', () => {
  for (const language of ['en', 'es'] as const) {
    test(`dates and a Parquet round trip use Lingua's copies (${language})`, async ({ page, context }) => {
      const seen = watchExtensions(context);
      await openQuery(page, language);

      await run(page, "SELECT current_date AS d, now() - INTERVAL 1 DAY AS y, date_trunc('day', now()) AS t");
      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
      expect([...seen.files].sort()).toEqual(['icu', 'json']);

      await run(page, "SELECT 1 AS id, 'Ada' AS name");
      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
      await page.getByTestId('sql-result-preview-export').click();
      await page.getByTestId('sql-export-format-parquet').click();
      const download = page.waitForEvent('download');
      await page.getByTestId('sql-export-download').click();
      const parquet = await readFile(await (await download).path());
      expect(parquet.subarray(0, 4).toString('latin1')).toBe('PAR1');
      await page.keyboard.press('Escape');

      await page.getByTestId('sql-workspace-import-input').setInputFiles({ name: 'people.parquet', mimeType: 'application/octet-stream', buffer: parquet });
      await expect(page.getByTestId('sql-import-modal-name')).toHaveValue('people');
      await page.getByTestId('sql-import-modal-confirm').click();
      const people = page.locator('[data-testid="sql-explorer-table"][data-table-name="people"]');
      await expect(people.locator('..').getByTestId('sql-explorer-row-count')).toHaveText('1');

      expect([...seen.files].sort()).toEqual(['icu', 'json', 'parquet']);
      expect(seen.host).toEqual([]);
    });

    test(`names an extension it does not ship, and the engine keeps working (${language})`, async ({ page, context }) => {
      const seen = watchExtensions(context);
      await openQuery(page, language);
      const error = page.getByTestId('sql-result-preview-error-sql-error');

      await run(page, "SELECT '1.2.3.4'::INET AS ip");
      await expect(error).toContainText(NOT_INCLUDED[language]('inet'));
      await run(page, 'LOAD spatial');
      await expect(error).toContainText(NOT_INCLUDED[language]('spatial'));
      await run(page, 'SELECT 1 AS x');
      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
      expect(seen.host).toEqual([]);
    });

    test(`recovers when its ICU copy failed at start (${language})`, async ({ page, context }) => {
      const seen = watchExtensions(context);
      let broken = true;
      await context.route(/\/icu\.duckdb_extension\.wasm$/, (route) => (broken ? route.fulfill({ status: 200, contentType: 'application/wasm', body: 'not a signed extension' }) : route.continue()));
      await openQuery(page, language);

      await run(page, 'SELECT current_date AS d');
      await expect(page.getByTestId('sql-result-preview-error-sql-error')).toContainText(NOT_LOADED[language]('icu'));

      broken = false;
      await run(page, 'SELECT current_date AS d');
      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
      expect(seen.host).toEqual([]);
    });
  }

  test('Instant SQL previews date functions from the copy and names the rest as you type', async ({ page, context }) => {
    const seen = watchExtensions(context);
    await openQuery(page, 'en', true);
    const preview = page.getByTestId('sql-instant-preview');

    await typeQuery(page, 'SELECT current_date AS d, today() AS t');
    await expect(preview.locator('tbody tr')).toHaveCount(1);
    await typeQuery(page, "SELECT '1.2.3.4'::INET AS ip");
    await expect(page.getByTestId('sql-instant-error')).toHaveText(NOT_INCLUDED.en('inet'));
    await typeQuery(page, 'SELECT 1 AS x');
    await expect(preview.locator('tbody tr')).toHaveCount(1);
    await expect(page.getByTestId('sql-instant-error')).toHaveCount(0);
    expect(seen.host).toEqual([]);
  });

  test('offline, dates keep working and Parquet says its copy did not load, then recovers', async ({ page, context, consoleErrors }) => {
    const seen = watchExtensions(context);
    await openQuery(page, 'en');
    await run(page, 'SELECT current_date AS d');
    await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);

    await context.setOffline(true);
    await run(page, "SELECT date_trunc('month', now()) AS m");
    await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
    const missingFile = "SELECT * FROM read_parquet('missing.parquet')";
    await run(page, missingFile);
    const error = page.getByTestId('sql-result-preview-error-sql-error');
    await expect(error).toContainText(NOT_LOADED.en('parquet'));

    await context.setOffline(false);
    await run(page, `${missingFile} -- now online`);
    await expect(error).toBeVisible();
    await expect(error).not.toContainText('did not load');
    expect(seen.files.has('parquet')).toBe(true);
    expect(seen.host).toEqual([]);
    // The blocked reads of the Parquet copy log these; the fixture still checks anything else.
    const unexpected = consoleErrors.filter((error) => error !== 'Failed to load resource: net::ERR_INTERNET_DISCONNECTED');
    consoleErrors.length = 0;
    expect(unexpected).toEqual([]);
  });

  test('a saved database reopens with no request to the host', async ({ page, context }) => {
    const seen = watchExtensions(context);
    // A route turns the browser's cache off, so a reload shows every extension it reads.
    await context.route(/\.duckdb_extension\.wasm$/, (route) => route.continue());
    await seedSession(page, { language: 'en' });
    await page.addInitScript(() => {
      const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
      raw.state.sqlWorkspacePersistTables = true;
      localStorage.setItem('lingua-settings', JSON.stringify(raw));
    });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-query-list-create').click();
    await run(page, 'CREATE OR REPLACE TABLE saved_times AS SELECT now() AS saved_at, current_date AS saved_day');
    await expect(page.locator('[data-testid="sql-explorer-table"][data-table-name="saved_times"]')).toBeVisible();
    seen.files.clear();
    await page.reload();
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await run(page, 'SELECT saved_at, saved_day FROM saved_times');
    // The row restored with the page is the earlier statement's count, so wait for the dates.
    await expect(page.getByTestId('sql-result-preview-row')).toContainText(String(new Date().getUTCFullYear()));
    expect([...seen.files].sort()).toEqual(['icu', 'json']);

    expect(seen.host).toEqual([]);
  });

  test.describe('with the service worker', () => {
    test.use({ serviceWorkers: 'allow' });

    test('dates work after an offline reload', async ({ page, context }) => {
      await openQuery(page, 'en');
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
      await page.reload();
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await page.getByTestId('sql-query-list-create').click();
      await run(page, 'SELECT current_date AS d');
      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);

      await context.setOffline(true);
      await page.reload();
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await page.getByTestId('sql-query-list-create').click();
      await run(page, 'SELECT current_date AS d');
      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(1);
    });
  });
});

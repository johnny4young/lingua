/**
 * SQL grid magics on the real DuckDB-WASM engine, with Rich display on:
 * links, 0–1 bars, checks and image thumbnails in the result cells.
 */
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const QUERY = [
  `SELECT 'https://lingua.dev/docs' AS site, 0.25::DOUBLE AS share, true AS active, from_base64('${PIXEL}') AS logo`,
  `UNION ALL SELECT 'plain text', 0.8::DOUBLE, false, NULL`,
].join(' ');

async function seed(page: Page, language: 'en' | 'es'): Promise<void> {
  await seedSession(page, { language });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { richDisplay: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
}

test.describe('SQL grid magics', () => {
  for (const language of ['en', 'es'] as const) {
    test(`draws links, bars, checks and thumbnails (${language})`, async ({ page }) => {
      await seed(page, language);
      await gotoApp(page);
      await page.keyboard.press('ControlOrMeta+Alt+S');
      await page.getByTestId('sql-query-list-create').click();
      const editor = page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor');
      await editor.click({ position: { x: 120, y: 20 } });
      await page.keyboard.press('ControlOrMeta+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.insertText(QUERY);
      await page.keyboard.press('ControlOrMeta+Enter');

      await expect(page.getByTestId('sql-result-preview-row')).toHaveCount(2);
      const link = page.getByTestId('sql-cell-link');
      await expect(link).toHaveCount(1);
      await expect(link).toHaveAttribute('title', language === 'en' ? 'Cmd/Ctrl+click to open' : 'Cmd/Ctrl+clic para abrir');
      await expect(page.getByTestId('sql-cell-bar')).toHaveCount(2);
      await expect(page.getByTestId('sql-cell-check')).toHaveText(['✓', '✗']);
      await expect(page.getByTestId('sql-cell-thumb')).toHaveAttribute('src', /^data:image\/png;base64,/);
      const url = page.url();
      await link.click();
      expect(page.url()).toBe(url);
      await expect(page.getByTestId('sql-result-preview-row').first()).toHaveAttribute('aria-selected', 'true');
    });
  }
});

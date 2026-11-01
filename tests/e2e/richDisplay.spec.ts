/**
 * Rich display: lingua.display shows a value as a table in the Console and
 * lingua.display.progress keeps one row that redraws in place.
 */
import type { Page } from '@playwright/test';
import { createLanguageTab, dismissWhatsNew, expect, gotoApp, replaceEditorText, seedSession, test } from './licenseWeb.helpers';

async function seedDisplay(page: Page, language: 'en' | 'es'): Promise<void> {
  await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run', python: 'run' } });
  await page.addInitScript(() => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    raw.state.featureFlags = { richDisplay: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
  });
}

test.describe('Rich display', () => {
  for (const language of ['en', 'es'] as const) {
    test(`shows a table and one progress row that redraws (${language})`, async ({ page }) => {
      await seedDisplay(page, language);
      await gotoApp(page);
      await replaceEditorText(
        page,
        [
          'lingua.display([{ city: "Envigado", orders: 42 }, { city: "Medellin", orders: 87 }]);',
          'const bar = lingua.display.progress("import");',
          'for (let i = 1; i <= 25; i++) bar.update(i / 25, `${i} / 25 files`);',
          'console.log("done-marker");',
        ].join('\n')
      );
      await page.keyboard.press('ControlOrMeta+Enter');
      const rows = page.getByTestId('console-entry-row');
      await expect(rows.filter({ hasText: 'done-marker' })).toHaveCount(1);
      await expect(rows.filter({ hasText: language === 'en' ? 'Table 2×2' : 'Tabla 2×2' })).toHaveCount(1);
      const bars = page.getByRole('progressbar', { name: 'import' });
      await expect(bars).toHaveCount(1);
      await expect(bars).toHaveAttribute('aria-valuenow', '100');
      await expect(page.getByTestId('rich-value-progress')).toContainText('25 / 25 files');
    });
  }

  test('shows Python display values in order with print, and one progress row', async ({ page }) => {
    test.setTimeout(180_000);
    await seedDisplay(page, 'en');
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
    await replaceEditorText(
      page,
      ['print("before-marker")', 'display([{"city": "Bogota", "orders": 120}])', 'bar = display.progress("load")', 'for i in range(1, 11):', '    bar.update(i / 10)', '', 'print("after-marker")'].join('\n')
    );
    await page.keyboard.press('ControlOrMeta+Enter');
    const rows = page.getByTestId('console-entry-row');
    await expect(rows.filter({ hasText: 'after-marker' })).toHaveCount(1, { timeout: 120_000 });
    await expect(rows.filter({ hasText: 'Table 1×2' })).toHaveCount(1);
    await expect(page.getByRole('progressbar', { name: 'load' })).toHaveAttribute('aria-valuenow', '100');
    const texts = await rows.allTextContents();
    const order = ['before-marker', 'Table 1×2', 'after-marker'].map(marker => texts.findIndex(text => text.includes(marker)));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });
});

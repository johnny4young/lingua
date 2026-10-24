/** Real Monaco input, including the persisted draft; no server database is used. */
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';
import { getSqlQueryAutoSaveDebounceMs } from '../../src/renderer/components/SqlWorkspace/sqlQueryEditorTiming';

async function replaceWithKeystrokes(page: Page, source: string): Promise<void> {
  await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor .overflow-guard').click();
  await page.keyboard.press('ControlOrMeta+A');
  // Per-character native events exercise controlled reconciliation; insertText is one event.
  await page.keyboard.type(source);
}

async function savedQuery(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const stored = JSON.parse(localStorage.getItem('lingua-workspace-sql-state') ?? '{}') as {
      state?: { activeQueryId?: string; queries?: Array<{ id: string; query: string }> };
    };
    return stored.state?.queries?.find(query => query.id === stored.state?.activeQueryId)?.query ?? null;
  });
}

for (const language of ['en', 'es'] as const) {
  test(`preserves fast SQL input and the saved draft (${language.toUpperCase()})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    await page.getByTestId('sql-query-list-create').click();
    const editor = page.getByTestId('sql-query-editor-monaco');
    await expect(editor.locator('.monaco-editor')).toBeVisible();
    if (language === 'es') {
      await page.getByTestId('action-pill-settings').click();
      await page.locator('#settings-rail-appearance').click();
      await page.getByTestId('app-language-select').selectOption('es');
      await page.keyboard.press('Escape');
    }
    await expect(page.getByTestId('sql-query-editor-run')).toContainText(language === 'es' ? 'Ejecutar' : 'Run');

    const debounce = getSqlQueryAutoSaveDebounceMs();
    // Two ordinary replacements, then edits near either side of a pending save's quiet window.
    for (const [index, pause] of [0, 0, debounce - 50, debounce - 10].entries()) {
      if (pause > 0) {
        await editor.locator('.monaco-editor .overflow-guard').click();
        await page.keyboard.press('ControlOrMeta+A');
        await page.keyboard.insertText('SELECT 420000 AS pending');
        await page.waitForTimeout(pause);
      }
      const source = `SELECT ${424201 + index} AS answer`;
      await replaceWithKeystrokes(page, source);
      await expect.poll(async () => (await editor.locator('.view-lines').innerText()).replace(/\u00a0/g, ' ').trim()).toBe(source);
      await expect.poll(() => savedQuery(page)).toBe(source);
    }
    expect(errors).toEqual([]);
  });
}

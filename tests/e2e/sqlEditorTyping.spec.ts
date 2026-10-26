/** Real Monaco input, including the persisted draft; no server database is used. */
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test, waitForSeededWorkspaceSettled } from './licenseWeb.helpers';
import { getSqlQueryAutoSaveDebounceMs } from '../../src/renderer/components/SqlWorkspace/sqlQueryEditorTiming';

async function replaceWithKeystrokes(page: Page, source: string): Promise<void> {
  await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor .overflow-guard').click();
  await page.keyboard.press('ControlOrMeta+A');
  // Per-character native events exercise controlled reconciliation; insertText is one event.
  await page.keyboard.type(source);
}

async function savedQuery(page: Page, queryId?: string): Promise<string | null> {
  return page.evaluate(queryId => {
    const stored = JSON.parse(localStorage.getItem('lingua-workspace-sql-state') ?? '{}') as {
      state?: { activeQueryId?: string; queries?: Array<{ id: string; query: string }> };
    };
    return stored.state?.queries?.find(query => query.id === (queryId ?? stored.state?.activeQueryId))?.query ?? null;
  }, queryId);
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

  test(`keeps undo separate for queries with identical text (${language.toUpperCase()})`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await seedSession(page, { language });
    await gotoApp(page);
    await waitForSeededWorkspaceSettled(page);
    await page.keyboard.press('ControlOrMeta+Alt+S');
    const source = 'SELECT 1 AS fixture';
    const ids: string[] = [];
    for (let index = 0; index < 2; index += 1) {
      await page.getByTestId('sql-query-list-create').click();
      await expect(page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor')).toBeVisible();
      const id = await page.locator('[data-testid="sql-query-tab"][data-active="true"]').getAttribute('data-query-id');
      if (!id) throw new Error('The new query must have a document id');
      ids.push(id);
      await replaceWithKeystrokes(page, source);
      await expect.poll(() => savedQuery(page, id)).toBe(source);
    }
    await page.locator(`[data-testid="sql-query-list-row"][data-query-id="${ids[0]}"]`).click();
    const editor = page.getByTestId('sql-query-editor-monaco');
    await expect(page.getByTestId('sql-query-editor-run')).toContainText(language === 'es' ? 'Ejecutar' : 'Run');
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(editor.locator('.lingua-sql-run-glyph')).toHaveCount(1);
    await editor.locator('.overflow-guard').click();
    await page.keyboard.press('ControlOrMeta+z');
    // A new edit makes the saved-state oracle wait for this document's actual post-Undo model,
    // rather than accepting the unchanged saved text before the next auto-save.
    await page.keyboard.press('End');
    await page.keyboard.insertText(';');
    await expect.poll(async () => (await editor.locator('.view-lines').innerText()).replace(/\u00a0/g, ' ').trim()).toBe(`${source};`);
    await expect.poll(() => savedQuery(page, ids[0])).toBe(`${source};`);
    await expect.poll(() => savedQuery(page, ids[1])).toBe(source);
    expect(errors).toEqual([]);
  });
}

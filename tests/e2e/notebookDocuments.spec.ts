/** Real Chromium FSA commits; only native picker selections are substituted. */
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

async function installPickers(page: Page) {
  await page.addInitScript(() => {
    const folder = () =>
      navigator.storage
        .getDirectory()
        .then(root => root.getDirectoryHandle('notebook-documents', { create: true }));
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: folder });
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => [await (await folder()).getFileHandle('original.linguanb')],
    });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async () => {
        if (sessionStorage.getItem('cancel-save') === 'yes')
          throw new DOMException('Cancelled', 'AbortError');
        return (await folder()).getFileHandle('saved.linguanb', { create: true });
      },
    });
  });
}
async function seedFile(page: Page) {
  await page.evaluate(async () => {
    const directory = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('notebook-documents', { create: true });
    const file = await directory.getFileHandle('original.linguanb', { create: true });
    const writable = await file.createWritable();
    await writable.write(
      JSON.stringify({
        format: 'linguanb',
        documentVersion: 1,
        notebook: {
          version: 1,
          id: 'stable-document',
          title: 'Persistent notebook',
          createdAt: '2026-09-30T00:00:00.000Z',
          cells: [
            { kind: 'markdown', id: 'intro', source: '# Preserved markdown' },
            {
              kind: 'code',
              id: 'js',
              language: 'javascript',
              source: 'console.log("captured");',
              outputs: [{ kind: 'text', stream: 'stdout', text: 'previous output' }],
            },
            ...(['typescript', 'python', 'sql'] as const).map(language => ({
              kind: 'code',
              id: language,
              language,
              source: language === 'sql' ? 'select 1;' : '1',
              outputs: [],
            })),
          ],
        },
        executionOrder: { js: 7 },
      })
    );
    await writable.close();
  });
}
async function editFirst(page: Page, source: string) {
  const row = page.getByTestId('notebook-code-cell-row').first();
  const staticView = row.getByTestId('notebook-code-cell-static');
  if (await staticView.count()) await staticView.click();
  const editor = row.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(source);
}
async function disk(page: Page, name: string) {
  return page.evaluate(async name => {
    const dir = await (
      await navigator.storage.getDirectory()
    ).getDirectoryHandle('notebook-documents');
    return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
  }, name);
}
for (const language of ['en', 'es'] as const) {
  test(`manual notebook document save, conflict, Save As and recovery (${language})`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await installPickers(page);
    await seedSession(page, { language, primeProLicense: true, restoreSessionMode: 'always' });
    await gotoApp(page);
    await seedFile(page);
    await page.keyboard.press('ControlOrMeta+O');
    await expect(page.getByTestId('notebook-view')).toBeVisible();
    await expect(page.getByTestId('notebook-code-cell-row')).toHaveCount(4);
    await expect(page.getByTestId('notebook-view')).toContainText('previous output');
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    await editFirst(page, 'console.log("edited");');
    await expect(page.getByTestId('notebook-document-dirty')).toBeVisible();
    await page.getByTestId('notebook-document-save').click();
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    const saved = await disk(page, 'original.linguanb');
    expect(saved.notebook.cells.map((cell: { id: string }) => cell.id)).toEqual([
      'intro',
      'js',
      'typescript',
      'python',
      'sql',
    ]);
    expect(saved.notebook.cells[1].source).toBe('console.log("edited");');
    expect(saved.executionOrder).toEqual({ js: 7 });
    await editFirst(page, 'console.log("local remains");');
    await page.evaluate(async () => {
      const dir = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle('notebook-documents');
      const file = await dir.getFileHandle('original.linguanb');
      const writer = await file.createWritable();
      await writer.write('external modification');
      await writer.close();
    });
    await page.getByTestId('notebook-document-save').click();
    await expect(page.getByTestId('status-notice-banner')).toContainText(
      language === 'en' ? /changed on disk/ : /cambió en disco/
    );
    await expect(page.getByTestId('notebook-document-dirty')).toBeVisible();
    await page.evaluate(() => sessionStorage.setItem('cancel-save', 'yes'));
    await page.getByTestId('notebook-document-save-as').click();
    await expect(page.getByTestId('notebook-document-dirty')).toBeVisible();
    await page.evaluate(() => sessionStorage.removeItem('cancel-save'));
    await page.getByTestId('notebook-document-save-as').click();
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    expect((await disk(page, 'saved.linguanb')).notebook.cells[1].source).toBe(
      'console.log("local remains");'
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            JSON.parse(localStorage.getItem('lingua-session') ?? '{}').state?.savedTabs?.some(
              (tab: { name: string }) => tab.name === 'saved.linguanb'
            ) ?? false
        )
      )
      .toBe(true);
    expect(errors).toEqual([]);
    const beforeReload = await page.evaluate(() => Object.fromEntries(['lingua-settings', 'lingua-session', 'lingua-notebook-state', 'lingua-safe-mode'].map(key => [key, localStorage.getItem(key)])));
    await page.reload();
    await expect(page.getByTestId('notebook-view')).toBeVisible().catch(async error => {
      await test.info().attach('recovery-storage', { body: JSON.stringify({ beforeReload, afterReload: await page.evaluate(() => Object.fromEntries(['lingua-settings', 'lingua-session', 'lingua-notebook-state', 'lingua-safe-mode'].map(key => [key, localStorage.getItem(key)]))) }), contentType: 'application/json' });
      throw error;
    });
    await expect(page.getByTestId('notebook-view')).toContainText('previous output');
    await expect(page.getByTestId('notebook-document-dirty')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
test('Free cannot open a selected notebook document', async ({ page }) => {
  await installPickers(page);
  await seedSession(page, { language: 'en' });
  await gotoApp(page);
  await seedFile(page);
  await page.keyboard.press('ControlOrMeta+O');
  await expect(page.getByTestId('status-notice-banner')).toBeVisible();
  await expect(page.getByTestId('notebook-view')).toHaveCount(0);
});

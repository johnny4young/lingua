/**
 * Notebook runtime correctness: a Python cell answers a long collection and a
 * huge int with a bounded value and their real size, and SQL cells whose
 * tables an engine reconnect dropped turn stale and run again on Refresh.
 */

import type { Locator, Page } from '@playwright/test';
import {
  closeSettings,
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
  waitForSeededWorkspaceSettled,
} from './licenseWeb.helpers';
import { isKnownBenignConsoleError } from './consoleErrorFilter';

async function editCell(page: Page, row: Locator, code: string): Promise<void> {
  const staticView = row.getByTestId('notebook-code-cell-static');
  if ((await staticView.count()) > 0) await staticView.click();
  const editor = row.locator('.monaco-editor').first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(code);
}

async function addCell(page: Page, language: string, code: string): Promise<Locator> {
  const rows = page.getByTestId('notebook-code-cell-row');
  const before = await rows.count();
  await page.getByTestId('notebook-cells-append-code').click();
  await expect(rows).toHaveCount(before + 1);
  const row = rows.nth(before);
  await row.getByTestId('notebook-code-cell-language').selectOption(language);
  await editCell(page, row, code);
  return row;
}

async function runCell(row: Locator): Promise<void> {
  await row.getByTestId('notebook-code-cell-run').click();
  await expect(row.getByTestId('notebook-code-cell-status')).toHaveAttribute('data-status', 'ok', { timeout: 120_000 });
}

const answerOn = (row: Locator, line: number) => row.locator(`[data-testid="notebook-cell-answer"][data-line="${line}"]`);
const status = (row: Locator) => row.getByTestId('notebook-code-cell-status');

for (const language of ['en', 'es'] as const) {
  test(`notebook runtime answers sizes and replays dropped SQL tables (${language})`, async ({ page }) => {
    // Pyodide boots on the first Python run.
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error' && !isKnownBenignConsoleError(message.text())) errors.push(message.text());
    });
    page.on('pageerror', error => {
      if (!isKnownBenignConsoleError(error.message)) errors.push(error.message);
    });
    await seedSession(page, { language, primeProLicense: true });
    await gotoApp(page);
    await waitForSeededWorkspaceSettled(page);
    await page.keyboard.press('ControlOrMeta+Alt+N');
    await expect(page.getByTestId('notebook-view')).toBeVisible();

    const python = page.getByTestId('notebook-code-cell-row').first();
    await python.getByTestId('notebook-code-cell-language').selectOption('python');
    await editCell(page, python, 'readings = list(range(100000))\nhuge = 2 ** 20000\nlabels = {f"k{i}": i for i in range(2000)}');
    await runCell(python);
    // The tag counts the whole value, not the part that fits on the line.
    await expect(answerOn(python, 1)).toContainText('list·100K');
    await expect(answerOn(python, 2)).toContainText('int·6021');
    await expect(answerOn(python, 2)).toContainText('398027684033796659');
    await expect(answerOn(python, 3)).toContainText('dict·2000');

    const create = await addCell(page, 'sql', 'CREATE TABLE orders AS SELECT range AS id FROM range(4)');
    await runCell(create);
    const read = await addCell(page, 'sql', 'SELECT count(*) AS n FROM orders');
    await runCell(read);

    // Reconnecting the in-memory engine drops its tables.
    page.on('dialog', dialog => void dialog.accept());
    await openSettings(page);
    await openSettingsTab(page, 'editor');
    await page.getByTestId('settings-sql-reconnect').click();
    await closeSettings(page);
    await expect(status(create)).toHaveAttribute('data-status', 'stale');
    await expect(status(read)).toHaveAttribute('data-status', 'stale');
    await expect(status(python)).toHaveAttribute('data-status', 'ok');

    await page.getByTestId('notebook-toolbar-refresh-stale').click();
    await expect(status(read)).toHaveAttribute('data-status', 'ok', { timeout: 120_000 });
    await expect(status(create)).toHaveAttribute('data-status', 'ok');
    await expect(answerOn(read, 1)).toContainText('4');
    expect(errors).toEqual([]);
  });
}

/**
 * Notebook answers through the shared answer renderer: a JavaScript cell that
 * throws keeps the answers above the throw, and Python cells name what they
 * make and use (functions, classes, import aliases, chained assignments),
 * keep those chips across a reload, and answer a print from a function
 * another cell defined on the line that called it.
 */

import type { Locator, Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test, waitForSeededWorkspaceSettled } from './licenseWeb.helpers';
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

const answerOn = (row: Locator, line: number) => row.locator(`[data-testid="notebook-cell-answer"][data-line="${line}"]`);

for (const language of ['en', 'es'] as const) {
  test(`notebook cells answer through the shared renderer (${language})`, async ({ page }) => {
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

    const throws = page.getByTestId('notebook-code-cell-row').first();
    await editCell(page, throws, "const prices = [12, 7.5, 30];\nprices.length\nconst gone = null;\ngone.size");
    await throws.getByTestId('notebook-code-cell-run').click();
    await expect(throws.getByTestId('notebook-code-cell-status')).toHaveAttribute('data-status', 'error');
    // The line before the throw keeps its answer; the throw answers on its own line.
    await expect(answerOn(throws, 2).getByTestId('answer-object-value')).toHaveText('3');
    await expect(answerOn(throws, 2).getByTestId('answer-object-value')).toHaveAttribute('data-tone', 'number');
    await expect(answerOn(throws, 4).getByTestId('answer-object')).toHaveAttribute('data-tone', 'error');
    await expect(answerOn(throws, 4)).toContainText('TypeError');

    const defs = await addCell(page, 'python', 'import math as m\nx = y = 2\ndef greet(name): print("hi", name)\nclass Box: pass');
    const call = await addCell(page, 'python', 'greet("ana")\nticks = [3, 1, 4]');
    for (const row of [defs, call]) {
      await row.getByTestId('notebook-code-cell-run').click();
      await expect(row.getByTestId('notebook-code-cell-status')).toHaveAttribute('data-status', 'ok', { timeout: 120_000 });
    }
    const made = language === 'es' ? 'crea' : 'makes';
    await expect(defs.getByTestId('notebook-code-cell-produces')).toHaveText(new RegExp(`m, x, y, greet, Box$`));
    await expect(call.getByTestId('notebook-code-cell-uses')).toContainText('greet');
    // A print from a function the cell above defined answers on the line that called it.
    await expect(answerOn(call, 1)).toContainText('hi ana');
    await expect(answerOn(call, 2).getByTestId('answer-picture-bars')).toBeVisible();
    await expect(answerOn(call, 2)).toContainText('list·3');

    await expect
      .poll(() => page.evaluate(() => localStorage.getItem('lingua-notebook-state')?.includes('greet(\\"ana\\")') ?? false))
      .toBe(true);
    await page.reload();
    await page.getByTestId('status-notice-action-editor.restoreSession.promptCta').click();
    await expect(page.getByTestId('notebook-view')).toBeVisible();
    const rows = page.getByTestId('notebook-code-cell-row');
    await expect(rows.nth(1).getByTestId('notebook-code-cell-produces')).toHaveText(new RegExp(`m, x, y, greet, Box$`));
    await expect(rows.nth(1).getByTestId('notebook-code-cell-produces')).toContainText(made);
    await expect(rows.nth(2).getByTestId('notebook-code-cell-uses')).toContainText('greet');
    expect(errors).toEqual([]);
  });
}

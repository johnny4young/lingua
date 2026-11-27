/**
 * The notebook toolbar holds one row with its stale notice at 1440 px in both
 * locales, folds its kernel actions into ⋯ on a narrow notebook, swaps Run all
 * for Stop while cells run, and never moves the cells when the notice appears.
 * Markdown cells read as prose with a Fraunces heading.
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

async function openNotebook(page: Page, language: 'en' | 'es', width: number): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' && !isKnownBenignConsoleError(message.text())) errors.push(message.text());
  });
  page.on('pageerror', error => {
    if (!isKnownBenignConsoleError(error.message)) errors.push(error.message);
  });
  await page.setViewportSize({ width, height: 900 });
  await seedSession(page, { language, primeProLicense: true });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await page.keyboard.press('ControlOrMeta+Alt+N');
  await expect(page.getByTestId('notebook-view')).toBeVisible();
  return errors;
}

/** Runs two JS cells, then edits the first so both read stale. */
async function makeStale(page: Page): Promise<void> {
  const rows = page.getByTestId('notebook-code-cell-row');
  await page.getByTestId('notebook-cells-append-code').click();
  await expect(rows).toHaveCount(2);
  await editCell(page, rows.nth(0), 'const base = 21;');
  await editCell(page, rows.nth(1), 'base * 2');
  await page.getByTestId('notebook-toolbar-run-all').click();
  await expect(rows.nth(1).getByTestId('notebook-code-cell-status')).toHaveAttribute('data-status', 'ok', {
    timeout: 60_000,
  });
  await editCell(page, rows.nth(0), 'const base = 10;');
  await rows.nth(1).click();
  await expect(page.getByTestId('notebook-reactivity-banner')).toBeVisible();
}

const toolbar = (page: Page) => page.getByTestId('notebook-toolbar');
const top = async (locator: Locator) => (await locator.boundingBox())!.y;

for (const language of ['en', 'es'] as const) {
  test(`${language}: one toolbar row at 1440 px with the stale notice at its end`, async ({ page }) => {
    const errors = await openNotebook(page, language, 1440);
    const heightBefore = await toolbar(page).evaluate(el => (el as HTMLElement).offsetHeight);
    const firstCellTop = await top(page.getByTestId('notebook-markdown-cell-row'));
    await makeStale(page);

    await expect(toolbar(page)).toHaveAttribute('data-fit', /^(full|nometa)$/u);
    expect(await toolbar(page).evaluate(el => (el as HTMLElement).offsetHeight)).toBe(heightBefore);
    expect(heightBefore).toBeLessThan(56);
    const banner = page.getByTestId('notebook-reactivity-banner');
    const runAll = page.getByTestId('notebook-toolbar-run-all');
    expect(Math.abs((await top(banner)) + 15 - ((await top(runAll)) + 14))).toBeLessThan(3);
    // Every action stays inline; nothing folds into ⋯.
    for (const id of ['restart', 'clear-outputs', 'export', 'run-above', 'run-from-here']) {
      await expect(page.getByTestId(`notebook-toolbar-${id}`)).toBeVisible();
    }
    await expect(page.getByTestId('notebook-toolbar-more')).toHaveCount(0);
    await expect(page.getByTestId('notebook-toolbar-add-code')).toHaveCount(0);
    expect(await top(page.getByTestId('notebook-markdown-cell-row'))).toBe(firstCellTop);
    expect(errors).toEqual([]);
  });
}

test('a narrow notebook folds kernel actions into ⋯ and keeps the cells still', async ({ page }) => {
  const errors = await openNotebook(page, 'en', 768);
  await expect(toolbar(page)).toHaveAttribute('data-fit', /^(menu|runmenu)$/u);
  await expect(page.getByTestId('notebook-toolbar-restart')).toHaveCount(0);
  const more = page.getByTestId('notebook-toolbar-more');
  await more.click();
  const menu = page.getByTestId('notebook-toolbar-more-menu');
  await expect(menu.getByTestId('notebook-toolbar-restart')).toBeVisible();
  await expect(menu.getByTestId('notebook-toolbar-clear-outputs')).toBeDisabled();
  await menu.getByTestId('notebook-toolbar-export').click();
  await expect(menu).toHaveCount(0);
  await expect(page.getByTestId('notebook-export-menu')).toBeVisible();
  // The export menu takes focus, and Escape hands it back to ⋯.
  await expect(page.getByTestId('notebook-export-script')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByTestId('notebook-export-ipynb')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('notebook-export-menu')).toHaveCount(0);
  await expect(more).toBeFocused();
  // ⋯ never stacks on an open export menu.
  await more.click();
  await menu.getByTestId('notebook-toolbar-export').click();
  await more.click();
  await expect(page.locator('[role="menu"]')).toHaveCount(1);
  // A wider row empties ⋯, so an open menu closes instead of floating empty.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(more).toHaveCount(0);
  await expect(page.locator('[role="menu"]')).toHaveCount(0);
  await page.setViewportSize({ width: 768, height: 900 });

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(toolbar(page)).toHaveAttribute('data-fit', 'stacked');
  const heightBefore = await toolbar(page).evaluate(el => (el as HTMLElement).offsetHeight);
  const firstCellTop = await top(page.getByTestId('notebook-markdown-cell-row'));
  await makeStale(page);
  await page.getByTestId('notebook-cells').evaluate(el => el.scrollTo(0, 0));
  expect(await toolbar(page).evaluate(el => (el as HTMLElement).offsetHeight)).toBe(heightBefore);
  expect(await top(page.getByTestId('notebook-markdown-cell-row'))).toBe(firstCellTop);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBe(375);
  expect(errors).toEqual([]);
});

test('Stop takes Run all’s place only while cells run', async ({ page }) => {
  const errors = await openNotebook(page, 'en', 1440);
  const runAll = page.getByTestId('notebook-toolbar-run-all');
  const stop = page.getByTestId('notebook-toolbar-stop');
  await expect(runAll).toBeVisible();
  await expect(stop).toBeHidden();
  const row = page.getByTestId('notebook-code-cell-row').first();
  await editCell(page, row, 'const end = Date.now() + 20000;\nwhile (Date.now() < end) {}');
  await runAll.click();
  await expect(stop).toBeVisible();
  await expect(runAll).toBeHidden();
  const stopBox = (await stop.boundingBox())!;
  const runBox = (await runAll.boundingBox())!;
  expect(stopBox.x).toBe(runBox.x);
  await stop.click();
  await expect(runAll).toBeVisible({ timeout: 15_000 });
  await expect(stop).toBeHidden();
  expect(errors).toEqual([]);
});

test('markdown reads as prose with its chrome on hover', async ({ page }) => {
  const errors = await openNotebook(page, 'en', 1440);
  const cell = page.getByTestId('notebook-markdown-cell-row');
  const heading = cell.locator('h1');
  // With a code cell active, the markdown cell reads as plain prose.
  await page.getByTestId('notebook-code-cell-row').first().click({ position: { x: 400, y: 14 } });
  await expect(cell).not.toHaveAttribute('data-active', 'true');
  await expect(heading).toHaveText('Welcome to Lingua notebooks');
  expect(await heading.evaluate(el => getComputedStyle(el).fontFamily)).toMatch(/Fraunces/u);
  expect(await heading.evaluate(el => getComputedStyle(el).fontStyle)).toBe('italic');
  expect(parseFloat(await heading.evaluate(el => getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(17);
  await expect(cell).toHaveCSS('border-top-color', 'rgba(0, 0, 0, 0)');

  const chrome = page.getByTestId('notebook-markdown-cell-delete').locator('xpath=ancestor::header[1]');
  await page.mouse.move(0, 0);
  await expect(chrome).toHaveCSS('opacity', '0');
  await heading.hover();
  await expect(chrome).toHaveCSS('opacity', '1');
  await expect(page.getByTestId('notebook-markdown-cell-kind')).toBeVisible();

  await page.getByTestId('notebook-markdown-cell-preview').dblclick();
  const source = page.getByTestId('notebook-markdown-cell-source');
  await expect(source).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('notebook-markdown-cell-preview')).toBeVisible();
  await page.getByTestId('notebook-markdown-cell-move-down').click();
  await expect(page.getByTestId('notebook-markdown-cell-row')).toHaveAttribute('data-cell-id', 'cell-welcome');
  await expect(page.locator('[data-notebook-cell-shell]').nth(1)).toHaveAttribute('data-cell-kind', 'markdown');
  expect(errors).toEqual([]);
});

/**
 * implementation — presenter / focus mode end-to-end.
 *
 * Locks the acceptance criteria on the production web build:
 *   - the shortcut hides the toolbar chrome and lifts the editor font,
 *   - toggling again restores the exact previous layout,
 *   - the palette action drives the same toggle.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  expect,
  gotoApp,
  openConsole,
  seedSession,
  test,
} from './licenseWeb.helpers';

const PRESENTER_CHORD = process.platform === 'darwin' ? 'Meta+Alt+P' : 'Control+Alt+P';

async function editorFontSize(page: Page): Promise<string> {
  return page.evaluate(() => {
    const line = document.querySelector('.monaco-editor .view-lines');
    return line ? getComputedStyle(line).fontSize : 'missing';
  });
}

test.describe('presenter mode', () => {
  test('the shortcut hides the toolbar, lifts the font, and restores exactly', async ({
    page,
  }) => {
    await seedSession(page, { showStatusBar: true });
    await gotoApp(page);
    // The font assertions need a mounted Monaco editor.
    await createJavaScriptTab(page);
    await openConsole(page);

    const toolbarChip = page.getByRole('button', { name: /Scratchpad/ }).first();
    const statusBar = page.getByTestId('status-bar');
    const consoleOutput = page.locator('[data-window-range]').first();
    await expect(toolbarChip).toBeVisible();
    await expect(statusBar).toBeVisible();
    // Monaco mounts lazily behind Suspense — wait for the real editor
    // surface before reading its computed font.
    await page.locator('.monaco-editor .view-lines').first().waitFor();
    const baseFont = await editorFontSize(page);
    const baseConsoleFont = await consoleOutput.evaluate(
      element => getComputedStyle(element).fontSize
    );
    expect(baseFont).not.toBe('missing');

    await page.keyboard.press(PRESENTER_CHORD);
    await expect(toolbarChip).toBeHidden();
    await expect(statusBar).toBeHidden();
    const presenterFont = await editorFontSize(page);
    const presenterConsoleFont = await consoleOutput.evaluate(
      element => getComputedStyle(element).fontSize
    );
    expect(Number.parseFloat(presenterFont)).toBe(Number.parseFloat(baseFont) + 4);
    expect(Number.parseFloat(presenterConsoleFont)).toBe(
      Number.parseFloat(baseConsoleFont) + 2
    );

    await page.keyboard.press(PRESENTER_CHORD);
    await expect(toolbarChip).toBeVisible();
    await expect(statusBar).toBeVisible();
    expect(await editorFontSize(page)).toBe(baseFont);
    expect(
      await consoleOutput.evaluate(element => getComputedStyle(element).fontSize)
    ).toBe(baseConsoleFont);
  });

  test('the palette action toggles the same mode', async ({ page }) => {
    await seedSession(page);
    await gotoApp(page);

    await page.keyboard.press(
      process.platform === 'darwin' ? 'Meta+Shift+P' : 'Control+Shift+P'
    );
    await page
      .getByPlaceholder('Search templates, snippets, commands...')
      .fill('presenter');
    await page.getByRole('option', { name: /Toggle presenter mode/i }).click();

    await expect(
      page.getByRole('button', { name: /Scratchpad/ }).first()
    ).toBeHidden();
  });
});

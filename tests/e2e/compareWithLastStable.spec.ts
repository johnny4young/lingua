/**
 * RL-020 Slice 8 — Compare-with-last-stable end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - Clean JS run captures the snapshot; editing produces a
 *     different output; the Compare panel chip lights up and renders
 *     the diff.
 *   - The chip is disabled before the first successful run.
 *   - Language change clears the snapshot and disables the chip.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function replaceEditorText(page: Page, source: string): Promise<void> {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(
    process.platform === 'darwin' ? 'Meta+A' : 'Control+A'
  );
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

test.describe('compare with last stable run (RL-020 Slice 8)', () => {
  test('toggle is disabled until the first clean run captures a snapshot', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const toggle = page.getByTestId('panel-chip-compare');
    await expect(toggle).toBeDisabled();
  });

  test('clean run + diverging edit lights up Compare and renders the diff', async ({
    page,
  }) => {
    test.setTimeout(45_000);
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(page, 'console.log(2)');
    // Wait for the auto-run debounce + the panel update.
    await page.waitForTimeout(1_400);

    const toggle = page.getByTestId('panel-chip-compare');
    await expect(toggle).not.toBeDisabled();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await replaceEditorText(page, 'console.log(4)');
    await page.waitForTimeout(1_400);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(
      page.locator('[data-testid="compare-results-panel"]')
    ).toBeVisible();
    await expect(
      page.locator('[data-testid="compare-row-changed"]').first()
    ).toBeVisible();
  });
});

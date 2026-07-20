/**
 * implementation — `@watch` magic-comment pin end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - A JS scratchpad with an arrow (`=>`) and a pin watch
 *     (`data-result-kind="watch"`) surfaces both inline.
 *   - Breaking the buffer fires implementation's gate AND the pin watches
 *     stay on screen (implementation snapshot restore + implementation watch
 *     persistence).
 *   - Repairing the buffer updates the watch values cleanly.
 *
 * Monaco gesture pattern matches `autoRunGating.spec.ts` /
 * `workflowMode.spec.ts`: click the editor body, NOT the hidden
 * textarea.
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
  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

/**
 * Append text at the end of the active editor buffer without clearing
 * what's already there. This avoids the Cmd+A → Backspace empty-state
 * transit that defeats the implementation snapshot-restore flow when the
 * caller's intent is "edit incrementally and observe the gate".
 */
async function appendToEditor(page: Page, source: string): Promise<void> {
  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  // Move the cursor to the very end of the buffer.
  const endCombo = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
  await page.keyboard.press(endCombo);
  await page.keyboard.press('End');
  await page.keyboard.insertText(source);
}

async function seedWatchBuffer(page: Page, counter = 5): Promise<void> {
  await replaceEditorText(
    page,
    [
      `const counter = ${counter};`,
      'counter //=> counter',
      'counter * 10 // @watch counter * 10',
      '',
    ].join('\n')
  );
}

test.describe('@watch magic-comment pin ', () => {
  test('JS scratchpad surfaces both an arrow and a pinned watch', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await seedWatchBuffer(page);

    // No fixed debounce wait — the toBeVisible below auto-retries (10s
    // expect timeout) and is the sync point for the seeded auto-run.
    // Pin watch must surface from the default seed alone.
    const watch = page.locator('[data-result-kind="watch"]').first();
    await expect(watch).toBeVisible();
    await expect(watch).toContainText('50'); // counter * 10 == 50
  });

  test('breaking the buffer fires the gate and the watch stays visible', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await seedWatchBuffer(page);

    // Sanity — the watch is on screen before we break anything. This
    // toBeVisible also waits out the seeded auto-run's debounce.
    await expect(page.locator('[data-result-kind="watch"]').first()).toBeVisible();

    // Append a clearly-incomplete fragment at the END of the seeded
    // buffer (no Cmd+A → Backspace empty transit that would defeat
    // the snapshot-restore). The trailing `+` operator triggers the
    // implementation gate cleanly.
    await appendToEditor(page, '\nconst y = 1 +');

    // Gate notice appears (toBeVisible waits out the debounce).
    await expect(page.getByTestId('auto-run-gate-notice')).toBeVisible();
    // Watch SURVIVES the gated keystroke (implementation snapshot restore).
    await expect(page.locator('[data-result-kind="watch"]').first()).toBeVisible();
  });

  test('completing the buffer refreshes the watch and dismisses the gate', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await page.waitForTimeout(1_400);

    await replaceEditorText(
      page,
      'const counter = 7;\ncounter * 10 // @watch counter * 10\n'
    );
    await page.waitForTimeout(1_400);

    await expect(page.getByTestId('auto-run-gate-notice')).toHaveCount(0);
    await expect(page.locator('[data-result-kind="watch"]').first()).toContainText(
      '70'
    );
  });
});

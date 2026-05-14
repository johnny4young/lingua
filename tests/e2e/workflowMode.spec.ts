/**
 * RL-020 Slice 2 — per-tab workflow-mode segmented control e2e smoke.
 *
 * Locks the user-visible contract:
 *
 *   - The toolbar mounts a 3-segment toggle (Run / Debug / Scratchpad)
 *     with the Scratchpad segment active on a fresh JS tab.
 *   - Clicking the Run segment flips the workflow mode, no auto-run
 *     fires on subsequent keystrokes, and the result-panel pill
 *     mirrors the new mode.
 *   - Switching back to Scratchpad re-enables auto-run; the completion
 *     gate keeps doing its job for incomplete buffers.
 *
 * Deeper contract (telemetry payload, settings defaults seed, cycle
 * shortcut behaviour) lives in unit tests — those don't need
 * Playwright.
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

test.describe('Workflow mode segmented control (RL-020 Slice 2)', () => {
  test('renders the 3-segment toggle with Scratchpad active on a fresh JS tab', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const segment = page.getByTestId('workflow-mode-segment');
    await expect(segment).toBeVisible();
    await expect(segment).toHaveAttribute('data-workflow-mode', 'scratchpad');
    // The result-panel pill mirrors the active mode (fold B).
    const pill = page.getByTestId('workflow-mode-status-pill');
    await expect(pill).toBeVisible();
    await expect(pill).toHaveAttribute('data-workflow-mode', 'scratchpad');
  });

  test('clicking Run silences auto-run on subsequent keystrokes', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    // Type a complete JS expression first so Scratchpad-mode produces
    // a visible result. The result-panel content shouldn't matter for
    // this assertion — we're checking that Run mode SKIPS auto-run.
    await replaceEditorText(page, 'const x = 1;');
    await page.waitForTimeout(1_400);
    await expect(page.getByTestId('workflow-mode-segment')).toHaveAttribute(
      'data-workflow-mode',
      'scratchpad'
    );

    // Flip to Run mode via the toolbar segment.
    await page.getByTestId('workflow-mode-segment-run').click();
    await expect(page.getByTestId('workflow-mode-segment')).toHaveAttribute(
      'data-workflow-mode',
      'run'
    );
    await expect(page.getByTestId('workflow-mode-status-pill')).toHaveAttribute(
      'data-workflow-mode',
      'run'
    );

    // Type an obviously-incomplete buffer; with auto-run off, the
    // Slice-1 gate never fires either — the result panel stays still.
    await replaceEditorText(page, 'const y = ');
    await page.waitForTimeout(1_400);
    // No auto-run gate notice (no auto-run fires at all).
    await expect(page.getByTestId('auto-run-gate-notice')).toHaveCount(0);
  });

  test('switching back to Scratchpad re-enables the auto-run gate', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    // Toggle through Run → Scratchpad and verify the gate still works.
    await page.getByTestId('workflow-mode-segment-run').click();
    await expect(page.getByTestId('workflow-mode-segment')).toHaveAttribute(
      'data-workflow-mode',
      'run'
    );

    await page.getByTestId('workflow-mode-segment-scratchpad').click();
    await expect(page.getByTestId('workflow-mode-segment')).toHaveAttribute(
      'data-workflow-mode',
      'scratchpad'
    );

    // The Slice-1 gate should still fire on an incomplete buffer.
    await replaceEditorText(page, 'const x = ');
    await page.waitForTimeout(1_400);
    await expect(page.getByTestId('auto-run-gate-notice')).toBeVisible();
  });
});

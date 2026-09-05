/**
 * implementation — per-tab workflow-mode segmented control e2e smoke.
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
  selectWorkflowMode,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function replaceEditorText(page: Page, source: string): Promise<void> {
  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

test.describe('Workflow mode action pill ', () => {
  test('renders the workflow action with Scratchpad active on a fresh JS tab', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const runButton = page.getByTestId('action-pill-run');
    await expect(runButton).toBeVisible();
    await expect(runButton).toHaveAttribute('data-workflow', 'scratchpad');
    await page.getByTestId('action-pill-run-menu').click();
    await expect(page.getByTestId('action-pill-workflow-option-run')).toBeVisible();
    await expect(page.getByTestId('action-pill-workflow-option-debug')).toBeVisible();
    await expect(page.getByTestId('action-pill-workflow-option-scratchpad')).toHaveAttribute(
      'data-active',
      'true'
    );
    await page.keyboard.press('Escape');
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
    await expect(page.getByTestId('action-pill-run')).toHaveAttribute(
      'data-workflow',
      'scratchpad'
    );

    const activeTab = page.locator('[data-tab-id][data-active="true"]');
    await expect(activeTab).toHaveAttribute('data-execution-state', 'idle');

    // Flip to Run mode via the action-pill workflow menu.
    await selectWorkflowMode(page, 'run');
    await expect(page.getByTestId('action-pill-run')).toHaveAttribute(
      'data-workflow',
      'run'
    );

    // The lazy controller can still be loading while data-running is false.
    // Wait for this first manual run to finish before editing its input.
    await expect(activeTab).toHaveAttribute('data-execution-state', 'success', {
      timeout: 30_000,
    });

    // Type an obviously-incomplete buffer; with auto-run off, the
    // implementation gate never fires either — the result panel stays still.
    await replaceEditorText(page, 'const y = ');
    await page.waitForTimeout(1_400);
    // No auto-run gate notice (no auto-run fires at all).
    await expect(page.getByTestId('auto-run-gate-notice')).toHaveCount(0);
  });

  for (const language of ['en', 'es'] as const) {
    test(`switching back to Scratchpad after a cold Run re-enables auto-run (${language})`, async ({
      page,
    }) => {
      const controllerRequested = Promise.withResolvers<void>();
      const releaseController = Promise.withResolvers<void>();
      // Hold the real lazy chunk, not the execution result. This deterministically
      // exposes the pre-dispatch idle window that a fast local cache can hide.
      await page.route(/\/assets\/manualRunController-[^/]+\.js$/, async route => {
        controllerRequested.resolve();
        await releaseController.promise;
        await route.continue();
      });

      try {
        await seedSession(page, { language });
        await gotoApp(page);
        await dismissWhatsNew(page);
        await createJavaScriptTab(page);

        const activeTab = page.locator('[data-tab-id][data-active="true"]');
        const runButton = page.getByTestId('action-pill-run');
        await expect(activeTab).toHaveAttribute('data-execution-state', 'idle');
        await selectWorkflowMode(page, 'run');
        await controllerRequested.promise;
        await expect(runButton).toHaveAttribute('data-workflow', 'run');
        // Idle here means the controller has not dispatched yet, NOT that the
        // requested run has finished. Do not try to open the next menu now.
        await expect(runButton).toHaveAttribute('data-running', 'false');
        releaseController.resolve();
        // Success is durable even when the running state lasts less than a
        // Playwright polling interval. The initial idle assertion excludes a
        // stale terminal state, and failures still fail this assertion.
        await expect(activeTab).toHaveAttribute('data-execution-state', 'success', {
          timeout: 30_000,
        });

        await selectWorkflowMode(page, 'scratchpad');
        await expect(runButton).toHaveAttribute('data-workflow', 'scratchpad');

        await replaceEditorText(page, 'const x = ');
        await expect(page.getByTestId('auto-run-gate-notice')).toBeVisible();
      } finally {
        // Never leave the intercepted request pending when an assertion fails.
        releaseController.resolve();
      }
    });
  }
});

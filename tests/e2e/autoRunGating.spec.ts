/**
 * RL-020 Slice 1 — auto-run completion gate end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - Typing an obviously incomplete JS buffer shows the "Live
 *     updates paused" notice and never produces a `SyntaxError`
 *     in the panel.
 *   - Completing the expression dismisses the notice and the run
 *     fires.
 *   - Fold E: under `runtimeMode === 'browser-preview'`, the notice
 *     swaps to the "Preview paused" copy variant so a DOM-oriented
 *     user knows the iframe re-render is what is paused.
 *
 * Deeper contract (telemetry payload shape, snapshot restoration,
 * heuristic edge cases) lives in the gate's unit tests and the
 * hook's component tests — those don't need Playwright.
 *
 * Monaco gesture pattern: click the editor body, NOT the hidden
 * textarea. The textarea sits under the line-margin overlay and
 * Playwright correctly refuses that pixel as intercepted. Same
 * pattern as `debuggerJs.spec.ts`.
 */

import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  selectRuntimeMode,
  test,
} from './licenseWeb.helpers';

async function replaceEditorText(page: Page, source: string): Promise<void> {
  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

test.describe('Auto-run completion gate (RL-020 Slice 1)', () => {
  test('typing an incomplete JS line shows the paused notice without throwing SyntaxError', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await replaceEditorText(page, 'for (let i = ');

    // Wait past the debounce window so the gate runs.
    await page.waitForTimeout(1_400);

    // The ambient gate notice surfaces with the default-variant copy.
    const notice = page.getByTestId('auto-run-gate-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-gate-variant', 'default');
    await expect(notice).toHaveAttribute('role', 'status');
    await expect(notice).toHaveText(/Live updates paused/i);
    await expect(page.getByText(/SyntaxError|Unexpected end of input/i)).toHaveCount(0);
  });

  test('completing the expression dismisses the gate notice', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    // Use a no-bracket trailing-operator shape so Monaco's auto-pair
    // doesn't intervene and we don't have to wrestle with cursor
    // position. `const x = ` clearly ends on `=`.
    await replaceEditorText(page, 'const x = ');
    await page.waitForTimeout(1_400);
    await expect(page.getByTestId('auto-run-gate-notice')).toBeVisible();

    // Replace the buffer with the completed form (rather than
    // appending — Monaco's auto-paired bracket from earlier would
    // still sit at end-of-file otherwise).
    await replaceEditorText(page, 'const x = 42; console.log(x);');
    await page.waitForTimeout(1_400);

    await expect(page.getByTestId('auto-run-gate-notice')).toHaveCount(0);
  });

  test('Fold E — under Browser preview, the notice uses the preview-paused copy variant', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    // Flip the tab into browser-preview runtime mode.
    await selectRuntimeMode(page, 'browser-preview');
    await expect(page.getByTestId('bottom-panel-browser-preview-tab')).toBeVisible();

    // Same no-bracket trailing-operator shape so Monaco auto-pair
    // doesn't muddy the assertion. `document.title = ` ends on `=`.
    await replaceEditorText(page, 'document.title = ');
    await page.waitForTimeout(1_400);

    const notice = page.getByTestId('auto-run-gate-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toHaveAttribute('data-gate-variant', 'browser-preview');
    await expect(notice).toHaveText(/Preview paused/i);
  });
});

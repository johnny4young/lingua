/**
 * Per-tab Recent Runs pill end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - Auto-run alone never surfaces the pill (auto-run doesn't record).
 *   - Manual Cmd+R makes the pill appear with the run count.
 *   - Clicking the pill opens a popover listing the entry with a
 *     working Replay action.
 *   - Per-tab isolation: a second tab does not see the first tab's
 *     history.
 *   - Mod+Alt+H toggles the popover from the keyboard.
 *   - Popover code stays outside the initial graph and is reused after loading.
 *
 * Pre-seeded Pro license required (the pill gates on the
 * `EXECUTION_HISTORY` entitlement).
 */

import type { Page } from '@playwright/test';
import {
  clickRun,
  createJavaScriptTab,
  createTypeScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  replaceEditorAndWaitForAutoRun,
  test,
} from './licenseWeb.helpers';

async function pressRun(page: Page): Promise<void> {
  // The action pill Run button is the most reliable trigger across
  // viewport sizes / focus state. Keyboard shortcut Mod+Enter
  // also works but can be swallowed by the Monaco textarea in CI.
  await clickRun(page);
}

async function countRecentRunsPopoverResources(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      performance
        .getEntriesByType('resource')
        .filter(entry => /\/assets\/RecentRunsPopover-[^/]+\.js$/.test(entry.name)).length
  );
}

async function expectPopoverInsideResultPanel(page: Page): Promise<void> {
  const resultPanelBounds = await page.getByTestId('result-panel').boundingBox();
  const popoverBounds = await page.getByTestId('recent-runs-popover').boundingBox();
  expect(resultPanelBounds).not.toBeNull();
  expect(popoverBounds).not.toBeNull();
  expect(popoverBounds!.x).toBeGreaterThanOrEqual(resultPanelBounds!.x - 1);
  expect(popoverBounds!.x + popoverBounds!.width).toBeLessThanOrEqual(
    resultPanelBounds!.x + resultPanelBounds!.width + 1
  );
}

test.describe('Recent Runs pill ', () => {
  for (const language of ['en', 'es'] as const) {
    test(`auto-run alone does not surface the pill; manual run does (${language})`, async ({ page }) => {
      await seedSession(page, { language, primeProLicense: true });
      await gotoApp(page);
      await dismissWhatsNew(page);
      await createJavaScriptTab(page);

      await replaceEditorAndWaitForAutoRun(page, 'console.log("history-auto-proof")', 'history-auto-proof');
      // Auto-run does NOT record history; pill stays hidden.
      await expect(page.getByTestId('recent-runs-pill')).toHaveCount(0);

      // Manual run records an entry; pill appears with count 1.
      await pressRun(page);
      await expect(page.getByTestId('recent-runs-pill')).toBeVisible();
      await expect(page.getByTestId('recent-runs-pill')).toHaveAttribute(
        'data-recent-runs-count',
        '1'
      );
    });
  }

  test('clicking the pill opens the popover; per-tab isolation works', async ({ page }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await replaceEditorAndWaitForAutoRun(page, 'console.log("history-popover-proof")', 'history-popover-proof');
    await pressRun(page);
    await expect(page.getByTestId('recent-runs-pill')).toBeVisible();

    expect(await countRecentRunsPopoverResources(page)).toBe(0);
    await page.getByTestId('recent-runs-pill').click();
    await expect(page.getByTestId('recent-runs-popover')).toBeVisible();
    await expect(page.getByTestId('recent-runs-popover-list').locator('li')).toHaveCount(1);
    await expectPopoverInsideResultPanel(page);
    expect(await countRecentRunsPopoverResources(page)).toBe(1);

    // The same document reuses the loaded module on later activations and the
    // popover remains usable when the layout approaches its minimum width.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('recent-runs-popover')).toHaveCount(0);
    await page.setViewportSize({ width: 900, height: 960 });
    await page.getByTestId('recent-runs-pill').click();
    await expect(page.getByTestId('recent-runs-popover')).toBeVisible();
    await expectPopoverInsideResultPanel(page);
    expect(await countRecentRunsPopoverResources(page)).toBe(1);
    await page.keyboard.press('Escape');

    // Open a second tab — its pill should be hidden (different tab id,
    // zero entries).
    await createTypeScriptTab(page);
    await replaceEditorAndWaitForAutoRun(page, 'console.log("history-second-tab-proof")', 'history-second-tab-proof');
    await expect(page.getByTestId('recent-runs-pill')).toHaveCount(0);
  });

  test('a delayed automatic execution must finish before history absence is asserted', async ({ page }) => {
    let delayedWorkerRequests = 0;
    // The preview build emits the worker created in
    // src/renderer/runners/workerRunnerShell.ts (new URL('../workers/js-worker.ts'))
    // as assets/js-worker-<hash>.js. If that name changes, the request count
    // assertion below fails instead of the delay silently not applying.
    await page.context().route('**/assets/js-worker-*.js', async route => {
      delayedWorkerRequests += 1;
      await new Promise(resolve => setTimeout(resolve, 1_800));
      await route.continue();
    });
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await replaceEditorAndWaitForAutoRun(
      page,
      'console.log("history-delayed-proof")',
      'history-delayed-proof'
    );
    expect(delayedWorkerRequests).toBeGreaterThan(0);
    await expect(page.getByTestId('recent-runs-pill')).toHaveCount(0);
  });

  test('Mod+Alt+H toggles the popover from the keyboard', async ({ page }) => {
    // Moved from Mod+Shift+H so the
    // VSCode-parity Mod+Shift+H binding can map to project-replace.
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await replaceEditorAndWaitForAutoRun(page, 'console.log("history-shortcut-proof")', 'history-shortcut-proof');
    await pressRun(page);
    await expect(page.getByTestId('recent-runs-pill')).toBeVisible();

    const combo = process.platform === 'darwin' ? 'Meta+Alt+H' : 'Control+Alt+H';
    await page.keyboard.press(combo);
    await expect(page.getByTestId('recent-runs-popover')).toBeVisible();
    await page.keyboard.press(combo);
    await expect(page.getByTestId('recent-runs-popover')).toHaveCount(0);
  });
});

/**
 * RL-020 Slice 4 — per-tab Recent Runs pill end-to-end smoke.
 *
 * Locks the user-visible contract:
 *
 *   - Auto-run alone never surfaces the pill (auto-run doesn't record).
 *   - Manual Cmd+R makes the pill appear with the run count.
 *   - Clicking the pill opens a popover listing the entry with a
 *     working Replay action.
 *   - Per-tab isolation: a second tab does not see the first tab's
 *     history.
 *   - Mod+Shift+H (fold B) toggles the popover from the keyboard.
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
  test,
} from './licenseWeb.helpers';

async function pressRun(page: Page): Promise<void> {
  // The action pill Run button is the most reliable trigger across
  // viewport sizes / focus state. Keyboard shortcut Mod+Enter
  // also works but can be swallowed by the Monaco textarea in CI.
  await clickRun(page);
}

test.describe('Recent Runs pill (RL-020 Slice 4)', () => {
  test('auto-run alone does not surface the pill — manual Cmd+R does', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    // Wait long enough for the seeded auto-run to fire.
    await page.waitForTimeout(1_400);
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

  test('clicking the pill opens the popover; per-tab isolation works', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await page.waitForTimeout(1_400);
    await pressRun(page);
    await expect(page.getByTestId('recent-runs-pill')).toBeVisible();

    await page.getByTestId('recent-runs-pill').click();
    await expect(page.getByTestId('recent-runs-popover')).toBeVisible();
    await expect(page.getByTestId('recent-runs-popover-list').locator('li')).toHaveCount(1);

    // Close popover.
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('recent-runs-popover')).toHaveCount(0);

    // Open a second tab — its pill should be hidden (different tab id,
    // zero entries).
    await createTypeScriptTab(page);
    await page.waitForTimeout(1_400);
    await expect(page.getByTestId('recent-runs-pill')).toHaveCount(0);
  });

  test('Mod+Alt+H toggles the popover from the keyboard (fold B)', async ({
    page,
  }) => {
    // RL-024 Slice 2 — moved from Mod+Shift+H to Mod+Alt+H so the
    // VSCode-parity Mod+Shift+H binding can map to project-replace.
    await seedSession(page, { language: 'en', primeProLicense: true });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await page.waitForTimeout(1_400);
    await pressRun(page);
    await expect(page.getByTestId('recent-runs-pill')).toBeVisible();

    const combo = process.platform === 'darwin' ? 'Meta+Alt+H' : 'Control+Alt+H';
    await page.keyboard.press(combo);
    await expect(page.getByTestId('recent-runs-popover')).toBeVisible();
    await page.keyboard.press(combo);
    await expect(page.getByTestId('recent-runs-popover')).toHaveCount(0);
  });
});

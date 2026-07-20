/**
 * implementation — end-to-end smoke for the Browser preview
 * runtime.
 *
 * Locks the user-visible contract:
 *
 *   - From a JS tab, the runtime dropdown's Browser preview option
 *     is enabled.
 *   - Selecting Browser preview opens the dedicated bottom-panel
 *     tab AND surfaces the iframe element.
 *   - Switching back to Worker hides the Browser preview tab.
 *
 * Deeper guarantees (postMessage protocol, runId guard, timeout
 * kill, console capture, DOM rendering) live in the runner unit
 * tests + the component tests — they don't need Playwright to
 * exercise.
 */

import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  selectRuntimeMode,
  test,
} from './licenseWeb.helpers';

test.describe('Browser preview runtime ', () => {
  test('Browser preview option is enabled in the runtime dropdown', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await page.getByTestId('action-pill-runtime').click();
    const browserPreview = page.getByTestId('action-pill-runtime-option-browser-preview');
    await expect(browserPreview).toBeVisible();
    await expect(browserPreview).not.toBeDisabled();
    await page.keyboard.press('Escape');
  });

  test('switching to Browser preview opens the dedicated bottom-panel tab + iframe', async ({
    page,
  }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await selectRuntimeMode(page, 'browser-preview');

    const tab = page.getByTestId('bottom-panel-browser-preview-tab');
    await expect(tab).toBeVisible();

    // The panel mounts an iframe via the bridge — assert its
    // presence as the structural anchor for the runner.
    const iframe = page.getByTestId('browser-preview-iframe');
    await expect(iframe).toBeVisible();
  });

  test('switching back to Worker hides the Browser preview tab', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    // Switch to browser-preview and confirm the tab appears.
    await selectRuntimeMode(page, 'browser-preview');
    await expect(page.getByTestId('bottom-panel-browser-preview-tab')).toBeVisible();

    // Switch back to Worker — the tab vanishes for non-browser-
    // preview tabs.
    await selectRuntimeMode(page, 'worker');
    await expect(page.getByTestId('bottom-panel-browser-preview-tab')).toBeHidden();
  });
});

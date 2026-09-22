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
 * Real execution below also checks the emitted CSP and recovery.
 */

import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  seedSession,
  selectRuntimeMode,
  selectWorkflowMode,
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

for (const language of ['en', 'es'] as const) {
  test(`Browser preview executes, reports an error and recovers under the emitted CSP (${language})`, async ({
    page,
  }) => {
    await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run' } });
    await page.addInitScript(language => {
      if (window !== window.top) return;
      const settings = JSON.parse(localStorage.getItem('lingua-settings')!);
      settings.state.theme = language === 'en' ? 'light' : 'dark';
      settings.state.editorTheme = language === 'en' ? 'lingua-light' : 'lingua-dark';
      localStorage.setItem('lingua-settings', JSON.stringify(settings));
    }, language);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await selectRuntimeMode(page, 'browser-preview');
    await expect(page.locator('html')).toHaveAttribute('data-theme', language === 'en' ? 'light' : 'dark');
    const run = page.getByTestId('action-pill-run');
    const preview = page.frameLocator('[data-testid="browser-preview-iframe"]');
    const waitForDocument = async (text: string) => {
      // document.open replaces the frame's execution context. Poll the actual
      // rendered body before asking Playwright's cross-frame visibility query.
      await expect
        .poll(async () => {
          const frame = page
            .frames()
            .find(frame => frame.url().includes('/assets/lingua-sandbox-'));
          if (!frame) return '';
          try {
            return await frame.evaluate(() => document.body?.innerText ?? '');
          } catch (error) {
            if (
              error instanceof Error &&
              /Execution context was destroyed|Frame was detached/.test(error.message)
            )
              return '';
            throw error;
          }
        })
        .toContain(text);
      await expect(preview.getByText(text, { exact: true })).toBeVisible();
    };
    const edit = async (source: string, refresh = 'off') => {
      await page
        .locator('.monaco-editor')
        .first()
        .click({ position: { x: 140, y: 42 } });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
      await page.keyboard.insertText(`// @preview-refresh ${refresh}\n${source}`);
    };
    await edit('document.body.textContent = "sandbox-first-run";');
    await run.click();
    await waitForDocument('sandbox-first-run');
    await expect(run).toBeEnabled();
    await edit(
      'document.body.textContent = "sandbox-error-run"; throw new Error("sandbox-intentional-failure");'
    );
    await run.click();
    await expect(page.getByTestId('browser-preview-status')).toContainText('error');
    await edit('document.body.textContent = "sandbox-recovered";');
    await run.click();
    await waitForDocument('sandbox-recovered');
    await selectWorkflowMode(page, 'scratchpad');
    // Live refresh is a separate journey: no manual Run click, retain the
    // last accepted document on error, then replace it on successful recovery.
    await edit('document.body.textContent = "sandbox-auto-stable";', '300');
    await waitForDocument('sandbox-auto-stable');
    await edit('throw new Error("sandbox-auto-error");', '300');
    await expect(page.getByTestId('browser-preview-status')).toContainText('error');
    await waitForDocument('sandbox-auto-stable');
    await edit('document.body.textContent = "sandbox-auto-recovered";', '300');
    await waitForDocument('sandbox-auto-recovered');
    await page.screenshot({ path: `output/playwright/sandbox-recovery-${language}.png` });
  });
}

/**
 * RL-019 Slice 1 — Playwright smoke for the JS/TS runtime-mode
 * selector.
 *
 * Locks the Slice 1 contract surface:
 *   - Selector renders for JS tabs (default `Worker`).
 *   - Dropdown shows three items; only `Worker` is enabled.
 *   - Disabled items expose their "coming in Slice N" hint via the
 *     accessible-name / `aria-disabled` contract.
 *   - The selector is hidden for non-JS/TS tabs.
 *   - Spanish locale renders the localized labels.
 */

import {
  closeSettings,
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe('Runtime mode selector (RL-019 Slice 1)', () => {
  test('renders Worker as the active mode on a fresh JS tab', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const button = page.getByTestId('runtime-mode-selector-button');
    await expect(button).toBeVisible();
    await expect(button).toContainText('Worker');
  });

  test('dropdown lists three options; only Node is disabled after Slice 3', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await page.getByTestId('runtime-mode-selector-button').click();

    const worker = page.getByTestId('runtime-mode-option-worker');
    const node = page.getByTestId('runtime-mode-option-node');
    const browserPreview = page.getByTestId('runtime-mode-option-browser-preview');

    await expect(worker).toBeVisible();
    await expect(worker).not.toBeDisabled();

    await expect(node).toBeVisible();
    await expect(node).toBeDisabled();
    await expect(node).toHaveAttribute('aria-disabled', 'true');
    await expect(node).toHaveAttribute('title', /coming soon.*desktop Node/i);

    // RL-019 Slice 3 — Browser preview is now ENABLED. The tooltip
    // surfaces the shipping copy instead of the comingSoon hint.
    await expect(browserPreview).toBeVisible();
    await expect(browserPreview).not.toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(node).toBeHidden();
  });

  test('selector is hidden when the active tab is not JS/TS', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);

    // Open the New file menu and create a Python tab so the active
    // tab does not own the runtime-mode surface.
    await page.getByRole('button', { name: /new file language menu|menú de lenguaje para nuevo archivo/i }).click();
    await page.getByRole('menuitem', { name: 'Python' }).click();

    await expect(page.getByTestId('runtime-mode-selector-button')).toBeHidden();
  });

  test('Settings → Editor default runtime mode select lists three options', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);

    await openSettings(page);
    await openSettingsTab(page, 'editor');

    const select = page.getByTestId('settings-default-runtime-mode');
    await expect(select).toBeVisible();
    const optionValues = await select.locator('option').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
    expect(optionValues).toEqual(['worker', 'node', 'browser-preview']);
    // RL-019 Slice 3 fold E — only `node` is disabled now.
    // `browser-preview` lit up alongside `worker`.
    const disabledValues = await select.locator('option[disabled]').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
    expect(disabledValues).toEqual(['node']);
    await expect(select.locator('option[value="browser-preview"]')).toHaveAttribute(
      'title',
      /iframe-isolated preview with DOM/i
    );

    await closeSettings(page);
  });

  test('Spanish locale renders the localized labels', async ({ page }) => {
    await seedSession(page, { language: 'es' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const button = page.getByTestId('runtime-mode-selector-button');
    await expect(button).toContainText('Entorno');
    await expect(button).toContainText('Worker');

    await button.click();
    await expect(page.getByTestId('runtime-mode-option-node')).toHaveAttribute(
      'title',
      /próximamente.*Node de escritorio/iu
    );
    await page.keyboard.press('Escape');
  });
});

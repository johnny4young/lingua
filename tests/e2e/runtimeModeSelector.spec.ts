/**
 * implementation — Playwright smoke for the JS/TS runtime-mode
 * selector.
 *
 * Locks the implementation contract surface:
 *   - The action pill runtime chip renders for JS tabs (default `Worker`).
 *   - Web keeps Worker/Browser preview enabled and explains desktop subprocess limits.
 *   - The chip is hidden for non-JS/TS tabs.
 *   - Spanish locale renders the localized menu descriptions.
 */

import { mkdirSync } from 'node:fs';
import {
  closeSettings,
  closeActiveEditorTab,
  createJavaScriptTab,
  createLanguageTab,
  dismissWhatsNew,
  expect,
  expectNoticeContains,
  gotoApp,
  openPaletteAction,
  openSettings,
  openSettingsTab,
  seedSession,
  test,
} from './licenseWeb.helpers';

test.describe('Runtime mode selector', () => {
  test('renders Worker as the active mode on a fresh JS tab', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    const button = page.getByTestId('action-pill-runtime');
    await expect(button).toBeVisible();
    await expect(button).toContainText('Worker');
  });

  test('web picker and palette explain desktop runtimes without changing mode', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);

    await page.getByTestId('action-pill-runtime').click();

    const worker = page.getByTestId('action-pill-runtime-option-worker');
    const node = page.getByTestId('action-pill-runtime-option-node');
    const browserPreview = page.getByTestId('action-pill-runtime-option-browser-preview');

    await expect(worker).toBeVisible();
    await expect(worker).not.toBeDisabled();

    await expect(node).toBeVisible();
    await expect(node).toBeDisabled();
    await expect(node).toContainText(/Desktop only/i);
    await expect(page.getByTestId('action-pill-runtime-option-deno')).toBeDisabled();
    await expect(page.getByTestId('action-pill-runtime-option-bun')).toBeDisabled();
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/product-runtime-platform', { recursive: true });
      await page.screenshot({
        path: 'output/review/product-runtime-platform/web-runtime-menu-en.png',
      });
    }

    await expect(browserPreview).toBeVisible();
    await expect(browserPreview).not.toBeDisabled();

    await page.keyboard.press('Escape');
    await expect(node).toBeHidden();

    await openPaletteAction(page, 'runtime to Node', /Switch runtime to Node/);
    await expectNoticeContains(page, 'only in Lingua Desktop');
    await expect(page.getByTestId('action-pill-runtime')).toContainText('Worker');

    await page.keyboard.press('ControlOrMeta+Alt+M');
    await expect(page.getByTestId('action-pill-runtime')).toContainText('Browser preview');
    await page.keyboard.press('ControlOrMeta+Alt+M');
    await expect(page.getByTestId('action-pill-runtime')).toContainText('Worker');
  });

  test('selector is hidden when the active tab is not JS/TS', async ({ page }) => {
    await seedSession(page, { language: 'en' });
    await gotoApp(page);
    await dismissWhatsNew(page);
    await closeActiveEditorTab(page);

    // Create a Python tab so the active tab does not own the
    // runtime-mode surface.
    await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);

    await expect(page.getByTestId('action-pill-runtime')).toBeHidden();
  });

  test('Settings → Editor default runtime mode select lists five options', async ({ page }) => {
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
    // implementation runtimes added Deno and Bun as first-class desktop modes.
    expect(optionValues).toEqual(['worker', 'node', 'browser-preview', 'deno', 'bun']);
    const disabledValues = await select.locator('option[disabled]').evaluateAll((options) =>
      options.map((option) => (option as HTMLOptionElement).value)
    );
    expect(disabledValues).toEqual(['node', 'deno', 'bun']);
    await expect(select.locator('option[value="node"]')).toHaveAttribute(
      'title',
      /Desktop only/i
    );
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

    const button = page.getByTestId('action-pill-runtime');
    await expect(button).toContainText('Worker');

    await button.click();
    await expect(page.getByTestId('action-pill-runtime-option-node')).toBeDisabled();
    await expect(page.getByTestId('action-pill-runtime-option-node')).toContainText(
      /Solo escritorio/iu
    );
    if (process.env.LINGUA_CAPTURE_REVIEW_SCREENSHOT === '1') {
      mkdirSync('output/review/product-runtime-platform', { recursive: true });
      await page.screenshot({
        path: 'output/review/product-runtime-platform/web-runtime-menu-es.png',
      });
    }
    await page.keyboard.press('Escape');
  });
});

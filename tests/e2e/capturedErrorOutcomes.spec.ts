import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  openConsole,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function edit(page: Page, source: string): Promise<void> {
  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  test(`captured errors remain failures while later expressions run (${language})`, async ({ page }) => {
    await seedSession(page, { language });
    await page.addInitScript(language => {
      const settings = JSON.parse(localStorage.getItem('lingua-settings')!);
      settings.state.scratchpadAutoLogByLanguage = { javascript: true };
      settings.state.theme = language === 'en' ? 'light' : 'dark';
      settings.state.editorTheme = language === 'en' ? 'lingua-light' : 'lingua-dark';
      localStorage.setItem('lingua-settings', JSON.stringify(settings));
    }, language);
    await gotoApp(page);
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await openConsole(page);
    await edit(page, 'JSON.parse("captured-invalid-json")\n21 * 2');
    const rows = page.getByTestId('console-entry-row');
    await expect(rows.filter({ hasText: 'SyntaxError' })).toHaveCount(1);
    await expect(rows.filter({ hasText: language === 'en' ? 'Failed in' : 'Falló en' })).toHaveCount(1);
    await expect(page.locator('[data-result-kind="autoLog"]').filter({ hasText: '42' })).toBeVisible();
    await expect(page.locator('[data-result-kind="run-status-pill"]')).toHaveAttribute('data-run-status', 'error');
    await page.screenshot({ path: test.info().outputPath(`captured-error-${language}.png`) });

    await edit(page, 'throw new Error("uncaught diagnostic probe")');
    await expect(rows.filter({ hasText: 'uncaught diagnostic probe' })).toHaveCount(1);
    await expect(rows.filter({ hasText: language === 'en' ? 'Failed in' : 'Falló en' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'SyntaxError' })).toHaveCount(0);

    await edit(page, 'console.log("diagnostics recovered")');
    await expect(rows.filter({ hasText: 'diagnostics recovered' })).toHaveCount(1);
    await expect(rows.filter({ hasText: language === 'en' ? 'Completed in' : 'Completado en' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'uncaught diagnostic probe' })).toHaveCount(0);
    // Success intentionally has no warning pill; the localized completion
    // summary above is the positive outcome assertion.
    await expect(page.locator('[data-result-kind="run-status-pill"]')).toHaveCount(0);
  });
}

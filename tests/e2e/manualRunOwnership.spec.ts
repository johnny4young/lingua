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
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  test(`manual Stop and recovery preserve current output (${language})`, async ({ page }) => {
    await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run' } });
    await gotoApp(page);
    await page.evaluate(language => {
      const settings = JSON.parse(localStorage.getItem('lingua-settings')!);
      settings.state.editorTheme = language === 'en' ? 'lingua-light' : 'lingua-dark';
      settings.state.theme = language === 'en' ? 'light' : 'dark';
      localStorage.setItem('lingua-settings', JSON.stringify(settings));
    }, language);
    await page.reload();
    await dismissWhatsNew(page);
    await createJavaScriptTab(page);
    await openConsole(page);
    const run = page.getByTestId('action-pill-run');
    await edit(page, 'while (true) {}');
    await run.click();
    await expect(run).toHaveAttribute('data-running', 'true');
    const stopLabel = language === 'en' ? 'Stop' : 'Detener';
    await expect(run).toHaveAttribute('aria-label', stopLabel);
    await expect(run).toContainText(stopLabel);
    await expect(run.locator('svg.lucide-square')).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`running-stop-${language}.png`) });
    await run.click();
    await expect(run).toHaveAttribute('data-running', 'false');
    await expect(run).toHaveAttribute('aria-label', language === 'en' ? 'Run' : 'Ejecutar');
    await expect(
      page.locator('[data-result-kind="run-status-pill"][data-run-status="stopped"]')
    ).toBeVisible();

    await edit(page, 'throw new Error("controlled ownership failure")');
    await run.click();
    await expect(
      page
        .getByTestId('console-entry-row')
        .filter({ hasText: 'controlled ownership failure' })
        .first()
    ).toBeVisible();
    await expect(run).toHaveAttribute('data-running', 'false');

    await edit(page, 'console.log("ownership recovered")');
    await run.click();
    await expect(
      page.getByTestId('console-entry-row').filter({ hasText: 'ownership recovered' }).first()
    ).toBeVisible();
    await expect(run).toHaveAttribute('data-running', 'false');
    await expect(
      page.getByTestId('console-entry-row').filter({ hasText: 'controlled ownership failure' })
    ).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`recovered-${language}.png`) });
  });
}

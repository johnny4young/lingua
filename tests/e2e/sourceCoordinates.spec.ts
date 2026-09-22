import type { Page } from '@playwright/test';
import {
  createJavaScriptTab, createTypeScriptTab, dismissWhatsNew, expect,
  gotoApp, openConsole, seedSession, test,
} from './licenseWeb.helpers';

async function edit(page: Page, source: string): Promise<void> {
  await page.locator('.monaco-editor').first().click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  for (const runtime of ['javascript', 'typescript'] as const) {
    test(`source coordinates survive timing and ${runtime} transforms (${language})`, async ({ page }) => {
      await seedSession(page, { language, workflowModeDefaultsByLanguage: { javascript: 'run', typescript: 'run' } });
      await page.addInitScript(language => {
        const settings = JSON.parse(localStorage.getItem('lingua-settings')!);
        settings.state.showLineTiming = true;
        settings.state.theme = language === 'en' ? 'light' : 'dark';
        settings.state.editorTheme = language === 'en' ? 'lingua-light' : 'lingua-dark';
        localStorage.setItem('lingua-settings', JSON.stringify(settings));
      }, language);
      await gotoApp(page);
      await dismissWhatsNew(page);
      if (runtime === 'javascript') await createJavaScriptTab(page);
      else await createTypeScriptTab(page);
      await openConsole(page);
      const run = page.getByTestId('action-pill-run');
      const rows = page.getByTestId('console-entry-row');
      await edit(page, [
        runtime === 'typescript' ? 'type Entry = { label: string };' : '// direct JavaScript',
        'const label = "coordinate marker";',
        'throw new Error(label);',
      ].join('\n'));
      await run.click();
      await expect(rows.filter({ hasText: 'coordinate marker' })).toContainText('user code:3:7');
      const details = rows.filter({ hasText: 'coordinate marker' }).getByTestId('console-rich-error-runtime');
      await expect(details).not.toHaveAttribute('open');
      const internal = details.getByTestId('console-rich-error-frame-text').first();
      await expect(internal).not.toBeVisible();
      const summary = details.locator('summary');
      await expect(summary).toHaveText(language === 'en' ? 'Runtime details' : 'Detalles internos');
      await summary.focus();
      await page.keyboard.press('Enter');
      await expect(internal).toBeVisible();
      await expect(details.getByRole('button')).toHaveCount(0);
      await page.keyboard.press('Enter');
      await expect(internal).not.toBeVisible();
      await expect(run).toHaveAttribute('data-running', 'false');
      await page.screenshot({ path: test.info().outputPath(`coordinates-${runtime}-${language}.png`) });

      await edit(page, 'JSON.parse("invalid") //=>\nconsole.log("after captured arrow")');
      await run.click();
      await expect(rows.filter({ hasText: 'SyntaxError' })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'SyntaxError' })).toContainText('user code:1:6');
      await expect(rows.filter({ hasText: 'after captured arrow' })).toHaveCount(1);
      await expect(run).toHaveAttribute('data-running', 'false');

      await edit(page, 'console.error(new Error("logged coordinate"));');
      await run.click();
      await expect(rows.filter({ hasText: 'logged coordinate' })).toContainText('user code:1:15');
      await expect(rows.filter({ hasText: 'logged coordinate' }).getByTestId('console-rich-error-runtime')).not.toHaveAttribute('open');
      await expect(run).toHaveAttribute('data-running', 'false');

      await edit(page, 'console.log("coordinates recovered")');
      await run.click();
      await expect(rows.filter({ hasText: 'coordinates recovered' })).toHaveCount(1);
      await expect(rows.filter({ hasText: language === 'en' ? 'Completed in' : 'Completado en' })).toHaveCount(1);
      await expect(rows.filter({ hasText: 'SyntaxError' })).toHaveCount(0);
    });
  }
}

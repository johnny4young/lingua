import type { Page } from '@playwright/test';
import {
  createJavaScriptTab,
  createLanguageTab,
  dismissWhatsNew,
  expect,
  gotoApp,
  openConsole,
  seedSession,
  test,
} from './licenseWeb.helpers';

async function edit(page: Page, source: string) {
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  for (const runtime of ['javascript', 'python'] as const) {
    test(`observed ${runtime} output survives a fatal error and recovery (${language})`, async ({
      page,
    }) => {
      // Python's existing boot budget is 90s; reserve boot + run + browser assertions.
      if (runtime === 'python') test.setTimeout(210_000);
      await seedSession(page, {
        language,
        workflowModeDefaultsByLanguage: { javascript: 'run', python: 'run' },
      });
      await page.addInitScript(language => {
        const settings = JSON.parse(localStorage.getItem('lingua-settings')!);
        settings.state.theme = language === 'en' ? 'light' : 'dark';
        localStorage.setItem('lingua-settings', JSON.stringify(settings));
      }, language);
      await gotoApp(page);
      await dismissWhatsNew(page);
      if (runtime === 'javascript') await createJavaScriptTab(page);
      else await createLanguageTab(page, /^Python\b/i, /PY .*\.py/i);
      await openConsole(page);
      await edit(
        page,
        runtime === 'javascript'
          ? 'console.error("order-first");\nconsole.log("order-middle");\nconsole.error("order-last");\nthrow new Error("order-fatal");'
          : 'import sys\nprint("order-first", file=sys.stderr)\nprint("order-middle")\nprint("order-last", file=sys.stderr)\nraise ValueError("order-fatal")'
      );
      const run = page.getByTestId('action-pill-run');
      await run.click();
      if (runtime === 'python') {
        await expect
          .poll(() => page.evaluate(() => window.__linguaE2e?.pythonRuntimeBooted?.() ?? false), {
            timeout: 100_000,
            intervals: [1000],
          })
          .toBe(true);
      }
      const rows = page.getByTestId('console-entry-row');
      const output = rows.filter({ hasText: /order-(first|middle|last)/ });
      await expect(output).toHaveCount(3);
      for (const [index, text] of ['order-first', 'order-middle', 'order-last'].entries()) {
        await expect(output.nth(index)).toContainText(text);
      }
      await expect(rows.filter({ hasText: 'order-fatal' })).toHaveCount(1);
      await expect(
        rows.filter({ hasText: language === 'en' ? 'Failed in' : 'Falló en' })
      ).toHaveCount(1);
      await expect(run).toHaveAttribute('data-running', 'false');
      await page.screenshot({
        path: test.info().outputPath(`output-order-${runtime}-${language}.png`),
      });
      await edit(
        page,
        runtime === 'javascript' ? 'console.log("order-recovered")' : 'print("order-recovered")'
      );
      await run.click();
      await expect(rows.filter({ hasText: 'order-recovered' })).toHaveCount(1);
      await expect(
        rows.filter({ hasText: language === 'en' ? 'Completed in' : 'Completado en' })
      ).toHaveCount(1);
      await expect(rows.filter({ hasText: 'order-fatal' })).toHaveCount(0);
    });
  }
}

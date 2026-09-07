import type { Page } from '@playwright/test';
import { clickRun, expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

async function replaceSource(page: Page, source: string): Promise<void> {
  await page.locator('.monaco-editor .view-lines').first().waitFor();
  await page
    .locator('.monaco-editor')
    .first()
    .click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  test(`manual streamed console batches retain collapse and error delivery (${language})`, async ({
    page,
  }) => {
    await seedSession(page, {
      language,
      workflowModeDefaultsByLanguage: { javascript: 'run' },
    });
    await gotoApp(page);
    await replaceSource(
      page,
      [
        'for (let i = 0; i < 900; i++) console.log(`flood-${i}`);',
        'for (let i = 0; i < 50; i++) console.log("batch-repeat");',
      ].join('\n')
    );
    await clickRun(page);
    await page
      .getByRole('button', {
        name: language === 'en' ? 'Show console panel' : 'Muestra el panel de consola',
        exact: true,
      })
      .click();
    const rows = page.getByTestId('console-entry-row');
    await expect(rows.filter({ hasText: 'Completed in' })).toBeVisible();
    await expect(
      rows.filter({ hasText: 'batch-repeat' }).getByTestId('console-repeat-count')
    ).toHaveText('×50');
    await expect.poll(() => rows.count()).toBeLessThan(120);
    await expect(rows.filter({ hasText: /^.*flood-0$/ })).toHaveCount(0);

    await replaceSource(
      page,
      'console.log("before-batch-error");\nthrow new Error("batch-error-marker");'
    );
    await clickRun(page);
    await expect(rows.filter({ hasText: 'before-batch-error' })).toBeVisible();
    await expect(rows.filter({ hasText: 'batch-error-marker' }).first()).toBeVisible();
    await expect(rows.filter({ hasText: 'Completed in' })).toBeVisible();
    await expect(rows.filter({ hasText: 'batch-repeat' })).toHaveCount(0);
    // The shared fixture asserts zero unexpected console/page errors on teardown.
  });
}

/**
 * Labs › GUI actions to code: a pipeline saves as a JavaScript snippet that
 * gives the same answer in a JS tab, and never holds the pipeline's input.
 */
import type { Page } from '@playwright/test';
import { clickRun, expect, gotoApp, openSnippets, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

const INPUT = 'tok-SECRET value';

async function openPanel(page: Page, language: 'en' | 'es', flag: boolean) {
  await seedSession(page, { language, primeProLicense: true });
  await page.addInitScript((flag) => {
    const settings = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    settings.state.featureFlags = flag ? { ejectToCode: true } : {};
    localStorage.setItem('lingua-settings', JSON.stringify(settings));
  }, flag);
  await gotoApp(page);
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
  await page.getByTestId('utility-pipeline-list-create').click();
}

for (const language of ['en', 'es'] as const) {
  test(`saves a pipeline as a snippet that matches it in a JS tab (${language})`, async ({ page }) => {
    await openPanel(page, language, true);
    const utilities = ['hash', 'base64-encode', 'uuid', 'url-encode'];
    for (const [index, utility] of utilities.entries()) {
      await page.getByTestId('utility-pipeline-editor-add-step').click();
      await page.getByTestId('utility-pipeline-step-utility').nth(index).selectOption(utility);
    }
    await page.getByTestId('utility-pipeline-step-delete').nth(2).click();
    await page.getByTestId('utility-pipeline-editor-input').fill(INPUT);
    await page.getByTestId('utility-pipeline-editor-run').click();
    const output = page.getByTestId('utility-pipeline-result-output').last();
    await expect(output).not.toHaveText('');
    const expected = await output.innerText();

    await page.getByTestId('utility-pipeline-editor-eject').click();
    await expect(page.getByRole('status').filter({ hasText: language === 'en' ? 'Saved this pipeline' : 'Guardaste este pipeline' }).first()).toBeVisible();
    const saved = await page.evaluate(() => localStorage.getItem('lingua-snippets') ?? '');
    expect(saved).toContain('crypto.subtle.digest');
    expect(saved).not.toContain('SECRET');

    await page.keyboard.press('Escape');
    await openSnippets(page);
    const label = (JSON.parse(saved) as { state: { snippets: Array<{ label: string }> } }).state.snippets[0]!.label;
    expect(label).not.toBe('');
    const modal = page.locator('[data-scrim="blur"]');
    await modal.getByRole('button', { name: label }).click();
    await modal.getByRole('button', { name: language === 'en' ? 'Open in New Tab' : 'Abrir en nueva pestaña' }).click();

    const lines = page.locator('.monaco-editor .view-lines').first();
    await expect(lines).toContainText('let value');
    await expect(lines).toContainText(language === 'en' ? 'Put your input here' : 'Pon aquí tu entrada');
    await lines.click();
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.insertText(INPUT);
    await clickRun(page);
    await waitForRunCompleted(page);
    await expect(page.getByTestId('console-entry-row').filter({ hasText: expected }).first()).toBeVisible();
  });
}

test('keeps the panel as it was without the flag', async ({ page }) => {
  await openPanel(page, 'en', false);
  await expect(page.getByTestId('utility-pipeline-editor-run')).toBeVisible();
  await expect(page.getByTestId('utility-pipeline-editor-eject')).toHaveCount(0);
});

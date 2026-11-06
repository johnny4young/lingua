/**
 * GUI actions to code: a pipeline saves as a JavaScript snippet that
 * gives the same answer in a JS tab, and never holds the pipeline's input.
 */
import type { Page } from '@playwright/test';
import { clickRun, expect, gotoApp, openSnippets, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

const INPUT = 'tok-SECRET value';

async function openPanel(page: Page, language: 'en' | 'es') {
  await seedSession(page, { language, primeProLicense: true });
  await gotoApp(page);
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
  await page.getByTestId('utility-pipeline-list-create').click();
}

async function saveAndRun(page: Page, language: 'en' | 'es', utilities: string[], input: string) {
  await openPanel(page, language);
  for (const [index, utility] of utilities.entries()) {
    await page.getByTestId('utility-pipeline-editor-add-step').click();
    await page.getByTestId('utility-pipeline-step-utility').nth(index).selectOption(utility);
  }
  await page.getByTestId('utility-pipeline-editor-input').fill(input);
  await page.getByTestId('utility-pipeline-editor-run').click();
  const output = page.getByTestId('utility-pipeline-result-output').last();
  await expect(page.getByTestId('utility-pipeline-result-output')).toHaveCount(utilities.filter((utility) => utility !== 'uuid').length + Number(utilities.includes('uuid')));
  await expect(output).not.toHaveText('');
  const expected = await output.innerText();

  await page.getByTestId('utility-pipeline-editor-eject').click();
  await expect(page.getByRole('status').filter({ hasText: language === 'en' ? 'Saved this pipeline' : 'Guardaste este pipeline' }).first()).toBeVisible();
  const saved = await page.evaluate(() => localStorage.getItem('lingua-snippets') ?? '');
  expect(saved).not.toContain(input);
  const label = (JSON.parse(saved) as { state: { snippets: Array<{ label: string }> } }).state.snippets[0]!.label;
  expect(label).not.toBe('');

  await page.keyboard.press('Escape');
  await openSnippets(page);
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
  await page.keyboard.insertText(JSON.stringify(input).slice(1, -1));
  await clickRun(page);
  await waitForRunCompleted(page);
  await expect(page.getByTestId('console-entry-row').filter({ hasText: expected }).first()).toBeVisible();
}

for (const language of ['en', 'es'] as const) {
  test(`saves a pipeline as a snippet that matches it in a JS tab (${language})`, async ({ page }) => {
    await saveAndRun(page, language, ['hash', 'base64-encode', 'url-encode'], INPUT);
  });
}

// Each chain ends in a hash, so one line of output proves every step's exact bytes in the Worker.
const CHAINS: ReadonlyArray<[string, string[], string]> = [
  ['text transforms', ['line-sort', 'string-case', 'slugify', 'html-entity-encode', 'html-entity-decode', 'url-encode', 'url-decode', 'text-stats', 'hash'], 'banana & Kiwi\napple tok-SECRET'],
  ['URL parsing', ['url-parse', 'json-minify', 'base64-encode', 'base64-decode', 'json-format', 'hash'], 'https://h.example/a?x=1&x=2&tok=SECRET#f'],
  ['JWT decoding', ['jwt-decode', 'json-minify', 'hash'], 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTRUNSRVQifQ.s'],
  ['numbers and regex', ['regex-replace', 'number-base', 'hash'], '255'],
  ['timestamps', ['timestamp', 'hash'], '1700000000'],
];

for (const [name, utilities, input] of CHAINS) {
  test(`gives the pipeline's answer in the Worker for ${name}`, async ({ page }) => {
    await saveAndRun(page, 'en', utilities, input);
  });
}


/**
 * Labs › Clipboard-aware utilities: outputs go to a pipeline step, and steps
 * can be disabled, paused at a breakpoint or re-run with auto-bake, in the Worker.
 */
import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test } from './licenseWeb.helpers';

async function open(page: Page, language: 'en' | 'es', { flag = true, pro = true } = {}) {
  await seedSession(page, { language, primeProLicense: pro });
  await page.addInitScript((flag) => {
    const stored = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    stored.state.featureFlags = flag ? { clipboardChains: true } : {};
    localStorage.setItem('lingua-settings', JSON.stringify(stored));
  }, flag);
  await gotoApp(page);
}

async function pipelineWith(page: Page, utilities: string[], input: string) {
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
  await page.getByTestId('utility-pipeline-list-create').click();
  for (const [index, utility] of utilities.entries()) {
    await page.getByTestId('utility-pipeline-editor-add-step').click();
    await page.getByTestId('utility-pipeline-step-utility').nth(index).selectOption(utility);
  }
  await page.getByTestId('utility-pipeline-editor-input').fill(input);
}

const rows = (page: Page) => page.getByTestId('utility-pipeline-result-row');
const expectStatuses = (page: Page, statuses: string[]) =>
  expect
    .poll(() => rows(page).evaluateAll((all) => all.map((row) => row.getAttribute('data-status'))))
    .toEqual(statuses);

for (const language of ['en', 'es'] as const) {
  test(`sends a tool's output to a new pipeline step (${language})`, async ({ page }) => {
    await open(page, language);
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
    await page.getByTestId('utility-send-output').selectOption('json-minify');
    await page.getByTestId('utility-send-output-go').click();

    await expect(page.getByTestId('utility-pipeline-panel')).toBeVisible();
    await expect(page.getByTestId('utility-pipeline-step-row')).toHaveCount(1);
    await expect(page.getByTestId('utility-pipeline-editor-input')).not.toHaveValue('');
    await expectStatuses(page, ['ok']);
    await expect(page.getByTestId('utility-pipeline-result-output')).toContainText('"name":"Lingua"');

    await page.getByTestId('utility-pipeline-send-select').selectOption('hash');
    await page.getByTestId('utility-pipeline-send-select-go').click();
    await expect(page.getByTestId('utility-pipeline-step-row')).toHaveCount(2);
    await expectStatuses(page, ['ok', 'ok']);
    await expect(page.getByTestId('utility-pipeline-result-output').last()).toHaveText(/^[0-9a-f]{64}$/);
  });

  test(`disables, pauses and continues in the Worker (${language})`, async ({ page }) => {
    await open(page, language);
    await pipelineWith(page, ['url-encode', 'base64-encode', 'url-decode'], 'a b');
    await page.getByTestId('utility-pipeline-step-disable').first().click();
    await page.getByTestId('utility-pipeline-step-breakpoint').nth(1).click();
    await page.getByTestId('utility-pipeline-editor-run').click();

    await expectStatuses(page, ['disabled', 'ok', 'paused']);
    await expect(page.getByTestId('utility-pipeline-result-input')).toHaveText('a b');
    await expect(page.getByTestId('utility-pipeline-result-output')).toHaveText('YSBi');
    await expect(page.getByTestId('pipeline-save-capsule')).toBeDisabled();
    await expect(rows(page).first()).toContainText(language === 'en' ? 'its input passed through' : 'su entrada pasó tal cual');
    await expect(rows(page).last()).toContainText(language === 'en' ? 'Waiting at the breakpoint' : 'Esperando en el punto de interrupción');

    await page.getByTestId('utility-pipeline-continue').click();
    await expectStatuses(page, ['disabled', 'ok', 'ok']);
    await expect(page.getByTestId('pipeline-save-capsule')).toBeEnabled();
  });
}

// 1184px with the list folded leaves the three columns at their minimum widths.
for (const [list, width, fold] of [['expanded', 1280, false], ['folded', 1184, true]] as const) {
  test(`keeps every step control reachable with the tool list ${list}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await open(page, 'es');
    await page.keyboard.press('ControlOrMeta+K');
    await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
    await pipelineWith(page, ['url-encode', 'base64-encode'], 'a b');
    if (fold) await page.keyboard.press('ControlOrMeta+B');
    await page.getByTestId('utility-pipeline-step-breakpoint').first().click();
    await page.getByTestId('utility-pipeline-editor-run').click();
    await expectStatuses(page, ['ok', 'paused']);

    const overflow = (testId: string) =>
      page.getByTestId(testId).evaluateAll((all) => all.map((node) => node.scrollWidth - node.clientWidth));
    for (const value of await overflow('utility-pipeline-step-row')) expect(value).toBeLessThanOrEqual(0);
    for (const value of await overflow('utility-pipeline-panel')) expect(value).toBeLessThanOrEqual(0);

    await page.getByTestId('utility-pipeline-step-disable').last().click();
    await page.getByTestId('utility-pipeline-step-delete').last().click();
    await expect(page.getByTestId('utility-pipeline-step-row')).toHaveCount(1);
  });
}

test('auto-bake follows the input in the Worker, and stops at a breakpoint', async ({ page }) => {
  await open(page, 'en');
  await pipelineWith(page, ['url-encode', 'base64-encode'], 'a b');
  await page.getByTestId('utility-pipeline-auto-bake').check();
  const output = page.getByTestId('utility-pipeline-result-output').last();
  await expect(output).toHaveText('YSUyMGI=');

  await page.getByTestId('utility-pipeline-editor-input').fill('c d');
  await expect(output).toHaveText('YyUyMGQ=');

  await page.getByTestId('utility-pipeline-step-breakpoint').first().click();
  await expectStatuses(page, ['ok', 'paused']);
  await expect(page.getByTestId('utility-pipeline-result-input')).toHaveText('c d');
});

test('keeps the controls across a reload, and never the input', async ({ page }) => {
  await open(page, 'en');
  await pipelineWith(page, ['url-encode'], 'tok-SECRET value');
  await page.getByTestId('utility-pipeline-step-disable').click();
  await page.getByTestId('utility-pipeline-step-breakpoint').click();
  await page.getByTestId('utility-pipeline-auto-bake').check();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('lingua-utility-pipeline-state') ?? ''))
    .toContain('"autoBake":true');
  expect(await page.evaluate(() => JSON.stringify({ ...localStorage }))).not.toContain('tok-SECRET');

  await page.reload();
  await page.keyboard.press('ControlOrMeta+Shift+G');
  await expect(page.getByTestId('utility-pipeline-step-disable')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('utility-pipeline-step-breakpoint')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('utility-pipeline-auto-bake')).toBeChecked();
  await expect(page.getByTestId('utility-pipeline-editor-input')).toHaveValue('');
});

test('keeps Utilities as it was without the flag', async ({ page }) => {
  await open(page, 'en', { flag: false });
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
  await expect(page.getByTestId('utility-send-output')).toHaveCount(0);
  await pipelineWith(page, ['url-encode'], 'a b');
  await expect(page.getByTestId('utility-pipeline-step-disable')).toHaveCount(0);
  await expect(page.getByTestId('utility-pipeline-step-breakpoint')).toHaveCount(0);
  await expect(page.getByTestId('utility-pipeline-auto-bake')).toHaveCount(0);
  await page.getByTestId('utility-pipeline-editor-run').click();
  await expectStatuses(page, ['ok']);
  await expect(page.getByTestId('utility-pipeline-send')).toHaveCount(0);
});

test('offers no Send to on a plan with no pipelines', async ({ page }) => {
  await open(page, 'en', { pro: false });
  await page.keyboard.press('ControlOrMeta+K');
  await expect(page.getByTestId('developer-utilities-workspace')).toBeVisible();
  await expect(page.getByTestId('utility-send-output')).toHaveCount(0);
});

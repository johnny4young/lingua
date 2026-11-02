import {
  clickRun,
  createJavaScriptTab,
  expect,
  gotoApp,
  openCommandPalette,
  paletteInput,
  replaceEditorText,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';
import type { Page } from '@playwright/test';

const REMOTE = 'https://licenses.linguacode.dev/palette-autodetect';

async function seed(page: Page, language: 'en' | 'es') {
  await seedSession(page, { language, primeProLicense: true, workflowModeDefaultsByLanguage: { javascript: 'run' } });
  await page.addInitScript(({ endpoint }) => {
    const raw = JSON.parse(localStorage.getItem('lingua-settings') || '{"state":{},"version":0}');
    raw.state.featureFlags = { ...(raw.state.featureFlags ?? {}), paletteAutodetect: true };
    localStorage.setItem('lingua-settings', JSON.stringify(raw));
    localStorage.setItem('lingua-ai', JSON.stringify({ state: { endpoint, apiKey: 'remote-fixture-only', model: 'gpt-fixture' }, version: 1 }));
  }, { endpoint: REMOTE });
  await gotoApp(page);
}

for (const language of ['en', 'es'] as const) {
  test(`Palette autodetect: a question opens Explain with the last run in ${language}`, async ({ page }) => {
    await seed(page, language);
    await createJavaScriptTab(page);
    await replaceEditorText(page, "console.log('twice');\nconsole.log('twice');");
    await clickRun(page);
    await waitForRunCompleted(page);

    await openCommandPalette(page);
    const question = language === 'es' ? '¿por qué imprime dos veces?' : 'why does this print twice';
    await paletteInput(page).fill(question);
    await expect(page.getByTestId('command-palette-autodetect')).toContainText(language === 'es' ? '(detectado · pregunta)' : '(autodetected · question)');
    await page.keyboard.press('Enter');

    const preview = page.getByTestId('ai-explain-code-preview');
    await expect(preview).toContainText(`Question: ${question}`);
    await expect(preview).not.toContainText('Last run:');
    await page.getByTestId('ai-explain-code-include-last-run').check();
    await expect(preview).toContainText('Last run:');
    await expect(preview).toContainText('twice');
  });
}

test('Palette autodetect: a file name opens Quick Open with it typed in', async ({ page }) => {
  await seed(page, 'en');
  await openCommandPalette(page);
  await paletteInput(page).fill('main.py');
  await expect(page.getByTestId('command-palette-autodetect')).toContainText('(autodetected · file)');
  await page.keyboard.press('Enter');
  await expect(page.getByPlaceholder(/go to file/i)).toHaveValue('main.py');

  // ! keeps the palette a plain command search.
  await page.keyboard.press('Escape');
  await openCommandPalette(page);
  await paletteInput(page).fill('!main.py');
  await expect(page.getByTestId('command-palette-autodetect')).toHaveCount(0);
});

test('Starter prompts: an empty SQL query opens Ask AI, an empty request fills a GET', async ({ page }) => {
  await seed(page, 'en');
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-workspace-empty-create').click();
  const prompts = page.getByTestId('sql-starter-prompts');
  await expect(prompts).toBeVisible();
  await prompts.getByRole('button', { name: 'Show the current date and time' }).click();
  await expect(page.getByTestId('ask-sql-question')).toHaveValue('Show the current date and time');
  await page.getByTestId('ask-sql-close').click();

  await page.keyboard.press('ControlOrMeta+Shift+K');
  await page.getByTestId('http-workspace-empty-create').click();
  await page.getByTestId('http-starter-get-json').click();
  await expect(page.getByTestId('http-request-editor-url')).toHaveValue('https://httpbin.org/json');
  await expect(page.getByTestId('http-starter-requests')).toHaveCount(0);
});

test('Starter requests survive a draft the editor had not saved yet', async ({ page }) => {
  await seed(page, 'en');
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await page.getByTestId('http-workspace-empty-create').click();
  // A method change still in the autosave window, then a starter right away.
  await page.getByTestId('http-request-editor-method').selectOption('PUT');
  await page.getByTestId('http-starter-post-json').click();
  await expect(page.getByTestId('http-request-editor-url')).toHaveValue('https://httpbin.org/post');

  // The editor reloads the request from the store when another request is picked and back.
  await page.getByTestId('http-request-list-create').click();
  // New requests go on top, so the first one is now second.
  await page.getByTestId('http-request-list-row').nth(1).click();
  await expect(page.getByTestId('http-request-editor-url')).toHaveValue('https://httpbin.org/post');
  await expect(page.getByTestId('http-request-editor-method')).toHaveValue('POST');
});


import type { Route } from '@playwright/test';
import {
  clickRun,
  closeSettings,
  createJavaScriptTab,
  expect,
  gotoApp,
  openSettings,
  openSettingsTab,
  replaceEditorText,
  seedSession,
  test,
  waitForRunCompleted,
} from './licenseWeb.helpers';

const REMOTE = 'https://licenses.linguacode.dev/ai-modes';
const LOCAL_ORIGIN = 'http://localhost:11434';
const FAILING = ['const user = null;', 'console.log(user.name);'].join('\n');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};

async function answerChat(route: Route, text: string, auth: (string | undefined)[]): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS });
    return;
  }
  auth.push(route.request().headers()['authorization']);
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    headers: CORS,
    body: `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`,
  });
}

for (const language of ['en', 'es'] as const) {
  test(`AI modes: Local and My endpoint from Settings and the explain panel in ${language}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const remoteAuth: (string | undefined)[] = [];
    const localAuth: (string | undefined)[] = [];
    await seedSession(page, { language, primeProLicense: true, workflowModeDefaultsByLanguage: { javascript: 'run' } });
    // A v1 single-endpoint config, which migrates into the My endpoint profile.
    await page.addInitScript(
      ({ endpoint }) =>
        localStorage.setItem('lingua-ai', JSON.stringify({ state: { endpoint, apiKey: 'remote-fixture-only', model: 'gpt-fixture' }, version: 1 })),
      { endpoint: REMOTE }
    );
    await page.route(REMOTE, (route) => answerChat(route, 'Remote: user is null.', remoteAuth));
    await page.route(`${LOCAL_ORIGIN}/v1/chat/completions`, (route) => answerChat(route, 'Local: user is null.', localAuth));
    await page.route(`${LOCAL_ORIGIN}/v1/models`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', headers: CORS, body: JSON.stringify({ data: [{ id: 'qwen-fixture' }] }) })
    );
    await gotoApp(page);

    await openSettings(page);
    await openSettingsTab(page, 'account');
    await expect(page.getByTestId('ai-settings-mode-remote')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('ai-settings-key')).toHaveValue('remote-fixture-only');
    await page.getByTestId('ai-settings-mode-local').click();
    await expect(page.getByTestId('ai-settings-key')).toHaveCount(0);
    await page.getByTestId('ai-settings-detect').click();
    await page.getByTestId('ai-settings-detect-model').filter({ hasText: 'qwen-fixture' }).click();
    await expect(page.getByTestId('ai-settings-endpoint')).toHaveValue(`${LOCAL_ORIGIN}/v1/chat/completions`);
    await expect(page.getByTestId('ai-settings-model')).toHaveValue('qwen-fixture');
    await closeSettings(page);

    await createJavaScriptTab(page);
    await replaceEditorText(page, FAILING);
    await clickRun(page);
    await waitForRunCompleted(page);
    await page.getByTestId('error-line-explain').click();
    const panel = page.getByTestId('ai-explain-panel');
    await expect(panel.getByTestId('ai-explain-mode-local')).toHaveAttribute('aria-checked', 'true');
    await expect(panel.getByTestId('ai-explain-mode-caption')).toContainText('qwen-fixture');
    await expect(panel.getByTestId('ai-explain-mode-caption')).toContainText('localhost:11434');

    await panel.getByTestId('ai-explain-send').click();
    await expect(panel).toContainText('Local: user is null.');
    expect(localAuth).toEqual([undefined]);

    await panel.getByTestId('ai-explain-mode-remote').click();
    await expect(panel.getByTestId('ai-explain-mode-caption')).toContainText('gpt-fixture');
    await expect(panel.getByTestId('ai-explain-mode-caption')).toContainText('licenses.linguacode.dev');
    await expect(panel).not.toContainText('Local: user is null.');
    await panel.getByTestId('ai-explain-send').click();
    await expect(panel).toContainText('Remote: user is null.');
    expect(remoteAuth).toEqual(['Bearer remote-fixture-only']);

    // Each mode keeps its own thread.
    await panel.getByTestId('ai-explain-mode-local').click();
    await expect(panel).toContainText('Local: user is null.');
    expect(localAuth).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}

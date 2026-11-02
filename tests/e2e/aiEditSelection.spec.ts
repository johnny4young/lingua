import type { Route } from '@playwright/test';
import { createJavaScriptTab, createLanguageTab, expect, gotoApp, openPaletteAction, replaceEditorText, seedSession, test } from './licenseWeb.helpers';

const REMOTE = 'https://licenses.linguacode.dev/ai-edit';
const BEFORE = ['const user = null;', 'console.log(user.name);'].join('\n');
const AFTER = ["const user = { name: 'Ada' };", 'console.log(user.name);'].join('\n');
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization,content-type',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
};
const mod = process.platform === 'darwin' ? 'Meta' : 'Control';

async function answer(route: Route, bodies: string[], content = `\`\`\`js\n${AFTER}\n\`\`\``): Promise<void> {
  if (route.request().method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS });
    return;
  }
  bodies.push(route.request().postData() ?? '');
  await route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    headers: CORS,
    body: `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`,
  });
}

for (const language of ['en', 'es'] as const) {
  test(`Edit with AI: runs the proposal, accepts it as one undoable edit in ${language}`, async ({ page }) => {
    const bodies: string[] = [];
    await seedSession(page, { language, primeProLicense: true, workflowModeDefaultsByLanguage: { javascript: 'run' } });
    await page.addInitScript(
      ({ endpoint }) =>
        localStorage.setItem('lingua-ai', JSON.stringify({ state: { endpoint, apiKey: 'remote-fixture-only', model: 'gpt-fixture' }, version: 1 })),
      { endpoint: REMOTE }
    );
    await page.route(REMOTE, route => answer(route, bodies));
    await gotoApp(page);

    await createJavaScriptTab(page);
    await replaceEditorText(page, BEFORE);
    await openPaletteAction(page, language === 'es' ? 'Editar con IA' : 'Edit with AI', /edit with ai|editar con ia/i);

    const dialog = page.getByTestId('ai-edit-dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByTestId('ai-edit-provider')).toContainText('gpt-fixture');
    await dialog.getByTestId('ai-edit-instruction').fill('give the user a name');
    await dialog.getByTestId('ai-edit-send').click();

    // Nothing the model wrote runs until Run preview.
    await expect(dialog.getByTestId('ai-edit-preview')).toContainText("name: 'Ada'");
    await expect(dialog.getByTestId('ai-edit-notice')).toBeVisible();
    await expect(dialog.getByTestId('ai-edit-run-line')).toHaveCount(0);
    await dialog.getByTestId('ai-edit-run-preview').click();

    await expect(dialog.getByTestId('ai-edit-now').getByTestId('ai-edit-run-line')).toContainText('null', { timeout: 30_000 });
    await expect(dialog.getByTestId('ai-edit-preview').getByTestId('ai-edit-run-line')).toHaveText('Ada');
    const actions = dialog.getByTestId('ai-edit-actions');
    await expect(actions).toContainText(language === 'es' ? '1 error corregido' : '1 error fixed');

    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain('<<<SELECTION>>>');
    expect(bodies[0]).toContain('give the user a name');
    expect(bodies[0]).not.toContain('remote-fixture-only');

    await dialog.getByTestId('ai-edit-show-diff').click();
    await expect(dialog.getByTestId('ai-edit-diff')).toBeVisible();
    await dialog.getByTestId('ai-edit-show-diff').click();

    await dialog.getByTestId('ai-edit-instruction').press(`${mod}+Enter`);
    await expect(dialog).toHaveCount(0);
    const lines = page.locator('.monaco-editor .view-lines').first();
    await expect(lines).toContainText("name: 'Ada'");

    await page.keyboard.press(`${mod}+Z`);
    await expect(lines).toContainText('const user = null;');
  });
}

test('Edit with AI: previews Python on a Pyodide of its own with the network blocked', async ({ page }) => {
  test.setTimeout(120_000);
  const bodies: string[] = [];
  // The CSP allows this host and the route answers it, so only the preview's block policy can print offline.
  const fixed = ['from pyodide.http import pyfetch', 'try:', "    await pyfetch('https://licenses.linguacode.dev/ping')", "    print('online')", 'except Exception:', "    print('offline')"].join('\n');
  await seedSession(page, { language: 'en', primeProLicense: true, workflowModeDefaultsByLanguage: { python: 'run' } });
  await page.addInitScript(
    ({ endpoint }) =>
      localStorage.setItem('lingua-ai', JSON.stringify({ state: { endpoint, apiKey: 'remote-fixture-only', model: 'gpt-fixture' }, version: 1 })),
    { endpoint: REMOTE }
  );
  await page.route(REMOTE, route => answer(route, bodies, `\`\`\`python\n${fixed}\n\`\`\``));
  await page.route('https://licenses.linguacode.dev/ping', route => route.fulfill({ status: 200, headers: CORS, body: 'pong' }));
  await gotoApp(page);

  await createLanguageTab(page, /python/i, /\.py/i);
  await replaceEditorText(page, 'print(missing)');
  await openPaletteAction(page, 'Edit with AI', /edit with ai/i);
  const dialog = page.getByTestId('ai-edit-dialog');
  await dialog.getByTestId('ai-edit-instruction').fill('try the network');
  await dialog.getByTestId('ai-edit-send').click();
  await dialog.getByTestId('ai-edit-run-preview').click();

  await expect(dialog.getByTestId('ai-edit-now').getByTestId('ai-edit-run-line')).toContainText('missing', { timeout: 90_000 });
  await expect(dialog.getByTestId('ai-edit-preview').getByTestId('ai-edit-run-line')).toHaveText('offline', { timeout: 90_000 });
  await expect(dialog.getByTestId('ai-edit-actions')).toContainText('1 error fixed');
});

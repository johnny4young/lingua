import type { Page } from '@playwright/test';
import { clickRun, createJavaScriptTab, expect, gotoApp, seedSession, test, waitForRunCompleted } from './licenseWeb.helpers';

const endpoint = 'https://licenses.linguacode.dev/ai-explain-panel';
const FAILING = ['const user = { id: 7, profile: null };', "const greeting = 'Hello, ' + user.profile.name;", 'console.log(greeting);'].join('\n');
const FIXED = ['const user = { id: 7, profile: null };', "const greeting = 'Hello, ' + (user.profile?.name ?? 'Guest');", 'console.log(greeting);'].join('\n');
const ANSWER = `The profile is null, so reading .name throws.\n\n\`\`\`javascript\n${FIXED}\n\`\`\``;

async function replaceEditorText(page: Page, source: string) {
  await page.locator('.monaco-editor').click({ position: { x: 140, y: 42 } });
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A');
  await page.keyboard.press('Backspace');
  await page.keyboard.insertText(source);
}

for (const language of ['en', 'es'] as const) {
  test(`anchored explain panel from the error row in ${language}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    const sent: string[] = [];
    await seedSession(page, { language, primeProLicense: true, workflowModeDefaultsByLanguage: { javascript: 'run', typescript: 'run' } });
    await page.addInitScript(
      ({ endpoint }) =>
        localStorage.setItem('lingua-ai', JSON.stringify({ state: { endpoint, apiKey: 'local-fixture-only', model: 'fixture' }, version: 1 })),
      { endpoint }
    );
    await page.route(endpoint, async (route) => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' },
        });
        return;
      }
      sent.push(route.request().postData() ?? '');
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: `data: ${JSON.stringify({ choices: [{ delta: { content: ANSWER } }] })}\n\ndata: [DONE]\n\n`,
      });
    });
    await gotoApp(page);
    await createJavaScriptTab(page);
    await replaceEditorText(page, FAILING);
    await clickRun(page);
    await waitForRunCompleted(page);

    await expect(page.locator('.monaco-editor .lingua-error-line')).toHaveCount(1);
    await expect(page.locator('.monaco-editor .lingua-error-glyph')).toHaveCount(1);
    const row = page.getByTestId('error-line-row');
    await expect(row).toContainText('TypeError');
    await page.getByTestId('error-line-explain').click();

    const panel = page.getByTestId('ai-explain-panel');
    await expect(panel).toBeVisible();
    await expect(page.locator('.overlay-backdrop')).toHaveCount(0);
    await expect(panel.getByTestId('ai-explain-preview')).toContainText('user.profile.name');
    expect(sent).toHaveLength(0);

    await panel.getByTestId('ai-explain-send').click();
    await expect(panel).toContainText('The profile is null');
    expect(sent).toHaveLength(1);
    await panel.getByTestId('ai-explain-helpful').click();
    await expect(panel.getByTestId('ai-explain-helpful')).toHaveAttribute('aria-pressed', 'true');
    const ratings = await page.evaluate(() => localStorage.getItem('lingua-explain-ratings') ?? '');
    expect(ratings).toContain('"kind":"TypeError"');
    expect(ratings).not.toContain('profile');

    await panel.getByTestId('ai-explain-chip').first().click();
    await expect(panel.getByTestId('ai-explain-followup-question')).toHaveCount(1);
    expect(sent).toHaveLength(2);

    await panel.getByTestId('ai-explain-panel-pin').click();
    await panel.getByTestId('ai-explain-apply').click();
    await expect(panel.getByTestId('ai-explain-apply-diff')).toContainText("user.profile?.name ?? 'Guest'");
    await panel.getByTestId('ai-explain-apply-confirm').click();
    await waitForRunCompleted(page);
    await expect(page.locator('.monaco-editor .lingua-error-line')).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(panel).toBeVisible();
    // Cmd/Ctrl+J puts the cursor back on the explained line.
    await page.locator('.monaco-editor').click({ position: { x: 140, y: 12 } });
    await page.keyboard.press('ControlOrMeta+J');
    await page.keyboard.press('End');
    await page.keyboard.insertText(' // jumped');
    await expect(page.locator('.monaco-editor .view-line').nth(1)).toContainText('// jumped');
    await panel.getByTestId('ai-explain-close').click();
    await expect(panel).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}

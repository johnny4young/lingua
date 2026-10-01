import { mkdirSync } from 'node:fs';
import {
  expect,
  gotoApp,
  openCommandPalette,
  paletteInput,
  seedSession,
  test,
} from './licenseWeb.helpers';

const endpoint = 'https://licenses.linguacode.dev/ai-fixture';
for (const language of ['en', 'es'] as const) {
  test(`AI consent, streaming, and resource limits in ${language}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('console', message => {
      if (message.type() === 'error') errors.push(message.text());
    });
    let requests = 0;
    await seedSession(page, {
      language,
      primeProLicense: true,
      workflowModeDefaultsByLanguage: { javascript: 'run', typescript: 'run' },
    });
    await page.addInitScript(
      ({ endpoint }) =>
        localStorage.setItem(
          'lingua-ai',
          JSON.stringify({
            state: { endpoint, apiKey: 'local-fixture-only', model: 'fixture' },
            version: 1,
          })
        ),
      { endpoint }
    );
    await page.route(endpoint, async route => {
      if (route.request().method() === 'OPTIONS') {
        await route.fulfill({
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'authorization,content-type',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
          },
        });
        return;
      }
      requests++;
      const body =
        requests === 1
          ? 'data: {"choices":[{"delta":{"content":"Fixture answer."}}]}\n\ndata: [DONE]\n\n'
          : `data: ${JSON.stringify({ choices: [{ delta: { content: 'x'.repeat(256 * 1024 + 1) } }] })}\n\ndata: [DONE]\n\n`;
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body,
      });
    });
    await gotoApp(page);
    await expect(page.getByTestId('license-badge')).toContainText(/Pro/i);
    const editor = page.locator('.monaco-editor').first();
    await expect(editor).toBeVisible();
    await editor.click({ position: { x: 100, y: 35 } });
    await page.keyboard.press('ControlOrMeta+A');
    await page.keyboard.insertText('console.log(1);');
    await openCommandPalette(page);
    await paletteInput(page).fill(
      language === 'en' ? 'Explain selected code' : 'Explicar el código'
    );
    await page
      .getByRole('option', {
        name:
          language === 'en'
            ? /Explain selected code with AI/
            : /Explicar el código seleccionado con IA/,
      })
      .click();
    await expect(page.getByTestId('ai-explain-code-preview')).toBeVisible();
    expect(requests).toBe(0);
    await page.getByTestId('ai-explain-code-send').click();
    await expect(page.getByTestId('ai-explain-result')).toContainText('Fixture answer.');
    await page.getByTestId('ai-explain-code-followup-input').fill('More detail');
    await page.getByTestId('ai-explain-code-followup-send').click();
    await expect(page.getByTestId('ai-explain-code-error')).toContainText(
      language === 'en'
        ? 'response exceeded its size limit'
        : 'respuesta de IA superó el límite de tamaño'
    );
    await expect(page.getByTestId('ai-explain-code-error')).not.toContainText(
      language === 'en' ? 'request failed' : 'falló'
    );
    await expect(page.getByTestId('ai-explain-code-followup-input')).not.toBeVisible();
    expect(requests).toBe(2);
    mkdirSync('output/review/ai-response-budgets', { recursive: true });
    await page.screenshot({ path: `output/review/ai-response-budgets/web-${language}-limit.png` });
    expect(errors).toEqual([]);
  });
}

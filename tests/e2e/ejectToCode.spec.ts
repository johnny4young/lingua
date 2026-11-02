/**
 * Labs › GUI actions to code: an HTTP request opens as a JS tab that runs in
 * the Worker without its secrets, and the grid's SQL saves as a snippet.
 */
import type { Page } from '@playwright/test';
import { clickRun, expect, gotoApp, seedSession, test, waitForRunCompleted, waitForSeededWorkspaceSettled } from './licenseWeb.helpers';

const API = 'https://api.example.com';
const SECRET = 'tok-SECRET-value';

async function openRequest(page: Page, language: 'en' | 'es', flag: boolean): Promise<string[]> {
  const seen: string[] = [];
  await page.route(`${API}/**`, async (route) => {
    const request = route.request();
    if (request.method() !== 'OPTIONS') seen.push(`${request.method()} ${request.url()} ${(await request.allHeaders())['authorization'] ?? ''}`);
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization,content-type' },
      body: 'from-the-api',
    });
  });
  await seedSession(page, { language });
  await page.addInitScript(
    ({ flag, API, SECRET }) => {
      const settings = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
      settings.state.featureFlags = flag ? { ejectToCode: true } : {};
      localStorage.setItem('lingua-settings', JSON.stringify(settings));
      if (localStorage.getItem('lingua-workspace-tool-state')) return;
      const request = { id: 'r', name: 'Users', method: 'GET', url: `${API}/users?page=1`, headers: [], auth: { kind: 'bearer', token: '{{apiToken}}' }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', responses: [], captures: [], assertions: [], params: [], version: 1 };
      const environment = { id: 'prod', name: 'prod', variables: [{ id: 'v', key: 'apiToken', value: SECRET, secret: true }] };
      localStorage.setItem('lingua-workspace-tool-state', JSON.stringify({ state: { requests: [request], activeRequestId: 'r', environments: [environment], activeEnvironmentId: 'prod' }, version: 0 }));
    },
    { flag, API, SECRET }
  );
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(page.getByTestId('http-workspace-panel')).toBeVisible();
  await expect(page.getByTestId('http-request-editor-copy-menu')).toBeEnabled();
  return seen;
}

const editorText = async (page: Page) => (await page.locator('.monaco-editor .view-lines').first().innerText()).replace(/ /g, ' ');

for (const language of ['en', 'es'] as const) {
  test(`opens a request as a JS tab without its secret (${language})`, async ({ page }) => {
    const seen = await openRequest(page, language, true);
    await page.getByTestId('http-request-editor-copy-menu').click();
    await page.getByTestId('http-request-editor-open-tab').click();

    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('fetch');
    const source = await editorText(page);
    expect(source).toContain('{{apiToken}}');
    expect(source).toContain(language === 'en' ? 'Secrets stay out of this file' : 'Los secretos no quedan en este archivo');
    expect(source).not.toContain(SECRET);

    // It waits for Run: opening it sends nothing.
    await page.waitForTimeout(1_500);
    expect(seen).toEqual([]);

    await clickRun(page);
    await waitForRunCompleted(page);
    await expect.poll(() => seen.length).toBe(1);
    expect(seen[0]).toBe(`GET ${API}/users?page=1 Bearer {{apiToken}}`);
    await expect(page.getByTestId('console-entry-row').filter({ hasText: 'from-the-api' }).first()).toBeVisible();
  });
}

test('keeps the menu as it was without the flag', async ({ page }) => {
  await openRequest(page, 'en', false);
  await page.getByTestId('http-request-editor-copy-menu').click();
  await expect(page.getByTestId('http-request-editor-copy-fetch')).toBeVisible();
  await expect(page.getByTestId('http-request-editor-open-tab')).toHaveCount(0);
});

test('saves the SQL a grid filter generates as a snippet', async ({ page }) => {
  await seedSession(page, { language: 'en' });
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
    settings.state.featureFlags = { ejectToCode: true };
    localStorage.setItem('lingua-settings', JSON.stringify(settings));
  });
  await gotoApp(page);
  await page.keyboard.press('ControlOrMeta+Alt+S');
  await page.getByTestId('sql-query-list-create').click();
  await page.getByTestId('sql-query-editor-monaco').locator('.monaco-editor').click({ position: { x: 120, y: 20 } });
  await page.keyboard.insertText("SELECT * FROM (VALUES ('Cali'), ('Pasto')) t(city)");
  await page.keyboard.press('ControlOrMeta+Enter');
  await page.getByTestId('sql-result-preview-row').first().locator('td[data-column="city"]').click({ button: 'right' });
  await page.getByTestId('sql-cell-menu-filter').click();
  await expect(page.getByTestId('sql-grid-sql')).toContainText(`WHERE "city" = 'Cali'`);
  await page.getByTestId('sql-grid-sql-snippet').click();
  await expect
    .poll(() => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('lingua-snippets') ?? '{}'))))
    .toContain(`WHERE \\"city\\" = 'Cali'`);
});

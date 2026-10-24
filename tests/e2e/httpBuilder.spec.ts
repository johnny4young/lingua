import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test, waitForSeededWorkspaceSettled } from './licenseWeb.helpers';

const API = 'https://api.lingua.test';
const users = {
  items: [
    { id: 101, name: 'runtime', homepage: `https://example.com/${'long-path-segment/'.repeat(12)}end` },
    { id: 102, name: 'editor' },
  ],
  page: 1,
};

async function openBuilder(page: Page, language: 'en' | 'es'): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(`${API}/**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify(users),
    })
  );
  await seedSession(page, { language });
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(page.getByTestId('http-workspace-panel')).toBeVisible();
  const create = page.getByTestId('http-request-list-create');
  if (await create.isVisible().catch(() => false)) await create.click();
  else await page.getByTestId('http-workspace-empty-create').click();
}

test('explains a disabled Send, highlights variables, and folds, searches and captures the JSON body', async ({ page }) => {
  await openBuilder(page, 'en');
  const url = page.getByTestId('http-request-editor-url');
  const send = page.getByTestId('http-request-editor-send');
  const hint = page.getByTestId('http-request-editor-url-hint');

  await expect(send).toBeDisabled();
  await expect(hint).toHaveText('Enter a URL to send.');
  await expect(send).toHaveAttribute('aria-describedby', 'http-request-editor-url-hint');

  await url.fill('{{base}}/users');
  await expect(page.getByTestId('http-request-editor-url-token')).toHaveAttribute('data-state', 'missing');
  await expect(hint).toHaveText('Choose an environment that sets base to send.');

  await url.fill(`${API}/users`);
  await expect(hint).toHaveCount(0);
  await expect(page.getByTestId('http-request-editor-url-field')).toHaveAttribute('data-mirrored', 'false');
  await send.click();

  const tree = page.getByTestId('http-response-preview-body-tree');
  await expect(tree).toBeVisible();
  await expect(tree).toHaveAttribute('data-wrap', 'false');
  await expect(page.getByTestId('http-json-row').first()).toHaveText('items: [2]');
  const second = page.locator('[data-testid="http-json-row"][data-pointer="/items/1"]');
  await second.click();
  await page.keyboard.press('ArrowLeft');
  await expect(second).toHaveAttribute('aria-expanded', 'false');

  await page.getByTestId('http-response-preview-search').fill('EDITOR');
  await expect(page.getByTestId('http-response-preview-search-count')).toHaveText('1 match');
  await expect(page.locator('[data-hit="true"]')).toHaveAttribute('data-pointer', '/items/1/name');

  const idRow = page.locator('[data-testid="http-json-row"][data-pointer="/items/0/id"]');
  await idRow.hover();
  await idRow.getByRole('button', { name: 'Capture items[0].id as a variable' }).click();
  await expect(page.getByTestId('http-request-editor-tab-capture')).toHaveAttribute('data-active', 'true');
  await expect(idRow.getByTestId('http-json-captured')).toHaveText('captured → id');

  await page.getByTestId('http-response-preview-wrap-toggle').check();
  await expect(tree).toHaveAttribute('data-wrap', 'true');
});

test('shows the Send hint and tree controls in Spanish', async ({ page }) => {
  await openBuilder(page, 'es');
  await expect(page.getByTestId('http-request-editor-url-hint')).toHaveText('Escribe una URL para enviar.');
  await page.getByTestId('http-request-editor-url').fill('localhost');
  await expect(page.getByTestId('http-request-editor-url-hint')).toHaveText(
    'Escribe una URL completa que empiece con https:// o http:// para enviar.'
  );
  await page.getByTestId('http-request-editor-url').fill(`${API}/users`);
  await page.getByTestId('http-request-editor-send').click();
  await expect(page.getByRole('button', { name: 'Contraer 1' })).toBeVisible();
  await expect(page.getByTestId('http-response-preview-wrap-toggle')).not.toBeChecked();
});

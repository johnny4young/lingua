import type { Page } from '@playwright/test';
import { expect, gotoApp, seedSession, test, waitForSeededWorkspaceSettled } from './licenseWeb.helpers';

// A public-looking host: .test names count as local and never wait for the network.
const API = 'https://api.example.com';
const users = {
  items: [
    { id: 101, name: 'runtime', homepage: `https://example.com/${'long-path-segment/'.repeat(12)}end` },
    { id: 102, name: 'editor' },
  ],
  page: 1,
};

async function openBuilder(
  page: Page,
  language: 'en' | 'es',
  scopes?: { environments?: unknown[]; activeEnvironmentId?: string; requests?: unknown[]; activeRequestId?: string },
  flags: Record<string, boolean> = { httpScopes: true }
): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route(`${API}/**`, (route) =>
    route.fulfill({
      status: 200,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify(users),
    })
  );
  await seedSession(page, { language });
  if (scopes) {
    await page.addInitScript(
      ({ tools, featureFlags }) => {
        const settings = JSON.parse(localStorage.getItem('lingua-settings') ?? '{"state":{},"version":0}');
        settings.state.featureFlags = featureFlags;
        localStorage.setItem('lingua-settings', JSON.stringify(settings));
        if (!localStorage.getItem('lingua-workspace-tool-state')) {
          localStorage.setItem('lingua-workspace-tool-state', JSON.stringify({ state: { requests: [], ...tools }, version: 1 }));
        }
      },
      { tools: scopes, featureFlags: flags }
    );
  }
  await gotoApp(page);
  await waitForSeededWorkspaceSettled(page);
  await page.keyboard.press('ControlOrMeta+Shift+K');
  await expect(page.getByTestId('http-workspace-panel')).toBeVisible();
  if (scopes?.activeRequestId) return;
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
  await expect(page.getByRole('tree', { name: 'JSON de la respuesta' })).toBeVisible();
  await expect(page.getByTestId('http-response-preview-wrap-toggle')).not.toBeChecked();
});

test('shows the total on the Timing tab of the web build', async ({ page }) => {
  await openBuilder(page, 'en');
  await page.getByTestId('http-request-editor-url').fill(`${API}/users`);
  await page.getByTestId('http-request-editor-send').click();
  await page.getByRole('button', { name: 'Timing' }).click();
  await expect(page.getByTestId('http-timing')).toHaveAttribute('data-phases', 'false');
  await expect(page.getByTestId('http-timing')).toContainText('The browser reports only the total');
});

test('holds sends while offline, sends reads by themselves and leaves writes for Send now', async ({ page, context }) => {
  await openBuilder(page, 'en');
  const url = page.getByTestId('http-request-editor-url');
  const send = page.getByTestId('http-request-editor-send');
  await url.fill(`${API}/users`);
  await context.setOffline(true);
  await expect(send).toHaveText('Send when online');
  await send.click();
  await expect(page.getByTestId('http-request-editor-queued')).toContainText('Queued');
  await expect(page.getByTestId('http-response-preview-body-tree')).toHaveCount(0);
  await context.setOffline(false);
  await expect(page.getByTestId('http-response-preview-body-tree')).toBeVisible();
  await expect(send).toHaveText('Send');

  await page.getByTestId('http-request-editor-method').selectOption('POST');
  await context.setOffline(true);
  await send.click();
  await expect(page.getByTestId('http-request-editor-queued')).toBeVisible();
  await context.setOffline(false);
  await expect(send).toHaveText('Send now');
  await send.click();
  await expect(send).toHaveText('Send');
});

test('resolves collection, environment and request variables and copies a missing one from another environment', async ({ page }) => {
  const NOW = '2026-10-25T00:00:00.000Z';
  const env = (id: string, name: string, variables: Array<[string, string]>) => ({
    version: 1,
    id,
    name,
    variables: variables.map(([key, value], index) => ({ id: `${id}-${index}`, key, value, secret: false })),
    createdAt: NOW,
    updatedAt: NOW,
  });
  await openBuilder(page, 'en', {
    environments: [env('prod', 'prod', [['base', API]]), { ...env('stg', 'staging', [['pageSize', '50']]), variables: [...env('stg', 'staging', [['pageSize', '50']]).variables, { id: 'stg-t', key: 'token', value: 'stg-only', secret: true }] }],
    activeEnvironmentId: 'prod',
  });
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(API)) sent.push(request.url());
  });
  await page.getByTestId('http-request-editor-url').fill('{{base}}/repos/{{owner}}?per_page={{pageSize}}&t={{token}}');

  await page.getByTestId('http-environment-manage').click();
  await page.getByTestId('http-environment-collection-tab').click();
  const collection = page.getByTestId('http-environment-collection');
  await collection.getByTestId('http-environment-var-add').click();
  await collection.getByTestId('http-environment-var-key').fill('owner');
  await collection.getByTestId('http-environment-var-value').fill('octocat');
  await page.keyboard.press('Escape');

  const tokens = page.getByTestId('http-request-editor-url-token');
  await expect(tokens).toHaveCount(4);
  await expect(tokens.nth(0)).toHaveAttribute('data-state', 'environment');
  await expect(tokens.nth(1)).toHaveAttribute('data-state', 'collection');
  await expect(tokens.nth(2)).toHaveAttribute('data-state', 'missing');
  await expect(tokens.nth(3)).toHaveAttribute('data-state', 'missing');
  const send = page.getByTestId('http-request-editor-send');
  await expect(send).toBeDisabled();
  await expect(send).toHaveAttribute('data-tinted', 'true');

  // The secret comes over as its key only, and the manager opens on it to type this environment's value.
  await page.getByTestId('http-request-editor-url-hint-add').click();
  const focused = page.locator(':focus');
  await expect(focused).toHaveAttribute('data-testid', 'http-environment-var-value');
  await expect(focused).toHaveAttribute('type', 'password');
  await expect(focused).toHaveValue('');
  await page.keyboard.insertText('prod-token');
  await page.keyboard.press('Escape');
  await expect(tokens.nth(2)).toHaveAttribute('data-state', 'environment');
  await expect(tokens.nth(3)).toHaveAttribute('data-state', 'environment');
  await page.getByTestId('http-request-editor-tab-vars').click();
  const vars = page.getByTestId('http-request-editor-vars');
  await vars.getByTestId('http-environment-var-add').click();
  await vars.getByTestId('http-environment-var-key').fill('owner');
  await vars.getByTestId('http-environment-var-value').fill('hubot');
  await expect(tokens.nth(1)).toHaveAttribute('data-state', 'request');

  await send.click();
  await expect(page.getByTestId('http-response-preview-body-tree')).toBeVisible();
  expect(sent).toContain(`${API}/repos/hubot?per_page=50&t=prod-token`);
  expect(sent.join(' ')).not.toContain('stg-only');
});

test('chains a request to the response of another through a tag, sending the source first', async ({ page }) => {
  const NOW = '2026-10-25T00:00:00.000Z';
  const base = { version: 1, method: 'GET', headers: [], createdAt: NOW, updatedAt: NOW };
  await openBuilder(
    page,
    'en',
    {
      requests: [
        { ...base, id: 'get-repo', name: 'Get repo', url: `${API}/repos/{{owner}}/lingua` },
        {
          ...base,
          id: 'list-repos',
          name: 'List repos',
          url: `${API}/users/octocat/repos`,
          captures: [{ id: 'cap', source: 'body-json', path: '[0].owner.login', targetVariable: 'owner', enabled: true }],
        },
      ],
      activeRequestId: 'get-repo',
    },
    { httpChainTags: true }
  );
  await page.route(`${API}/users/octocat/repos`, (route) =>
    route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify([{ owner: { login: 'octocat' } }]) })
  );
  const sent: string[] = [];
  page.on('request', (request) => {
    if (request.url().startsWith(API)) sent.push(request.url());
  });
  const send = page.getByTestId('http-request-editor-send');
  await expect(send).toBeDisabled();
  await expect(page.getByTestId('http-request-editor-url-hint')).toContainText('owner comes from List repos');
  await expect(page.getByTestId('http-chain-node')).toHaveCount(2);

  await page.getByTestId('http-chain-chip').click();
  await expect(page.getByTestId('http-chain-tag-source')).toContainText('List repos · GET');
  await expect(page.getByTestId('http-chain-tag-preview')).toHaveText('No 2xx response yet');
  await page.getByRole('radio', { name: 'Send source first' }).click();
  await expect(send).toBeEnabled();

  await send.click();
  await expect(page.getByTestId('http-response-preview-body-tree')).toBeVisible();
  expect(sent).toEqual([`${API}/users/octocat/repos`, `${API}/repos/octocat/lingua`]);
  await expect(page.getByTestId('http-chain-tag-preview')).toContainText('"octocat"');
});
